# Phase 4: Vision RAG — Page Routing, OCR & ColPali

## 1. Objective

Make documents whose meaning lives in their layout searchable by that layout. Every PDF page is classified as text or visual; visual pages are rendered to images, OCR'd, and embedded with ColPali's late-interaction patch vectors; queries fan out to both indexes and return one fused, reranked list where a scanned page and a text chunk compete on equal footing. By the end of this phase: a developer ingests a 12-page scanned invoice PDF with **no text layer at all**, asks `"what is the total on invoice 8871"`, and gets back the correct page — with its rendered image — ranked above text chunks from other documents.

**No generation, no LLM calls, no conversation, no SSE, no frontend changes.** `POST /api/search` returns visual results as JSON with an `imageUri`; nothing renders them yet and nothing answers from them — that is Phase 5. Phase 2's text path is extended, not replaced: a mixed PDF sends most pages down the existing text pipeline unchanged.

---

## 2. Page Classification — `vision/app/classifier.py`

### 2.1 The Signals

PyMuPDF exposes both signals in a single pass over the page tree, with no rendering:

```python
import fitz  # PyMuPDF

CHAR_THRESHOLD = 200        # architecture §5.2
COVERAGE_THRESHOLD = 0.45

def classify_page(page: fitz.Page) -> dict:
    text = page.get_text("text")
    char_count = len(text.strip())

    page_area = abs(page.rect.width * page.rect.height)
    if page_area == 0:                       # degenerate/zero-size page
        return _verdict(page.number, "text", char_count, 0.0, "zero_area_page")

    # Union of image rects, not the sum: overlapping images (a common artifact of
    # scanner software layering a full-page scan plus a logo) would otherwise sum
    # past 1.0 and flip a text page to visual for the wrong reason.
    covered = _union_area(
        [fitz.Rect(b[:4]) for b in page.get_image_info(xrefs=False)],
        clip=page.rect,
    )
    coverage = covered / page_area

    if char_count < CHAR_THRESHOLD:
        return _verdict(page.number, "visual", char_count, coverage, "low_text")
    if coverage > COVERAGE_THRESHOLD:
        return _verdict(page.number, "visual", char_count, coverage, "high_image_coverage")
    return _verdict(page.number, "text", char_count, coverage, "text_dominant")
```

`_union_area` computes the area of the geometric union of overlapping rectangles by sweeping x-boundaries and summing covered y-intervals per band. Using the union rather than a naive sum is what stops a scanner's layered output — a full-page image plus a stamped logo — from reporting 130% coverage.

### 2.2 The Garbled-Text-Layer Case

The FR-ING edge case "a text layer exists but is wrong or garbled" defeats a pure character count: a bad producer-side OCR pass yields thousands of characters of nonsense, so `char_count` clears 200 and the page routes to text. A third signal catches it:

```python
GIBBERISH_ALPHA_RATIO = 0.55     # fraction of non-space chars that are letters/digits
GIBBERISH_MIN_CHARS   = 400      # only judge pages with enough text to be judgeable

def looks_garbled(text: str) -> bool:
    stripped = "".join(text.split())
    if len(stripped) < GIBBERISH_MIN_CHARS:
        return False
    alnum = sum(c.isalnum() for c in stripped)
    ratio = alnum / len(stripped)
    # Real prose in any script runs 0.75-0.95 alphanumeric once whitespace is removed.
    # Producer-side OCR failures fall well below 0.55 because they emit dense runs of
    # punctuation and box-drawing artifacts. 0.55 leaves headroom for legitimately
    # symbol-heavy pages (code listings, math) so they are not misrouted.
    return ratio < GIBBERISH_ALPHA_RATIO
```

A page failing this check routes **visual** with `reason: "garbled_text_layer"`, and its useless embedded text is discarded in favor of a fresh Tesseract pass.

### 2.3 `POST /classify`

