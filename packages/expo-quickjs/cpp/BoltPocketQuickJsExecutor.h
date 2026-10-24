#pragma once

#include <cstddef>
#include <cstdint>
#include <atomic>
#include <optional>
#include <string>

namespace boltpocket::quickjs {

struct ExecutionRequest {
  std::string code;
  std::string filename;
  std::optional<std::string> input_json;
  std::int32_t timeout_ms;
  std::size_t memory_limit_bytes;
  std::size_t stack_limit_bytes;
  std::size_t max_output_bytes;
  const std::atomic_bool *cancelled = nullptr;
};

struct ExecutionResult {
  std::string stdout_text;
  std::string stderr_text;
  std::optional<std::string> result;
  std::int32_t exit_code;
};

ExecutionResult execute(const ExecutionRequest &request);

}  // namespace boltpocket::quickjs
