import mongoose from 'mongoose';
import { getEmbeddingRobust } from './hfCircuitBreaker.js';

// The Sink Schema: Defines the structure for storing chunks in MongoDB Atlas
const VectorModel = mongoose.models.Document || mongoose.model('Document', new mongoose.Schema({
    fileName: { type: String, required: true, index: true },
    textChunk: { type: String, required: true },
    vector: { type: [Number], required: true },
    metadata: { type: mongoose.Schema.Types.Mixed }
}));

export interface IngestionResult {
    fileName: string;
    skipped: boolean;
    chunksCreated: number;
    processingTimeMs: number;
    message: string;
}

/**
 * Helper to split text by words, respecting the 500-word window and 50-word overlap.
 */
function chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    
    if (words.length === 0) return chunks;

    for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
        const chunkWords = words.slice(i, i + chunkSize);
        chunks.push(chunkWords.join(' '));
    }

    return chunks;
}

/**
 * 1. The Pipeline Logic: Implement processDocument
 */
export async function processDocument(fileContent: string, fileName: string): Promise<IngestionResult> {
    const startTime = Date.now();

    // 2. Idempotency: Check if the fileName already exists in the database.
    const existingDoc = await VectorModel.findOne({ fileName }).lean();
    if (existingDoc) {
        return {
            fileName,
            skipped: true,
            chunksCreated: 0,
            processingTimeMs: Date.now() - startTime,
            message: 'Document already exists. Skipping ingestion to avoid duplicate vectors.'
        };
    }

    // Step A (The Chunker): Sliding Window Chunker
    const chunks = chunkText(fileContent, 500, 50);

    // Output array to hold chunks with their embeddings
    const processedChunks: { textChunk: string; vector: number[] }[] = [];

    // Step B (Batch Vectorization): Call Hugging Face API
    // Optimization: Process chunks with concurrency limited to 5
    const CONCURRENCY_LIMIT = 5;
    
    for (let i = 0; i < chunks.length; i += CONCURRENCY_LIMIT) {
        const batch = chunks.slice(i, i + CONCURRENCY_LIMIT);
        
        // Process current batch of 5 concurrently using Promise.all
        const vectors = await Promise.all(batch.map(async (textChunk) => {
            try {
                const result = await getEmbeddingRobust(textChunk);
                if (!Array.isArray(result) && result.error) {
                    throw new Error(`Embedding Service Unavailable: ${(result as any).status}`);
                }
                return result as number[];
            } catch (error) {
                console.error(`Error generating embedding for chunk in file: ${fileName}`, error);
                throw new Error("Failed to generate embedding during ingestion");
            }
        }));

        batch.forEach((textChunk, index) => {
            processedChunks.push({
                textChunk,
                vector: vectors[index]
            });
        });
    }

    // Step C (The Sink): Save each chunk to MongoDB Atlas
    const documentsToInsert = processedChunks.map((chunk, index) => ({
        fileName,
        textChunk: chunk.textChunk,
        vector: chunk.vector,
        metadata: {
            chunkIndex: index,
            timestamp: new Date().toISOString()
        }
    }));

    if (documentsToInsert.length > 0) {
        // Bulk insert chunks
        await VectorModel.insertMany(documentsToInsert);
    }

    // 3. UI Feedback
    return {
        fileName,
        skipped: false,
        chunksCreated: documentsToInsert.length,
        processingTimeMs: Date.now() - startTime,
        message: 'Successfully ingested document'
    };
}
