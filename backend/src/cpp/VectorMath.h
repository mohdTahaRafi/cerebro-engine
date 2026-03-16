/**
 * @file VectorMath.h
 * @brief Data contract and base class for Cerebro Vector Search Core.
 * 
 * This file defines the interface between Node.js and the custom C++ 
 * vector search implementation.
 */

#ifndef VECTOR_MATH_H
#define VECTOR_MATH_H

#include <cstddef>

namespace Cerebro {

/**
 * @class VectorSearch
 * @brief High-performance vector management and similarity search.
 */
class VectorSearch {
public:
    /**
     * @brief Adds a batch of document vectors to the search index.
     * 
     * @param vectorData Pointer to the start of a flattened 1D array of float32 values.
     *                   Data is expected to be memory-contiguous and L2-normalized 
     *                   from the Node.js layer.
     * @param totalVectors The number of discrete document chunks in the buffer.
     * @param dimensions The vector space dimensionality (Expected: 384).
     */
    virtual void AddDocumentVectors(const float* vectorData, 
                                   size_t totalVectors, 
                                   size_t dimensions) = 0;

    virtual ~VectorSearch() {}
};

} // namespace Cerebro

#endif // VECTOR_MATH_H