Request is the raw PDF bytes; response is per-page verdicts plus a document-level summary. Non-PDF formats never reach this endpoint.

```json
{
  "pageCount": 12,
  "textPages": [1, 2, 3, 4, 5, 6, 7, 8, 9],
  "visualPages": [10, 11, 12],
  "pages": [
    { "page": 10, "kind": "visual", "charCount": 14, "imageCoverage": 0.97, "reason": "low_text" }
  ],
  "elapsedMs": 340
}
```

Classification is metadata-only — no rendering, no OCR — so a 500-page PDF classifies in ~2 s. This is why routing can be a cheap precondition rather than a decision deferred until after expensive work.

---

## 3. Page Rendering — `vision/app/render.py`

```python
RENDER_DPI = 150
JPEG_QUALITY = 85
MAX_EDGE_PX = 2400

def render_page(page: fitz.Page) -> bytes:
    # Normalize rotation first. A page with /Rotate 90 renders sideways otherwise,
    # which wrecks both Tesseract accuracy and ColPali's patch layout.
    page.set_rotation(0)

    zoom = RENDER_DPI / 72.0          # PDF user space is 72 dpi
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False, colorspace=fitz.csRGB)

    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if max(img.size) > MAX_EDGE_PX:
        img.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue()
```

| Constant | Value | Justification |
|---|---|---|
| `RENDER_DPI` | 150 | Set by Tesseract, not ColPali. Tesseract accuracy degrades sharply below 150 dpi on 9–11 pt body text; ColPali downsamples to its own patch grid regardless, so raising DPI further costs storage and OCR time for no retrieval gain |
| `JPEG_QUALITY` | 85 | Visually lossless for document scans. Quality 95 grows files ~1.8× with no measurable OCR or ColPali difference |
| `MAX_EDGE_PX` | 2400 | Caps a pathological A0 engineering drawing at 150 dpi (~7000 px) that would otherwise consume ~15 MB and stall Tesseract for minutes |
| `alpha=False` | — | Transparency is meaningless for a page raster and inflates the pixmap by 33% |

### 3.1 Deskew

Tesseract's page-segmentation handles small rotations poorly. `tesseract-ocr-osd` (installed in Phase 1's Dockerfile precisely for this) detects orientation and script before the real OCR pass:

```python
def deskew(img: Image.Image) -> Image.Image:
    try:
        osd = pytesseract.image_to_osd(img, output_type=pytesseract.Output.DICT)
        angle = osd.get("rotate", 0)
        # Only correct cardinal rotations. OSD's confidence on arbitrary skew angles
        # is poor, and a wrong rotation is far worse than a slightly skewed page.
        if angle in (90, 180, 270):
            return img.rotate(-angle, expand=True, resample=Image.BICUBIC)
    except pytesseract.TesseractError:
        pass          # OSD fails on sparse pages; proceed with the original
    return img
```

---

## 4. OCR — `vision/app/ocr.py`

```python
OCR_CONFIG = "--oem 1 --psm 3"
MIN_WORD_CONFIDENCE = 40

def ocr_page(img: Image.Image, languages: str = "eng") -> dict:
    data = pytesseract.image_to_data(
        img, lang=languages, config=OCR_CONFIG, output_type=pytesseract.Output.DICT
    )

    words, confidences = [], []
    for text, conf in zip(data["text"], data["conf"]):
        c = float(conf)
        if c < 0 or not text.strip():        # -1 marks layout blocks, not words
            continue
        if c >= MIN_WORD_CONFIDENCE:
            words.append(text)
            confidences.append(c)

    return {
        "text": " ".join(words),
        "meanConfidence": (sum(confidences) / len(confidences)) if confidences else 0.0,
        "wordCount": len(words),
    }
```

