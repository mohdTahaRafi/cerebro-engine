#include "VectorMath.h"

#include <cstdlib>      // getenv — CEREBRO_FORCE_SCALAR (phase 6 §3.1)
#include <cstring>      // strcmp
#include <immintrin.h> // AVX2/FMA intrinsics (GCC, Clang, and MSVC all provide this header)
#if defined(_MSC_VER)
#include <intrin.h>     // __cpuid / __cpuidex for MSVC's runtime feature check
#endif

namespace Cerebro {

namespace {

/**
 * Portable scalar dot product. No intrinsics, no special compile flags —
 * this is the safe fallback for any CPU without AVX2 (and for any `dim`
 * that isn't a multiple of 8).
 */
float ScalarDotProduct(const float* a, const float* b, size_t dim) {
    float sum = 0.0f;
    for (size_t i = 0; i < dim; ++i) {
        sum += a[i] * b[i];
    }
    return sum;
}

#if defined(__GNUC__) || defined(__clang__)
/**
 * AVX2/FMA dot product. Marked with a per-function `target` attribute so it
 * can use AVX2 intrinsics without the translation unit (or the rest of the
 * binary) being compiled with -mavx2/-mfma globally. Must only be called
 * after CpuSupportsAVX2() has confirmed the host CPU actually supports it —
 * calling this on an unsupported CPU will SIGILL.
 */
__attribute__((target("avx2,fma")))
float DotProductAVX2(const float* a, const float* b, size_t dim) {
    __m256 sum = _mm256_setzero_ps();

    size_t i = 0;
    for (; i + 8 <= dim; i += 8) {
        __m256 va = _mm256_loadu_ps(a + i);
        __m256 vb = _mm256_loadu_ps(b + i);
        sum = _mm256_fmadd_ps(va, vb, sum);
    }

    float temp[8];
    _mm256_storeu_ps(temp, sum);
    float total = temp[0] + temp[1] + temp[2] + temp[3] +
                  temp[4] + temp[5] + temp[6] + temp[7];

    // Scalar tail for any remainder when dim isn't a multiple of 8.
    for (; i < dim; ++i) {
        total += a[i] * b[i];
    }

    return total;
}
#endif

/**
 * Detects AVX2 support once and caches the result. GCC/Clang use the
 * compiler-provided CPUID builtin; MSVC falls back to a manual __cpuid leaf-7
 * check (EBX bit 5). Never assumes the build machine's CPU matches the
 * runtime machine's CPU.
 */
bool CpuSupportsAVX2() {
#if defined(__GNUC__) || defined(__clang__)
    static const bool supported = [] {
        __builtin_cpu_init();
        return __builtin_cpu_supports("avx2") != 0;
    }();
    return supported;
#elif defined(_MSC_VER)
    static const bool supported = [] {
        int info[4] = {0};
        __cpuid(info, 0);
        int maxLeaf = info[0];
        if (maxLeaf < 7) return false;
        __cpuidex(info, 7, 0);
        return (info[1] & (1 << 5)) != 0; // EBX bit 5 = AVX2
    }();
    return supported;
#else
    return false;
#endif
}

/**
 * Phase 6 §3.1: the benchmark needs to isolate the SIMD win from the JS-vs-native-language
 * win, which means it needs a way to force this same addon down the scalar path on
 * hardware that *does* support AVX2 — otherwise "cpp-scalar" and "cpp-avx2" would be
 * indistinguishable on any AVX2 machine, and the benchmark could never decompose "leaving
 * the JS runtime" from "using SIMD" into two separate factors. Read once and cached
 * (getenv() is not free to call per dot product, and the addon is loaded once per process
 * — bench/cppVsQdrant.js sets this before requiring the addon, never mid-run).
 */
bool ScalarForced() {
    static const bool forced = [] {
        const char* v = std::getenv("CEREBRO_FORCE_SCALAR");
        return v != nullptr && std::strcmp(v, "1") == 0;
    }();
    return forced;
}

} // namespace

float SimdDotProduct(const float* a, const float* b, size_t dim) {
#if defined(__GNUC__) || defined(__clang__) || defined(_MSC_VER)
    if (!ScalarForced() && dim >= 8 && CpuSupportsAVX2()) {
#if defined(__GNUC__) || defined(__clang__)
        return DotProductAVX2(a, b, dim);
#elif defined(_MSC_VER)
        // MSVC intrinsics compile without /arch:AVX2 (that flag only
        // changes default codegen elsewhere); calling them here is safe now
        // that CpuSupportsAVX2() has gated it.
        __m256 sum = _mm256_setzero_ps();
        size_t i = 0;
        for (; i + 8 <= dim; i += 8) {
            __m256 va = _mm256_loadu_ps(a + i);
            __m256 vb = _mm256_loadu_ps(b + i);
            sum = _mm256_fmadd_ps(va, vb, sum);
        }
        float temp[8];
        _mm256_storeu_ps(temp, sum);
        float total = temp[0] + temp[1] + temp[2] + temp[3] +
                      temp[4] + temp[5] + temp[6] + temp[7];
        for (; i < dim; ++i) {
            total += a[i] * b[i];
        }
        return total;
#endif
    }
#endif
    return ScalarDotProduct(a, b, dim);
}

} // namespace Cerebro
