from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str                 # "up" | "down"
    model: str
    device: str
    modelLoaded: bool
    colpaliEnabled: bool        # false ⇒ OCR-only mode; modelLoaded is then expected false
    tesseractVersion: str
    uptimeSeconds: float


# ── Phase 4: /classify (§2.3) ────────────────────────────────────────────────────────

class PageVerdict(BaseModel):
    page: int
    kind: str          # "text" | "visual"
    charCount: int
    imageCoverage: float
    reason: str


class ClassifyResponse(BaseModel):
    pageCount: int
    textPages: list[int]
    visualPages: list[int]
    pages: list[PageVerdict]
    elapsedMs: int


# ── Phase 4: /embed_pages (§5.3) ─────────────────────────────────────────────────────

class EmbedPageResult(BaseModel):
    page: int
    imageUri: str
    widthPx: int
    heightPx: int
    ocrText: str
    ocrQuality: str        # "good" | "poor"
    meanConfidence: float
    wordCount: int
    multivector: list[list[float]] | None   # None ⇒ COLPALI_ENABLED=false; OCR fields still populated
    patchCount: int


class EmbedPagesResponse(BaseModel):
    pages: list[EmbedPageResult]
    elapsedMs: int


# ── Phase 4: /embed_query (§5.2, referenced by search.js in §7.1) ───────────────────

class EmbedQueryRequest(BaseModel):
    query: str


class EmbedQueryResponse(BaseModel):
    multivector: list[list[float]]
    elapsedMs: int
