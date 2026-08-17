# 🧠 Cerebro Engine — Project Flow, Features & Challenges

---

## The User Journey — End to End

When a user opens Cerebro, the experience follows three distinct phases:

```
Phase 1: INGEST  →  Upload documents → Parse → Sanitize → Chunk → Embed → Store
Phase 2: SEARCH  →  Type a query → Vectorize → Hybrid Search → RRF Fusion → Display results
Phase 3: ASK     →  Ask a question → Retrieve context → Stream LLM answer → Render in real-time
```

Each phase involves multiple systems working together. Below is a deep dive into every action, how it works internally, the challenges I hit, and how I solved them.

---

## Phase 1: Document Ingestion Pipeline

### What the User Sees

The user drags and drops a file (PDF, DOCX, CSV, Excel, JSON, or a URL) onto the interface. The `GlobalDropzone` component wraps the entire dashboard, so dropping anywhere works. A toast notification confirms the upload, and within seconds, the document is searchable.

### What Actually Happens (5-Stage Pipeline)

```
File Upload → UniversalLoader → TextSanitizer → SemanticChunker → BatchEncoder → MongoDB Sink
```

#### Stage 1: File Upload & Routing

**Action:** The frontend's `EngineContext.ingestFile()` creates a `FormData` object and POSTs it to `/api/ingest`. Express's `multer` middleware intercepts the multipart upload, saves the binary to a temporary `uploads/` directory, and passes the file path to the `IngestionService`.

**Key Detail:** Multer strips the file extension during upload (it saves as a random hash like `a3f2b1c`). But the `UniversalLoader` needs the extension to determine which parser to use. So the API handler explicitly renames the file to restore the extension (`a3f2b1c` → `a3f2b1c.pdf`) before passing it downstream.

**Challenge: Temporary File Cleanup**
- The temporary file must be deleted after successful ingestion, but **preserved on failure** so the user can retry.
- **Solution:** The API handler uses a `try/catch` structure where `fs.unlink()` only runs inside the success path. On error, the response includes the `preservedPath` so the file can be manually retried or inspected.

#### Stage 2: Universal Document Parsing

**Action:** The `UniversalLoader` detects the file type by extension and dispatches to the correct parser:

| Format | Parser | Extraction Strategy |
|---|---|---|
| PDF | `pdf-parse` | Extracts text page-by-page using `"-- X of Y --"` boundary markers. Falls back to full-text extraction if page splitting fails. |
| DOCX | `mammoth` | Extracts raw text (no formatting, no images). Pure text only. |
| CSV/Excel | `xlsx` | Converts each row into a natural language sentence: `"Context: Name is John, Age is 30, Department is Engineering"`. This makes tabular data semantically searchable. |
| HTML/Web | `cheerio` | Fetches the URL, loads the HTML, extracts `body.text()` with whitespace normalization. No headless browser needed. |
| JSON | Native | Arrays → one chunk per item. Objects → stringify as single chunk. |
| Text/Markdown | `fs.readFile` | Direct read into the chunking pipeline. |

**Challenge: Tabular Data and Embeddings**
- CSV/Excel rows like `{Name: "John", Age: 30}` are structurally meaningless to an embedding model — it doesn't understand column-value pairs.
- **Solution:** Each row is converted into a natural language sentence: `"Context: Name is John, Age is 30"`. This gives the embedding model semantic content to work with. Now a query like "employees over 30" can match rows where `Age is 35` because the model understands the meaning.

**Challenge: PDF Page Boundary Detection**
- `pdf-parse` doesn't natively separate pages cleanly. It concatenates all text with `"-- 1 of 5 --"` markers interspersed.
- **Solution:** Split the raw text using a regex `/\n*\s*-- \d+ of \d+ --\s*\n*/`, then map each segment to a page number. If the regex produces no segments (non-standard PDF), fall back to treating the entire text as one page.

#### Stage 3: Text Sanitization

**Action:** The `TextSanitizer` processes raw extracted text through 5 transformations:

