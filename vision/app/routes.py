import asyncio
import json
import os
import time
from pathlib import Path

import fitz
import pytesseract
from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile

from . import classifier, colpali, ocr, render
from .schemas import (
    ClassifyResponse,
    EmbedPagesResponse,
    EmbedPageResult,
    EmbedQueryRequest,
    EmbedQueryResponse,
    HealthResponse,
)

router = APIRouter()
_START = time.monotonic()

# Matches the PAGE_STORAGE_DIR the docker-compose volume mounts (./storage/pages on the
# host, /storage/pages in this container) — see vision/Dockerfile's env and phase 4 §5.3.
PAGE_STORAGE_DIR = Path(os.environ.get("PAGE_STORAGE_DIR", "./storage/pages"))


@router.get("/health", response_model=HealthResponse)
def health(response: Response):
    colpali_enabled = colpali.enabled()
    model_loaded = colpali.is_ready()
    # "Healthy" means "can serve what it is configured to serve". With ColPali switched
    # off, OCR-only is the configured service, so an unloaded model is the expected
    # steady state rather than a fault — reporting 503 forever would deadlock Compose's
    # `depends_on: vision: service_healthy` and never start the backend at all.
    if colpali_enabled and not model_loaded:
        # Weights are still downloading/loading — this is what the Compose healthcheck's
        # start_period is waiting out (phase 1 §2).
        response.status_code = 503

    try:
        tesseract_version = str(pytesseract.get_tesseract_version())
    except Exception:
        tesseract_version = "unknown"

    return HealthResponse(
        status="up" if (model_loaded or not colpali_enabled) else "down",
        model=_configured_model(),
        device=_configured_device(),
        modelLoaded=model_loaded,
        colpaliEnabled=colpali_enabled,
        tesseractVersion=tesseract_version,
        uptimeSeconds=round(time.monotonic() - _START, 1),
    )


def _configured_model() -> str:
    return os.environ.get("COLPALI_MODEL", "vidore/colpali-v1.3")


def _configured_device() -> str:
    return os.environ.get("COLPALI_DEVICE", "cpu")


def _require_model_ready():
    if not colpali.enabled():
        # Not an error for /embed_pages, which still has real OCR work to do — only
        # /embed_query, which has nothing to return without the model, calls this via
        # _require_colpali_enabled below.
        return
    if not colpali.is_ready():
        # 503, matching /health's own readiness signal — a caller hitting this before
        # first-boot weight download finishes gets an honest "not ready yet", not a
        # crash mid-forward-pass or a silently wrong embedding.
        raise HTTPException(status_code=503, detail="ColPali model is still loading.")


