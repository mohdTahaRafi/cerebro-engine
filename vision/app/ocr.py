# Tesseract OCR (phase 4 §4): LSTM engine, confidence-filtered word extraction, and
# script-based language selection.
import logging

import pytesseract
from PIL import Image

logger = logging.getLogger("uvicorn.error")

# --oem 1: LSTM engine only. Legacy Tesseract 3 is markedly worse on modern scans;
# forcing LSTM avoids `oem 3`'s "either" mode picking the wrong one.
# --psm 3: fully automatic page segmentation, the right default for whole-page documents.
# --psm 6 ("uniform block") wins on single-column scans but destroys multi-column layouts,
# the more damaging failure.
OCR_CONFIG = "--oem 1 --psm 3"
# Tesseract's per-word confidence is roughly bimodal: correct words cluster 70-96,
# hallucinated noise from speckle clusters under 30. 40 sits in the trough, discarding
# scanner artifacts without dropping genuinely difficult but correct words.
MIN_WORD_CONFIDENCE = 40

# §4.2: below this, the page's OCR text is still indexed (it may hold a recoverable
# identifier) but the ingestion result flags it as poor for the user — the honest
# handling of the handwriting edge case.
OCR_POOR_MAX_CONFIDENCE = 45
OCR_POOR_MIN_WORDS = 5

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


def ocr_page(img: Image.Image, languages: str = "eng") -> dict:
    try:
        data = pytesseract.image_to_data(
            img, lang=languages, config=OCR_CONFIG, output_type=pytesseract.Output.DICT
        )
    except pytesseract.TesseractError as exc:
        # A requested script's language pack isn't installed in this image — only eng +
        # osd ship in the Phase 1 Dockerfile (§4.1). Tesseract fails the whole call rather
        # than partially degrading, so the fallback is a full retry in eng alone rather
        # than losing the page entirely.
        if languages == "eng":
            raise
        logger.warning(f"[ocr] language pack unavailable for '{languages}', falling back to eng: {exc}")
        data = pytesseract.image_to_data(
            img, lang="eng", config=OCR_CONFIG, output_type=pytesseract.Output.DICT
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


def ocr_quality(result: dict) -> str:
    if result["meanConfidence"] < OCR_POOR_MAX_CONFIDENCE or result["wordCount"] < OCR_POOR_MIN_WORDS:
        return "poor"
    return "good"
