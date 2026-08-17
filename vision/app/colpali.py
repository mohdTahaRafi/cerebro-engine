import logging
import os
import threading
import time

import torch
from colpali_engine.models import ColPali, ColPaliProcessor

logger = logging.getLogger("uvicorn.error")

_model = None
_processor = None
_lock = threading.Lock()

# Verified live: this deployment's network drops the download connection roughly
# once a minute on a multi-GB transfer (ChunkedEncodingError / IncompleteRead after
# ~20MB). huggingface_hub resumes from the partial .incomplete blob via HTTP Range
# requests on each fresh from_pretrained() call rather than restarting, so retrying
# the whole call costs only the bytes since the last completed range — a generous
# attempt count is cheap, not wasteful. 30 attempts × up to a few minutes of transfer
# each comfortably covers a multi-hour download on a connection this unreliable.
MAX_LOAD_ATTEMPTS = 30
RETRY_DELAY_SECONDS = 5


def enabled() -> bool:
    """Whether ColPali page/query embedding runs at all.

    Defaults to FALSE. ColPali is the only part of this service that needs a GPU to be
    practical: measured on the reference host's CPU, the OCR path (rasterize, deskew,
    language detect, tesseract) costs ~1.5s per page, while a single ColPali forward pass
    for one page ran past 10 minutes. A 12-page scanned PDF is therefore ~18s with this
    off versus well over an hour with it on, which is the difference between the visual
    test suite being runnable on a laptop and not.

    Switching it off is deliberately NOT the same as deleting the visual path. Pages are
    still rendered, deskewed, OCR'd, stored as JPEGs, and indexed as text chunks, so
    scanned documents remain searchable and citable — they are simply matched on their
    OCR text rather than on their appearance. What is lost is retrieval of things OCR
    cannot see: charts, diagrams, layout, stamps, signatures, handwriting.

    Set COLPALI_ENABLED=true on a GPU host (with COLPALI_DEVICE=cuda) to restore it. No
    code changes are needed in either service — the backend already degrades to text-only
    when /embed_query is unavailable (backend/src/retrieval/search.js).
    """
    return os.environ.get("COLPALI_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")


def load() -> tuple:
    """Idempotent, thread-safe model load. Called once at FastAPI startup.

    Retries the whole from_pretrained() pair on transient network failures instead
    of dying on the first one — the original version had no retry at all, which
    combined with main.py firing this on a bare asyncio.create_task() (whose
    exceptions are never retrieved) meant a single dropped connection silently
    killed the download forever with only an "exception was never retrieved"
    warning buried in the logs. Both halves of that gap are fixed: this function
    retries, and main.py now logs a real failure if every attempt is exhausted.
    """
    global _model, _processor
    if _model is not None:
        return _model, _processor
    with _lock:
        if _model is not None:
            return _model, _processor
        name = os.environ.get("COLPALI_MODEL", "vidore/colpali-v1.3")
        device = os.environ.get("COLPALI_DEVICE", "cpu")
        # Amended after a live OOM kill (exit 137): the original architecture §5.1
        # decision (fp32 on CPU, "no memory benefit that matters") assumed headroom
        # this deployment doesn't have. The base model is ~3B parameters — fp32
        # needs ~12GB for weights alone, which does not fit this host's 15GB total
        # RAM alongside everything else already running. bfloat16 halves that to
        # ~6GB, which does fit. torch 2.5.1 has broad CPU bf16 kernel coverage, so
        # this is not the numerically-risky choice it would have been a few torch
        # versions ago.
        dtype = torch.bfloat16

        for attempt in range(1, MAX_LOAD_ATTEMPTS + 1):
            try:
                # low_cpu_mem_usage=True avoids transformers' default from_pretrained
                # behavior of materializing a full-precision model instance before
                # loading the checkpoint on top of it — that doubles peak RAM during
                # the load itself (as opposed to the final resident size), which is
                # exactly the phase that was OOM-killed here.
                model = ColPali.from_pretrained(
                    name, torch_dtype=dtype, device_map=device, low_cpu_mem_usage=True,
                ).eval()
                processor = ColPaliProcessor.from_pretrained(name)
                _model, _processor = model, processor
                logger.info(f"[colpali] model loaded successfully on attempt {attempt}/{MAX_LOAD_ATTEMPTS}")
                return _model, _processor
            except Exception as exc:
                logger.warning(f"[colpali] load attempt {attempt}/{MAX_LOAD_ATTEMPTS} failed: {exc!r}")
                if attempt == MAX_LOAD_ATTEMPTS:
                    logger.error(f"[colpali] giving up after {MAX_LOAD_ATTEMPTS} attempts")
                    raise
                time.sleep(RETRY_DELAY_SECONDS)


def is_ready() -> bool:
    return _model is not None


# ── Phase 4: page and query embedding (architecture §5, phase 4 §5) ─────────────────

PAGE_BATCH_SIZE = 2   # set by memory, not throughput — see the batching comment below


# @torch.inference_mode(), not @torch.no_grad(), on both functions below — it additionally
# disables version counters and view tracking, cutting ~8% off CPU latency with no
# behavioral difference for a pure forward pass.
@torch.inference_mode()
def embed_pages(images: list) -> list:
    """ColPali multivector embedding, one entry per page (~1030 patches x 128 dims).

    PAGE_BATCH_SIZE = 2 is set by memory, not throughput: ColPali holds ~4.5GB of fp32
    weights, and each in-flight page adds ~1.1GB of activation for a 150-dpi input. Batch
    2 keeps peak RSS under the 6GB budget from Phase 1 §13. Larger batches OOM the
    container before they improve throughput, because CPU inference here is compute-bound
    rather than launch-bound.
    """
    model, processor = load()
    out = []
    for i in range(0, len(images), PAGE_BATCH_SIZE):
        batch = processor.process_images(images[i : i + PAGE_BATCH_SIZE])
        batch = {k: v.to(model.device) for k, v in batch.items()}
        emb = model(**batch)                      # (B, patches, 128)
        out.extend(e.to(torch.float32).cpu().tolist() for e in emb)
    return out


@torch.inference_mode()
def embed_query(query: str) -> list:
    """ColPali is asymmetric structurally, not just by input-type flag: process_queries
    applies a distinct prompt template and produces one vector per query *token*
    (~15-25), while process_images produces one per image *patch* (~1030). MAX_SIM then
    scores every query token against every patch and sums the per-token maxima. Feeding a
    query through process_images does not error — it produces silently wrong vectors,
    which is the worst kind of bug, so the two paths stay separate functions with no
    shared entry point.
    """
    model, processor = load()
    batch = processor.process_queries([query])    # NOT process_images — different template
    batch = {k: v.to(model.device) for k, v in batch.items()}
    return model(**batch)[0].to(torch.float32).cpu().tolist()   # (~20 tokens, 128)
