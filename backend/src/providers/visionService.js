import axios from 'axios';
import { config } from '../config/index.js';

// Not wrapped in a shared opossum breaker (architecture §6.1's breaker table names
// only vision.classify and vision.embedPages — the real domain calls arriving in
// Phase 4). Health polling runs independently and concurrently inside health.js's
// own Promise.all, which already isolates a slow/dead vision service from the rest
// of the /health response; a second layer of circuit breaking here adds nothing.
const HEALTH_TIMEOUT_MS = 5_000;

// Phase 1 only implements health(). classify()/embedPages()/embedQuery() land in
// Phase 4 — see architecture §6.
export async function health() {
  const res = await axios.get(`${config.vision.url}/health`, { timeout: HEALTH_TIMEOUT_MS });
  return res.data;
}
