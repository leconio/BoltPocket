#pragma once
#include <nlohmann/json.hpp>
#include <array>
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <functional>
#include <optional>
#include <sstream>
#include <iomanip>
#include <vector>
#include <sys/stat.h>
extern "C" {
#include "llama/vendor/hash/sha256/sha256.h"
}

namespace bolt_cache {
namespace fs = std::filesystem;
using json = nlohmann::json;
inline std::string hex(const unsigned char * bytes) {
    std::ostringstream out;
    for (int i = 0; i < SHA256_DIGEST_SIZE; ++i) out << std::hex << std::setw(2) << std::setfill('0') << unsigned(bytes[i]);
    return out.str();
}
inline std::string digest(const void * bytes, size_t size) {
    unsigned char result[SHA256_DIGEST_SIZE];
    sha256_hash(result, static_cast<const unsigned char *>(bytes), size);
    return hex(result);
}
inline std::string file_digest(const fs::path & path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("Cache file read failed");
    sha256_t hash; sha256_init(&hash);
    std::array<unsigned char, 65536> buffer;
    while (input) {
        input.read(reinterpret_cast<char *>(buffer.data()), buffer.size());
        sha256_update(&hash, buffer.data(), size_t(input.gcount()));
    }
    if (!input.eof()) throw std::runtime_error("Cache file read failed");
    unsigned char result[SHA256_DIGEST_SIZE]; sha256_final(&hash, result);
    return hex(result);
}
struct Entry { fs::path path; uintmax_t bytes; };

// Only host-created private cache files. Never stores a user/tool message.
class Store {
    fs::path root;
    uintmax_t max_bytes;
    size_t max_entries;
    fs::path path(const std::string & key, const char * suffix) const { return root / ("prefix-" + key + suffix); }
    std::string key(const std::string & identity, const std::vector<int32_t> & tokens) const {
        const auto token_hash = digest(tokens.data(), tokens.size() * sizeof(int32_t));
        const auto value = identity + ":" + token_hash;
        return digest(value.data(), value.size());
    }
    void prune(const fs::path & keep) {
        std::vector<fs::directory_entry> entries;
        for (const auto & file : fs::directory_iterator(root)) {
            const auto name = file.path().filename().string();
            if (file.is_regular_file() && name.size() == 75 && name.rfind("prefix-", 0) == 0 && file.path().extension() == ".bin") entries.push_back(file);
        }
        std::sort(entries.begin(), entries.end(), [](const auto & a, const auto & b) { return a.last_write_time() > b.last_write_time(); });
        size_t retained = 1;
        for (const auto & file : entries) if (file.path() != keep) {
            if (retained++ < max_entries) continue;
            fs::remove(file.path()); auto metadata = file.path(); metadata.replace_extension(".json"); fs::remove(metadata);
        }
    }
public:
    explicit Store(fs::path directory, uintmax_t limit = 512ULL * 1024 * 1024, size_t entries = 2)
        : root(std::move(directory)), max_bytes(limit), max_entries(entries) { fs::create_directories(root); }

    std::string model_identity(const fs::path & model) {
        struct stat info{};
        if (::stat(model.c_str(), &info) != 0) throw std::runtime_error("Model identity unavailable");
#if defined(__APPLE__)
        const auto mtime_ns = info.st_mtimespec.tv_nsec, ctime_ns = info.st_ctimespec.tv_nsec;
#else
        const auto mtime_ns = info.st_mtim.tv_nsec, ctime_ns = info.st_ctim.tv_nsec;
#endif
        const auto signature = model.string() + ":" + std::to_string(info.st_ino) + ":" +
            std::to_string(info.st_size) + ":" + std::to_string(info.st_mtime) + ":" + std::to_string(mtime_ns) + ":" +
            std::to_string(info.st_ctime) + ":" + std::to_string(ctime_ns);
        const auto index = root / "model-identity.json";
        if (fs::exists(index) && fs::file_size(index) <= 8192) {
            try {
                std::ifstream in(index); auto value = json::parse(in);
                const auto sha = value.at("sha256").get<std::string>();
                if (value.at("signature") == signature && sha.size() == 64 && sha.find_first_not_of("0123456789abcdef") == std::string::npos) return sha;
            } catch (...) { /* A stale index is rebuilt from the model bytes. */ }
        }
        const auto sha = file_digest(model);
        const auto temp = root / "model-identity.json.tmp";
        { std::ofstream out(temp); out << json({{"signature", signature}, {"sha256", sha}}); out.flush(); if (!out) throw std::runtime_error("Model identity write failed"); }
        fs::rename(temp, index);
        return sha;
    }

    std::optional<Entry> candidate(const std::string & identity, const std::vector<int32_t> & tokens) {
        const auto id = key(identity, tokens);
        const auto metadata = path(id, ".json"), binary = path(id, ".bin");
        if (!fs::exists(metadata) || !fs::exists(binary) || fs::is_symlink(metadata) || fs::is_symlink(binary) || fs::file_size(metadata) > 8192) return {};
        try {
            std::ifstream in(metadata); auto value = json::parse(in);
            const auto bytes = fs::file_size(binary);
            if (value.at("version") != 1 || value.at("identity") != identity || value.at("tokens") != tokens.size() ||
                value.at("bytes") != bytes || bytes == 0 || bytes > max_bytes || value.at("sha256") != file_digest(binary)) return {};
            return Entry{binary, bytes};
        } catch (...) { return {}; }
    }

    bool save(const std::string & identity, const std::vector<int32_t> & tokens, uintmax_t estimate,
              const std::function<bool(const fs::path &)> & writer) {
        if (estimate > max_bytes || fs::space(root).available < estimate * 2) return false;
        const auto id = key(identity, tokens);
        const auto temporary = path(id, ".bin.tmp"), meta_temp = path(id, ".json.tmp");
        try {
            if (!writer(temporary)) throw std::runtime_error("State write failed");
            const auto bytes = fs::file_size(temporary);
            if (bytes == 0 || bytes > max_bytes) throw std::runtime_error("State exceeds cache limit");
            const auto checksum = file_digest(temporary);
            { std::ofstream out(meta_temp); out << json({{"version", 1}, {"identity", identity}, {"tokens", tokens.size()}, {"bytes", bytes}, {"sha256", checksum}});
              out.flush(); if (!out) throw std::runtime_error("Cache metadata write failed"); }
            const auto binary = path(id, ".bin");
            fs::rename(temporary, binary); fs::rename(meta_temp, path(id, ".json"));
            prune(binary); return true;
        } catch (...) {
            std::error_code ignored; fs::remove(temporary, ignored); fs::remove(meta_temp, ignored); return false;
        }
    }
};
} // namespace bolt_cache
