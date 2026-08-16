# Page rasterization (phase 4 §3): PyMuPDF -> upright, size-capped RGB image, with a
# deskew pass ahead of OCR. `render_page` is the public JPEG-bytes entry point routes.py
# stores to disk; `rasterize` is exposed separately because the OCR and ColPali stages
# downstream need the decoded PIL Image itself, not a re-decoded JPEG round-trip of it.
import io

import fitz
import pytesseract
from PIL import Image

# Set by Tesseract, not ColPali. Tesseract accuracy degrades sharply below 150 dpi on
# 9-11pt body text; ColPali downsamples to its own patch grid regardless, so raising DPI
# further costs storage and OCR time for no retrieval gain.
RENDER_DPI = 150
# Visually lossless for document scans. Quality 95 grows files ~1.8x with no measurable
# OCR or ColPali difference.
JPEG_QUALITY = 85
# Caps a pathological A0 engineering drawing at 150 dpi (~7000px) that would otherwise
# consume ~15MB and stall Tesseract for minutes.
MAX_EDGE_PX = 2400


def rasterize(page: fitz.Page) -> Image.Image:
    # Normalize rotation first. A page with /Rotate 90 renders sideways otherwise,
    # which wrecks both Tesseract accuracy and ColPali's patch layout.
    page.set_rotation(0)

    zoom = RENDER_DPI / 72.0          # PDF user space is 72 dpi
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False, colorspace=fitz.csRGB)

    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if max(img.size) > MAX_EDGE_PX:
        img.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX), Image.LANCZOS)
    return img


def render_page(page: fitz.Page) -> bytes:
    img = rasterize(page)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue()


def encode_jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue()


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
