#ifndef GGML_UNPACK8_32_GLSL
#define GGML_UNPACK8_32_GLSL

// Keep unpacked values in 32-bit lanes. Some mobile shader compilers either
// reject unpack8() or miscompile its narrow integer-vector result.
uvec4 ggml_unpack_u8_u32(uint packed) {
    return uvec4(packed & 255u, (packed >> 8) & 255u,
                 (packed >> 16) & 255u, packed >> 24);
}

ivec4 ggml_unpack_i8_i32(int packed) {
    return ivec4(bitfieldExtract(packed, 0, 8), bitfieldExtract(packed, 8, 8),
                 bitfieldExtract(packed, 16, 8), bitfieldExtract(packed, 24, 8));
}

#endif
