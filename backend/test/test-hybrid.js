import mongoose from 'mongoose';
import { hybridSearch } from '../src/services/SearchService.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function verifyHybrid() {
    try {
        console.log('--- Verifying Hybrid Search (RRF) ---');
        await mongoose.connect(process.env.MONGO_URI);

        const dim = 384;
        const queryVector = new Float32Array(dim).map(() => Math.random());
        const dataset = new Float32Array(100 * dim).map(() => Math.random());

        const results = await hybridSearch('sample', queryVector, dataset, 5);
        
        console.log('Hybrid Results Found: ' + results.length);
        results.forEach((res, i) => {
            console.log('Rank ' + (i + 1) + ': ID ' + res._id + ', Fused Score: ' + res.rrfScore.toFixed(6));
        });

    } catch (error) {
        console.error('Hybrid Verification Failed: ' + error.message);
    } finally {
        await mongoose.disconnect();
    }
}

verifyHybrid();
