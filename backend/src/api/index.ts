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

app.post('/similarity', (req, res) => {
    try {
        const { vecA, vecB } = req.body;
        
        if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
            return res.status(400).json({ error: 'vecA and vecB must be arrays of numbers' });
        }

        // Convert the JS arrays to Float32Arrays for the native addon
        const float32A = new Float32Array(vecA);
        const float32B = new Float32Array(vecB);

        // Call the C++ function!
        const score = cerebroCore.getSimilarityScore(float32A, float32B);
        
        res.json({ score });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on port ${PORT}`);
    console.log('🧪 Native Addon loaded successfully!');
});
