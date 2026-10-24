#include "engine.h"
#include <nlohmann/json.hpp>
#include <cstdarg>
#if defined(BOLT_VULKAN) || defined(BOLT_OPENCL)
#include <android/log.h>
#include "ggml.h"
#include "ggml-backend.h"
#include "ggml-alloc.h"
#if defined(BOLT_OPENCL)
#include "ggml-opencl.h"
#else
#include "ggml-vulkan.h"
#endif
#include "ggml-cpu.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <vector>

static ggml_backend_t probe_gpu_backend() {
#if defined(BOLT_OPENCL)
    return ggml_backend_opencl_init();
#else
    return ggml_backend_vk_init(0);
#endif
}
static const char * probe_gpu_name() {
#if defined(BOLT_OPENCL)
    return "opencl";
#else
    return "vulkan";
#endif
}
static thread_local const BoltEvent * probe_emit = nullptr;
static void probe_result(const char * format, ...) {
    char text[4096]; va_list args; va_start(args, format);
    std::vsnprintf(text, sizeof(text), format, args); va_end(args);
    auto result = nlohmann::ordered_json::parse(text);
    result["type"] = "kernel_result";
    (*probe_emit)(result.dump());
}
static int probe_attention(int64_t dim, int64_t nq, int64_t nk, int64_t hkv, bool cpu, bool half, bool strided, bool causal) {
    try {
        const int64_t hq = 8;
        if (dim < 8 || dim > 512 || dim % 8 || nq < 1 || nq > 256 || nk < nq || nk > 8192 || hkv < 1 || hq % hkv) return 9;
        auto * ctx = ggml_init({2 * 1024 * 1024, nullptr, true});
        const auto type = half ? GGML_TYPE_F16 : GGML_TYPE_F32;
        auto * q = ggml_new_tensor_3d(ctx, GGML_TYPE_F32, dim, nq, hq);
        auto * kr = ggml_new_tensor_3d(ctx, type, dim, strided ? hkv : nk, strided ? nk : hkv);
        auto * vr = ggml_dup_tensor(ctx, kr);
        auto * k = strided ? ggml_permute(ctx, kr, 0, 2, 1, 3) : kr;
        auto * v = strided ? ggml_permute(ctx, vr, 0, 2, 1, 3) : vr;
        auto * mask = causal ? ggml_new_tensor_2d(ctx, GGML_TYPE_F16, nk, nq) : nullptr;
        const float scale = 1.0f / std::sqrt(float(dim));
        auto * output = ggml_flash_attn_ext(ctx, q, k, v, mask, scale, 0.0f, 0.0f);
        ggml_prec_set_acc(output, GGML_PREC_F32);
        auto * graph = ggml_new_graph_custom(ctx, 128, false);
        ggml_build_forward_expand(graph, output);
        auto backend = cpu ? ggml_backend_cpu_init() : probe_gpu_backend();
        if (!backend) return 3;
        auto buffer = ggml_backend_alloc_ctx_tensors(ctx, backend);
        if (!buffer) return 4;
        std::vector<float> qf(dim * nq * hq), kf(dim * nk * hkv), vf(kf.size()), y(qf.size());
        uint32_t state = 0x31415926u;
        const auto next = [&state]() {
            state = state * 1664525u + 1013904223u;
            return (static_cast<int>((state >> 8) % 2001u) - 1000) / 2048.0f;
        };
        for (auto * data : {&qf, &kf, &vf}) for (float & f : *data) f = next();
        ggml_backend_tensor_set(q, qf.data(), 0, qf.size() * sizeof(float));
        const auto upload = [&](ggml_tensor * t, std::vector<float> & data) {
            if (half) {
                std::vector<ggml_fp16_t> packed(data.size());
                ggml_fp32_to_fp16_row(data.data(), packed.data(), data.size());
                ggml_backend_tensor_set(t, packed.data(), 0, packed.size() * sizeof(ggml_fp16_t));
                ggml_fp16_to_fp32_row(packed.data(), data.data(), data.size());
            } else ggml_backend_tensor_set(t, data.data(), 0, data.size() * sizeof(float));
        };
        upload(kr, kf); upload(vr, vf);
        if (mask) {
            std::vector<ggml_fp16_t> mf(nk * nq);
            for (int64_t i = 0; i < nq; ++i) for (int64_t j = 0; j < nk; ++j)
                mf[i * nk + j] = ggml_fp32_to_fp16(j <= nk - nq + i ? 0.0f : -INFINITY);
            ggml_backend_tensor_set(mask, mf.data(), 0, mf.size() * sizeof(ggml_fp16_t));
        }
        if (ggml_backend_graph_compute(backend, graph) != GGML_STATUS_SUCCESS) return 5;
        ggml_backend_synchronize(backend);
        ggml_backend_tensor_get(output, y.data(), 0, y.size() * sizeof(float));
        double err2 = 0, ref2 = 0, max_error = 0;
        const auto kv_index = [&](int64_t c, int64_t t, int64_t h) { return strided ? (t * hkv + h) * dim + c : (h * nk + t) * dim + c; };
        for (int64_t i = 0; i < nq; ++i) for (int64_t h = 0; h < hq; ++h) {
            const int64_t kh = h / (hq / hkv), count = causal ? nk - nq + i + 1 : nk;
            std::vector<double> scores(count);
            double max_score = -INFINITY, denom = 0;
            for (int64_t j = 0; j < count; ++j) {
                double dot = 0;
                for (int64_t c = 0; c < dim; ++c) dot += double(qf[(h * nq + i) * dim + c]) * kf[kv_index(c, j, kh)];
                scores[j] = dot * scale;
                max_score = std::max(max_score, scores[j]);
            }
            for (double & score : scores) { score = std::exp(score - max_score); denom += score; }
            for (int64_t c = 0; c < dim; ++c) {
                double ref = 0;
                for (int64_t j = 0; j < count; ++j) ref += scores[j] * vf[kv_index(c, j, kh)];
                ref /= denom;
                const double got = y[(i * hq + h) * dim + c], err = got - ref;
                if (!std::isfinite(got)) return 6;
                err2 += err * err; ref2 += ref * ref; max_error = std::max(max_error, std::abs(err));
            }
        }
        const double rmse = std::sqrt(err2 / std::max(ref2, 1e-30));
        const bool passed = rmse < 0.005 && max_error < 0.005;
        probe_result("{\"operation\":\"flash_attention\",\"dim\":%lld,\"nq\":%lld,\"nk\":%lld,\"hkv\":%lld,\"half\":%s,\"strided\":%s,\"causal\":%s,\"passed\":%s,\"relative_rmse\":%.9g,\"max_absolute_error\":%.9g}\n",
            (long long)dim, (long long)nq, (long long)nk, (long long)hkv, half ? "true" : "false", strided ? "true" : "false", causal ? "true" : "false", passed ? "true" : "false", rmse, max_error);
        ggml_backend_buffer_free(buffer); ggml_backend_free(backend); ggml_free(ctx);
        return passed ? 0 : 7;
    } catch (const std::exception & error) {
        (*probe_emit)(nlohmann::ordered_json({{"type","kernel_error"},{"message",error.what()}}).dump()); return 8;
    }
}

