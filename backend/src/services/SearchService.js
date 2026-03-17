// This service coordinates hybrid search by fusing results from lexical and vector engines using Reciprocal Rank Fusion.
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { lexicalSearch } from './DatabaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const cerebroCore = require(resolve(__dirname, '../../build/Release/cerebro_core.node'));
const { CerebroEngine } = cerebroCore;
const engine = new CerebroEngine();

export async function hybridSearch(queryText, queryVector, dataset, limitK = 5) {
    const RRF_K = 60;
    const fusedScores = new Map();

    const [lexicalResults, vectorResults] = await Promise.all([
        lexicalSearch(queryText, 50),
        Promise.resolve(engine.SearchVectors(queryVector, dataset, 50))
    ]);

    vectorResults.forEach((result, index) => {
        const id = result.index.toString();
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

    const finalResults = Array.from(fusedScores.entries())
        .map(([id, score]) => ({ _id: id, rrfScore: score }))
        .sort((a, b) => b.rrfScore - a.rrfScore)
        .slice(0, limitK);

    console.log('Hybrid search complete. Top result score: ' + (finalResults.length > 0 ? finalResults[0].rrfScore : 0));
    return finalResults;
}
