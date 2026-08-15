# Requirements — Pipeline Quality Upgrade

## 1. Overview
Replace hand-rolled ingestion, chunking, sanitization, embedding, and retrieval
logic with established RAG tooling, removing the current quality ceiling while
keeping every AI provider (embedding, vector store, generation) swappable.
Retrieval is multimodal: documents whose meaning lives in their visual layout
(scanned pages, image-heavy PDFs) are searchable alongside text documents.

## 2. Scope
**In scope:** document ingestion (text and visual), search/retrieval quality,
grounded multi-turn generation, document management, pipeline observability,
provider reliability/security.
**Out of scope (this pass):** frontend visual redesign, authentication and
multi-user accounts, deployment/infra (Docker, CI) — tracked separately.

## 3. Stakeholders
- **End user** — uploads documents, asks questions, expects accurate cited answers.
- **Developer / showcase reviewer** — inspects pipeline internals, expects correctness, traceability, and defensible engineering choices.

## 4. Requirement conventions
Functional requirements state required *outcomes*. Mechanisms (how text is
split, how results are ranked or fused, how page images are embedded, which
similarity metric is used) are delegated to the libraries/services chosen in
`tech-stack.md` and specified during design. Each group ends with the edge
cases the system must handle regardless of mechanism.

---

## 5. Features

1. **Multi-format knowledge base ingestion** — add documents by file upload or URL.
2. **Visual document understanding** — scanned and image-heavy PDFs are searchable by their visual content, not only by extractable text.
3. **Conversational Q&A with citations** — answers grounded in and cited to actual sources.
4. **High-quality search** — works for conceptual questions, exact-term lookups, and visually-expressed content.
5. **Multi-turn conversation** — follow-ups understood in context; threads persist.
6. **Document management** — list, delete, re-ingest knowledge base contents.
7. **Streaming answers** — responses render progressively.
8. **Developer/advanced console** — per-query trace of the pipeline with timings and scores.
9. **Provider flexibility** — embedding, vector store, and generation providers swappable by configuration.
10. **Reliability safeguards** — graceful degradation when an external provider fails.
11. **Cost/usage visibility** — per-request external API usage logged.

---

## 6. Functional Requirements

### FR-ING — Ingestion
- **FR-ING-01**: Users shall be able to add documents to the knowledge base by uploading a file or supplying a URL.
- **FR-ING-02**: The system shall support PDF, DOCX, TXT, MD, CSV, XLSX/XLS, and JSON files, plus HTML pages via URL.
- **FR-ING-03**: All readable content of an ingested document shall become searchable — no portion may be silently dropped or truncated.
- **FR-ING-04**: The system shall determine, per PDF, whether its content is primarily textual or primarily visual, and process it accordingly so that either kind is fully searchable.
- **FR-ING-05**: Documents whose meaning is carried visually (scanned pages, charts, diagrams, complex layouts, forms) shall be retrievable by that visual content, not only by whatever text can be extracted from them.
- **FR-ING-06**: Content whose meaning depends on structure (headings, tables, lists) shall remain interpretable after ingestion, such that a retrieved excerpt is understandable on its own.
- **FR-ING-07**: Every retrievable unit — textual or visual — shall be traceable to its origin document and its location within that document (page/section), for citation.
- **FR-ING-08**: Ingestion progress and outcome shall be observable by the user (queued / processing / ready / failed), with a human-readable reason on failure.
- **FR-ING-09**: Re-adding an unchanged document shall not create duplicate content in the knowledge base.
- **FR-ING-10**: Re-adding a changed document shall replace its previous content rather than accumulate stale copies.
- **FR-ING-11**: A failed ingestion shall not leave partial content in the knowledge base, and shall be retryable without re-upload.

**Edge cases the system must handle:**
- Scanned/image-only PDFs with no extractable text layer
- PDFs mixing text-heavy and image-heavy pages within one document
- PDFs whose extractable text layer exists but is wrong or garbled (bad OCR baked in by the producer)
- Documents where a chart/diagram carries information absent from the surrounding text
- Multi-sheet workbooks (all sheets, not only the first)
- A table or section spanning a page/section break
- Non-Latin scripts (Arabic, CJK, Cyrillic) and typographic characters (curly quotes, em-dashes, ligatures, emoji)
- Handwritten or low-resolution scanned content
- Rotated, skewed, or multi-column page layouts
- Mismatch between file extension and actual content type
- Password-protected, encrypted, or corrupt files
- Empty or whitespace-only documents
- Files exceeding the configured size limit
- Text containing no sentence punctuation, or a single unbroken run of characters longer than one retrievable unit
- Web pages dominated by navigation/ads/boilerplate rather than content
- Identical content appearing across two differently-named documents
- Mixed languages within a single document