| Setting | Value | Justification |
|---|---|---|
| `--oem 1` | LSTM engine only | The legacy Tesseract 3 engine is markedly worse on modern scans; forcing LSTM avoids the `oem 3` "either" mode picking the wrong one |
| `--psm 3` | Fully automatic page segmentation | The right default for whole-page documents. `--psm 6` ("uniform block") wins on single-column scans but destroys multi-column layouts, which is the more damaging failure |
| `MIN_WORD_CONFIDENCE` | 40 | Tesseract's per-word confidence is roughly bimodal: correct words cluster 70–96, hallucinated noise from speckle clusters under 30. 40 sits in the trough, discarding scanner artifacts without dropping genuinely difficult but correct words |

### 4.1 Language Selection

```python
SCRIPT_TO_LANGS = {
    "Latin": "eng", "Cyrillic": "eng+rus", "Han": "eng+chi_sim",
    "Japanese": "eng+jpn", "Korean": "eng+kor", "Arabic": "eng+ara", "Devanagari": "eng+hin",
}

def detect_languages(img: Image.Image) -> str:
    try:
        osd = pytesseract.image_to_osd(img, output_type=pytesseract.Output.DICT)
        return SCRIPT_TO_LANGS.get(osd.get("script", "Latin"), "eng")
    except pytesseract.TesseractError:
        return "eng"
```

Every combination includes `eng` because document scans in any script routinely carry Latin-script identifiers — invoice numbers, product codes, URLs — and those are precisely what FR-SRCH-02 requires be findable. Non-Latin language packs beyond `eng`/`osd` are **not** installed in the Phase 1 image; adding a script means adding its `tesseract-ocr-<lang>` package to the Dockerfile, and `detect_languages` falls back to `eng` when a requested pack is missing rather than erroring.

### 4.2 The Low-Confidence Outcome

A page whose OCR yields `meanConfidence < 45` **or** `wordCount < 5` is recorded as `ocrQuality: "poor"`. Its text is still indexed (it may hold a recoverable identifier), but the document's ingestion result carries a warning listing those pages. This is the honest handling of the handwriting edge case: handwritten pages produce near-useless OCR, remain fully retrievable through ColPali, and the user is told which pages the text index cannot help with.

---

## 5. ColPali Embedding — `vision/app/colpali.py`

### 5.1 Page Embedding

```python
PAGE_BATCH_SIZE = 2

@torch.inference_mode()
def embed_pages(images: list[Image.Image]) -> list[list[list[float]]]:
    model, processor = load()
    out = []
    for i in range(0, len(images), PAGE_BATCH_SIZE):
        batch = processor.process_images(images[i : i + PAGE_BATCH_SIZE])
        batch = {k: v.to(model.device) for k, v in batch.items()}
        emb = model(**batch)                      # (B, patches, 128)
        out.extend(e.to(torch.float32).cpu().tolist() for e in emb)
    return out
```

`PAGE_BATCH_SIZE = 2` is set by memory, not throughput: ColPali holds ~4.5 GB of fp32 weights, and each in-flight page adds ~1.1 GB of activation for a 150-dpi input. Batch 2 keeps peak RSS under the 6 GB budget from Phase 1 §13. Larger batches OOM the container before they improve throughput, because CPU inference here is compute-bound rather than launch-bound.

`@torch.inference_mode()` rather than `no_grad()` — it additionally disables version counters and view tracking, cutting ~8% off CPU latency with no behavioral difference for a pure forward pass.

### 5.2 Query Embedding

```python
@torch.inference_mode()
def embed_query(query: str) -> list[list[float]]:
    model, processor = load()
    batch = processor.process_queries([query])    # NOT process_images — different template
    batch = {k: v.to(model.device) for k, v in batch.items()}
    return model(**batch)[0].to(torch.float32).cpu().tolist()   # (~20 tokens, 128)
```

ColPali is asymmetric in the same spirit as Cohere's input types, but structurally: `process_queries` applies a distinct prompt template and produces one vector per query *token* (~15–25), while `process_images` produces one per image *patch* (~1030). MAX_SIM then scores every query token against every patch and sums the per-token maxima. Feeding a query through `process_images` does not error — it produces silently wrong vectors, which is the worst kind of bug, so the two paths are separate functions with no shared entry point.