1. **Unicode Normalization (NFKD):** Converts special characters to their ASCII equivalents (e.g., `ñ` → `n`, `ﬁ` → `fi`). PDFs frequently contain ligatures and special Unicode that pollute embeddings.
2. **HTML Tag Stripping:** Removes any residual `<div>`, `<span>`, etc. from web pages or rich documents.
3. **URL/Email Masking:** Replaces URLs with `[URL]` and emails with `[EMAIL]`. This preserves sentence structure while removing noise. A URL like `https://internal.corp.com/reports/q3-2024.pdf` would generate meaningless embedding dimensions — masking it avoids this.
4. **Non-ASCII Removal:** Strips emojis, control characters, and anything outside printable ASCII. Embedding models are trained primarily on ASCII text.
5. **Whitespace Collapse:** Multiple spaces → single space. 3+ newlines → double newline (preserves paragraph structure).

**Challenge: Masking vs. Removing**
- Initially I was **removing** URLs entirely, which broke sentence structure: `"Visit https://example.com for details"` became `"Visit for details"` — grammatically broken and misleading for the embedding model.
- **Solution:** Switched to **masking** — `"Visit [URL] for details"` keeps the sentence readable and the embedding meaningful.

#### Stage 4: Semantic Chunking

**Action:** The `SemanticChunker` splits sanitized text into ~500-character chunks using a 4-level recursive strategy:

```
Level 1: Split by paragraph (\n\n)
    ↓ if chunk > 500 chars
Level 2: Split by newline (\n)
    ↓ if chunk > 500 chars
Level 3: Split by sentence boundaries (. ? !)
    ↓ if chunk > 500 chars
Level 4: Split by spaces (word-level fallback)
```

After splitting, a **sliding window merge** reassembles segments into ~500-char chunks with a **50-character overlap** between consecutive chunks.

**Why 500 characters?** — The `all-MiniLM-L6-v2` model has a 256-token context window. ~500 characters ≈ ~100-120 tokens, leaving headroom while keeping chunks semantically dense. Too small (100 chars) = fragments with no meaning. Too large (2000 chars) = diluted embeddings where the model averages over too many concepts.

**Why 50-character overlap?** — If a fact spans a chunk boundary ("The revenue was $4.2 million | in Q3 2024"), the overlap ensures both Chunk A and Chunk B contain enough context to match a query about "Q3 2024 revenue". Without overlap, the fact is split and neither chunk matches well.

**Challenge: Sentence Boundary Detection**
- Naive splitting on `.` breaks abbreviations: `"Dr. Smith earned $4.2M in Q3."` → `["Dr", " Smith earned $4", "2M in Q3", ""]`
- **Solution:** Used a regex that matches complete sentence units: `/[^.!?]+[.!?]+|\s+[^.!?]+$/g`. This captures everything up to and including the punctuation, keeping `"Dr. Smith earned $4.2M in Q3."` as one unit.

#### Stage 5: Batch Encoding & L2 Normalization

**Action:** The `BatchEncoder` converts text chunks into 384-dimensional vectors using the local `all-MiniLM-L6-v2` model:

1. **Model Loading (Singleton):** The `ModelLoader` ensures the HuggingFace model is loaded exactly once. It uses a tracked `loadPromise` — if two requests arrive during cold start, both await the same promise instead of loading the model twice.

2. **Batched Processing:** Chunks are processed in batches of 50. Each batch runs through `Promise.all()` for parallel inference. Results are packed into a single contiguous `Float32Array(numChunks × 384)`.

3. **L2 Normalization:** Every vector is normalized to unit length: `V = V / ||V||`. This is a critical optimization — it converts cosine similarity into a simple dot product at query time.

   ```
   cos(A, B) = dot(A, B) / (||A|| × ||B||)
   
   If ||A|| = 1 and ||B|| = 1:
   cos(A, B) = dot(A, B)
   ```
   
   This eliminates **100K square root + division operations per query** at search time, at the cost of one normalization per chunk at ingestion time.

