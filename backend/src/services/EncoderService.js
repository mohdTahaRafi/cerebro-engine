import { BatchEncoder } from '../encoder/BatchEncoder.js';

const encoder = new BatchEncoder();

/**
 * processDocument
 * Handles the high-level orchestration of document encoding.
 * 
 * @param {string[]} documentChunks - Array of text segments.
 * @returns {Promise<Object>} Metadata and flattened vector data.
 */
export async function processDocument(documentChunks) {
    // 1. Validation
    if (!Array.isArray(documentChunks)) {
        throw new Error('[EncoderService] Input must be an array of document chunks.');
    }

    if (documentChunks.length === 0) {
        throw new Error('[EncoderService] Cannot process an empty array of chunks.');
    }

    console.log(`[EncoderService] Processing ${documentChunks.length} chunks...`);
    const startTime = performance.now();

    try {
        // 2. Encoding Lifecycle
        const vectorData = await encoder.encode(documentChunks);
        
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);
        
        console.log(`[EncoderService] Encoding complete in ${duration}ms.`);

        // 3. Structured Data Contract for C++ Bridge
        return {
            totalChunks: documentChunks.length,
            dimensions: 384,
            vectorData: vectorData, // Memory-contiguous Float32Array
            metrics: {
                latencyMs: parseFloat(duration)
            }
        };
    } catch (error) {
        console.error('[EncoderService] Fatal error during processing:', error);
        throw error;
    }
}