### 5.3 `POST /embed_pages`

Request: `{ documentId, pdfBytes (multipart), pages: [10, 11, 12] }`. For each requested page the service renders, deskews, OCRs, embeds, writes the JPEG to `PAGE_STORAGE_DIR/{documentId}/{page}.jpg`, and returns:

```json
{
  "pages": [{
    "page": 10,
    "imageUri": "pages/66f3a1.../10.jpg",
    "widthPx": 1275, "heightPx": 1650,
    "ocrText": "INVOICE 8871 ... TOTAL 42,500.00",
    "ocrQuality": "good",
    "meanConfidence": 88.4,
    "wordCount": 213,
    "multivector": [[0.021, -0.118, ...], ...],
    "patchCount": 1030
  }],
  "elapsedMs": 17420
}
```

The response is large — 3 pages of fp32 multivectors is ~1.5 MB of JSON. This is accepted rather than optimized: it crosses a loopback interface once per document during an already-multi-second job. Compressing it would add CPU on both sides to save time on a link that is not the bottleneck.

---

## 6. Ingestion Integration

### 6.1 Extended Job Handler

Phase 2's `ingestDocumentJob` gains a routing step between parse and chunk. The progress bands shift to make room:

```js
// 1. Classify (PDF only) ──────────────────────────────── 5% → 15%
let routing = { textPages: null, visualPages: [] };
if (doc.mimeType === 'application/pdf') {
  routing = await visionService.classify(doc.storagePath);
  await doc.updateOne({
    pageCount: routing.pageCount,
    textPageCount: routing.textPages.length,
    visualPageCount: routing.visualPages.length,
  });
}
await job.updateProgress(15);

// 2. Text path — unchanged from Phase 2, restricted to text pages ── 15% → 45%
const parsed = await parser.parseDocument(doc.storagePath, doc.mimeType);
const textPages = routing.textPages
  ? parsed.filter((p) => routing.textPages.includes(p.metadata.page))
  : parsed;

// 3. Visual path ──────────────────────────────────────── 45% → 75%
let visualResults = [];
if (routing.visualPages.length > 0) {
  visualResults = await embedVisualPages(doc, routing.visualPages, job);
}
await job.updateProgress(75);

// 4. Chunk text pages + OCR text together ──────────────── 75% → 85%
const chunks = [
  ...chunkPages(textPages, base),
  ...chunkPages(
    visualResults.map((v) => ({ text: v.ocrText, metadata: { page: v.page } })),
    { ...base, sourceKind: 'ocr' },          // marks provenance for §7.2 dedup
  ),
];
```

### 6.2 The No-Content Reversal

Phase 2 treated "zero extractable text" as a permanent failure. With a vision path that is now wrong — a fully scanned PDF has zero extractable text *and* is perfectly ingestable. The check is narrowed:

```js
const hasText = chunks.length > 0;
const hasVisual = visualResults.length > 0;
if (!hasText && !hasVisual) {
  const err = new Error('Document contains no extractable text and no renderable pages.');
  err.code = 'NO_EXTRACTABLE_CONTENT';
  throw err;
}
```

This is called out explicitly because it is a **behavior change to Phase 2 code**, not an addition: documents that Phase 2 rejected as `failed` now ingest successfully. Any Phase 2 test asserting the old behavior is updated in task 4.14 rather than left to fail.

### 6.3 Partial Vision Failure

Architecture §6.2 specifies that a vision-service outage degrades rather than fails the document:

```js
async function embedVisualPages(doc, pages, job) {
  try {
    return await visionService.embedPages(doc.storagePath, doc._id, pages);
  } catch (err) {
    console.warn(`[ingest] vision service unavailable for ${doc._id}: ${err.message}`);
    await doc.updateOne({
      warnings: [`${pages.length} scanned page(s) were skipped: ${err.message}`],
    });
    return [];        // text pages still complete; document reaches 'ready'
  }
}
```

