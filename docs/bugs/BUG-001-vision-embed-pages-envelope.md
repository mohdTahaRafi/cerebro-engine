# BUG-001 — `visualResults.map is not a function`: every scanned PDF fails to ingest

| | |
|---|---|
| **Area** | `backend/src/providers/visionService.js` → `backend/src/ingestion/ingestDocument.js` |
| **Severity** | Critical — the entire scanned-document path was unusable |
| **Found** | 2026-08-18, ingesting `Security.pdf` and `File Management (1).pdf` through the `/advanced` console |
| **Status** | **Fixed** |

## 1. Symptom

The Document Ingestion panel showed a red **INGESTION FAILED** state with the message
`VISUALRESULTS.MAP IS NOT A FUNCTION`. The backend log showed the BullMQ worker burning
all three attempts on the same error:

```
[ingest] job 89 failed (attempt 1/3): visualResults.map is not a function
[ingest] job 89 failed (attempt 2/3): visualResults.map is not a function
[ingest] job 89 failed (attempt 3/3): visualResults.map is not a function
```

Affected documents reached `status: failed` with `visualPageCount` correctly populated
(29 and 13), proving classification succeeded and the failure came later.

## 2. Root Cause

The Node client and the Python vision service disagreed about the response envelope of
`POST /embed_pages`.

The service returns `EmbedPagesResponse` (`vision/app/schemas.py`) — an **object**:

```json
{ "pages": [ /* one entry per page */ ], "elapsedMs": 4120 }
```

`visionService.embedPages()` returned `res.data`, the whole envelope, instead of
`res.data.pages`. `ingestDocument.js` treats that return value as an array of per-page
results and calls `.map()` on it directly (step 4, chunking OCR text), so the first
scanned page ever routed through this path threw.

Confirmed live against the running service rather than inferred from source:

```
$ curl -s -X POST http://localhost:8100/embed_pages \
    -F documentId=smoketest -F 'pages=[1]' -F 'pdfBytes=@…;type=application/pdf' | …
top-level type: dict
top-level keys: ['pages', 'elapsedMs']
pages is list: True | count: 1
```

The sibling function `embedQuery()` in the same file already unwrapped correctly
(`res.data.multivector`). Only this one did not.

### 2.1 Why it stayed hidden

The call site is guarded by `if (routing.visualPages.length > 0)`. Every document
previously in the index — the resumes, `lec12Notes.pdf`, `northwind-q3-2025.md` — is
pure text, classified as zero visual pages, so `embedVisualPages()` had **never been
invoked** in any prior run. The two PDFs that exposed it are the first fully-scanned
documents ingested (29 and 13 pages, zero text pages each).

The failure also slipped past `syncPageImagesToStorage()` one line earlier without
throwing: its guard reads `visionResults.length === 0 || config.storage.driver !== 's3'`,
and on an object `.length` is `undefined`, so the first clause is false — but with
`STORAGE_DRIVER=filesystem` the second clause short-circuits the function to an early
return. Under `STORAGE_DRIVER=s3` this bug would instead have surfaced one line sooner as
`visionResults is not iterable`.

## 3. Fix

One line in `backend/src/providers/visionService.js`, plus a comment recording the
envelope contract so the next reader doesn't re-introduce it:

```js
const res = await embedPagesBreaker.fire(form);
return res.data.pages;   // was: res.data — EmbedPagesResponse is { pages, elapsedMs }
```

No spec amendment was needed: `docs/planning/phase_4_vision_rag.md` specifies the
service's response schema correctly and never states that the client returns the raw
`res.data`. This was purely an implementation defect.

## 4. Verification

Both previously-failed documents were re-ingested through `POST /api/documents/:id/reingest`:

| Document | Scanned pages | Result |
|---|---|---|
| `Security.pdf` | 13 | `status: ready`, `chunkCount: 13` |
| `File Management (1).pdf` | 29 | `status: ready`, `chunkCount: 29` |

`cerebro_chunks` went from 10 points to 52. A grounded end-to-end query then returned the
new content:

```
Q: What is a denial of service attack?
SOURCES: ['Security.pdf']
A: A denial-of-service (DoS) attack is an attack that seeks to prevent legitimate users
   from using a system or facility… [1][2]
afterFloor=3 warnings=[]
```

OCR quality was spot-checked on a stored chunk and is well-formed prose, not noise.

## 5. Note on these documents

With `COLPALI_ENABLED=false` (the compose default — ColPali needs a GPU to be practical),
these pages are indexed by **OCR text only**. They are fully searchable and citable, but
not matchable by appearance, so a question about a diagram's visual layout will not find
them. That is the documented design, not a consequence of this bug.
