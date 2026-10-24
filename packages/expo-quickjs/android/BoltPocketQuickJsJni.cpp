#include <jni.h>

#include <cstdint>
#include <atomic>
#include <exception>
#include <optional>
#include <string>
#include <mutex>
#include <unordered_set>

#include "BoltPocketQuickJsExecutor.h"

namespace {

std::mutex execution_mutex;
std::int32_t current_execution_id = 0;
std::atomic_bool current_execution_cancelled{false};
std::unordered_set<std::int32_t> pending_cancellations;
constexpr std::size_t kMaxPendingCancellations = 256;

class ExecutionRegistration {
 public:
  explicit ExecutionRegistration(std::int32_t execution_id)
      : execution_id_(execution_id) {
    std::lock_guard<std::mutex> lock(execution_mutex);
    const bool was_cancelled = pending_cancellations.erase(execution_id_) > 0;
    current_execution_cancelled.store(was_cancelled,
                                      std::memory_order_relaxed);
    current_execution_id = execution_id_;
  }

  ~ExecutionRegistration() {
    std::lock_guard<std::mutex> lock(execution_mutex);
    if (current_execution_id == execution_id_) {
      current_execution_id = 0;
      current_execution_cancelled.store(false, std::memory_order_relaxed);
    }
    pending_cancellations.erase(execution_id_);
  }

 private:
  std::int32_t execution_id_;
};

std::string from_java_string(JNIEnv *environment, jstring value) {
  if (!value) return {};
  jclass string_class = environment->FindClass("java/lang/String");
  jmethodID get_bytes = environment->GetMethodID(
      string_class, "getBytes", "(Ljava/lang/String;)[B");
  jstring charset = environment->NewStringUTF("UTF-8");
  auto bytes = static_cast<jbyteArray>(
      environment->CallObjectMethod(value, get_bytes, charset));
  environment->DeleteLocalRef(charset);
  if (environment->ExceptionCheck() || !bytes) return {};
  const jsize length = environment->GetArrayLength(bytes);
  std::string result(static_cast<std::size_t>(length), '\0');
  if (length > 0) {
    environment->GetByteArrayRegion(
        bytes, 0, length, reinterpret_cast<jbyte *>(result.data()));
  }
  environment->DeleteLocalRef(bytes);
  environment->DeleteLocalRef(string_class);
  return result;
}

jstring to_java_string(JNIEnv *environment, const std::string &value) {
  jclass string_class = environment->FindClass("java/lang/String");
  jmethodID constructor = environment->GetMethodID(
      string_class, "<init>", "([BLjava/lang/String;)V");
  auto bytes = environment->NewByteArray(static_cast<jsize>(value.size()));
  if (!value.empty()) {
    environment->SetByteArrayRegion(
        bytes, 0, static_cast<jsize>(value.size()),
        reinterpret_cast<const jbyte *>(value.data()));
  }
  jstring charset = environment->NewStringUTF("UTF-8");
  auto result = static_cast<jstring>(
      environment->NewObject(string_class, constructor, bytes, charset));
  environment->DeleteLocalRef(charset);
  environment->DeleteLocalRef(bytes);
  environment->DeleteLocalRef(string_class);
  return result;
}

void put(JNIEnv *environment, jobject map, jmethodID put_method,
         const char *key, jobject value) {
  jstring java_key = environment->NewStringUTF(key);
  jobject previous =
      environment->CallObjectMethod(map, put_method, java_key, value);
  if (previous) environment->DeleteLocalRef(previous);
  environment->DeleteLocalRef(java_key);
}

jobject to_java_result(JNIEnv *environment,
                       const boltpocket::quickjs::ExecutionResult &result) {
  jclass map_class = environment->FindClass("java/util/HashMap");
  jmethodID constructor = environment->GetMethodID(map_class, "<init>", "()V");
  jmethodID put_method = environment->GetMethodID(
      map_class, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
  jobject map = environment->NewObject(map_class, constructor);

  jstring stdout_text = to_java_string(environment, result.stdout_text);
  jstring stderr_text = to_java_string(environment, result.stderr_text);
  put(environment, map, put_method, "stdout", stdout_text);
  put(environment, map, put_method, "stderr", stderr_text);
  environment->DeleteLocalRef(stdout_text);
  environment->DeleteLocalRef(stderr_text);

  if (result.result) {
    jstring value = to_java_string(environment, *result.result);
    put(environment, map, put_method, "result", value);
    environment->DeleteLocalRef(value);
  } else {
    put(environment, map, put_method, "result", nullptr);
  }

  jclass integer_class = environment->FindClass("java/lang/Integer");
  jmethodID value_of = environment->GetStaticMethodID(
      integer_class, "valueOf", "(I)Ljava/lang/Integer;");
  jobject exit_code = environment->CallStaticObjectMethod(
      integer_class, value_of, static_cast<jint>(result.exit_code));
  put(environment, map, put_method, "exitCode", exit_code);
  environment->DeleteLocalRef(exit_code);
  environment->DeleteLocalRef(integer_class);
  environment->DeleteLocalRef(map_class);
  return map;
}

void throw_runtime_exception(JNIEnv *environment, const char *message) {
  if (environment->ExceptionCheck()) return;
  jclass exception_class =
      environment->FindClass("java/lang/RuntimeException");
  environment->ThrowNew(exception_class, message);
  environment->DeleteLocalRef(exception_class);
}

}  // namespace

extern "C" JNIEXPORT jobject JNICALL
Java_dev_boltpocket_app_quickjs_BoltPocketQuickJsNative_executeNative(
    JNIEnv *environment, jobject, jint execution_id, jstring code,
    jstring filename, jstring input_json, jint timeout_ms,
    jint memory_limit_bytes, jint stack_limit_bytes, jint max_output_bytes) {
  try {
    ExecutionRegistration registration(static_cast<std::int32_t>(execution_id));
    boltpocket::quickjs::ExecutionRequest request{
        from_java_string(environment, code),
        from_java_string(environment, filename),
        input_json
            ? std::optional<std::string>(
                  from_java_string(environment, input_json))
            : std::nullopt,
        static_cast<std::int32_t>(timeout_ms),
        static_cast<std::size_t>(memory_limit_bytes),
        static_cast<std::size_t>(stack_limit_bytes),
        static_cast<std::size_t>(max_output_bytes),
        &current_execution_cancelled};
    if (environment->ExceptionCheck()) return nullptr;
    return to_java_result(environment, boltpocket::quickjs::execute(request));
  } catch (const std::exception &) {
    throw_runtime_exception(environment,
                            "The isolated JavaScript runtime failed.");
  } catch (...) {
    throw_runtime_exception(environment,
                            "The isolated JavaScript runtime failed.");
  }
  return nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_boltpocket_app_quickjs_BoltPocketQuickJsNative_cancelNative(
    JNIEnv *, jobject, jint execution_id) {
  std::lock_guard<std::mutex> lock(execution_mutex);
  if (current_execution_id == static_cast<std::int32_t>(execution_id)) {
    current_execution_cancelled.store(true, std::memory_order_relaxed);
  } else if (pending_cancellations.size() < kMaxPendingCancellations) {
    pending_cancellations.insert(static_cast<std::int32_t>(execution_id));
  }
}
