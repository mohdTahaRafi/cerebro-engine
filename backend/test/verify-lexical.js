import mongoose from 'mongoose';
import { lexicalSearch } from '../src/services/DatabaseService.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function verify() {
    try {
        console.log('--- Verifying Lexical Search ---');
        await mongoose.connect(process.env.MONGO_URI);
        
        const results = await lexicalSearch('sample', 5);
        console.log('Results Count: ' + results.length);
        
        if (results.length > 0) {
            console.log('First Result ID: ' + results[0]._id);
            console.log('First Result Score: ' + results[0].score);
            console.log('Type of ID: ' + typeof results[0]._id);
        } else {
            console.log('No results found for "sample". This is expected if the DB is empty.');
        }

    } catch (error) {
        console.error('Verification Failed: ' + error.message);
    } finally {
        await mongoose.disconnect();
    }
}

verify();
