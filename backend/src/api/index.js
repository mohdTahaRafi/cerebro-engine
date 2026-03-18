import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import mongoose from 'mongoose';
import { ingestDocument } from '../services/IngestionService.js';
import { hybridSearch } from '../services/SearchService.js';
import { processDocument as encodeText } from '../services/EncoderService.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('[CEREBRO] MongoDB Connected');
        app.listen(PORT, () => {
            console.log(`[CEREBRO] Backend Online at http://localhost:${PORT}`);
            console.log(`[CEREBRO] C++ SIMD Core: ACTIVE`);
        });
    })
    .catch(err => {
        console.error('[CEREBRO] MongoDB connection error:', err);
        process.exit(1);
    });

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'UP', timestamp: new Date() });
});

/**
 * Ingestion Endpoint
 * Receives a file, processes it through the pipeline:
 * Load -> Chunk -> Encode -> Sink (to MongoDB)
 */
app.post('/api/ingest', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No document provided.' });
        }

        const originalPath = req.file.path;
        const extension = path.extname(req.file.originalname);
        const newPath = `${originalPath}${extension}`;
        
        console.log(`[DEBUG] Ingesting: ${req.file.originalname}, Ext: ${extension}, Path: ${newPath}`);

        // Rename to preserve extension for UniversalLoader
        await fs.rename(originalPath, newPath);

        const result = await ingestDocument(newPath);

        // Cleanup
        await fs.unlink(newPath);

        res.json(result);
    } catch (error) {
        console.error('Ingestion error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Search Endpoint
 * Hybrid search using Lexical (Atlas Search) + Vector (C++ Rerank)
 */
app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: "Query text is required." });
        }

        // 1. Vectorize the query
        const encodingResult = await encodeText([query]);
        const queryVector = encodingResult.vectorData;

        // 2. Perform Hybrid Search
        // Note: For now, we need to handle the 'dataset' retrieval part.
        // In a real production setup, we'd fetch candidates from DB first.
        // For the purpose of the 'build' we verified, we'll implement the retrieval logic here or in SearchService.
        
        // FUTURE: Fetch candidates from MongoDB $vectorSearch or $text search
        // For now, let's call hybridSearch. We might need to update SearchService to handle its own retrieval.
        const results = await hybridSearch(query, queryVector, null, 10);
        
        res.json({
            results,
            query
        });

    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: error.message });
    }
});

