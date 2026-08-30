// Synthetic-but-real-shaped chunk text for bench/v2/seed.js. "The corpus is generated,
// not borrowed" (phase 8 §2.1) — these are not random floats standing in for text, they
// are real sentences run through the real Cohere embed call, so the resulting HNSW
// index has the semantic clustering a production corpus actually has (uniform random
// vectors are close to ANN's worst case — retrieval/constants.js's own HNSW_EF_SEARCH
// comment makes the same point). Deterministic from `seed` via bench/lib/prng.js's
// mulberry32, so a re-run without `--fresh` produces byte-identical text and the point
// ids (uuidv5 of documentId:position) land on the same points instead of duplicating.
import { mulberry32 } from '../../lib/prng.js';

// Six topic pools, ~18 sentences each — enough combinatorial variety that a 5-sentence
// chunk drawn from them rarely repeats verbatim across 100k chunks, while staying small
// enough to keep this file readable. Cross-topic mixing is deliberate: a real corpus is
// not one subject, and hybrid search's sparse (BM25) branch benefits from a vocabulary
// that actually varies chunk to chunk.
const TOPIC_SENTENCES = [
  // finance
  [
    'The quarterly revenue statement showed a modest increase over the prior period.',
    'Accrued liabilities are recognized when the obligation becomes probable and estimable.',
    'The board approved a new capital allocation policy favoring share buybacks.',
    'Working capital fell short of the target the treasury team had set.',
    'Depreciation is calculated on a straight-line basis over the asset useful life.',
    'The audit committee reviewed the internal controls report without material findings.',
    'Currency hedges reduced exposure to the volatility in the emerging markets basket.',
    'The pension fund rebalanced toward investment-grade corporate bonds this quarter.',
    'Free cash flow conversion improved after the working capital initiative concluded.',
    'The credit facility was extended for another eighteen months at a lower spread.',
    'Goodwill impairment testing is performed annually or upon a triggering event.',
    'The dividend payout ratio remained within the range set by the capital policy.',
    'Segment reporting separates the wholesale and retail distribution channels.',
    'The tax provision reflects a blended rate across the jurisdictions in scope.',
    'Inventory turnover slowed as the supply chain absorbed the tariff increase.',
    'The merger integration costs were classified as non-recurring in the filing.',
    'Return on invested capital exceeded the weighted average cost of capital.',
    'The subsidiary financials were consolidated after eliminating intercompany balances.',
  ],
  // engineering / infrastructure
  [
    'The load balancer distributes traffic across three availability zones by default.',
    'A rolling deployment replaces instances one at a time behind the health check.',
    'The message queue retries a failed job with exponential backoff up to five times.',
    'Database connection pooling reduced the tail latency under sustained concurrent load.',
    'The circuit breaker opens after five consecutive failures within a ten second window.',
    'Horizontal autoscaling adds worker nodes when queue depth exceeds the configured threshold.',
    'The service mesh enforces mutual TLS between every internal microservice.',
    'A blue-green cutover swaps traffic to the new version with an instant rollback path.',
    'The cache invalidation strategy uses a short TTL rather than explicit purge events.',
    'Structured logging emits one JSON line per request with a correlation identifier.',
    'The build pipeline runs unit tests, integration tests, and a security scan in sequence.',
    'Rate limiting is enforced per API key with a token bucket algorithm.',
    'The object storage bucket versions every write so a bad deploy can be reverted.',
    'Read replicas serve analytical queries so they never compete with transactional writes.',
    'The health check endpoint verifies the database connection before reporting ready.',
    'Feature flags let the rollout be gated to a small percentage of traffic first.',
    'The alerting rule pages on-call only after the condition holds for several minutes.',
    'Container images are scanned for known vulnerabilities before they reach the registry.',
  ],
  // biology / medicine
  [
    'The clinical trial enrolled participants across four sites over eighteen months.',
    'Mitochondrial density increases with sustained aerobic training in skeletal muscle.',
    'The vaccine candidate elicited a measurable antibody response after the second dose.',
    'Enzyme activity peaked at a pH consistent with the intended physiological environment.',
    'The control group received a placebo indistinguishable from the active compound.',
    'Gene expression was quantified using reverse transcription polymerase chain reaction.',
    'The biopsy sample was fixed and sectioned before histological staining.',
    'Blood pressure was recorded at rest and again after a standardized exertion test.',
    'The receptor binds its ligand with an affinity in the low nanomolar range.',
    'Cellular respiration converts glucose and oxygen into carbon dioxide and water.',
    'The dosage was titrated upward gradually to minimize adverse reactions.',
    'Antibiotic resistance emerged after repeated sublethal exposure in the culture.',
    'The immune response was characterized by an increase in circulating cytokines.',
    'Sleep deprivation was associated with a measurable decline in reaction time.',
    'The tissue sample showed no evidence of malignancy on pathological review.',
    'Insulin sensitivity improved following the twelve week exercise intervention.',
    'The randomized controlled design minimized selection bias in the cohort.',
    'Neural activity in the region correlated with the onset of the stimulus.',
  ],
  // law / policy
  [
    'The statute requires written notice within thirty days of the triggering event.',
    'The appellate court remanded the case for further proceedings consistent with its opinion.',
    'The contract included an indemnification clause limited to gross negligence.',
    'Regulatory guidance clarified the disclosure requirements for the new reporting period.',
    'The arbitration clause designated a neutral forum for resolving disputes.',
    'The agency published a proposed rule and opened a sixty day comment period.',
    'The plaintiff bears the burden of proving damages by a preponderance of the evidence.',
    'The settlement agreement included a confidentiality provision covering its terms.',
    'The zoning variance was granted subject to conditions on setback and height.',
    'The privacy policy discloses what categories of data are shared with vendors.',
    'The non-compete clause was narrowed to the specific geographic market at issue.',
    'The compliance program includes mandatory annual training for all employees.',
    'The consent decree required independent monitoring for a period of three years.',
    'The intellectual property assignment covers inventions conceived during employment.',
    'The force majeure clause excused performance during the declared emergency.',
    'The court applied a rational basis standard in reviewing the challenged regulation.',
    'The licensing agreement granted a non-exclusive, non-transferable right to use.',
    'The whistleblower provision protects an employee who reports in good faith.',
  ],
  // logistics / operations
  [
    'The warehouse management system reassigns pick paths to reduce travel distance.',
    'The freight forwarder consolidated three partial shipments into a single container.',
    'Demand forecasting uses a rolling twelve week average adjusted for seasonality.',
    'The distribution center added a second shift to absorb the holiday peak volume.',
    'Cross-docking eliminated the need to store the fast-moving items on shelves.',
    'The fleet routing algorithm balances delivery windows against fuel cost.',
    'Safety stock is sized to cover the lead time variance at the ninety-fifth percentile.',
    'The customs broker filed the entry documents ahead of the vessel arrival.',
    'A cycle count reconciles a subset of inventory locations every business day.',
    'The last-mile carrier reported an on-time delivery rate above the contracted target.',
    'The procurement team negotiated a volume discount tied to a two year commitment.',
    'The cold chain monitoring device logs temperature every five minutes in transit.',
    'The bill of lading listed the consignee, the carrier, and the declared value.',
    'Reverse logistics processed the returned units for refurbishment or disposal.',
    'The yard management system tracks trailer location across the facility in real time.',
    'The supplier scorecard weighs on-time delivery, quality, and responsiveness.',
    'The kitting operation assembles the promotional bundle ahead of the launch date.',
    'The vendor managed inventory program lets the supplier trigger its own replenishment.',
  ],
  // education / research
  [
    'The curriculum committee revised the prerequisite sequence for the introductory course.',
    'The study used a mixed methods design combining survey data and interviews.',
    'The grant proposal outlined a three year research plan with defined milestones.',
    'Peer review identified a methodological gap in the original sampling strategy.',
    'The lecture recording was made available with searchable captions the same day.',
    'The dissertation committee approved the proposal after the second revision.',
    'The pilot program was evaluated against a matched comparison group.',
    'The library expanded its interlibrary loan agreement to include digital archives.',
    'The rubric weighted analysis and argumentation above surface-level correctness.',
    'The cohort study followed participants annually for a decade after enrollment.',
    'The workshop introduced version control before the first programming assignment.',
    'The accreditation review cited strong outcomes in the capstone project sequence.',
    'The survey instrument was validated against an established measure in a pilot sample.',
    'The department adopted a new advising model pairing students with faculty mentors.',
    'The replication study reproduced the original effect with a similar magnitude.',
    'The scholarship covers tuition and a stipend contingent on continued enrollment.',
    'The seminar met weekly to discuss primary sources ahead of the written response.',
    'The assessment was redesigned after students consistently missed the same item.',
  ],
];