4. **Contiguous Memory Layout:** The `Float32Array` is packed as `[v0_d0, v0_d1, ..., v0_d383, v1_d0, v1_d1, ..., v1_d383, ...]`. This layout is critical for the C++ bridge — it allows pointer arithmetic (`datasetPtr + (i × 384)`) to jump directly to any vector without indirection.

**Challenge: Model Cold Start**
- The first time the HuggingFace model loads, it takes 2-3 seconds (downloading ONNX weights, initializing the runtime). If two ingestion requests hit simultaneously during cold start, both would try to load the model, causing OOM crashes.
- **Solution:** The `ModelLoader` Singleton pattern with a `loadPromise` guard. The first call sets `loadPromise` to the loading async function. The second call sees `loadPromise` is not null and awaits it instead of starting a new load. After loading completes, `instance` is set and all future calls return immediately.

**Challenge: Memory Pressure on Large Documents**
- A 500-page PDF might produce 2000+ chunks. Encoding all at once would allocate a massive tensor and crash.
- **Solution:** Batch processing with a batch size of 50. Each batch processes, writes its vectors into the pre-allocated `Float32Array`, and the batch's intermediate tensors are garbage collected before the next batch starts.

#### Stage 6: Database Sink

**Action:** The `DatabaseService.sinkChunks()` inserts the encoded chunks into MongoDB's `chunks` collection. Each document contains:
- `text`: The original chunk text (for lexical search)
- `vector`: The 384-dim float array (for vector search)
- `metadata`: Source file name, chunk index, page/row position, timestamp

It also ensures a `$text` index exists on the `text` field for lexical search.

---

## Phase 2: Hybrid Search Pipeline

### What the User Sees

The user types a query into the `ChatInput` component. Results appear instantly — a list of matching document chunks with similarity scores, source file names, and page positions.

### What Actually Happens (4-Stage Pipeline)

```
Query → Vectorize → [Atlas $vectorSearch ∥ $text Search] → C++ SIMD Rerank → RRF Fusion → Hydrate & Return
```

#### Stage 1: Query Vectorization

**Action:** The query text is encoded into a 384-dim vector using the same `BatchEncoder` + `all-MiniLM-L6-v2` model. This ensures the query lives in the same vector space as the stored documents.

#### Stage 2: Dual Retrieval (Concurrent)

Two searches execute in parallel:

**2a. Semantic Retrieval (MongoDB Atlas $vectorSearch)**

```javascript
db.collection('chunks').aggregate([{
    "$vectorSearch": {
        "index": "vector_index",
        "path": "vector",
        "queryVector": Array.from(queryVector),
        "numCandidates": 100,  // HNSW explores 100 candidates
        "limit": 50             // Returns top 50
    }
}])
```

This uses MongoDB's HNSW index to find the ~50 most semantically similar chunks. It's **approximate** — HNSW uses greedy graph traversal which can get stuck in local optima. But it's fast: O(log N) instead of O(N).

**2b. Lexical Retrieval (MongoDB $text)**

```javascript
db.collection('chunks').find(
    { $text: { $search: queryText } },
    { projection: { score: { $meta: "textScore" } } }
).sort({ score: { $meta: "textScore" } }).limit(50)
```

This uses an inverted index with TF-IDF scoring to find chunks containing the exact query keywords. It catches what vector search misses — specific IDs, names, and technical terms.

**Challenge: Atlas $vectorSearch Unavailability**
- MongoDB's `$vectorSearch` requires an Atlas cluster with a vector search index. If the user is running a local MongoDB instance (no Atlas), this aggregation throws an error.
- **Solution:** A `try/catch` wraps the `$vectorSearch` call. On failure, it falls back to fetching ALL vectors from MongoDB (`collection.find({}, { projection: { vector: 1 } })`) and doing a full brute-force search through the C++ SIMD engine. This is slower but always works, regardless of the MongoDB deployment.

#### Stage 3: C++ SIMD Reranking

**Action:** The ~50 candidates from Atlas `$vectorSearch` are **reranked** using exact dot-product similarity computed by the C++ SIMD engine.

