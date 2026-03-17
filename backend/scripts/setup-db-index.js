// This script establishes a MongoDB $text index on the text_content field to enable keyword-based hybrid search.
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function setupIndex() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const db = mongoose.connection.db;
        const collection = db.collection('chunks');
        
        await collection.createIndex({ text_content: 'text' });
        
        console.log('Success: Full-text index created on chunks collection.');
    } catch (error) {
        console.log('Error: Failed to create index. ' + error.message);
    } finally {
        await mongoose.disconnect();
        console.log('Status: Database connection closed.');
    }
}

setupIndex();