A document that reaches `ready` with `visualPageCount > 0` but zero indexed pages is visibly incomplete via its `warnings` array, and re-ingesting it once the service is healthy fills the gap — deterministic point ids (Phase 2 §6.3) make that a clean overwrite.

### 6.4 Page Upsert

```js
export async function upsertPages(pages, documentId) {
  const points = pages.map((p) => ({
    id: uuidv5(`${documentId}:page:${p.page}`, NAMESPACE),
    vector: { colpali: p.multivector },      // list-of-lists → Qdrant multivector
    payload: {
      documentId, fileName, page: p.page,
      imageUri: p.imageUri, widthPx: p.widthPx, heightPx: p.heightPx,
      ocrText: p.ocrText.slice(0, 8000),     // payload preview; the chunked copy is authoritative
      ocrQuality: p.ocrQuality, meanConfidence: p.meanConfidence,
      patchCount: p.patchCount, sourceKind: 'page',
    },
  }));

  // Batch size 4, not 256: one page is ~527 KB of fp32 multivector, so a 256-point
  // batch would be a 135 MB request body. 4 keeps each request near 2 MB.
  for (let i = 0; i < points.length; i += 4) {
    await qdrantBreaker.fire('upsert', config.qdrant.pagesCollection, {
      wait: true, points: points.slice(i, i + 4),
    });
  }
}
```

---

## 7. Query-Side Integration

### 7.1 Parallel Fan-Out

`search.js` from Phase 3 gains a third concurrent branch. All three run together because the ColPali query embedding (~120 ms) and the Cohere query embedding (~190 ms) are independent network calls — serializing them would add the smaller one to the critical path for no reason.

```js
const [denseRes, sparseVecs, colpaliVec] = await Promise.all([
  embeddings.encodeQuery(query),
  embeddings.encodeSparse([query]),
  visionService.embedQuery(query).catch((err) => {
    console.warn('[search] ColPali query embedding failed, text-only:', err.message);
    return null;                    // visual retrieval degrades independently
  }),
]);

const [chunkCandidates, pageCandidates] = await Promise.all([
  vectorStore.hybridQuery({ denseVector: denseRes.vector, sparseVector: sparseVecs[0], limit: 50, documentIds }),
  colpaliVec
    ? vectorStore.multivectorQuery({ queryMultivector: colpaliVec, limit: 10, documentIds })
    : Promise.resolve([]),
]);
```

`limit: 10` for pages against 50 for chunks reflects granularity, not importance: a page is roughly 5–8 chunks' worth of content, so 10 pages and 50 chunks contribute comparable volumes of material to the reranker while keeping the combined candidate set at the 50–60 the reranker is budgeted for (Phase 3 §4.2).

### 7.2 Provenance Merge — Replacing the Phase 3 Stub

Phase 3 left `mergeByProvenance` as an identity function with a test asserting pass-through. It is now real. The problem it solves: a visual page is indexed twice by design (architecture §5.3) — once as a ColPali multivector, once as OCR chunks — so the same scanned page can arrive from both branches and would otherwise occupy two reranker slots and two result rows with identical evidence.

```js
export function mergeByProvenance(chunkCandidates, pageCandidates) {
  // Key on (documentId, page) — the identity of a physical page.
  const pageIndex = new Map(pageCandidates.map((p) => [`${p.documentId}:${p.page}`, p]));
  const absorbed = new Set();

  for (const chunk of chunkCandidates) {
    if (chunk.sourceKind !== 'ocr') continue;          // only OCR chunks can collide
    const key = `${chunk.documentId}:${chunk.page}`;
    const page = pageIndex.get(key);
    if (!page) continue;

    // The page entry wins: it carries the image, which the chunk does not, and the
    // chunk's text is already reachable through the page's ocrText payload.
    (page.absorbedChunks ??= []).push(chunk.pointId);
    absorbed.add(chunk.pointId);
  }

  return [
    ...chunkCandidates.filter((c) => !absorbed.has(c.pointId)),
    ...pageCandidates,
  ];
}
```

