import express from 'express';
import cors from 'cors';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Load the compiled C++ addon
const cerebroCore = require(resolve(__dirname, '../../build/Release/cerebro_core.node'));


const app = express();
app.use(cors());
app.use(express.json());

// Add a simple logging middleware to see requests in the terminal
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.get('/', (req, res) => {
    res.json({ message: 'Cerebro Backend is running!' });
});

import { performSearch } from '../engine/VectorEngine.js';

app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Search query string is required' });
        }

        // Execute Vector Search orchestration
        const response = await performSearch(query);
        
        // Handle Circuit Breaker Fallbacks being bubbled up
        if ((response as any).status === 'Circuit Open') {
             return res.status(503).json(response);
        }
        
        res.json(response);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`[CEREBRO] Backend Online | C++ SIMD Core: ACTIVE`);
});
