import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../../config/index.js';

// Extension → canonical MIME. The extension alone is untrusted (FR-ING edge case:
// "mismatch between file extension and actual content type"); this map is only the
// first gate. Magic-byte verification happens in verifyType.js before any parsing.
export const ACCEPTED = new Map([
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.csv', 'text/csv'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.json', 'application/json'],
]);

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;   // 50 MB — architecture §6 upload cap

// storage/uploads may not exist yet on a fresh checkout — multer's diskStorage does not
// create it, it just fails the write.
fs.mkdirSync(config.storage.uploadsDir, { recursive: true });

export const upload = multer({
  storage: multer.diskStorage({
    destination: config.storage.uploadsDir,
    // Random temp name; the file is renamed to its content hash after hashing (documents.js).
    filename: (req, file, cb) => cb(null, `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ACCEPTED.has(ext)) {
      const err = new Error(
        `Unsupported file type "${ext || '(none)'}". Accepted: ${[...ACCEPTED.keys()].join(', ')}`,
      );
      err.code = 'UNSUPPORTED_FILE_TYPE';
      return cb(err);
    }
    cb(null, true);
  },
});
