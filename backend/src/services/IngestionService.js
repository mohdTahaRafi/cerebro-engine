import { UniversalLoader } from '../loaders/UniversalLoader.js';
import { processDocument as encodeChunks } from './EncoderService.js';
import { sinkChunks } from './DatabaseService.js';

const loader = new UniversalLoader();

/**
 * Orchestrates the full ingestion pipeline:
 * Load -> Chunk -> Encode -> Sink
 * 
 * @param {string} inputSource - File path or URL
 * @returns {Promise<Object>} Status of the ingestion
 */
export async function ingestDocument(inputSource) {
    console.log(`[IngestionService] Starting ingestion for: ${inputSource}`);
    const startTime = Date.now();

    try {
        // 1. Load and Chunk
        const chunks = await loader.load(inputSource);
        console.log(`[IngestionService] Loaded ${chunks.length} chunks.`);

        if (chunks.length === 0) {
            return { success: true, message: 'No content found to ingest.', chunksCount: 0 };
        }

        // 2. Encode (Vectorize)
        const texts = chunks.map(c => c.text);
        const encodingResult = await encodeChunks(texts);
        
        // 3. Prepare for Sink
        // Split the flattened Float32Array back into individual vectors
        const dim = encodingResult.dimensions;
        const vectorData = encodingResult.vectorData;
        
        const chunksToSink = chunks.map((chunk, i) => {
            const start = i * dim;
            const vector = Array.from(vectorData.slice(start, start + dim));
            return {
                text: chunk.text,
                vector: vector,
                metadata: {
                    ...chunk.metadata,
                    chunkIndex: i,
                    timestamp: new Date()
                }
            };
        });

        // 4. Sink to Database
        await sinkChunks(chunksToSink);

        const duration = (Date.now() - startTime) / 1000;
        console.log(`[IngestionService] Ingestion completed in ${duration.toFixed(2)}s.`);

        return {
            success: true,
            chunksCount: chunks.length,
            processingTimeS: duration,
            source: inputSource
        };

    } catch (error) {
        console.error(`[IngestionService] Ingestion failed for ${inputSource}:`, error);
        throw error;
    }
}
