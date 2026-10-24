#import "BoltPocketQuickJsBridge.h"

#include "BoltPocketQuickJsExecutor.h"

#include <exception>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_set>

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

std::string to_string(NSString *value) {
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return {};
  return std::string(static_cast<const char *>(data.bytes), data.length);
}

NSString *to_ns_string(const std::string &value) {
  NSData *data = [NSData dataWithBytes:value.data() length:value.size()];
  NSString *text = [[NSString alloc] initWithData:data
                                         encoding:NSUTF8StringEncoding];
  return text ?: @"";
}

NSDictionary<NSString *, id> *to_dictionary(
    const boltpocket::quickjs::ExecutionResult &result) {
  return @{
    @"stdout" : to_ns_string(result.stdout_text),
    @"stderr" : to_ns_string(result.stderr_text),
    @"result" : result.result ? to_ns_string(*result.result) : NSNull.null,
    @"exitCode" : @(result.exit_code),
  };
}

}  // namespace

@implementation BoltPocketQuickJsBridge

+ (NSDictionary<NSString *, id> *)execute:(NSString *)code
                               executionId:(NSInteger)executionId
                                  filename:(NSString *)filename
                                 inputJson:(nullable NSString *)inputJson
                                 timeoutMs:(NSInteger)timeoutMs
                          memoryLimitBytes:(NSInteger)memoryLimitBytes
                           stackLimitBytes:(NSInteger)stackLimitBytes
                            maxOutputBytes:(NSInteger)maxOutputBytes {
  @autoreleasepool {
    try {
      ExecutionRegistration registration(
          static_cast<std::int32_t>(executionId));
      boltpocket::quickjs::ExecutionRequest request{
          to_string(code),
          to_string(filename),
          inputJson ? std::optional<std::string>(to_string(inputJson))
                    : std::nullopt,
          static_cast<std::int32_t>(timeoutMs),
          static_cast<std::size_t>(memoryLimitBytes),
          static_cast<std::size_t>(stackLimitBytes),
          static_cast<std::size_t>(maxOutputBytes),
          &current_execution_cancelled};
      return to_dictionary(boltpocket::quickjs::execute(request));
    } catch (const std::exception &) {
      return @{
        @"stdout" : @"",
        @"stderr" : @"The isolated JavaScript runtime failed.\n",
        @"result" : NSNull.null,
        @"exitCode" : @1,
      };
    } catch (...) {
      return @{
        @"stdout" : @"",
        @"stderr" : @"The isolated JavaScript runtime failed.\n",
        @"result" : NSNull.null,
        @"exitCode" : @1,
      };
    }
  }
}

+ (void)cancel:(NSInteger)executionId {
  std::lock_guard<std::mutex> lock(execution_mutex);
  if (current_execution_id == static_cast<std::int32_t>(executionId)) {
    current_execution_cancelled.store(true, std::memory_order_relaxed);
  } else if (pending_cancellations.size() < kMaxPendingCancellations) {
    pending_cancellations.insert(static_cast<std::int32_t>(executionId));
  }
}

@end