### FR-SRCH — Search & Retrieval
- **FR-SRCH-01**: Search shall return results relevant to the *meaning* of a query, not only literal term overlap.
- **FR-SRCH-02**: Search shall return correct results for exact identifiers that carry no semantic meaning (invoice numbers, error codes, part numbers, names).
- **FR-SRCH-03**: Search shall return relevant visual content (e.g. a scanned page or chart) for queries whose answer lives in that content.
- **FR-SRCH-04**: Textual and visual results shall be presented in a single relevance-ordered result set, not as separate disconnected lists.
- **FR-SRCH-05**: Users shall be able to restrict a search to specific documents.
- **FR-SRCH-06**: When no sufficiently relevant content exists, the system shall report that explicitly rather than present weak matches as authoritative.
- **FR-SRCH-07**: Per-request relevance scores and stage timings shall be available for inspection.

**Edge cases the system must handle:**
- A query whose answer exists in both a text passage and a page image (results should not duplicate the same evidence twice)
- Query matching many near-duplicate passages or near-identical pages
- Query written in a different language from the corpus
- Very short (single-word) and very long queries
- Queries with typos or inconsistent casing/punctuation
- An empty knowledge base, or one containing only visual documents
- Answers that require combining evidence from multiple documents or across both modalities
- Queries containing only stopwords or only punctuation

### FR-GEN — Answer Generation
- **FR-GEN-01**: Answers shall be grounded in retrieved content from the knowledge base.
- **FR-GEN-02**: The system shall be able to ground answers in retrieved visual content as well as text.
- **FR-GEN-03**: The system shall explicitly state when retrieved content is insufficient, rather than fabricating an answer.
- **FR-GEN-04**: The system shall cite the specific content actually used to produce the answer, including the source page when the evidence is visual.
- **FR-GEN-05**: Generated answers shall stream to the client progressively rather than appearing only on completion.
- **FR-GEN-06**: Users shall be able to cancel an in-progress generation and to regenerate a response.

**Edge cases the system must handle:**
- Retrieved sources that contradict one another, including text contradicting a chart/table image
- Answers requiring synthesis across several retrieved passages or across both modalities
- Retrieved content exceeding the generation model's context window
- Visual evidence retrieved while the configured generation model cannot interpret images
- The generation provider failing or disconnecting mid-stream
- Questions entirely outside the knowledge base's subject matter
- Instruction-like text embedded in an ingested document (including inside an image) attempting to influence the model
- Queries pressuring the model to extrapolate beyond what sources support

### FR-CONV — Conversation
- **FR-CONV-01**: The system shall maintain conversational context across multiple turns.
- **FR-CONV-02**: Follow-up questions that are ambiguous in isolation shall be interpreted using prior turns.
- **FR-CONV-03**: Conversation threads shall persist and be resumable after a reload or reconnect.
- **FR-CONV-04**: Users shall be able to list, rename, and delete conversation threads.

**Edge cases the system must handle:**
- Follow-ups referring to prior turns only by pronoun ("what about that one?")
- Abrupt topic change mid-thread (prior context should not distort the new query)
- Conversations long enough to exceed the model's context window
- Rapid successive submissions where a newer query supersedes an in-flight one
- Resuming a thread whose cited documents have since been deleted

### FR-DOC — Document Management
- **FR-DOC-01**: Users shall be able to see all ingested documents with name, ingestion date, size/extent, and status.
- **FR-DOC-02**: Users shall be able to delete a document, fully removing its content — textual and visual — from the knowledge base.
- **FR-DOC-03**: Users shall be able to re-ingest an updated version of a document.
- **FR-DOC-04**: Users shall be able to filter/search the document list.

**Edge cases the system must handle:**
- Deleting a document while a query referencing it is in flight
- Deleting or re-ingesting a document while its ingestion is still processing
- Deleting a document cited by an existing saved conversation