**Why rerank?** — Atlas returned **approximate** results. The C++ engine computes **exact** similarity. This catches misranked results and produces a more accurate ordering.

**How it works:**

1. **Memory Packing:** JavaScript packs all candidate vectors into a single contiguous `Float32Array`:
   ```javascript
   const datasetBuffer = new Float32Array(candidates.length * 384);
   candidates.forEach((doc, i) => {
       datasetBuffer.set(doc.vector, i * 384);
   });
   ```

2. **Zero-Copy Bridge:** `engine.SearchVectors(queryVector, datasetBuffer, 50)` passes the `Float32Array` to C++. The C++ side calls `floatArray.Data()` which returns a raw `const float*` pointer directly into the ArrayBuffer's backing memory — **no serialization, no copying**.

3. **SIMD Dot Product:** For each candidate vector, the `SimdDotProduct` function loads 8 floats at a time into 256-bit AVX2 registers:
   ```
   Loop 48 times (384 dims / 8 lanes):
     Load 8 floats from query   → __m256 register A
     Load 8 floats from doc     → __m256 register B
     FMA: accumulator += A × B  (one CPU cycle)
   Horizontal reduction: sum all 8 lanes → single float score
   ```

4. **Min-Heap Top-K:** Instead of sorting all 50 scores, a Min-Heap of size K (default 50) maintains the best results. For each new score:
   - If heap size < K: push
   - If new score > heap minimum: pop minimum, push new score
   - Otherwise: skip
   
   This is O(N log K) instead of O(N log N).

**Challenge: Zero-Copy Memory Safety**
- The `Float32Array.Data()` pointer is only valid while the JavaScript `Float32Array` is alive. If V8's garbage collector moved or freed the ArrayBuffer, the C++ code would read garbage memory (use-after-free).
- **Solution:** The operation is synchronous — `SearchVectors` is a blocking call that completes within the same JavaScript turn. V8 cannot GC during synchronous execution, so the pointer remains valid for the entire duration. Additionally, `Float32Array` backing stores live in V8's external memory (not the managed heap), so they can't be relocated by the GC.

**Challenge: Choosing Synchronous over Asynchronous**
- The natural instinct is to make C++ calls async (using `Napi::AsyncWorker`) to avoid blocking the event loop. But for 50 vectors × 384 dimensions, the SIMD computation takes <1ms — the overhead of context-switching to a worker thread (scheduling, synchronization, callback marshalling) would actually be **slower** than the computation itself.
- **Solution:** Keep it synchronous. The computation is fast enough that blocking the event loop for <1ms is imperceptible. Async workers are only worth it for operations >10ms.

#### Stage 4: RRF Fusion

**Action:** The vector results (reranked) and lexical results are fused using **Reciprocal Rank Fusion**:

```
RRF_Score(doc) = Σ  1 / (k + rank_i)    where k = 60
```

For each result set (vector, lexical):
- The #1 ranked document gets: `1 / (60 + 1) = 0.01639`
- The #2 ranked document gets: `1 / (60 + 2) = 0.01613`
- The #50 ranked document gets: `1 / (60 + 50) = 0.00909`

If a document appears in **both** result sets, its scores are summed. This means documents that are both semantically relevant AND contain exact keyword matches bubble to the top.

