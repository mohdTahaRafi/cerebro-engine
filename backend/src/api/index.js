import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import mongoose from 'mongoose';
import CircuitBreaker from 'opossum';
import { randomUUID } from 'crypto';
import { ingestDocument } from '../services/IngestionService.js';
import { hybridSearch } from '../services/SearchService.js';
import { processDocument as encodeText } from '../services/EncoderService.js';
import { GenerationService } from '../services/GenerationService.js';
import { errorHandler } from '../middleware/errorHandler.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from '../config/index.js';
import { initTracing } from '../telemetry/tracing.js';
import { pingGraph } from '../graph/pingGraph.js';
import healthRouter from './routes/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = config.port;

app.use(cors());
app.use(express.json());

initTracing();

// MongoDB Connection — now reads through config/index.js (fail-fast validated at
// startup) instead of raw process.env, but the connection itself is unchanged.
mongoose.connect(config.mongo.uri)
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
// GET /health — replaces the trivial legacy handler with concurrent per-dependency
// probes (phase 1 §8). Not one of the routes phase 1 §1 promises to keep untouched
// (only /api/ingest, /api/search, /api/ask are legacy-frozen).
app.use(healthRouter);

/**
 * Ping Graph — THROWAWAY (phase 1 §9.2). Proves the LangGraph runtime and the
 * LangSmith tracing pipeline both work before Phase 5's real graph depends on them.
 * Deleted in Phase 5 along with pingGraph.js.
 */
app.post('/api/graph/ping', async (req, res, next) => {
    try {
        const runId = randomUUID();
        const result = await pingGraph.invoke(
            { input: req.body?.input ?? '' },
            { runId, runName: 'pingGraph' },
        );
        res.json({ output: result.output, steps: result.steps, runId });
    } catch (err) {
        next(err);
    }
});

/**
 * Ingestion Endpoint
 * Receives a file, processes it through the pipeline:
 * Load -> Chunk -> Encode -> Sink (to MongoDB)
 */
app.post('/api/ingest', upload.single('document'), async (req, res) => {
    let currentPath = '';
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No document provided.' });
        }

        currentPath = req.file.path;
        const extension = path.extname(req.file.originalname);
        const newPath = `${currentPath}${extension}`;

        console.log(`[DEBUG] Ingesting: ${req.file.originalname}, Ext: ${extension}, Path: ${newPath}`);

        // Rename to preserve extension for UniversalLoader
        await fs.rename(currentPath, newPath);
        currentPath = newPath; // Update reference for tracking

        const result = await ingestDocument(currentPath, req.file.originalname);

        // Cleanup ONLY on success
        await fs.unlink(currentPath);
        console.log(`[DEBUG] Ingestion successful, temporary file removed: ${currentPath}`);

        res.json(result);
    } catch (error) {
        console.error(`[Ingestion Error] Failure. File preserved at: ${currentPath}`);
        console.error(error);
        res.status(500).json({
            error: error.message,
            message: "Ingestion failed. Temporary file has been kept on the server for retry."
        });
    }
});

/**
 * Search Endpoint
 * Hybrid search using Lexical (Atlas Search) + Vector (C++ Rerank)
 *
 * Wrapped in an opossum circuit breaker: if MongoDB/the C++ engine start failing
 * repeatedly, the circuit opens and fails fast (503) instead of letting every
 * request hang/error individually. Trips are visible to the frontend via the
 * `{ status: 'Circuit Open' }` shape useCerebroSearch.ts already checks for.
 */
async function executeSearch(query, scopeSources) {
    // 1. Vectorize the query
    const encodingResult = await encodeText([query]);
    const queryVector = encodingResult.vectorData;

    // 2. Perform Hybrid Search, collecting real timing as it runs
    const timing = {};
    const results = await hybridSearch(query, queryVector, null, 10, timing, scopeSources);

    return { results, embeddingMs: encodingResult.metrics.latencyMs, timing };
}

const searchBreaker = new CircuitBreaker(executeSearch, {
    timeout: 8000,               // fail a single request if it takes longer than this
    errorThresholdPercentage: 50, // open the circuit once >50% of recent requests fail
    resetTimeout: 10000,         // wait this long before trying a request again (half-open)
    volumeThreshold: 3,          // require at least 3 requests in the window before tripping
});

app.post('/api/search', async (req, res) => {
    const routeStart = performance.now();
    try {
        const { query, scopeSources } = req.body;
        if (!query) {
            return res.status(400).json({ error: "Query text is required." });
        }

        const { results, embeddingMs, timing } = await searchBreaker.fire(query, scopeSources);

        res.json({
            results,
            query,
            telemetry: {
                cacheWaitMs: 0, // no cache layer exists yet — honest zero, not a placeholder
                embeddingMs,
                retrievalMs: timing.retrievalMs,
                rerankingMs: timing.rerankingMs,
                rerankingUs: timing.rerankingUs,
                totalMs: performance.now() - routeStart,
            }
        });

    } catch (error) {
        if (searchBreaker.opened) {
            return res.status(503).json({
                status: 'Circuit Open',
                error: 'Search engine is temporarily unavailable due to repeated failures. Please retry shortly.'
            });
        }
        console.error('Search error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Ask Endpoint
 * Generates an answer using local LLM based on retrieved context
 */
app.post('/api/ask', async (req, res) => {
    try {
        const { query, scopeSources } = req.body;
        if (!query) {
            return res.status(400).json({ error: "Query text is required." });
        }

        // 1. Set SSE headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 2. Vectorize the query and perform Hybrid Search to get context
        const encodingResult = await encodeText([query]);
        const queryVector = encodingResult.vectorData;
        // Reduced from 10 to 3 to speed up CPU inference. scopeSources, when the user has a
        // file currently attached, restricts grounding to that file instead of the whole
        // knowledge base — see SearchService.hybridSearch's sourceFilter param.
        const results = await hybridSearch(query, queryVector, null, 3, {}, scopeSources);

        // Send the real chunks the LLM is about to be grounded on, so the frontend can
        // show citations that actually match this answer instead of a separate, independent
        // /api/search call (which used a different top-K and could disagree with the LLM's context).
        res.write(`data: ${JSON.stringify({ sources: results })}\n\n`);

        // 3. Generate Answer via Ollama API
        await GenerationService.generateStreamingResponse(query, results, (token) => {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
        });

        res.write('data: [DONE]\n\n');
        res.end();

    } catch (error) {
        console.error('Ask error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// Centralized error handler — must be registered last, after all routes/middleware.
// Normalizes multer and body-parser (express.json()) failures into the API's
// standard { error } JSON shape instead of Express's default HTML error page.
app.use(errorHandler);
