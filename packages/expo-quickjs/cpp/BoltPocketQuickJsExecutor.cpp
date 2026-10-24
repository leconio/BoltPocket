#include "BoltPocketQuickJsExecutor.h"

#include "quickjs/quickjs.h"

#include <algorithm>
#include <chrono>
#include <memory>
#include <string>
#include <utility>

namespace boltpocket::quickjs {
namespace {

using Clock = std::chrono::steady_clock;

constexpr std::size_t kMaxCodeBytes = 512 * 1024;
constexpr std::size_t kMaxInputBytes = 256 * 1024;
constexpr std::int32_t kMinTimeoutMs = 10;
constexpr std::int32_t kMaxTimeoutMs = 10'000;
constexpr std::size_t kMinMemoryBytes = 1024 * 1024;
constexpr std::size_t kMaxMemoryBytes = 64 * 1024 * 1024;
constexpr std::size_t kMinStackBytes = 256 * 1024;
constexpr std::size_t kMaxStackBytes = 1024 * 1024;
constexpr std::size_t kMinOutputBytes = 1024;
constexpr std::size_t kMaxOutputBytes = 1024 * 1024;

struct ExecutionState {
  Clock::time_point deadline;
  std::size_t max_output_bytes;
  std::size_t output_bytes = 0;
  std::string stdout_text;
  std::string stderr_text;
  bool timed_out = false;
  bool output_exceeded = false;
  bool cancelled = false;
  const std::atomic_bool *cancellation_flag = nullptr;
};

bool has_valid_limits(const ExecutionRequest &request) {
  return !request.code.empty() && request.code.size() <= kMaxCodeBytes &&
         request.filename.size() <= 256 &&
         (!request.input_json || request.input_json->size() <= kMaxInputBytes) &&
         request.timeout_ms >= kMinTimeoutMs &&
         request.timeout_ms <= kMaxTimeoutMs &&
         request.memory_limit_bytes >= kMinMemoryBytes &&
         request.memory_limit_bytes <= kMaxMemoryBytes &&
         request.stack_limit_bytes >= kMinStackBytes &&
         request.stack_limit_bytes <= kMaxStackBytes &&
         request.max_output_bytes >= kMinOutputBytes &&
         request.max_output_bytes <= kMaxOutputBytes;
}

std::string safe_filename(const std::string &value) {
  const std::size_t separator = value.find_last_of("/\\");
  std::string filename =
      separator == std::string::npos ? value : value.substr(separator + 1);
  if (filename.empty()) filename = "js-exec.js";
  for (char &character : filename) {
    const auto byte = static_cast<unsigned char>(character);
    if (byte < 0x20U || byte == 0x7fU) character = '_';
  }
  return filename;
}

std::size_t valid_utf8_prefix(const char *value, std::size_t length,
                              std::size_t limit) {
  if (length <= limit) return length;
  std::size_t end = limit;
  while (end > 0 &&
         (static_cast<unsigned char>(value[end]) & 0xc0U) == 0x80U) {
    --end;
  }
  if (end == 0) return 0;
  const auto lead = static_cast<unsigned char>(value[end]);
  std::size_t width = 1;
  if ((lead & 0xe0U) == 0xc0U) width = 2;
  if ((lead & 0xf0U) == 0xe0U) width = 3;
  if ((lead & 0xf8U) == 0xf0U) width = 4;
  return end + width <= limit ? end + width : end;
}

bool append_bounded(ExecutionState &state, std::string &target,
                    const char *bytes, std::size_t length) {
  if (length == 0) return true;
  const std::size_t remaining =
      state.max_output_bytes > state.output_bytes
          ? state.max_output_bytes - state.output_bytes
          : 0;
  if (length <= remaining) {
    target.append(bytes, length);
    state.output_bytes += length;
    return true;
  }
  if (remaining > 0) {
    const std::size_t prefix = valid_utf8_prefix(bytes, length, remaining);
    target.append(bytes, prefix);
    state.output_bytes += prefix;
  }
  state.output_exceeded = true;
  return false;
}

bool append_bounded(ExecutionState &state, std::string &target,
                    const std::string &value) {
  return append_bounded(state, target, value.data(), value.size());
}

std::size_t remaining_output(const ExecutionState &state) {
  return state.max_output_bytes > state.output_bytes
             ? state.max_output_bytes - state.output_bytes
             : 0;
}

enum class StringConversion {
  kSuccess,
  kFailed,
  kOutputExceeded,
};

StringConversion value_to_bounded_string(JSContext *context,
                                         JSValueConst value,
                                         std::size_t output_limit,
                                         std::string &result) {
  result.clear();
  size_t length = 0;
  // QuickJS exposes the exact UTF-8 length together with its temporary C
  // string. Check that length before copying any bytes into host std::string.
  const char *text = JS_ToCStringLen(context, &length, value);
  if (!text) return StringConversion::kFailed;
  if (length > output_limit) {
    JS_FreeCString(context, text);
    return StringConversion::kOutputExceeded;
  }
  result.assign(text, length);
  JS_FreeCString(context, text);
  return StringConversion::kSuccess;
}

StringConversion value_to_console_string(JSContext *context,
                                         JSValueConst value,
                                         std::size_t output_limit,
                                         std::string &result) {
  if (JS_IsString(value) || JS_IsBigInt(context, value)) {
    return value_to_bounded_string(context, value, output_limit, result);
  }

  JSValue json =
      JS_JSONStringify(context, value, JS_UNDEFINED, JS_UNDEFINED);
  if (!JS_IsException(json) && !JS_IsUndefined(json)) {
    const StringConversion status =
        value_to_bounded_string(context, json, output_limit, result);
    JS_FreeValue(context, json);
    return status;
  }
  if (JS_IsException(json)) {
    JS_FreeValue(context, JS_GetException(context));
  }
  JS_FreeValue(context, json);
  return value_to_bounded_string(context, value, output_limit, result);
}

JSValue console_write(JSContext *context, JSValueConst, int argc,
                      JSValueConst *argv, int magic) {
  auto *state = static_cast<ExecutionState *>(JS_GetContextOpaque(context));
  if (!state) return JS_ThrowInternalError(context, "Console is unavailable");
  std::string &target = magic == 0 ? state->stdout_text : state->stderr_text;

  for (int index = 0; index < argc; ++index) {
    if (index > 0 && !append_bounded(*state, target, " ", 1)) {
      return JS_ThrowInternalError(context, "Output limit exceeded");
    }
    std::string part;
    const StringConversion conversion = value_to_console_string(
        context, argv[index], remaining_output(*state), part);
    if (conversion == StringConversion::kOutputExceeded) {
      state->output_exceeded = true;
      return JS_ThrowInternalError(context, "Output limit exceeded");
    }
    if (conversion == StringConversion::kFailed) {
      return JS_ThrowInternalError(context, "Could not format console output");
    }
    if (!append_bounded(*state, target, part)) {
      return JS_ThrowInternalError(context, "Output limit exceeded");
    }
  }
  if (!append_bounded(*state, target, "\n", 1)) {
    return JS_ThrowInternalError(context, "Output limit exceeded");
  }
  return JS_UNDEFINED;
}

bool install_console(JSContext *context) {
  JSValue console = JS_NewObject(context);
  if (JS_IsException(console)) return false;
  const struct {
    const char *name;
    int stream;
  } methods[] = {{"log", 0},   {"info", 0}, {"debug", 0},
                 {"warn", 1}, {"error", 1}};
  for (const auto &method : methods) {
    JSValue function = JS_NewCFunctionMagic(context, console_write, method.name,
                                            1, JS_CFUNC_generic_magic,
                                            method.stream);
    if (JS_IsException(function) ||
        JS_SetPropertyStr(context, console, method.name, function) < 0) {
      if (JS_IsException(function)) JS_FreeValue(context, function);
      JS_FreeValue(context, console);
      return false;
    }
  }
  JSValue global = JS_GetGlobalObject(context);
  const int status = JS_SetPropertyStr(context, global, "console", console);
  JS_FreeValue(context, global);
  return status >= 0;
}

bool install_input(JSContext *context,
                   const std::optional<std::string> &input_json) {
  JSValue input = JS_UNDEFINED;
  if (input_json) {
    input = JS_ParseJSON(context, input_json->c_str(), input_json->size(),
                         "<input>");
    if (JS_IsException(input)) return false;
  }
  JSValue global = JS_GetGlobalObject(context);
  const int status = JS_SetPropertyStr(context, global, "input", input);
  JS_FreeValue(context, global);
  return status >= 0;
}

int interrupt_handler(JSRuntime *, void *opaque) {
  auto *state = static_cast<ExecutionState *>(opaque);
  if (!state) return 1;
  if (state->cancellation_flag &&
      state->cancellation_flag->load(std::memory_order_relaxed)) {
    state->cancelled = true;
    return 1;
  }
  if (state->output_exceeded) return 1;
  if (Clock::now() >= state->deadline) {
    state->timed_out = true;
    return 1;
  }
  return 0;
}

std::string exception_text(JSContext *context, ExecutionState &state) {
  JSValue exception = JS_GetException(context);
  std::string message;
  const StringConversion message_status = value_to_bounded_string(
      context, exception, remaining_output(state), message);
  if (message_status == StringConversion::kOutputExceeded) {
    state.output_exceeded = true;
  }
  JSValue stack = JS_GetPropertyStr(context, exception, "stack");
  if (!state.output_exceeded && !JS_IsException(stack) &&
      !JS_IsUndefined(stack)) {
    const std::size_t remaining = remaining_output(state);
    const std::size_t separator = message.empty() ? 0 : 1;
    const std::size_t stack_limit =
        remaining > message.size() + separator
            ? remaining - message.size() - separator
            : 0;
    std::string stack_text;
    const StringConversion stack_status =
        value_to_bounded_string(context, stack, stack_limit, stack_text);
    if (stack_status == StringConversion::kOutputExceeded) {
      state.output_exceeded = true;
    }
    if (!stack_text.empty() && stack_text != message) {
      if (!message.empty()) message.push_back('\n');
      message.append(stack_text);
    }
  }
  JS_FreeValue(context, stack);
  JS_FreeValue(context, exception);
  if (state.output_exceeded) return "JavaScript output limit exceeded.";
  return message.empty() ? "JavaScript execution failed." : message;
}

bool append_failure(ExecutionState &state, const std::string &message) {
  if (!state.stderr_text.empty() && state.stderr_text.back() != '\n' &&
      !append_bounded(state, state.stderr_text, "\n", 1)) {
    return false;
  }
  if (!append_bounded(state, state.stderr_text, message)) return false;
  return append_bounded(state, state.stderr_text, "\n", 1);
}

std::optional<std::string> serialize_result(JSContext *context,
                                            JSValueConst value,
                                            ExecutionState &state,
                                            bool &failed) {
  failed = false;
  if (JS_IsUndefined(value)) return std::nullopt;
  if (JS_IsString(value) || JS_IsBigInt(context, value)) {
    std::string result;
    const StringConversion status = value_to_bounded_string(
        context, value, remaining_output(state), result);
    if (status == StringConversion::kOutputExceeded) {
      state.output_exceeded = true;
      return std::nullopt;
    }
    if (status == StringConversion::kFailed) {
      failed = true;
      return std::nullopt;
    }
    return result;
  }

  JSValue json =
      JS_JSONStringify(context, value, JS_UNDEFINED, JS_UNDEFINED);
  if (JS_IsException(json)) {
    failed = true;
    return std::nullopt;
  }
  if (JS_IsUndefined(json)) {
    JS_FreeValue(context, json);
    std::string result;
    const StringConversion status = value_to_bounded_string(
        context, value, remaining_output(state), result);
    if (status == StringConversion::kOutputExceeded) {
      state.output_exceeded = true;
      return std::nullopt;
    }
    if (status == StringConversion::kFailed) {
      failed = true;
      return std::nullopt;
    }
    return result;
  }
  std::string result;
  const StringConversion status = value_to_bounded_string(
      context, json, remaining_output(state), result);
  JS_FreeValue(context, json);
  if (status == StringConversion::kOutputExceeded) {
    state.output_exceeded = true;
    return std::nullopt;
  }
  if (status == StringConversion::kFailed) {
    failed = true;
    return std::nullopt;
  }
  return result;
}

ExecutionResult failure_result(ExecutionState &state,
                               const std::string &message) {
  append_failure(state, message);
  return {std::move(state.stdout_text), std::move(state.stderr_text),
          std::nullopt, 1};
}

}  // namespace

ExecutionResult execute(const ExecutionRequest &request) {
  ExecutionState state{Clock::now() +
                           std::chrono::milliseconds(request.timeout_ms),
                       request.max_output_bytes,
                       0,
                       {},
                       {},
                       false,
                       false,
                       false,
                       request.cancelled};
  if (!has_valid_limits(request)) {
    return failure_result(state, "Invalid bounded js-exec request.");
  }

  std::unique_ptr<JSRuntime, decltype(&JS_FreeRuntime)> runtime_owner(
      JS_NewRuntime(), JS_FreeRuntime);
  JSRuntime *runtime = runtime_owner.get();
  if (!runtime) {
    return failure_result(state, "Could not allocate the JavaScript runtime.");
  }
  JS_SetMemoryLimit(runtime, request.memory_limit_bytes);
  JS_SetMaxStackSize(runtime, request.stack_limit_bytes);
  JS_SetCanBlock(runtime, false);
  JS_SetInterruptHandler(runtime, interrupt_handler, &state);

  std::unique_ptr<JSContext, decltype(&JS_FreeContext)> context_owner(
      JS_NewContext(runtime), JS_FreeContext);
  JSContext *context = context_owner.get();
  if (!context) {
    return failure_result(state, "Could not allocate the JavaScript context.");
  }
  JS_SetContextOpaque(context, &state);

  ExecutionResult result;
  JSValue evaluated = JS_UNDEFINED;
  bool has_evaluated = false;
  do {
    if (!install_console(context)) {
      result = failure_result(state, "Could not initialize the JavaScript console.");
      break;
    }
    if (!install_input(context, request.input_json)) {
      result = failure_result(state, "Could not parse the JSON input.");
      break;
    }

    const std::string filename = safe_filename(request.filename);
    evaluated = JS_Eval(context, request.code.data(), request.code.size(),
                        filename.c_str(),
                        JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_STRICT);
    has_evaluated = true;
    if (JS_IsException(evaluated)) {
      if (state.cancelled) {
        JS_FreeValue(context, JS_GetException(context));
        result = failure_result(state, "JavaScript execution cancelled.");
        result.exit_code = 130;
      } else if (state.timed_out) {
        JS_FreeValue(context, JS_GetException(context));
        result = failure_result(state, "JavaScript execution timed out.");
      } else if (state.output_exceeded) {
        JS_FreeValue(context, JS_GetException(context));
        result = failure_result(state, "JavaScript output limit exceeded.");
      } else {
        result = failure_result(state, exception_text(context, state));
      }
      break;
    }

    JSContext *job_context = nullptr;
    int job_status = 0;
    while ((job_status = JS_ExecutePendingJob(runtime, &job_context)) > 0) {
      if (interrupt_handler(runtime, &state) != 0) break;
    }
    if (state.cancelled) {
      result = failure_result(state, "JavaScript execution cancelled.");
      result.exit_code = 130;
      break;
    }
    if (state.timed_out) {
      result = failure_result(state, "JavaScript execution timed out.");
      break;
    }
    if (state.output_exceeded) {
      result = failure_result(state, "JavaScript output limit exceeded.");
      break;
    }
    if (job_status < 0) {
      result = failure_result(
          state, exception_text(job_context ? job_context : context, state));
      break;
    }

    const auto promise_state = JS_PromiseState(context, evaluated);
    if (promise_state == JS_PROMISE_PENDING) {
      result = failure_result(
          state, "JavaScript returned a Promise that cannot settle without I/O.");
      break;
    }
    if (promise_state == JS_PROMISE_REJECTED) {
      JSValue rejection = JS_PromiseResult(context, evaluated);
      std::string message;
      const StringConversion status = value_to_bounded_string(
          context, rejection, remaining_output(state), message);
      JS_FreeValue(context, rejection);
      if (status == StringConversion::kOutputExceeded) {
        state.output_exceeded = true;
        result = failure_result(state, "JavaScript output limit exceeded.");
      } else if (status == StringConversion::kFailed) {
        result = failure_result(state, exception_text(context, state));
      } else {
        result = failure_result(
            state, message.empty() ? "JavaScript Promise rejected." : message);
      }
      break;
    }
    if (promise_state == JS_PROMISE_FULFILLED) {
      JSValue fulfillment = JS_PromiseResult(context, evaluated);
      JS_FreeValue(context, evaluated);
      evaluated = fulfillment;
    }

    bool serialization_failed = false;
    std::optional<std::string> serialized =
        serialize_result(context, evaluated, state, serialization_failed);
    if (state.output_exceeded) {
      result = failure_result(state, "JavaScript output limit exceeded.");
      break;
    }
    if (serialization_failed) {
      result = failure_result(state, exception_text(context, state));
      break;
    }
    if (serialized) {
      const std::size_t remaining =
          state.max_output_bytes > state.output_bytes
              ? state.max_output_bytes - state.output_bytes
              : 0;
      if (serialized->size() > remaining) {
        state.output_exceeded = true;
        result = failure_result(state, "JavaScript output limit exceeded.");
        break;
      }
      state.output_bytes += serialized->size();
    }
    result = {std::move(state.stdout_text), std::move(state.stderr_text),
              std::move(serialized), 0};
  } while (false);

  if (has_evaluated) JS_FreeValue(context, evaluated);
  JS_SetContextOpaque(context, nullptr);
  return result;
}

}  // namespace boltpocket::quickjs