### FR-OBS — Observability
- **FR-OBS-01**: Each request shall produce an inspectable trace covering every pipeline stage, with timings.
- **FR-OBS-02**: Traces shall distinguish which retrieval path (textual, visual) contributed each result.
- **FR-OBS-03**: Traces shall be inspectable outside of raw application logs.
- **FR-OBS-04**: Pipeline timing/telemetry shall be exposed to the frontend developer console in real time.
- **FR-OBS-05**: The system shall support benchmarking the legacy hand-rolled C++ vector engine against the production retrieval path on identical queries and datasets.
- **FR-OBS-06**: Per-request external API usage (calls/tokens) shall be logged.

### FR-SEC / FR-REL — Security & Reliability
- **FR-SEC-01**: Third-party API credentials shall remain server-side only and never reach the client.
- **FR-SEC-02**: Publicly reachable endpoints shall be rate-limited.
- **FR-SEC-03**: Uploads shall be validated (type, size) before processing.
- **FR-REL-01**: Repeated failure of any external dependency shall cause the system to fail fast with a clear error rather than hang.
- **FR-REL-02**: A health endpoint shall report the status of each critical dependency.
- **FR-REL-03**: Transient external failures shall be retried before an error is surfaced to the user.

**Edge cases the system must handle:**
- An external provider that is slow rather than failing outright (timeout vs. hang)
- Provider quota/rate-limit rejections
- Partial provider outage (e.g. text retrieval healthy, visual retrieval or generation down)

---

## 7. Non-Functional Requirements

### Performance
- **NFR-PERF-01**: Retrieval shall complete within 500ms at P95 for a knowledge base up to 100k retrievable units.
- **NFR-PERF-02**: Result ranking/refinement shall add no more than 300ms at P95.
- **NFR-PERF-03**: Time-to-first-token shall be within 2–5 seconds at P95.
- **NFR-PERF-04**: Ingestion of a typical 20-page text PDF shall complete within 30 seconds end-to-end.
- **NFR-PERF-05**: Visual ingestion (OCR + page-image indexing) may take longer than text ingestion, but shall report progress rather than appear stalled.
- **NFR-PERF-06**: Streamed responses shall render without layout shift or dropped frames.

### Reliability & Availability
- **NFR-REL-01**: Search shall remain available when the generation provider is unavailable.
- **NFR-REL-02**: Failing dependencies shall be isolated quickly and recover automatically once healthy.
- **NFR-REL-03**: Per-document ingestion shall be atomic — fully succeed or leave no trace.
- **NFR-REL-04**: Retrieval and generation endpoints shall target a 99% successful request rate under normal load.

### Security & Privacy
- **NFR-SEC-01**: Document content and query text shall not be logged in plaintext to third-party analytics.
- **NFR-SEC-02**: Credentials shall live in environment/secret storage, never in source control.
- **NFR-SEC-03**: Upload handling shall be resistant to resource-exhaustion attacks.

### Scalability
- **NFR-SCALE-01**: Adding documents shall not require reprocessing the existing knowledge base.
- **NFR-SCALE-02**: The API layer shall be horizontally scalable independently of storage and generation backends.
- **NFR-SCALE-03**: Storage growth from page-image indexing shall be bounded and predictable per document.

### Maintainability & Extensibility
- **NFR-MAINT-01**: Embedding, vector store, and generation providers shall each be swappable via configuration rather than code changes.
- **NFR-MAINT-02**: Established libraries shall be preferred over hand-rolled implementations for parsing, chunking, and retrieval; custom code is reserved for genuinely differentiating logic.
- **NFR-MAINT-03**: Documentation describing the pipeline shall be updated whenever pipeline behavior changes.

### Observability
- **NFR-OBS-01**: Every pipeline stage shall be traceable per request with timing and relevant metadata.
- **NFR-OBS-02**: Overall system and dependency health shall be visible from a single endpoint.

### Cost
- **NFR-COST-01**: External API usage shall be logged per request to support cost monitoring.
- **NFR-COST-02**: A lower-cost/local generation option shall remain supported.

### Usability
- **NFR-USE-01**: Answers shall begin rendering before generation completes.
- **NFR-USE-02**: Citations shall be traceable from the answer back to their source document, and to the source page image when the evidence is visual.

### Data Handling
- **NFR-DATA-01**: Document content shall not be sent to third-party providers beyond what the configured pipeline stage requires.
- **NFR-DATA-02**: Deleting a document shall fully remove its content — text, vectors, and page images — from all storage.

### Portability
- **NFR-PORT-01**: Changing vector store providers shall not require changes to ingestion business logic.
- **NFR-PORT-02**: A defined procedure shall exist for migrating an existing knowledge base to a new embedding model.