**Why k=60?** — The `k` parameter controls how much weight is given to top-ranked vs. lower-ranked results. Higher k → flatter curve (less emphasis on rank #1). The value 60 comes from the original RRF research paper (Cormack et al., 2009) and is empirically optimal for most retrieval tasks.

**Why RRF over Linear Score Combination?** — Vector search scores (cosine similarity, range 0–1) and lexical scores (TF-IDF, unbounded) are on completely different scales. You can't just add them — a TF-IDF score of 15.7 would dominate a cosine score of 0.92. RRF uses **ranks** (1st, 2nd, 3rd...) instead of raw scores, making it score-agnostic. No normalization needed.

After fusion, the top-K document IDs are extracted, hydrated (fetched from MongoDB with full text and metadata), and returned to the frontend with their RRF scores attached.

---

## Phase 3: RAG Answer Generation (Streaming)

### What the User Sees

The user types a question. An answer begins streaming token-by-token, appearing word by word in the `AnswerBox` component. Below the answer, source citations appear as clickable `SourceChip` components showing which documents were used.

### What Actually Happens (5-Stage Pipeline)

```
Query → Vectorize → Hybrid Search (top 3) → Prompt Construction → Ollama Streaming → SSE → Frontend Render
```

#### Stage 1-2: Query Vectorization + Hybrid Search

Same as Phase 2, but with `limitK = 3` instead of 10. Fewer chunks = smaller prompt = faster LLM inference (critical when running on CPU).

#### Stage 3: Prompt Construction

**Action:** The `GenerationService` constructs a grounded prompt:

```
You are a highly intelligent, secure corporate assistant.
Answer the user's question based STRICTLY on the Context provided below.
If the answer is not contained in the Context, say "I do not have enough information."
Do NOT make up facts. Cite your sources where possible.

CONTEXT:
[Chunk 1]:
<text from top search result>

[Chunk 2]:
<text from second result>

[Chunk 3]:
<text from third result>

QUESTION: <user's query>

ANSWER:
```

**Key Design Decision:** The prompt explicitly instructs the model to refuse if the answer isn't in the context. This prevents hallucination — the LLM can only synthesize from the provided chunks, not from its training data. This is critical for a corporate tool where factual accuracy matters more than creativity.

#### Stage 4: Ollama Streaming

**Action:** The `GenerationService` sends the prompt to Ollama's local API (`http://127.0.0.1:11434/api/generate`) with `stream: true`. Ollama returns **Newline-Delimited JSON (NDJSON)** — one JSON object per line, each containing a `response` field with 1-2 tokens:

```
{"model":"llama3","response":"The",...}
{"model":"llama3","response":" quarterly",...}
{"model":"llama3","response":" revenue",...}
{"model":"llama3","response":" was",...}
...
{"model":"llama3","response":"","done":true,...}
```

The service parses each line, extracts the `response` token, and fires an `onToken` callback.

**Challenge: NDJSON Stream Parsing**
- The Ollama stream arrives in arbitrary-sized TCP chunks. A single `data` event might contain half a JSON line, or two complete lines, or one and a half lines.
- **Solution:** A buffer accumulates incoming data. After each `data` event, the parser searches for newline characters. For each complete line found, it extracts and parses the JSON. Incomplete lines remain in the buffer for the next event.

#### Stage 5: SSE (Server-Sent Events) Bridge

**Action:** The Express `/api/ask` endpoint sets SSE headers and wraps each Ollama token in the SSE format:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Each token is written as:
```
data: {"token":"The"}\n\n
data: {"token":" quarterly"}\n\n
...
data: [DONE]\n\n
```

The frontend's `useCerebroChat` hook reads this stream using the **ReadableStream API** (`response.body.getReader()`). It uses a `TextDecoder` and a buffer to parse SSE frames (delimited by `\n\n`), extracting the `data:` prefix and parsing the JSON payload. Each token is appended to React state via `setAnswer(prev => prev + parsed.token)`, causing the component to re-render with each new word.

**Challenge: Double-Buffering (Ollama NDJSON → Express SSE)**
- There are actually **two** streaming protocols in play: Ollama produces NDJSON (newline-delimited), and Express produces SSE (double-newline delimited with `data:` prefix). The `GenerationService` sits in the middle, translating one format to the other.
- **Solution:** The `onToken` callback provided by the Express handler does the translation: `res.write(\`data: ${JSON.stringify({ token })}\n\n\`)`. This cleanly separates the Ollama parsing logic from the SSE formatting logic.

**Challenge: Connection Lifecycle**
- If the client disconnects mid-stream (user navigates away), the Express endpoint continues writing to a closed socket, causing unhandled errors.
- **Solution:** The SSE stream ends cleanly with `data: [DONE]\n\n` followed by `res.end()`. On error, the handler writes the error as a final SSE event and then ends the response, ensuring no orphaned connections.

---

## Frontend Features & Interactions

### ConsumerDashboard — The Main Interface

The dashboard has a **dynamic layout** that transforms based on state:

- **Empty State:** A centered hero section with the Cerebro logo and "How can I help you?" — the `ChatInput` is centered on screen.
- **Active State:** When results arrive, the hero animates out (via `AnimatePresence`), the answer box slides in from below, and the input bar docks to the bottom. The layout transition is animated with a 700ms ease-in-out.

### GlobalDropzone — Drag-and-Drop Upload

The entire dashboard is wrapped in a `GlobalDropzone` component (using `react-dropzone`). Users can drop files anywhere on the page, not just on a specific upload button. The `EngineContext.ingestFile()` function handles the upload optimistically — the file appears in the UI immediately, and is removed only if the server returns an error.

### SourceChip — Citation Display

After an answer is generated, the top 5 source chunks are displayed as `SourceChip` components. Each chip shows:
- Source file name (e.g., `"report.pdf"`)
- Position within the file (e.g., `"Page 3"` or `"Row 12"`)
- A text snippet preview
- The RRF fusion score

This lets users verify the answer's grounding — they can see exactly which document chunks the LLM used.

### EngineContext — Unified State Management

All application state (search results, chat answers, upload queue, telemetry, errors) flows through a single React Context (`EngineContext`). This avoids prop drilling across deeply nested components and ensures that the search and chat hooks share state cleanly.

---

## Key Challenges & Solutions — Summary Table

| Challenge | Where | Root Cause | Solution |
|---|---|---|---|
| Model loads twice on concurrent cold-start requests | `ModelLoader` | No guard against simultaneous initialization | Singleton pattern with tracked `loadPromise` — second caller awaits the first's promise |
| OOM on large document encoding | `BatchEncoder` | 2000+ chunks allocated as a single tensor | Batched processing (50 chunks/batch) with intermediate GC |
| File extension stripped by multer | `/api/ingest` | Multer saves as random hash without extension | Explicit `fs.rename()` to restore extension before parsing |
| Temporary files leaked on ingestion failure | `/api/ingest` | `fs.unlink()` ran regardless of success/failure | Moved cleanup to success-only path; preserved file on error for retry |
| Tabular data not semantically searchable | `UniversalLoader` | CSV rows are key-value pairs, not natural language | Convert each row to a sentence: `"Context: Name is John, Age is 30"` |
| URL tokens polluting embeddings | `TextSanitizer` | URLs generate meaningless embedding dimensions | Mask URLs as `[URL]` instead of removing them (preserves sentence structure) |
| Sentence splitting breaks abbreviations | `SemanticChunker` | Naive `.` splitting breaks `"Dr. Smith"` | Regex that matches complete sentence units: `/[^.!?]+[.!?]+/` |
| Atlas $vectorSearch not always available | `SearchService` | Requires Atlas cluster with vector index | `try/catch` fallback to brute-force C++ SIMD search on all vectors |
| GC could invalidate C++ pointers | Zero-copy bridge | `Float32Array.Data()` pointer tied to JS object lifetime | Synchronous execution prevents GC during the operation; ArrayBuffer backing stores are non-relocatable |
| Async overhead > computation time for small workloads | C++ bridge | Worker thread scheduling costs ~0.5ms for a 0.1ms operation | Keep C++ calls synchronous for <1ms operations |
| NDJSON chunks arrive in arbitrary sizes | `GenerationService` | TCP doesn't guarantee message-aligned delivery | Line-based buffer parsing with `indexOf('\n')` |
| Two incompatible streaming protocols | SSE pipeline | Ollama uses NDJSON, frontend expects SSE | `onToken` callback translates: NDJSON → `data: {json}\n\n` |
| Score scales incompatible between search types | RRF Fusion | Cosine similarity (0–1) vs TF-IDF (unbounded) | RRF uses ranks not scores — inherently scale-agnostic |
