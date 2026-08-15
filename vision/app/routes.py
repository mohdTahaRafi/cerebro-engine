import time

import pytesseract
from fastapi import APIRouter, Response

from . import colpali
from .schemas import HealthResponse

router = APIRouter()
_START = time.monotonic()


@router.get("/health", response_model=HealthResponse)
def health(response: Response):
    model_loaded = colpali.is_ready()
    if not model_loaded:
        # Weights are still downloading/loading — this is what the Compose healthcheck's
        # start_period is waiting out (phase 1 §2).
        response.status_code = 503

    try:
        tesseract_version = str(pytesseract.get_tesseract_version())
    except Exception:
        tesseract_version = "unknown"

    return HealthResponse(
        status="up" if model_loaded else "down",
        model=_configured_model(),
        device=_configured_device(),
        modelLoaded=model_loaded,
        tesseractVersion=tesseract_version,
        uptimeSeconds=round(time.monotonic() - _START, 1),
    )


def _configured_model() -> str:
    import os
    return os.environ.get("COLPALI_MODEL", "vidore/colpali-v1.3")


def _configured_device() -> str:
    import os
    return os.environ.get("COLPALI_DEVICE", "cpu")


# /classify and /embed_pages land in Phase 4 (phase 4 §2.3, §5.3). Stubbed here so
# the route surface exists and callers get an honest "not built yet" rather than 404.
@router.post("/classify")
def classify_stub():
    return Response(status_code=501, content="Not implemented until Phase 4.")


@router.post("/embed_pages")
def embed_pages_stub():
    return Response(status_code=501, content="Not implemented until Phase 4.")
