import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { errorHandler } from '../middleware/errorHandler.js';
import { buildCorsOptions } from './corsOptions.js';

import { config } from '../config/index.js';
import { initTracing } from '../telemetry/tracing.js';
import { requestDuration } from '../telemetry/metrics.js';
import { askLimiter, searchLimiter, uploadLimiter, globalLimiter } from './middleware/rateLimit.js';
import healthRouter from './routes/health.js';
import documentsRouter from './routes/documents.js';
import searchRouter from './routes/search.js';
import pagesRouter from './routes/pages.js';
import askRouter from './routes/ask.js';
import threadsRouter from './routes/threads.js';
import metricsRouter from './routes/metrics.js';
import { startWorker } from '../ingestion/queue.js';
import { registerGracefulShutdown } from '../shutdown.js';

const app = express();
const PORT = config.port;

// Phase 6 §6.2. `contentSecurityPolicy`'s default `img-src 'self'` already covers
// /api/pages/... — Caddy serves the SPA and proxies /api/* under one public origin
// (Caddyfile's single `handle /api/*` block, amended §16.6: NOT `handle_path`, which
// strips the /api prefix the backend's routes require intact), so a page image request is
// same-origin from the browser's perspective. The only addition needed is `data:`, since
// the frontend's own bundled assets/icons include a few data-URI images.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:'],
    },
  },
}));

app.use(cors(buildCorsOptions(config.nodeEnv, process.env.CORS_ALLOWED_ORIGINS)));

// Phase 6 §6.2: only /api/documents legitimately carries a large payload (a 50MB upload,
// upload.js's MAX_UPLOAD_BYTES), and that goes through multer's own multipart parsing, not
// this JSON body parser — every other route's JSON body is a short query string or a
// handful of ids, so 256kb is generous headroom, not a tight fit.
app.use(express.json({ limit: '256kb' }));

// Phase 6 §7.2: cerebro_request_duration_seconds, recorded around every route regardless
// of outcome — `res.on('finish', ...)` fires whether the handler resolved normally, threw
// into errorHandler, or the client's own request was rejected by a rate limiter upstream
// of this middleware. `route` prefers Express's matched pattern (`/api/documents/:id`)
// over the raw URL so per-request ids don't explode the metric's cardinality into one
// series per document.
app.use((req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    const route = req.route?.path ?? req.baseUrl ?? req.path;
    requestDuration.observe({ route, status: res.statusCode }, (performance.now() - start) / 1000);
  });
  next();
});

// Phase 6 §6.1: per-route budgets, applied before the routers that would otherwise handle
// these paths. Every request under /api/* also counts against the global backstop below,
// cumulatively with whichever specific limiter applies — see rateLimit.js's own comment.
app.use('/api/ask', askLimiter);
app.use('/api/search', searchLimiter);
app.use('/api/documents', uploadLimiter);
app.use('/api', globalLimiter);

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
                const worker = startWorker();
                console.log('[CEREBRO] Ingest worker started (concurrency 2)');
                // Phase 6 §6.2, §11: SIGTERM drains in-flight SSE streams, closes this
                // same worker instance (not a fresh one — closing a worker BullMQ never
                // started would be a no-op that only looks like a clean shutdown), then exits.
                registerGracefulShutdown(server, { worker });
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
// MongoDB-backed handler used to serve. That handler's module was deleted in Phase 6
// (§5.1) once this route had soaked — phase 3 §8.
app.use(searchRouter);

// Phase 4: serves rendered scanned-page JPEGs referenced by /api/search's `imageUri`.
app.use(pagesRouter);

// Phase 5: the real graph (LangGraph state machine — condense, retrieve, rerank,
// generate) replaces both the throwaway pingGraph proof-of-concept (deleted along with
// pingGraph.js and its /api/graph/ping route, phase 1 §9.2) and the legacy inline
// /api/ask handler below (removed here — same path, new SSE envelope, thread-aware).
app.use(askRouter);
app.use(threadsRouter);

// Phase 6 §7.2: Prometheus exposition — mounted like any other router, but deliberately
// absent from the Caddyfile's route table (§8.2), which is what actually keeps it off the
// public interface. See routes/metrics.js's own header comment.
app.use(metricsRouter);

// Phase 6 §5: the legacy `POST /api/ingest` handler — the old load/chunk/encode/sink
// pipeline that wrote MiniLM/384-dim vectors into MongoDB's `chunks` collection — is
// deleted along with the modules that implemented it (§5.1). POST /api/documents
// (documentsRouter, Phase 2) is the one ingestion path now — async, content-addressed,
// Qdrant-backed. Existing MongoDB-vector documents are carried forward once via
// scripts/migrate-legacy.js, not by keeping this route alive.

// Centralized error handler — must be registered last, after all routes/middleware.
// Normalizes multer and body-parser (express.json()) failures into the API's
// standard { error } JSON shape instead of Express's default HTML error page.
app.use(errorHandler);
