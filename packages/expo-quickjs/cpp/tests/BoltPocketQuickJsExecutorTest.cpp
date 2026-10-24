#include "BoltPocketQuickJsExecutor.h"

#include <cassert>
#include <atomic>
#include <chrono>
#include <iostream>
#include <optional>
#include <string>
#include <thread>

namespace {

boltpocket::quickjs::ExecutionRequest request(
    std::string code, std::optional<std::string> input = std::nullopt,
    std::int32_t timeout_ms = 500, std::size_t memory_bytes = 16 * 1024 * 1024,
    std::size_t output_bytes = 64 * 1024,
    const std::atomic_bool *cancelled = nullptr) {
  return {std::move(code), "/private/host/path/test.js", std::move(input),
          timeout_ms, memory_bytes, 512 * 1024, output_bytes, cancelled};
}

void test_basic_execution() {
  const auto result = boltpocket::quickjs::execute(request(
      "console.log('hello', input.name); console.error('warning'); "
      "({ answer: input.value * 2 })",
      R"({"name":"BoltPocket","value":21})"));
  assert(result.exit_code == 0);
  assert(result.stdout_text == "hello BoltPocket\n");
  assert(result.stderr_text == "warning\n");
  assert(result.result == R"({"answer":42})");
}

void test_fresh_context_and_no_host_apis() {
  const auto first = boltpocket::quickjs::execute(
      request("globalThis.transient = 42; transient"));
  const auto second = boltpocket::quickjs::execute(request(
      "[typeof transient, typeof require, typeof fetch, typeof std, "
      "typeof os].join(',')"));
  assert(first.exit_code == 0 && first.result == "42");
  assert(second.exit_code == 0);
  assert(second.result == "undefined,undefined,undefined,undefined,undefined");
}

void test_immediate_promise() {
  const auto result = boltpocket::quickjs::execute(
      request("Promise.resolve({ settled: true })"));
  assert(result.exit_code == 0);
  assert(result.result == R"({"settled":true})");
}

void test_bigint_result() {
  const auto result = boltpocket::quickjs::execute(
      request("console.log(2n ** 64n); (2n ** 127n - 1n) % 97n"));
  assert(result.exit_code == 0);
  assert(result.stdout_text == "18446744073709551616\n");
  assert(result.result == "65");
}

void test_module_loading_fails_closed() {
  const auto static_import = boltpocket::quickjs::execute(
      request("import value from './host.js'; value"));
  const auto dynamic_import =
      boltpocket::quickjs::execute(request("import('./host.js')"));
  assert(static_import.exit_code == 1);
  assert(dynamic_import.exit_code == 1);
}

void test_infinite_loop_timeout() {
  const auto started = std::chrono::steady_clock::now();
  const auto result =
      boltpocket::quickjs::execute(request("while (true) {}", std::nullopt, 30));
  const auto elapsed = std::chrono::steady_clock::now() - started;
  assert(result.exit_code == 1);
  assert(result.stderr_text.find("timed out") != std::string::npos);
  assert(elapsed < std::chrono::seconds(1));
}

void test_memory_limit() {
  const auto result = boltpocket::quickjs::execute(request(
      "const values = []; while (true) values.push('x'.repeat(4096));",
      std::nullopt, 2'000, 1024 * 1024));
  assert(result.exit_code == 1);
  assert(result.stderr_text.find("memory") != std::string::npos);
}

void test_combined_output_limit() {
  const auto result = boltpocket::quickjs::execute(
      request("console.log('界'.repeat(1024)); 'unreachable'", std::nullopt,
              500, 16 * 1024 * 1024, 1024));
  assert(result.exit_code == 1);
  assert(result.stdout_text.size() + result.stderr_text.size() <= 1024);
  assert(result.result == std::nullopt);
}

void assert_combined_output_bounded(
    const boltpocket::quickjs::ExecutionResult &result,
    std::size_t maximum) {
  const std::size_t result_bytes = result.result ? result.result->size() : 0;
  assert(result.stdout_text.size() + result.stderr_text.size() + result_bytes <=
         maximum);
}

void test_bounded_host_string_conversions() {
  constexpr std::size_t limit = 1024;
  const auto string_result = boltpocket::quickjs::execute(request(
      "console.log('a'.repeat(700)); '界'.repeat(200)", std::nullopt, 500,
      16 * 1024 * 1024, limit));
  assert(string_result.exit_code == 1);
  assert(string_result.result == std::nullopt);
  assert(string_result.stderr_text.find("output limit") != std::string::npos);
  assert_combined_output_bounded(string_result, limit);

  const auto json_result = boltpocket::quickjs::execute(request(
      "({ value: 'x'.repeat(2048) })", std::nullopt, 500,
      16 * 1024 * 1024, limit));
  assert(json_result.exit_code == 1);
  assert(json_result.result == std::nullopt);
  assert(json_result.stderr_text.find("output limit") != std::string::npos);
  assert_combined_output_bounded(json_result, limit);

  const auto exception_result = boltpocket::quickjs::execute(request(
      "throw new Error('界'.repeat(1024))", std::nullopt, 500,
      16 * 1024 * 1024, limit));
  assert(exception_result.exit_code == 1);
  assert(exception_result.result == std::nullopt);
  assert(exception_result.stderr_text.find("output limit") !=
         std::string::npos);
  assert_combined_output_bounded(exception_result, limit);
}

void test_abort_flag() {
  std::atomic_bool cancelled = false;
  std::thread canceller([&cancelled] {
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    cancelled.store(true, std::memory_order_relaxed);
  });
  const auto started = std::chrono::steady_clock::now();
  const auto result = boltpocket::quickjs::execute(
      request("while (true) {}", std::nullopt, 1'000, 16 * 1024 * 1024,
              64 * 1024, &cancelled));
  canceller.join();
  assert(result.exit_code == 130);
  assert(result.stderr_text.find("cancelled") != std::string::npos);
  assert(std::chrono::steady_clock::now() - started <
         std::chrono::seconds(1));
}

void test_error_path_is_sanitized() {
  const auto result =
      boltpocket::quickjs::execute(request("throw new Error('safe failure')"));
  assert(result.exit_code == 1);
  assert(result.stderr_text.find("test.js") != std::string::npos);
  assert(result.stderr_text.find("/private/host/path") == std::string::npos);
}

}  // namespace

int main() {
  test_basic_execution();
  test_fresh_context_and_no_host_apis();
  test_immediate_promise();
  test_bigint_result();
  test_module_loading_fails_closed();
  test_infinite_loop_timeout();
  test_memory_limit();
  test_combined_output_limit();
  test_bounded_host_string_conversions();
  test_abort_flag();
  test_error_path_is_sanitized();
  std::cout << "All bounded QuickJS native tests passed.\n";
  return 0;
}
