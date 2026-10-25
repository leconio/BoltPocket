#pragma once
#include <algorithm>
#include <stdexcept>

inline int bolt_output_budget(int prompt, int context, int requested) {
    if (prompt < 0 || context < 1 || requested < 1)
        throw std::invalid_argument("Invalid native generation budget");
    if (prompt >= context)
        throw std::runtime_error("Conversation exceeds the native token context");
    return std::min(requested, context - prompt);
}
