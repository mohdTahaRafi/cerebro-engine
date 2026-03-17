import mongoose from 'mongoose';
import { getChunksByIds } from '../src/services/DatabaseService.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function verifyHydration() {
    try {
        console.log('--- Verifying Data Hydration ---');
        await mongoose.connect(process.env.MONGO_URI);
        const db = mongoose.connection.db;
        const collection = db.collection('chunks');

        const mockChunks = [
            { text_content: 'Chunk Alpha', metadata: { pos: 1 } },
            { text_content: 'Chunk Beta', metadata: { pos: 2 } },
            { text_content: 'Chunk Gamma', metadata: { pos: 3 } }
        ];

        const insertResult = await collection.insertMany(mockChunks);
        const ids = Object.values(insertResult.insertedIds).map(id => id.toString());
        
        console.log('Inserted IDs: ' + ids.join(', '));

        const reversedIds = [...ids].reverse();
        console.log('Requesting Order: ' + reversedIds.join(', '));

        const hydrated = await getChunksByIds(reversedIds);
        
        console.log('Returned Order: ' + hydrated.map(h => h.text_content).join(', '));

        const success = hydrated.length === 3 && 
                        hydrated[0].text_content === 'Chunk Gamma' &&
                        hydrated[2].text_content === 'Chunk Alpha';

        console.log('Order Restoration Success: ' + success);

        await collection.deleteMany({ _id: { $in: Object.values(insertResult.insertedIds) } });

    } catch (error) {
        console.error('Hydration Verification Failed: ' + error.message);
    } finally {
        await mongoose.disconnect();
    }
}

verifyHydration();