A **text** chunk from page 12 and a **visual** page 12 of the same document do not merge, and correctly so: that combination means the page had enough text to route as text *and* enough visual weight to be indexed as a page, which only occurs in Phase 4's mixed-signal cases where the two genuinely carry different information.

### 7.3 Unified Reranking

Both kinds go into one Cohere rerank call. The reranker is text-only, so a page is represented by its OCR text:

```js
function buildRerankText(c) {
  if (c.sourceKind === 'page') {
    const label = `[Scanned page ${c.page} of ${c.fileName}]`;
    // Poor-OCR pages still get submitted — their identifiers often survive even when
    // prose does not, and excluding them would make handwritten pages unrankable.
    return `${label}\n\n${c.ocrText}`.slice(0, 4000);
  }
  const prefix = c.headingPath ? `${c.headingPath}\n\n` : '';
  return `${prefix}${c.text}`.slice(0, 4000);
}
```

This is the mechanism behind FR-SRCH-04's single ordered list: after reranking, a page and a chunk both carry a `relevanceScore` from the same model on the same scale, and the ordering is simply that score descending. No score normalization between modalities is needed because no cross-modality score comparison ever happens — MAX_SIM and RRF outputs are both discarded at this boundary.

### 7.4 Result Projection

```js
{
  pointId: '…', kind: 'page', score: 0.91,
  documentId: '…', fileName: 'invoice-batch-2024.pdf', page: 10,
  text: 'INVOICE 8871 ... TOTAL 42,500.00',    // ocrText, for snippet display
  imageUri: '/api/pages/66f3a1…/10.jpg',        // served route, not a filesystem path
  ocrQuality: 'good',
  headingPath: null, position: null
}
```

### 7.5 Serving Page Images

```js
router.get('/api/pages/:documentId/:page.jpg', async (req, res) => {
  const doc = await Document.findById(req.params.documentId).select('_id');
  if (!doc) return res.status(404).end();      // deleted document ⇒ image unreachable

  const key = `pages/${req.params.documentId}/${req.params.page}.jpg`;
  if (!(await storage.exists(key))) return res.status(404).end();

  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=3600');
  storage.createReadStream(key).pipe(res);
});
```

The Mongo existence check runs before the storage read specifically so a deleted document's images become unreachable immediately, even if storage cleanup lags. `private` in `Cache-Control` keeps document images out of shared caches.

---

