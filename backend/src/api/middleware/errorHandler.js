import multer from 'multer';

/**
 * Centralized Express error handler. Must be registered last, after all routes.
 * Normalizes multer failures (malformed multipart, oversized files, wrong field
 * name, etc.) and body-parser JSON parse failures into the same `{ error }` JSON
 * shape the rest of the API already uses, instead of Express's default HTML page.
 */
export function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    // Phase 2 §2.1: an oversized upload is a 413 (Payload Too Large), not a generic 400 —
    // multer enforces this while streaming (upload.js's `limits.fileSize`), so the request
    // is aborted mid-transfer rather than after the full body lands.
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File exceeds the maximum upload size.` });
    }
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }

    // Phase 2 §2.1: upload.js's fileFilter rejects an unsupported extension with this code
    // before multer even wraps it — surface the message (which already names the accepted
    // types) directly instead of falling through to the generic multipart-parse branch below.
    if (err.code === 'UNSUPPORTED_FILE_TYPE') {
        return res.status(400).json({ error: err.message });
    }

    // body-parser (express.json()) sets these on malformed JSON bodies.
    if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
        return res.status(400).json({ error: 'Malformed JSON in request body.' });
    }

    // Busboy (multer's underlying parser) throws plain Errors — not MulterError — for a
    // truncated/malformed multipart stream (e.g. "Unexpected end of form"). Still a
    // client-side bad request, identified by content-type rather than error subclass.
    const contentType = req.headers['content-type'] || '';
    if (contentType.startsWith('multipart/form-data')) {
        return res.status(400).json({ error: `Malformed multipart body: ${err.message}` });
    }

    console.error('[Unhandled Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
}
