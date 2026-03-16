import { ModelLoader } from './ModelLoader.js';

/**
 * BatchEncoder service handles chunk processing, batching, and manual L2 normalization.
 */
export class BatchEncoder {
    constructor() {
        this.dim = 384; // all-MiniLM-L6-v2 dimension
    }

    /**
     * Encodes an array of text chunks into a memory-contiguous Float32Array.
     * 
     * @param {string[]} textArray - Array of text segments to encode.
     * @param {number} batchSize - Number of chunks to process in parallel.
     * @returns {Promise<Float32Array>} Flattened and normalized embeddings.
     */
    async encode(textArray, batchSize = 50) {
        const extractor = await ModelLoader.getInstance();
        const numChunks = textArray.length;
        const resultBuffer = new Float32Array(numChunks * this.dim);

        for (let i = 0; i < numChunks; i += batchSize) {
            const batch = textArray.slice(i, i + batchSize);
            
            // Process the batch through the model
            // Xenova transformers feature-extraction returns an object { data, dims }
            const batchEncodings = await Promise.all(
                batch.map(text => extractor(text, { pooling: 'mean', normalize: false }))
            );

            // Process each result in the batch
            batchEncodings.forEach((output, batchIdx) => {
                const vector = Array.from(output.data);
                const normalized = this.#normalizeL2(vector);
                
                // Copy into the contiguous resultBuffer
                const globalIdx = i + batchIdx;
                resultBuffer.set(normalized, globalIdx * this.dim);
            });
        }

        return resultBuffer;
    }

    /**
     * Manual L2 Normalization: V = V / ||V||
     * 
     * @param {number[]} vector - Raw vector embedding.
     * @returns {number[]} L2 normalized vector.
     */
    #normalizeL2(vector) {
        let sumSquared = 0;
        for (let i = 0; i < vector.length; i++) {
            sumSquared += vector[i] * vector[i];
        }
        
        const magnitude = Math.sqrt(sumSquared);
        
        // Prevent division by zero
        if (magnitude === 0) return vector;

        return vector.map(v => v / magnitude);
    }
}