## 8. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 4.1 | Implement `classify_page` with char + union-coverage signals | A born-digital text PDF classifies 20/20 pages `text`; a fully scanned PDF classifies 12/12 `visual` |
| 4.2 | Implement union-area (not sum) image coverage | A page with two overlapping full-page images reports `imageCoverage ≤ 1.0` |
| 4.3 | Implement the garbled-text-layer detector | A PDF with a deliberately corrupted text layer routes `visual` with `reason:"garbled_text_layer"` |
| 4.4 | Implement `POST /classify` | A 500-page PDF returns verdicts in < 5 s with no rendering performed |
| 4.5 | Implement page rendering with rotation normalization + deskew | A page with `/Rotate 90` produces an upright JPEG; output ≤ 2400 px on the long edge |
| 4.6 | Implement OCR with confidence filtering | A clean scan returns `meanConfidence > 80`; a blank page returns `wordCount: 0` without erroring |
| 4.7 | Implement script-based language selection | A Cyrillic scan calls Tesseract with a lang string containing `eng`; a missing pack falls back to `eng` rather than raising |
| 4.8 | Implement `embed_pages` with batch size 2 | 12 pages embed without the container exceeding 6 GB RSS (`docker stats`); each returns `patchCount ≈ 1030` |
| 4.9 | Implement `embed_query` via `process_queries` | Returned multivector has 15–25 rows of 128 floats — distinguishably different from a page embedding |
| 4.10 | Implement `POST /embed_pages` writing JPEGs to page storage | `storage/pages/<documentId>/10.jpg` exists and opens as a valid image |
| 4.11 | Implement `upsertPages` with batch size 4 and quantization | Qdrant `cerebro_pages` reports 12 points; `curl /collections/cerebro_pages` shows int8 quantization active |
| 4.12 | Integrate classification + visual path into the ingest job | A 12-page scan reaches `status:"ready"` with `visualPageCount:12, textPageCount:0, chunkCount > 0` (from OCR) |
| 4.13 | Implement vision-outage degradation | With the vision container stopped, a scanned PDF still reaches `ready`, has a populated `warnings` array, and 0 page points |
| 4.14 | Update the Phase 2 no-content rule and its tests | A scanned PDF that Phase 2 rejected now ingests; the Phase 2 test asserting `NO_EXTRACTABLE_CONTENT` is updated, not deleted |
| 4.15 | Implement `multivectorQuery` with MAX_SIM | A query returns page hits ordered by MAX_SIM score in < 400 ms over 500 indexed pages |
| 4.16 | Replace the `mergeByProvenance` stub with real dedup | A scanned page retrieved from both branches appears exactly **once** in results, with `absorbedChunks` non-empty |
| 4.17 | Implement unified reranking across chunks and pages | A single result list contains both `kind:"text"` and `kind:"page"` entries in strictly descending `score` order |
| 4.18 | Implement ColPali-failure degradation on the query path | With the vision container stopped, `/api/search` still returns text results and logs the ColPali failure |
| 4.19 | Implement the page image route | `GET /api/pages/:id/10.jpg` returns HTTP 200 `image/jpeg`; after deleting the document it returns 404 |
| 4.20 | Extend delete to purge page points and images | Deleting a scanned document leaves 0 points in `cerebro_pages` and no files under `storage/pages/<id>/` |

---

## 9. Milestone Definition

Phase 4 is **complete** when:

> A developer uploads `invoice-batch-2024.pdf` — 12 pages, every one a 300-dpi photocopy with no text layer whatsoever, the file that Phase 2 rejected outright with `NO_EXTRACTABLE_CONTENT`. This time `GET /api/documents/:id` climbs past 15% (classification: all 12 pages `visual`, reason `low_text`), sits at 45–75% for about 70 seconds while the vision container renders, deskews, OCRs, and ColPali-embeds each page at roughly 6 seconds apiece, then lands on `{"status":"ready","pageCount":12,"visualPageCount":12,"textPageCount":0,"chunkCount":31}` — the 31 chunks being the OCR text, indexed alongside the images. The Qdrant dashboard shows 12 points in `cerebro_pages`, each with a 1030×128 multivector and int8 quantization active, and `du -sh storage/pages/<id>/` reports about 3 MB. They post `{"query":"what is the total on invoice 8871"}` to `/api/search`. The top result is `{"kind":"page","page":7,"score":0.91,"imageUri":"/api/pages/…/7.jpg","ocrQuality":"good"}` — ranked above text chunks from three other documents in the corpus — and opening that `imageUri` in a browser shows the actual scanned invoice with 8871 legible on it. The result list below it interleaves `kind:"page"` and `kind:"text"` entries in strictly descending score, one ordered list rather than two. Critically, page 7 appears exactly **once**, even though it was retrieved by both the ColPali branch and the OCR-chunk branch — its result carries a non-empty `absorbedChunks` array naming the chunk it swallowed. They then `docker compose stop vision` and repeat the same query: it still returns results, now text-only, with a ColPali failure logged and no error surfaced to the caller. Restarting vision and uploading a *mixed* 40-page report with 3 scanned appendix pages produces `{"textPageCount":37,"visualPageCount":3}` — the routing is per page, not per document. Finally they `DELETE` the invoice document and confirm `cerebro_pages` holds 0 points for it, `storage/pages/<id>/` is gone, and the previously working image URL now returns 404.

