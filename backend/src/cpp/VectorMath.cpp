#include "VectorMath.h"
#include <immintrin.h>

namespace Cerebro {

float SimdDotProduct(const float* a, const float* b) {
    // We assume 384 dimensions (multiple of 8 for AVX2)
    // 384 / 8 = 48 iterations
    
    __m256 sum = _mm256_setzero_ps();

    for (size_t i = 0; i < 384; i += 8) {
        // Load 8 floats from a and b
        __m256 va = _mm256_loadu_ps(a + i);
        __m256 vb = _mm256_loadu_ps(b + i);

        // Fused Multiply-Add: sum = (va * vb) + sum
        sum = _mm256_fmadd_ps(va, vb, sum);
    }

    // Horizontal add of the 8 values in the sum register
    float finalSum = 0;
    float temp[8];
    _mm256_storeu_ps(temp, sum);
    
    for (int i = 0; i < 8; i++) {
        finalSum += temp[i];
    }

    return finalSum;
}

} // namespace Cerebro
