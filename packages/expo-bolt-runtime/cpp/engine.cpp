#include "engine.h"
#include "llama.h"
#include "prefix-cache.h"
#include "chat.h"
#include "ggml-backend.h"
#if defined(BOLT_VULKAN)
#include "ggml-vulkan.h"
#endif
#if defined(BOLT_OPENCL)
#include "ggml-opencl.h"
#endif
#include <nlohmann/json.hpp>
#include <algorithm>
#include <chrono>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <atomic>
#include <cstdlib>
#include <filesystem>
#include <cmath>
#include <sys/resource.h>
#if defined(__ANDROID__)
#include <android/log.h>
#endif
#if defined(__APPLE__)
#include <mach/mach.h>
#endif
using json = nlohmann::ordered_json;
using Clock = std::chrono::steady_clock;
static llama_model * model = nullptr;
static llama_context * ctx = nullptr;
static constexpr uint32_t context_tokens = 16384;
static common_chat_templates_ptr templates;
static std::vector<llama_token> cached_tokens;
static std::unique_ptr<bolt_cache::Store> prefix_cache;
static std::string prefix_cache_identity;
static std::mutex engine_mutex;
static std::atomic<bool> cancelled{false};
static std::mutex log_mutex;
static std::string last_error;
struct BoltTrace {
    std::string directory;
    bool enabled = false;
    bool complete = false;
    int index = 0;
};
static BoltTrace trace;
static bool trace_tensor(ggml_tensor * tensor, bool ask, void *) {
    const bool selected = trace.enabled && !trace.complete &&
        tensor->type == GGML_TYPE_F32 && ggml_is_contiguous(tensor) &&
        tensor->op != GGML_OP_NONE && tensor->op != GGML_OP_VIEW &&
        tensor->op != GGML_OP_RESHAPE && tensor->op != GGML_OP_PERMUTE &&
        tensor->op != GGML_OP_TRANSPOSE && ggml_nbytes(tensor) <= 8 * 1024 * 1024;
    if (ask) return selected;
    if (!selected) return true;
    std::vector<float> values(ggml_nelements(tensor));
    ggml_backend_tensor_get(tensor, values.data(), 0, ggml_nbytes(tensor));
    const auto filename = std::to_string(trace.index++) + ".f32";
    std::ofstream raw(trace.directory + "/" + filename, std::ios::binary);
    raw.write(reinterpret_cast<const char *>(values.data()), values.size() * sizeof(float));
    double sum = 0, sum_sq = 0, max_abs = 0;
    int nonfinite = 0;
    for (float v : values) {
        if (!std::isfinite(v)) { ++nonfinite; continue; }
        sum += v; sum_sq += double(v) * v; max_abs = std::max(max_abs, std::abs(double(v)));
    }
    std::ofstream meta(trace.directory + "/trace.ndjson", std::ios::app);
    meta << json({{"file",filename},{"name",tensor->name},{"op",ggml_op_name(tensor->op)},
        {"shape",{tensor->ne[0],tensor->ne[1],tensor->ne[2],tensor->ne[3]}},
        {"count",values.size()},{"sum",sum},{"rms",std::sqrt(sum_sq / values.size())},
        {"max_abs",max_abs},{"nonfinite",nonfinite}}).dump() << "\n";
    if (std::string(tensor->name) == "result_output") trace.complete = true;
    return true;
}
static void native_log(enum ggml_log_level level, const char * text, void *) {
    if (level == GGML_LOG_LEVEL_DEBUG) return;
    if (level == GGML_LOG_LEVEL_ERROR) {
        std::lock_guard<std::mutex> lock(log_mutex);
        last_error += text;
        if (last_error.size() > 4096) last_error.erase(0, last_error.size() - 4096);
    }
#if defined(__ANDROID__)
    __android_log_write(level == GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO, "BoltLlama", text);
#endif
}
void bolt_cancel() { cancelled=true; }
static double memory_mb() {
#if defined(__APPLE__)
    task_vm_info_data_t v{}; mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
    if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&v, &count) == KERN_SUCCESS)
        return v.phys_footprint / 1048576.0;
#else
    std::ifstream f("/proc/self/status"); std::string line;
    while (std::getline(f,line)) if(line.rfind("VmRSS:",0)==0) return std::stod(line.substr(6))/1024.0;
