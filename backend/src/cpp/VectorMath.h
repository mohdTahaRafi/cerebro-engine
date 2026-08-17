/**
 * @file VectorMath.h
 * @brief Dot-product primitive used by Cerebro's vector search core.
 *
 * There is no persistent, server-side vector index anywhere in this addon:
 * CerebroEngine::SearchVectors (VectorSearch.cpp) is a stateless brute-force
 * scan — the caller rebuilds and passes in the full candidate buffer on every
 * single call. SimdDotProduct below is the per-call primitive that scan is
 * built on. This addon has not served live queries since Phase 3 (Qdrant
 * took over hybrid retrieval); it survives as the benchmark artifact
 * bench/cppVsQdrant.js measures (phase 6 §3, §5.2).
 */

#ifndef VECTOR_MATH_H
#define VECTOR_MATH_H

#include <cstddef>

namespace Cerebro {

/**
 * @brief Dot product of two equal-length float vectors, dispatched at
 * runtime to an AVX2/FMA implementation when the host CPU supports it, or a
 * portable scalar fallback otherwise (see VectorMath.cpp). Safe to call on
 * any CPU — never assumes AVX2 is present.
 *
 * @param a Pointer to a `dim`-length float array.
 * @param b Pointer to a `dim`-length float array.
 * @param dim Number of elements in each of `a` and `b`.
 * @return float Computed dot product.
 */
float SimdDotProduct(const float* a, const float* b, size_t dim);

} // namespace Cerebro

#endif // VECTOR_MATH_H
