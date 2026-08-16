# Per-page text/visual routing (phase 4 §2, architecture §5.2). Runs over a page's
# metadata only — no rendering — so a 500-page PDF classifies in seconds (task 4.4).
import time

import fitz

from .geometry import union_area as _union_area

CHAR_THRESHOLD = 200        # architecture §5.2
COVERAGE_THRESHOLD = 0.45

GIBBERISH_ALPHA_RATIO = 0.55     # fraction of non-space chars that are letters/digits
GIBBERISH_MIN_CHARS = 400        # only judge pages with enough text to be judgeable


def _verdict(page_number: int, kind: str, char_count: int, coverage: float, reason: str) -> dict:
    return {
        # fitz's page.number is 0-based; every other component in the pipeline (parser.js
        # page metadata, chunker.js payloads, OCR page routes) is 1-based — convert here,
        # once, so 1-based is the only convention downstream code ever sees.
        "page": page_number + 1,
        "kind": kind,
        "charCount": char_count,
        "imageCoverage": round(coverage, 4),
        "reason": reason,
    }


def classify_page(page: fitz.Page) -> dict:
    text = page.get_text("text")
    char_count = len(text.strip())

    page_area = abs(page.rect.width * page.rect.height)
    if page_area == 0:                       # degenerate/zero-size page
        return _verdict(page.number, "text", char_count, 0.0, "zero_area_page")

    # Union of image rects, not the sum: overlapping images (a common artifact of
    # scanner software layering a full-page scan plus a logo) would otherwise sum
    # past 1.0 and flip a text page to visual for the wrong reason.
    #
    # Amended during implementation: get_image_info(xrefs=False) returns a list of
    # dicts keyed by "bbox" (among others), not raw (x0,y0,x1,y1) tuples — verified live
    # against PyMuPDF 1.25.1, `b["bbox"]` where the phase 4 spec's sample read `b[:4]`.
    covered = _union_area(
        [fitz.Rect(b["bbox"]) for b in page.get_image_info(xrefs=False)],
        clip=page.rect,
    )
    coverage = covered / page_area

    if char_count < CHAR_THRESHOLD:
        return _verdict(page.number, "visual", char_count, coverage, "low_text")
    if coverage > COVERAGE_THRESHOLD:
        return _verdict(page.number, "visual", char_count, coverage, "high_image_coverage")
    return _verdict(page.number, "text", char_count, coverage, "text_dominant")


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


def classify_document(pdf_bytes: bytes) -> dict:
    """Per-page verdicts plus a document-level summary (phase 4 §2.3's /classify body).

    Runs classify_page's char-count/coverage signals first, then — only for pages that
    cleared both and landed on "text" — re-extracts the page's text to run the garbled-
    text-layer check (§2.2). Deferring the garble check to just the "text" verdicts
    avoids paying for it on pages already routed "visual", where it can't change the
    outcome anyway.
    """
    start = time.monotonic()
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pages, text_pages, visual_pages = [], [], []

        for page in doc:
            verdict = classify_page(page)

            if verdict["kind"] == "text" and looks_garbled(page.get_text("text")):
                verdict = _verdict(
                    page.number, "visual", verdict["charCount"], verdict["imageCoverage"],
                    "garbled_text_layer",
                )

            pages.append(verdict)
            (visual_pages if verdict["kind"] == "visual" else text_pages).append(verdict["page"])

        return {
            "pageCount": doc.page_count,
            "textPages": text_pages,
            "visualPages": visual_pages,
            "pages": pages,
            "elapsedMs": round((time.monotonic() - start) * 1000),
        }
    finally:
        doc.close()
