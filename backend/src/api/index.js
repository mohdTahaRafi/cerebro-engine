import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import mongoose from 'mongoose';
import { ingestDocument } from '../services/IngestionService.js';
import { errorHandler } from '../middleware/errorHandler.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from '../config/index.js';
import { initTracing } from '../telemetry/tracing.js';
import healthRouter from './routes/health.js';
import documentsRouter from './routes/documents.js';
import searchRouter from './routes/search.js';
import pagesRouter from './routes/pages.js';
import askRouter from './routes/ask.js';
import threadsRouter from './routes/threads.js';
import { startWorker } from '../ingestion/queue.js';

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
        // Phase 2: bind the port BEFORE starting the ingest worker. Ordering matters —
        // an instance that cannot bind must not consume the queue. Without this, a second
        // `node src/api/index.js` (a stale process, a duplicate `npm run dev`) silently
        // ran its own BullMQ worker against the same Redis queue while serving no HTTP at
        // all, doubling effective ingest concurrency to 4 with nothing in the logs to say
        // so. Observed live: architecture §6's "exactly 2 concurrent" budget measured as 4
        // until the orphan was found and killed.
        let bindFailed = false;

        const server = app.listen(PORT, () => {
            // Everything here is deliberately deferred rather than run inline. Verified
            // live that on this dual-stack host the 'listening' callback can fire *before*
            // an EADDRINUSE 'error' event on the same server, so "do it inside the
            // callback" is not on its own a guarantee that a losing instance stays out of
            // the queue — nor that it should announce itself as online. A short defer lets
            // the error settle first; EADDRINUSE surfaces immediately, so 100ms is ample
            // and is paid once at startup.
            setTimeout(() => {
                if (bindFailed) return;
                console.log(`[CEREBRO] Backend Online at http://localhost:${PORT}`);
                console.log(`[CEREBRO] C++ SIMD Core: ACTIVE`);
                startWorker();
                console.log('[CEREBRO] Ingest worker started (concurrency 2)');
            }, 100);
        });

        server.on('error', (err) => {
            bindFailed = true;
            if (err.code === 'EADDRINUSE') {
                console.error(
                    `[CEREBRO] Port ${PORT} is already in use — another backend instance is running. ` +
                    `Exiting rather than starting a duplicate ingest worker against the same queue.`,
                );
            } else {
                console.error('[CEREBRO] HTTP server error:', err);
            }
            process.exit(1);
        });
    })
    .catch(err => {
        console.error('[CEREBRO] MongoDB connection error:', err);
        process.exit(1);
    });

// Routes
// GET /health — replaces the trivial legacy handler with concurrent per-dependency
// probes (phase 1 §8). Not one of the routes phase 1 §1 promised to keep untouched
// (originally /api/ingest, /api/search, /api/ask; /api/search was re-pointed in Phase 3).
app.use(healthRouter);

// Phase 2: new document-lifecycle API (upload → async ingest → ready), independent of the
// legacy /api/ingest below. Both write different stores (Qdrant here, MongoDB legacy) so
// they coexist without conflict until Phase 6 decommissions the legacy path.
app.use(documentsRouter);

// Phase 3: hybrid retrieval + reranking, mounted at the same /api/search path the legacy
// MongoDB-backed handler used to serve (removed here; SearchService.js itself stays on
// disk, unused by any route as of Phase 5, until Phase 6 deletes it — phase 3 §8).
app.use(searchRouter);

// Phase 4: serves rendered scanned-page JPEGs referenced by /api/search's `imageUri`.
app.use(pagesRouter);

// Phase 5: the real graph (LangGraph state machine — condense, retrieve, rerank,
// generate) replaces both the throwaway pingGraph proof-of-concept (deleted along with
// pingGraph.js and its /api/graph/ping route, phase 1 §9.2) and the legacy inline
// /api/ask handler below (removed here — same path, new SSE envelope, thread-aware).
app.use(askRouter);
app.use(threadsRouter);

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

// Centralized error handler — must be registered last, after all routes/middleware.
// Normalizes multer and body-parser (express.json()) failures into the API's
// standard { error } JSON shape instead of Express's default HTML error page.
app.use(errorHandler);