static int probe_rms(int64_t width, int64_t rows, int64_t offset, bool cpu, bool inplace) {
    try {
        if (width < 1 || width > 8192 || rows < 1 || rows > 4096 || offset < 0 || offset > 63) return 9;
        auto * ctx = ggml_init({2 * 1024 * 1024, nullptr, true});
        auto * storage = ggml_new_tensor_1d(ctx, GGML_TYPE_F32, width * rows + offset);
        auto * input = ggml_view_2d(ctx, storage, width, rows, width * sizeof(float), offset * sizeof(float));
        auto * weights = ggml_new_tensor_1d(ctx, GGML_TYPE_F32, width);
        auto * norm = ggml_rms_norm(ctx, input, 1e-6f);
        auto * output = inplace ? ggml_mul_inplace(ctx, norm, weights) : ggml_mul(ctx, norm, weights);
        auto * graph = ggml_new_graph_custom(ctx, 128, false);
        ggml_build_forward_expand(graph, output);
        auto backend = cpu ? ggml_backend_cpu_init() : probe_gpu_backend();
        if (!backend) return 3;
        auto buffer = ggml_backend_alloc_ctx_tensors(ctx, backend);
        if (!buffer) return 4;
        std::vector<float> x(width * rows + offset), w(width), y(width * rows);
        uint32_t state = 0x31415926u;
        const auto next = [&state]() {
            state = state * 1664525u + 1013904223u;
            return (static_cast<int>((state >> 8) % 2001u) - 1000) / 2048.0f;
        };
        for (float & value : x) value = next();
        for (float & value : w) value = 1.0f + next();
        ggml_backend_tensor_set(storage, x.data(), 0, x.size() * sizeof(float));
        ggml_backend_tensor_set(weights, w.data(), 0, w.size() * sizeof(float));
        if (ggml_backend_graph_compute(backend, graph) != GGML_STATUS_SUCCESS) return 5;
        ggml_backend_synchronize(backend);
        ggml_backend_tensor_get(output, y.data(), 0, y.size() * sizeof(float));
        double error_squared = 0, reference_squared = 0, max_error = 0;
        for (int64_t row = 0; row < rows; ++row) {
            double square_sum = 0;
            for (int64_t col = 0; col < width; ++col) {
                const double value = x[offset + row * width + col];
                square_sum += value * value;
            }
            const double scale = 1.0 / std::sqrt(square_sum / width + 1e-6f);
            for (int64_t col = 0; col < width; ++col) {
                const auto index = row * width + col;
                const double reference = scale * x[offset + index] * w[col];
                const double error = y[index] - reference;
                if (!std::isfinite(y[index])) return 6;
                error_squared += error * error;
                reference_squared += reference * reference;
                max_error = std::max(max_error, std::abs(error));
            }
        }
        const double relative_rmse = std::sqrt(error_squared / std::max(reference_squared, 1e-30));
        const bool passed = relative_rmse < 1e-5 && max_error < 1e-4;
        probe_result("{\"operation\":\"rms_mul\",\"backend\":\"%s\",\"width\":%lld,\"rows\":%lld,\"offset\":%lld,\"inplace\":%s,\"passed\":%s,\"relative_rmse\":%.9g,\"max_absolute_error\":%.9g}\n",
            cpu ? "cpu" : probe_gpu_name(), static_cast<long long>(width), static_cast<long long>(rows),
            static_cast<long long>(offset), inplace ? "true" : "false", passed ? "true" : "false", relative_rmse, max_error);
        ggml_backend_buffer_free(buffer);
        ggml_backend_free(backend);
        ggml_free(ctx);
        return passed ? 0 : 7;
    } catch (const std::exception & error) {
        (*probe_emit)(nlohmann::ordered_json({{"type","kernel_error"},{"message",error.what()}}).dump());
        return 8;
    }
}