#endif
    return 0;
}
static double ms(Clock::time_point a, Clock::time_point b) { return std::chrono::duration<double,std::milli>(b-a).count(); }
static void event(const BoltEvent & emit, const json & v) { emit(v.dump(-1,' ',false,json::error_handler_t::replace)); }
void bolt_close() {
    cached_tokens.clear();
    prefix_cache.reset(); prefix_cache_identity.clear();
    templates.reset();
    if(ctx) { llama_free(ctx); ctx=nullptr; }
    if(model) { llama_model_free(model); model=nullptr; }
}
void bolt_load(const std::string & path,int gpu_layers,int threads,const BoltEvent & emit) {
    std::lock_guard<std::mutex> lock(engine_mutex);
    try {
        bolt_close(); auto start=Clock::now();
        { std::lock_guard<std::mutex> log_lock(log_mutex); last_error.clear(); }
        llama_log_set(native_log, nullptr); ggml_log_set(native_log, nullptr);
        ggml_backend_load_all(); llama_backend_init();
        auto mp=llama_model_default_params();
        mp.n_gpu_layers=gpu_layers; mp.load_mode=LLAMA_LOAD_MODE_MMAP;
        mp.lazy_mode=LLAMA_LAZY_MODE_AUTO;
        model=llama_model_load_from_file(path.c_str(),mp);
        if(!model) {
            std::lock_guard<std::mutex> log_lock(log_mutex);
            throw std::runtime_error("Model loading failed: " + last_error);
        }
        auto cp=llama_context_default_params();
        trace = {};
        if (const char * directory = std::getenv("BOLT_TRACE_DIR")) {
            trace.directory = directory;
            std::filesystem::create_directories(trace.directory);
            cp.cb_eval = trace_tensor;
        }
        cp.op_offload = gpu_layers > 0;
        cp.offload_kqv = gpu_layers > 0;
        cp.n_ctx=context_tokens; cp.n_batch=256; cp.n_ubatch=64;
#if defined(BOLT_OPENCL)
        if (gpu_layers > 0) cp.n_ubatch=256;
#endif
#if defined(BOLT_VULKAN)
        char gpu_description[128]{};
        if (gpu_layers > 0 && ggml_backend_vk_get_device_count() > 0) {
            ggml_backend_vk_get_device_description(0, gpu_description, sizeof(gpu_description));
            if (std::string(gpu_description).find("Adreno") != std::string::npos) cp.n_ubatch=256;
        }
#endif
        if (const char * ubatch = std::getenv("BOLT_UBATCH")) cp.n_ubatch = std::clamp(std::atoi(ubatch), 1, 256);
        cp.n_threads=threads; cp.n_threads_batch=threads;
        cp.flash_attn_type=std::getenv("BOLT_NO_FLASH_ATTN") ? LLAMA_FLASH_ATTN_TYPE_DISABLED : LLAMA_FLASH_ATTN_TYPE_AUTO; cp.no_perf=false;
        ctx=llama_init_from_model(model,cp);
        if(!ctx) throw std::runtime_error("Context allocation failed");
        templates=common_chat_templates_init(model,"");
        if (const char * directory = std::getenv("BOLT_PREFIX_CACHE_DIR")) {
            try {
                prefix_cache = std::make_unique<bolt_cache::Store>(directory);
                const auto model_hash = prefix_cache->model_identity(path);
                prefix_cache_identity = std::string(BOLT_CACHE_BUILD_ID) + ":" + model_hash + ":" +
                    std::to_string(llama_n_ctx(ctx)) + ":" + std::to_string(gpu_layers) + ":" +
                    std::to_string(threads) + ":" + std::to_string(cp.n_ubatch) + ":" + std::to_string(cp.flash_attn_type) + ":" +
                    (std::getenv("BOLT_CACHE_DEVICE_ID") ? std::getenv("BOLT_CACHE_DEVICE_ID") : "");
                for (const char * name : {"GGML_OPENCL_Q4K_GEMV_TILED", "GGML_OPENCL_DISABLE_FUSION", "GGML_OPENCL_ADRENO_XMEM_GEMM",
                        "GGML_VK_DISABLE_FUSION", "GGML_VK_DISABLE_GRAPH_OPTIMIZE", "GGML_VK_DISABLE_ASYNC", "GGML_VK_DISABLE_F16", "GGML_VK_DISABLE_MMVQ"}) {
                    prefix_cache_identity += std::string(":") + name + "=" + (std::getenv(name) ? std::getenv(name) : "");
                }
            } catch (...) {
                prefix_cache.reset();
                event(emit,{{"type","prefix_cache_unavailable"}});
            }
        }
        char desc[256]{}; llama_model_desc(model,desc,sizeof(desc));
        event(emit,{{"type","loaded"},{"load_ms",ms(start,Clock::now())},{"memory_mib",memory_mb()},
                    {"memory_metric",
#if defined(__APPLE__)
                    "phys_footprint"
#else
                    "rss"
#endif
                    },{"model",desc},{"gpu_layers_requested",gpu_layers},{"threads",threads},
                    {"backend",
#if defined(BOLT_OPENCL)
                    gpu_layers > 0 ? "OpenCL" : "CPU"
#elif defined(BOLT_VULKAN)
                    gpu_layers > 0 ? "Vulkan" : "CPU"
#else
                    gpu_layers > 0 ? "Metal" : "CPU"
#endif
                    },
                    {"context",llama_n_ctx(ctx)},{"batch",256},{"ubatch",cp.n_ubatch},{"flash_attention",cp.flash_attn_type != LLAMA_FLASH_ATTN_TYPE_DISABLED},{"thinking",false},
                    {"temperature",1.0},{"top_p",0.95},{"seed",42},{"system_info",llama_print_system_info()}});
    } catch(const std::exception & e) { event(emit,{{"type","error"},{"message",e.what()}}); }
}
void bolt_generate(const std::string & messages_json,int max_tokens,const std::string & tag,const BoltEvent & emit) {
    std::lock_guard<std::mutex> lock(engine_mutex);
    std::atomic<bool> running{true}; std::atomic<double> peak{memory_mb()};
    std::thread sampler([&]{ while(running) { double m=memory_mb(); if(m>peak) peak=m; std::this_thread::sleep_for(std::chrono::milliseconds(20)); } });
    try {
        if(!ctx) throw std::runtime_error("Load model first");
        auto start=Clock::now(); cancelled=false;
        // Diagnostics are restricted to the fixed synthetic probe, never chat.
        trace.enabled = !trace.directory.empty() && tag == "gpu-short";
        common_chat_templates_inputs input; input.enable_thinking=false;
        input.chat_template_kwargs["enable_thinking"]="false";
        input.chat_template_kwargs["conversational_mode"]="false";
        auto payload=json::parse(messages_json);
        auto messages=payload.is_array()?payload:payload.at("messages");
        input.messages=common_chat_msgs_parse_oaicompat(common_json::parse(messages.dump()));
        if(payload.is_object()&&payload.contains("tools")&&!payload["tools"].empty())
            input.tools=common_chat_tools_parse_oaicompat(common_json::parse(payload["tools"].dump()));
        auto vocab=llama_model_get_vocab(model);
        common_chat_session chat(templates.get(),vocab,input);
        auto prompt=chat.prompt().str();
        int n=llama_tokenize(vocab,prompt.data(),(int)prompt.size(),nullptr,0,true,true);
        if(n>=0) throw std::runtime_error("Unexpected tokenization result");
        std::vector<llama_token> tokens(-n);
        n=llama_tokenize(vocab,prompt.data(),(int)prompt.size(),tokens.data(),tokens.size(),true,true); tokens.resize(n);
        if(n+max_tokens>llama_n_ctx(ctx)) throw std::runtime_error("Conversation exceeds the native " + std::to_string(llama_n_ctx(ctx)) + "-token context");
        // Derive only system/tool tokens, before the first user message. Two distinct
        // user sentinels make the boundary independent of token merges or templates.
        std::vector<llama_token> fixed_prefix;
        if (prefix_cache && payload.is_object() && payload.value("cache_prompt", true)) {
            auto base = json::array();
            for (const auto & message : messages) {
                if (message.value("role", "") != "system" && message.value("role", "") != "developer") break;
                base.push_back(message);
            }
            std::vector<llama_token> variants[2];
            for (int index=0; index<2; ++index) {
                auto prefix_input = input; auto probe = base;
                probe.push_back({{"role","user"},{"content",index == 0 ? "A" : "B"}});
                prefix_input.messages = common_chat_msgs_parse_oaicompat(common_json::parse(probe.dump()));
                common_chat_session prefix_chat(templates.get(),vocab,prefix_input);
                auto rendered = prefix_chat.prompt().str();
                int count = -llama_tokenize(vocab,rendered.data(),(int)rendered.size(),nullptr,0,true,true);
                if (count <= 0) throw std::runtime_error("Prefix tokenization failed");
                variants[index].resize(count);
                count = llama_tokenize(vocab,rendered.data(),(int)rendered.size(),variants[index].data(),count,true,true);
                if (count < 0) throw std::runtime_error("Prefix tokenization failed");
                variants[index].resize(count);
            }
            size_t count=0;
            while (count<variants[0].size() && count<variants[1].size() && count<tokens.size() &&
                   variants[0][count]==variants[1][count] && variants[0][count]==tokens[count]) ++count;
            if (count>=512 && count<tokens.size()) fixed_prefix.assign(tokens.begin(),tokens.begin()+count);
        }
        // Reuse only an exact token prefix. Bench fixtures explicitly disable this.
        const bool cache_prompt = payload.is_object() ? payload.value("cache_prompt", true) : true;
        int reused = 0;
        if (cache_prompt) {
            while (reused < n && reused < (int)cached_tokens.size() && tokens[reused] == cached_tokens[reused]) ++reused;
            reused = std::min(reused, n - 1); // Decode at least one token for fresh logits.
        }
        // A sliding-window cache cannot roll back beyond retained local attention.
        const auto min_position = llama_memory_seq_pos_min(llama_get_memory(ctx), 0);
        if (reused > 0 && min_position > 0 && reused < (int)cached_tokens.size()) reused = 0;
        std::string cache_origin = reused > 0 ? "memory" : "none";
        if (!fixed_prefix.empty() && reused < (int)fixed_prefix.size()) {
            try {
                const auto restore_start = Clock::now();
                event(emit,{{"type","cache_restore_begin"},{"tag",tag}});
                const auto saved = prefix_cache->candidate(prefix_cache_identity,fixed_prefix);
                if (saved) {
                    std::vector<llama_token> restored(context_tokens); size_t count=0;
                    if (llama_state_load_file(ctx,saved->path.c_str(),restored.data(),restored.size(),&count) &&
                        count==fixed_prefix.size() && std::equal(fixed_prefix.begin(),fixed_prefix.end(),restored.begin())) {
                        cached_tokens = fixed_prefix; reused = (int)fixed_prefix.size(); cache_origin = "disk";
                        event(emit,{{"type","prefix_cache_restored"},{"tag",tag},{"tokens",reused},
                            {"bytes",saved->bytes},{"elapsed_ms",ms(restore_start,Clock::now())}});
                    } else {
                        llama_memory_clear(llama_get_memory(ctx),true); cached_tokens.clear(); reused=0; cache_origin="none";
                        event(emit,{{"type","prefix_cache_rejected"},{"tag",tag}});
                    }
                }
            } catch (...) {
                llama_memory_clear(llama_get_memory(ctx),true); cached_tokens.clear(); reused=0; cache_origin="none";
                event(emit,{{"type","prefix_cache_rejected"},{"tag",tag}});
            }
        }
        if (reused == 0 || !llama_memory_seq_rm(llama_get_memory(ctx), 0, reused, -1)) {
            llama_memory_clear(llama_get_memory(ctx),true); reused = 0; cache_origin="none";
        }
        cached_tokens.resize(reused);
        llama_perf_context_reset(ctx);
        event(emit,{{"type","begin"},{"tag",tag},{"prompt_tokens",n},{"cache_reused_tokens",reused},{"cache_origin",cache_origin},{"prefill_tokens",n-reused},{"memory_mib",memory_mb()}});
        for(int i=reused;i<n;) {
            if(cancelled) throw std::runtime_error("cancelled");
            int count=std::min(256,n-i);
            if (!fixed_prefix.empty() && i < (int)fixed_prefix.size()) count=std::min(count,(int)fixed_prefix.size()-i);
            if(llama_decode(ctx,llama_batch_get_one(tokens.data()+i,count))!=0) throw std::runtime_error("Prompt evaluation failed");
            cached_tokens.insert(cached_tokens.end(), tokens.begin()+i, tokens.begin()+i+count);
            event(emit,{{"type","prefill_submitted"},{"tag",tag},{"tokens",i+count},{"prompt_tokens",n},{"elapsed_ms",ms(start,Clock::now())}});
            i+=count;
            if (!fixed_prefix.empty() && i==(int)fixed_prefix.size() && !cancelled) {
                const auto save_start=Clock::now();
                try {
                    llama_synchronize(ctx);
                    const auto estimate=llama_state_get_size(ctx);
                    const bool saved=prefix_cache->save(prefix_cache_identity,fixed_prefix,estimate,[&](const auto & file) {
                        return llama_state_save_file(ctx,file.c_str(),fixed_prefix.data(),fixed_prefix.size());
                    });
                    event(emit,{{"type",saved?"prefix_cache_saved":"prefix_cache_save_skipped"},{"tag",tag},
                        {"tokens",fixed_prefix.size()},{"estimated_bytes",estimate},{"elapsed_ms",ms(save_start,Clock::now())}});
                } catch (...) { event(emit,{{"type","prefix_cache_save_skipped"},{"tag",tag}}); }
            }
        }
        auto prompt_end=Clock::now();
        auto chain=llama_sampler_chain_init(llama_sampler_chain_default_params());
        llama_sampler_chain_add(chain,llama_sampler_init_top_p(0.95,1));
        llama_sampler_chain_add(chain,llama_sampler_init_temp(1.0));
        llama_sampler_chain_add(chain,llama_sampler_init_dist(42));
        std::string output; int count=0; double ttft=0; Clock::time_point first{},last{};
        bool eos=false; double decode_ms=0;
        for(int i=0;i<max_tokens;i++) {
            if(cancelled) break;
            auto token=llama_sampler_sample(chain,ctx,-1);
            if(llama_vocab_is_eog(vocab,token)) { eos=true; break; }
            auto now=Clock::now(); if(count==0) { first=now; ttft=ms(start,now); } last=now;
            char small[512]; int len=llama_token_to_piece(vocab,token,small,sizeof(small),0,true);
            std::string piece;
            if(len>=0) piece.assign(small,len); else { piece.resize(-len); llama_token_to_piece(vocab,token,piece.data(),piece.size(),0,true); }
            output+=piece; ++count;
            common_chat_input chunk;chunk.append(piece,token); const auto & parsed=chat.feed(chunk);
            event(emit,{{"type","token"},{"tag",tag},{"text",parsed.content},{"tokens",count}});
            auto ds=Clock::now();
            if(llama_decode(ctx,llama_batch_get_one(&token,1))!=0) { llama_sampler_free(chain); throw std::runtime_error("Token evaluation failed"); }
            cached_tokens.push_back(token);
            decode_ms+=ms(ds,Clock::now());
        }
        llama_sampler_free(chain); auto end=Clock::now();
        auto perf=llama_perf_context(ctx);
        double interval=count>1?ms(first,last):0;
        running=false; sampler.join();
        auto parsed=chat.finish(); auto calls=json::array();
        for(const auto &t:parsed.tool_calls) calls.push_back({{"name",t.name},{"arguments",t.arguments},{"id",t.id}});
        event(emit,{{"type","done"},{"tag",tag},{"text",parsed.content},{"tool_calls",calls},
            {"prompt_tokens",n},{"output_tokens",count},{"max_tokens",max_tokens},{"finish_reason",eos?"eos":"length"},
            {"cancelled",cancelled.load()},{"ttft_ms",ttft},{"prefill_ms",ms(start,prompt_end)},{"total_ms",ms(start,end)},
            {"decode_tok_s",interval>0?(count-1)*1000.0/interval:0},{"decode_compute_tok_s",decode_ms>0?count*1000.0/decode_ms:0},
            {"llama_eval_ms",perf.t_eval_ms},{"llama_eval_tokens",perf.n_eval},
            {"peak_memory_mib",peak.load()},{"end_memory_mib",memory_mb()},{"prompt_cache",cache_prompt},{"cache_reused_tokens",reused},{"prefill_tokens",n-reused}});
    } catch(const std::exception & e) {
        cached_tokens.clear();
        running=false; if(sampler.joinable())sampler.join();
        event(emit,{{"type","error"},{"tag",tag},{"message",e.what()}});
    }
}