---

## 10. Files to Create

```
vision/app/
├── classifier.py                     # Per-page text/visual verdict, union coverage, garble check
├── render.py                         # PyMuPDF → 150-dpi JPEG, rotation normalize, deskew, size cap
├── ocr.py                            # Tesseract LSTM, confidence filter, script→language selection
├── colpali.py                        # [extend] embed_pages (batch 2) + embed_query (process_queries)
├── routes.py                         # [extend] /classify, /embed_pages, /embed_query — replaces the 501 stubs
└── geometry.py                       # Rectangle union-area sweep

backend/src/
├── providers/
│   ├── visionService.js              # [extend] classify, embedPages, embedQuery
│   └── vectorStore.js                # [extend] upsertPages, multivectorQuery, deletePagesByDocument
├── ingestion/ingestDocument.js       # [extend] classify step, visual branch, revised no-content rule
├── retrieval/
│   ├── search.js                     # [extend] third fan-out branch, unified rerank input
│   └── merge.js                      # [replace] real provenance dedup, superseding the Phase 3 stub
└── api/routes/pages.js               # GET /api/pages/:documentId/:page.jpg

backend/test/vision/
├── fixtures/                         # scanned-12pg.pdf, mixed-40pg.pdf, rotated.pdf, garbled-layer.pdf, handwritten.pdf
├── classifier.test.js                # Routing verdicts per fixture, coverage math
├── merge.test.js                     # Dedup: page absorbs its OCR chunks, text chunks untouched
└── visual-retrieval.test.js          # End-to-end: ingest scan → query → correct page ranked first
```

---

## 11. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| Classification, 500-page PDF | `elapsedMs` from `/classify` | < 5 s (no rendering) |
| Visual ingestion per page | Job duration ÷ visual page count | < 6 s/page (architecture §6) |
| Vision container peak RSS during a 12-page batch | `docker stats --no-stream` sampled through the job | < 6 GB |
| ColPali query embedding | `telemetry.colpaliMs` | < 200 ms |
| MAX_SIM retrieval @ 500 pages | `telemetry.pageRetrieveMs` p95 | < 400 ms |
| Qdrant storage per page | `du` on the Qdrant volume ÷ page count, after quantization | ~132 KB vectors |
| Page JPEG size | `ls -l storage/pages/<id>/` mean | ~250 KB |
| Total search latency with both branches | `telemetry.totalMs` p95 | < 900 ms (text 500 + parallel visual overlap) |
| Combined candidate count into rerank | `telemetry.candidatesRetrieved` | 50–60 after merge |

---

## 12. Estimated Complexity

- **Python vision service**: ~640 LOC across 6 files (classifier 150, render 110, ocr 130, colpali extension 90, routes 110, geometry 50)
- **Node backend**: ~430 LOC (visionService extension 130, vectorStore extension 120, ingest job extension 90, merge 60, pages route 30)
- **Tests**: ~340 LOC plus 5 PDF fixtures (~14 MB, stored with Git LFS)
- **New Python dependencies**: 0 — PyMuPDF, pytesseract, Pillow, torch, and colpali-engine all arrived in Phase 1
- **New npm dependencies**: 0
- **Changed behavior in prior phases**: one — Phase 2's `NO_EXTRACTABLE_CONTENT` rule (§6.2), with its test updated in task 4.14

This is the phase that justifies the two-runtime architecture. Everything before it could have been a single Node service; ColPali is what makes the Python process necessary, and page-level routing is what keeps its cost proportional to how much of a corpus is actually visual rather than charging every document for it.