static int probe(const char * format, int64_t steps = 1, bool cpu = false,
                 bool mixed = false, int64_t width = 2048, int64_t rows = 512,
                 int64_t experts = 0, bool rhs_f16 = false, bool separate_inputs = false,
                 bool reference_bf16_rhs = false) {
    try {
        ggml_type type = GGML_TYPE_COUNT;
        for (auto candidate : {GGML_TYPE_Q2_K, GGML_TYPE_Q4_K, GGML_TYPE_Q5_K, GGML_TYPE_Q6_K,
                               GGML_TYPE_Q8_0, GGML_TYPE_IQ4_NL, GGML_TYPE_F32, GGML_TYPE_F16, GGML_TYPE_BF16}) {
            if (std::strcmp(format, ggml_type_name(candidate)) == 0) type = candidate;
        }
        if (type == GGML_TYPE_COUNT) return 9;
        const int64_t banks = experts ? experts : 1;
        const int64_t used = std::min<int64_t>(banks, 8);
        const int64_t input_copies = experts && separate_inputs ? used : 1;
        if (steps < 1 || steps > 256 || width < 1 || width > 16384 || rows < 1 || rows > 65536 ||
            experts < 0 || experts > 16 || width * rows * banks > 128 * 1024 * 1024 || width % ggml_blck_size(type)) return 9;
        ggml_init_params params = {2 * 1024 * 1024, nullptr, true};
        auto * ctx = ggml_init(params);
        if (!ctx) return 2;
        auto * weights = experts ? ggml_new_tensor_3d(ctx, type, width, rows, banks) :
                                  ggml_new_tensor_2d(ctx, type, width, rows);
        const ggml_type input_type = rhs_f16 ? GGML_TYPE_F16 : GGML_TYPE_F32;
        auto * input = experts ? ggml_new_tensor_3d(ctx, input_type, width, input_copies, steps) :
                                ggml_new_tensor_2d(ctx, input_type, width, steps);
        auto * ids = experts ? ggml_new_tensor_2d(ctx, GGML_TYPE_I32, used, steps) : nullptr;
        auto * output = experts ? ggml_mul_mat_id(ctx, weights, input, ids) : ggml_mul_mat(ctx, weights, input);
        auto * graph = ggml_new_graph_custom(ctx, 128, false);
        ggml_build_forward_expand(graph, output);
        
        auto backend = cpu ? ggml_backend_cpu_init() : probe_gpu_backend();
        if (!backend) return 3;
        auto buffer = ggml_backend_alloc_ctx_tensors(ctx, backend);
        if (!buffer) return 4;
        std::vector<float> w(width * rows * banks, 0.125f), x(width * steps * input_copies, 1.0f), y(rows * steps * used);
        std::vector<int32_t> selected(used * steps);
        for (int64_t col = 0; col < steps; ++col)
            for (int64_t e = 0; e < used; ++e) selected[col * used + e] = (e * 3 + col) % banks;
        if (mixed) {
            uint32_t state = 0x31415926u;
            const auto next = [&state]() {
                state = state * 1664525u + 1013904223u;
                return (static_cast<int>((state >> 8) % 2001u) - 1000) / 2048.0f;
            };
            for (float & value : w) value = next();
            for (float & value : x) value = next();
        }
        std::vector<unsigned char> quantized(ggml_nbytes(weights));
        if (type == GGML_TYPE_F32) {
            std::memcpy(quantized.data(), w.data(), quantized.size());
        } else if (type == GGML_TYPE_F16) {
            ggml_fp32_to_fp16_row(w.data(), reinterpret_cast<ggml_fp16_t *>(quantized.data()), w.size());
        } else if (type == GGML_TYPE_BF16) {
            ggml_fp32_to_bf16_row(w.data(), reinterpret_cast<ggml_bf16_t *>(quantized.data()), w.size());
        } else {
            ggml_quantize_init(type);
            ggml_quantize_chunk(type, w.data(), quantized.data(), 0, rows * banks, width, nullptr);
        }
        ggml_backend_tensor_set(weights, quantized.data(), 0, quantized.size());
        if (rhs_f16) {
            std::vector<ggml_fp16_t> half(x.size());
            ggml_fp32_to_fp16_row(x.data(), half.data(), x.size());
            ggml_backend_tensor_set(input, half.data(), 0, half.size() * sizeof(ggml_fp16_t));
            ggml_fp16_to_fp32_row(half.data(), x.data(), x.size());
        } else {
            ggml_backend_tensor_set(input, x.data(), 0, x.size() * sizeof(float));
        }
        if (ids) ggml_backend_tensor_set(ids, selected.data(), 0, selected.size() * sizeof(int32_t));
        const auto start = std::chrono::steady_clock::now();
        const auto status = ggml_backend_graph_compute(backend, graph);
        ggml_backend_synchronize(backend);
        const auto elapsed = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
        if (status != GGML_STATUS_SUCCESS) return 5;
        ggml_backend_tensor_get(output, y.data(), 0, y.size() * sizeof(float));
        if (type != GGML_TYPE_F32) ggml_get_type_traits(type)->to_float(quantized.data(), w.data(), w.size());
        // The BF16 general-matrix path intentionally lowers F32 activations to
        // BF16. Keep the uploaded F32 inputs, and explicitly select the matching
        // reference precision instead of loosening the numerical error limit.
        if (reference_bf16_rhs) {
            std::vector<ggml_bf16_t> packed(x.size());
            ggml_fp32_to_bf16_row(x.data(), packed.data(), x.size());
            ggml_bf16_to_fp32_row(packed.data(), x.data(), x.size());
        }
        double error_squared = 0, reference_squared = 0, max_error = 0, max_reference = 0;
        for (int64_t col = 0; col < steps; ++col) {
          for (int64_t e = 0; e < used; ++e) {
            const int64_t bank = selected[col * used + e];
            for (int64_t row = 0; row < rows; ++row) {
                double reference = 0;
                const int64_t input_index = col * input_copies + (separate_inputs ? e : 0);
                for (int64_t k = 0; k < width; ++k) reference += double(w[(bank * rows + row) * width + k]) * x[input_index * width + k];
                const float value = y[(col * used + e) * rows + row];
                if (!std::isfinite(value)) return 6;
                const double error = double(value) - reference;
                max_error = std::max(max_error, std::abs(error));
                max_reference = std::max(max_reference, std::abs(reference));
                error_squared += error * error;
                reference_squared += reference * reference;
            }
          }
        }
        const double relative_rmse = std::sqrt(error_squared / std::max(reference_squared, 1e-30));
        const bool passed = relative_rmse < 0.001 && max_error < 0.003 * max_reference + 1e-4;
        probe_result("{\"format\":\"%s\",\"backend\":\"%s\",\"pattern\":\"%s\",\"width\":%lld,\"rows\":%lld,\"steps\":%lld,\"experts\":%lld,\"rhs_f16\":%s,\"separate_inputs\":%s,\"passed\":%s,\"first_compute_ms\":%.5f,\"max_absolute_error\":%.8f,\"relative_rmse\":%.8f}\n",
            format, cpu ? "cpu" : probe_gpu_name(), mixed ? "mixed" : "constant", static_cast<long long>(width),
            static_cast<long long>(rows), static_cast<long long>(steps), static_cast<long long>(experts),
            rhs_f16 ? "true" : "false", separate_inputs ? "true" : "false", passed ? "true" : "false", elapsed, max_error, relative_rmse);
        std::fflush(stdout);
        ggml_backend_buffer_free(buffer);
        ggml_backend_free(backend);
        ggml_free(ctx);
        return passed ? 0 : 7;
    } catch (const std::exception & error) {
        (*probe_emit)(nlohmann::ordered_json({{"type","kernel_error"},{"message",error.what()}}).dump());
        return 8;
    }
}


