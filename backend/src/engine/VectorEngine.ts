import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createHash } from 'crypto';
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

// Example Mongoose Model (Needs to be replaced with your actual schema)
const VectorModel = mongoose.model('Document', new mongoose.Schema({
    content: String,
    embedding: [Number]
}));

// Redis Client Setup (Connect this during app startup)
export const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => console.log('Redis Client Error', err));

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
    
    if (redisClient.isOpen) {
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            cacheWaitMs = Date.now() - cacheStart;
            const parsed = JSON.parse(cachedResults);
            parsed.telemetry.totalMs = Date.now() - startTime;
            return parsed;
        }
    }
    cacheWaitMs = Date.now() - cacheStart;

    // Step B (Embedding): Call the Hugging Face Inference API
    embeddingStart = Date.now();
    let queryVectorArr: number[] = [];
    
    try {
        const hfToken = process.env.HF_TOKEN;
        const modelUrl = 'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2'; // Or your 1536d model
        
        const response = await axios.post(
            modelUrl,
            { inputs: queryText },
            { headers: { Authorization: `Bearer ${hfToken}` } }
        );
        queryVectorArr = response.data;
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
                "path": "embedding",
                "queryVector": queryVectorArr,
                "numCandidates": 100, // Search space
                "limit": 50 // Top 50 rough candidates
            }
        }
    ]);
    retrievalMs = Date.now() - retrievalStart;

    // Step D (The Re-rank): Pass vectors to C++ native addon
    rerankingStart = Date.now();
    
    const rerankedResults = roughCandidates.map(doc => {
        const docVector = new Float32Array(doc.embedding);
        const score = computeSimilarity(queryVector, docVector);
        
        return {
            documentId: doc._id.toString(),
            content: doc.content,
            similarity: score
        };
    });

    // Step E (Final Result): Sort results based on C++ score and get top 10
    rerankedResults.sort((a, b) => b.similarity - a.similarity);
    const top10 = rerankedResults.slice(0, 10);
    rerankingMs = Date.now() - rerankingStart;

    const finalResponse: SearchResponse = {
        results: top10,
        telemetry: {
            cacheWaitMs,
            embeddingMs,
            retrievalMs,
            rerankingMs,
            totalMs: Date.now() - startTime
        }
    };

    // Cache the fully computed result
    if (redisClient.isOpen) {
        await redisClient.set(cacheKey, JSON.stringify(finalResponse), {
            EX: 3600 // Cache for 1 hour
        });
    }

    return finalResponse;
}
