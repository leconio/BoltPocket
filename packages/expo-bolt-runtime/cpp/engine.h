#pragma once
#include <functional>
#include <string>
using BoltEvent = std::function<void(const std::string &)>;
void bolt_load(const std::string & path, int gpu_layers, int threads, const BoltEvent & emit);
void bolt_generate(const std::string & messages_json, int max_tokens, const std::string & tag, const BoltEvent & emit);
void bolt_close();
void bolt_cancel();
void bolt_gpu_probe(const std::string & options, const BoltEvent & emit);