# ── POST /classify (phase 4 §2.3) ────────────────────────────────────────────────────
# Request is the raw PDF bytes; response is per-page verdicts plus a document-level
# summary. Metadata-only — no rendering, no OCR — so a 500-page PDF classifies in ~2s.
@router.post("/classify", response_model=ClassifyResponse)
async def classify_endpoint(request: Request):
    pdf_bytes = await request.body()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Request body is empty; expected raw PDF bytes.")
    try:
        # Run off the event loop: classify_document is synchronous PyMuPDF work, and a
        # 500-page pathological PDF must not stall concurrent /health polling for its
        # ~2-5s duration.
        return await asyncio.to_thread(classifier.classify_document, pdf_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not classify PDF: {exc}") from exc


# ── POST /embed_pages (phase 4 §5.3) ─────────────────────────────────────────────────
# multipart/form-data: documentId, pdfBytes (file), pages (JSON-encoded list of 1-based
# page numbers). For each requested page: render, deskew, detect script, OCR, embed, and
# write the JPEG to PAGE_STORAGE_DIR/{documentId}/{page}.jpg.
def _process_pages(pdf_bytes: bytes, document_id: str, pages: list[int]) -> list[dict]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        images = []
        partials = []   # per-page dict, everything except the multivector

        for page_num in pages:
            index = page_num - 1   # requested pages are 1-based; fitz indexing is 0-based
            if index < 0 or index >= doc.page_count:
                raise ValueError(f"page {page_num} is out of range for a {doc.page_count}-page document")

            fitz_page = doc[index]
            img = render.rasterize(fitz_page)
            img = render.deskew(img)

            languages = ocr.detect_languages(img)
            ocr_result = ocr.ocr_page(img, languages)

            jpeg_bytes = render.encode_jpeg(img)
            dest = PAGE_STORAGE_DIR / document_id / f"{page_num}.jpg"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(jpeg_bytes)

            images.append(img)
            partials.append({
                "page": page_num,
                "imageUri": f"pages/{document_id}/{page_num}.jpg",
                "widthPx": img.width,
                "heightPx": img.height,
                "ocrText": ocr_result["text"],
                "ocrQuality": ocr.ocr_quality(ocr_result),
                "meanConfidence": round(ocr_result["meanConfidence"], 2),
                "wordCount": ocr_result["wordCount"],
            })

        # Everything above this line — render, deskew, OCR, JPEG write — still runs with
        # ColPali off. Only the embedding is skipped, so a scanned page keeps its OCR
        # text (indexed as chunks by ingestDocument.js) and its stored image (so the
        # answer can still show the page it cited); it simply has no visual vector, and
        # is therefore retrievable by its text rather than its appearance.
        if not colpali.enabled():
            return [{**p, "multivector": None, "patchCount": 0} for p in partials]

        # One batched embedding call for every requested page, not one call per page —
        # embed_pages already chunks internally at PAGE_BATCH_SIZE (colpali.py §5.1).
        multivectors = colpali.embed_pages(images)

        return [
            {**p, "multivector": mv, "patchCount": len(mv)}
            for p, mv in zip(partials, multivectors)
        ]
    finally:
        doc.close()


@router.post("/embed_pages", response_model=EmbedPagesResponse)
async def embed_pages_endpoint(
    documentId: str = Form(...),
    pages: str = Form(...),
    pdfBytes: UploadFile = File(...),
):
    _require_model_ready()

    try:
        page_numbers = json.loads(pages)
        if not isinstance(page_numbers, list) or not all(isinstance(p, int) for p in page_numbers):
            raise ValueError("must be a JSON array of integers")
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid 'pages' field: {exc}") from exc

    pdf_bytes = await pdfBytes.read()
    start = time.monotonic()
    try:
        # Off the event loop: rendering + OCR + ColPali is several seconds per page of
        # blocking CPU work (architecture §6's <6s/page budget), which must not freeze
        # concurrent /health polling for the duration of the whole batch.
        results = await asyncio.to_thread(_process_pages, pdf_bytes, documentId, page_numbers)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return EmbedPagesResponse(
        pages=[EmbedPageResult(**r) for r in results],
        elapsedMs=round((time.monotonic() - start) * 1000),
    )


# ── POST /embed_query (phase 4 §5.2, called from search.js §7.1) ────────────────────
@router.post("/embed_query", response_model=EmbedQueryResponse)
async def embed_query_endpoint(body: EmbedQueryRequest):
    if not colpali.enabled():
        # 503 rather than 404/501: the caller's correct reaction is identical to a vision
        # outage — drop the visual branch and search text only — and search.js already
        # implements exactly that. Returning it immediately (instead of the 5s client
        # timeout an unreachable service costs) is why disabling ColPali makes queries
        # faster rather than merely no slower.
        raise HTTPException(
            status_code=503,
            detail="ColPali is disabled (COLPALI_ENABLED=false); visual retrieval is unavailable.",
        )
    _require_model_ready()
    start = time.monotonic()
    multivector = await asyncio.to_thread(colpali.embed_query, body.query)
    return EmbedQueryResponse(
        multivector=multivector,
        elapsedMs=round((time.monotonic() - start) * 1000),
    )