const ALL_SENTENCES = TOPIC_SENTENCES.flat();

// Deterministic 5-8 sentence chunk (roughly matches ingestion/chunker.js's real target
// window), with a synthetic "citation" fact injected so no two chunks are byte-identical
// even when the RNG draws the same sentence set — a real corpus never has two chunks
// that are exact duplicates of each other, and Qdrant's uuidv5 point id is derived from
// (documentId, position), not from text content, so identical text would not itself
// break upsert; the fact is there to keep chunk-level BM25 term frequencies realistic.
export function generateChunkText(seed, userIndex, contextIndex, chunkIndex) {
  const rng = mulberry32(seed);
  const count = 5 + Math.floor(rng() * 4);   // 5-8 sentences
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(ALL_SENTENCES[Math.floor(rng() * ALL_SENTENCES.length)]);
  }
  picked.push(`Reference note: tenant ${userIndex}, context ${contextIndex}, chunk ${chunkIndex}.`);
  return picked.join(' ');
}

// A handful of realistic-shaped queries, reused by tenancy.bench.js — topically matched
// to TOPIC_SENTENCES above so a real dense/sparse search over the seeded corpus returns
// non-trivial candidate sets instead of near-zero-score noise.
export const BENCH_QUERIES = [
  'What does the quarterly revenue statement show about the company?',
  'How does the circuit breaker decide when to stop sending requests?',
  'What was measured in the vaccine candidate clinical trial?',
  'What does the indemnification clause in the contract cover?',
  'How is safety stock sized for the distribution center?',
  'What did the pilot program evaluation compare against?',
];