#endif
void bolt_gpu_probe(const std::string & options, const BoltEvent & emit) {
#if defined(BOLT_VULKAN) || defined(BOLT_OPENCL)
    using json = nlohmann::ordered_json;
    try {
        ggml_log_set([](ggml_log_level level, const char * text, void *) {
            if (level != GGML_LOG_LEVEL_DEBUG) __android_log_write(ANDROID_LOG_INFO, "BoltVulkan", text);
        }, nullptr);
        probe_emit = &emit;
        const auto config = json::parse(options);
        emit(json({{"type","kernel_begin"},{"config",config}}).dump());
        int status;
        const auto op = config.value("op", std::string("matmul"));
        if (op == "rms") {
            status = probe_rms(config.value("width", 256), config.value("rows", 30),
                config.value("offset", 0), false, config.value("inplace", false));
        } else if (op == "attention") {
            status = probe_attention(config.value("dim", 256), config.value("nq", 30),
                config.value("nk", 30), config.value("hkv", 2), false,
                config.value("half", true), config.value("strided", true), config.value("causal", true));
        } else {
            status = probe(config.value("format", std::string("q4_K")).c_str(),
                config.value("steps", 1), false, true, config.value("width", 2048),
                config.value("rows", 128), 0, config.value("rhs_f16", false), false,
                config.value("reference_bf16_rhs", false));
        }
        emit(json({{"type","kernel_done"},{"status",status},{"passed",status == 0}}).dump());
    } catch (const std::exception & error) {
        emit(json({{"type","kernel_error"},{"message",error.what()}}).dump());
    }
    probe_emit = nullptr;
#else
    emit("{\"type\":\"kernel_error\",\"message\":\"Vulkan is not enabled in this build\"}");
#endif
}
