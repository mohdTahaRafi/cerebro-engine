import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { getEmbeddingRobust } from './hfCircuitBreaker.js';
import axios from 'axios';
import mongoose from 'mongoose';
import { createClient } from 'redis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// 1. The Native Bridge: Import the compiled C++ addon
const cerebroCore = require(resolve(__dirname, '../../build/Release/cerebro_core.node'));

/**
 * Wrapper function for the C++ native addon
 */
export function computeSimilarity(v1: Float32Array, v2: Float32Array): number {
    return cerebroCore.getSimilarityScore(v1, v2);
}

// Unify Schema with IngestionService
const VectorModel = mongoose.models.Document || mongoose.model('Document', new mongoose.Schema({
    fileName: String,
    textChunk: String,
    vector: [Number],
    metadata: mongoose.Schema.Types.Mixed
}));

// Redis Client Setup (Connect this during app startup)
export const redisClient = createClient({ 
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => retries > 2 ? false : 500 // Fail fast if not there
    }
});
redisClient.on('error', (err) => {
    // Only log once to avoid terminal spam
    if (err.code === 'ECONNREFUSED') return; 
    console.log('Redis Client Error', err);
});

export interface SearchResult {
    documentId: string;
    content: string;
    similarity: number;
}

export interface SearchResponse {
    results: SearchResult[];
    telemetry: {
        cacheWaitMs: number;
        embeddingMs: number;
        retrievalMs: number;
        rerankingMs: number;
        rerankingUs: number; // High-resolution C++ execution time in microseconds
        totalMs: number;
    }
}

// 2. The Search Flow
export async function performSearch(queryText: string): Promise<SearchResponse> {
    const startTime = Date.now();
    let embeddingStart = 0;
    let retrievalStart = 0;
    let rerankingStart = 0;

    let embeddingMs = 0;
    let retrievalMs = 0;
    let rerankingMs = 0;
    let cacheWaitMs = 0;

    // Step A (The Cache): Generate SHA-256 hash of the query
    const cacheStart = Date.now();
    const queryHash = createHash('sha256').update(queryText).digest('hex');
    const cacheKey = `search:${queryHash}`;
    
    if (redisClient.isReady) {
        try {
            const cachedResults = await redisClient.get(cacheKey);
            if (cachedResults) {
                console.log(`ENGINE: Cache Hit for [${queryHash}]`);
                cacheWaitMs = Date.now() - cacheStart;
                const parsed = JSON.parse(cachedResults as string);
                parsed.telemetry.totalMs = Date.now() - startTime;
                return parsed;
            }
        } catch (e) {
            console.error("ENGINE: Redis Cache Error (Lookup)", e);
        }
    }
    cacheWaitMs = Date.now() - cacheStart;

    // Step B (Embedding): Call the Hugging Face Inference API via Circuit Breaker
    embeddingStart = Date.now();
    let queryVectorArr: number[] = [];
    
    try {
        const result = await getEmbeddingRobust(queryText);
        
        // Check if the circuit breaker returned the fallback error object
        if (!Array.isArray(result) && result.error) {
            return result as any; // Returns { error: 'Embedding Service Unavailable', status: 'Circuit Open' }
        }
        
        queryVectorArr = result as number[];
    } catch (error) {
        console.error("Embedding API Error:", error);
        throw new Error("Failed to generate embedding");
    }
    const queryVector = new Float32Array(queryVectorArr);
    embeddingMs = Date.now() - embeddingStart;

    // Step C (Retrieval): Query MongoDB Atlas using vectorSearch (HNSW)
    retrievalStart = Date.now();
    
    // Note: Assuming a predefined Atlas Search index named 'vector_index'
    const roughCandidates = await VectorModel.aggregate([
        {
            "$vectorSearch": {
                "index": "vector_index",
                "path": "vector",
                "queryVector": queryVectorArr,
                "numCandidates": 100, // Search space
                "limit": 50 // Top 50 rough candidates
            }
        }
    ]);
    retrievalMs = Date.now() - retrievalStart;

    // Step D (The Re-rank): Pass vectors to C++ native addon (Zero-Copy Float32Array)
    console.log(`ENGINE: Calling C++ Addon with [${roughCandidates.length}] candidates...`);
    rerankingStart = Date.now();
    const hrtStart = process.hrtime.bigint(); // Microsecond-precision timer
    
    const rerankedResults = roughCandidates.map(doc => {
        const docVector = new Float32Array(doc.vector);
        const score = computeSimilarity(queryVector, docVector);
        
        return {
            documentId: doc._id.toString(),
            content: doc.textChunk || doc.content || "",
            fileName: doc.fileName,
            textChunk: doc.textChunk,
            similarity: score
        };
    });

    // Step E (Final Result): Sort results based on C++ score and get top 10
    rerankedResults.sort((a, b) => b.similarity - a.similarity);
    const top10 = rerankedResults.slice(0, 10);
    
    const hrtEnd = process.hrtime.bigint();
    rerankingMs = Date.now() - rerankingStart;
    const rerankingUs = Number(hrtEnd - hrtStart) / 1000; // nanoseconds -> microseconds

    const finalResponse: SearchResponse = {
        results: top10,
        telemetry: {
            cacheWaitMs,
            embeddingMs,
            retrievalMs,
            rerankingMs,
            rerankingUs,
            totalMs: Date.now() - startTime
        }
    };

    // Cache the fully computed result (backgrounded)
    if (redisClient.isReady) {
        redisClient.set(cacheKey, JSON.stringify(finalResponse), {
            EX: 3600 // Cache for 1 hour
        }).catch(e => console.error("ENGINE: Redis Cache Error (Storage)", e));
    }

    return finalResponse;
}
