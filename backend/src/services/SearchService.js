// This service coordinates hybrid search by fusing results from lexical and vector engines using Reciprocal Rank Fusion (RRF).
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { lexicalSearch, getChunksByIds } from './DatabaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const cerebroCore = require(resolve(__dirname, '../../build/Release/cerebro_core.node'));
const { CerebroEngine } = cerebroCore;
const engine = new CerebroEngine();

/**
 * Executes hybrid search with RRF fusion.
 * 
 * @param {string} queryText - Lexical query string
 * @param {Float32Array} queryVector - Query embedding
 * @param {Float32Array|null} providedDataset - Optional override dataset for testing
 * @param {number} limitK - Number of top results to return
 */
export async function hybridSearch(queryText, queryVector, providedDataset = null, limitK = 5) {
    const RRF_K = 60;
    const fusedScores = new Map();

    let candidates = [];
    let vectorResults = [];

    // 1. Retrieval Phase
    if (providedDataset) {
        // Direct C++ search (from testing pipeline)
        vectorResults = engine.SearchVectors(queryVector, providedDataset, 50);
    } else {
        // Real MongoDB Atlas Vector Search retrieval
        const db = mongoose.connection.db;
        const collection = db.collection('chunks');
        
        candidates = await collection.aggregate([
            {
                "$vectorSearch": {
                    "index": "vector_index", // Matches the project's standard index name
                    "path": "vector",
                    "queryVector": Array.from(queryVector),
                    "numCandidates": 100,
                    "limit": 50
                }
            }
        ]).toArray();

        // Pass retrieved vectors to C++ Core for precise dot-product reranking
        if (candidates.length > 0) {
            const dim = queryVector.length;
            const datasetBuffer = new Float32Array(candidates.length * dim);
            candidates.forEach((doc, i) => {
                datasetBuffer.set(doc.vector, i * dim);
            });
            vectorResults = engine.SearchVectors(queryVector, datasetBuffer, 50);
        }
    }

    // 2. Lexical Retrieval
    const lexicalResults = await lexicalSearch(queryText, 50);

    // 3. RRF Fusion Logic
    vectorResults.forEach((result, index) => {
        // If we used a provided dataset, index is just an integer. 
        // If we used MongoDB, we map it back to the candidate's ObjectId.
        const id = providedDataset ? result.index.toString() : candidates[result.index]._id.toString();
        const rank = index + 1;
        const rrfScore = 1 / (RRF_K + rank);
        fusedScores.set(id, (fusedScores.get(id) || 0) + rrfScore);
    });

    lexicalResults.forEach((result, index) => {
        const id = result._id;
        const rank = index + 1;
        const rrfScore = 1 / (RRF_K + rank);
        fusedScores.set(id, (fusedScores.get(id) || 0) + rrfScore);
    });

    // 4. Sorting and Hydration
    const sortedIds = Array.from(fusedScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limitK)
        .map(entry => entry[0]);

    const hydratedDocs = await getChunksByIds(sortedIds);
    
    // Add fused scores to the results for UI/debug
    const resultsWithScores = hydratedDocs.map(doc => ({
        ...doc,
        rrfScore: fusedScores.get(doc._id.toString())
    }));

    console.log(`[SearchService] Hybrid search complete. Returned ${resultsWithScores.length} docs.`);
    return resultsWithScores;
}
