import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import colpali
from .routes import router

logger = logging.getLogger("uvicorn.error")


async def _load_model_in_background():
    try:
        await asyncio.to_thread(colpali.load)
    except Exception:
        # colpali.load() already retries transient network failures MAX_LOAD_ATTEMPTS
        # times; reaching here means every attempt failed. A bare asyncio.create_task()
        # swallows its exception silently (only an "exception was never retrieved"
        # warning) — verified live: that is exactly what made an earlier permanent
        # failure invisible until someone went looking at the logs. Logging it
        # explicitly here means a real, unrecoverable failure is visible in
        # `docker logs` immediately instead of only showing up as /health staying
        # down forever with no explanation.
        logger.exception("[vision] ColPali model failed to load after all retry attempts")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fired, not awaited: the container must accept /health connections immediately
    # (reporting 503 / modelLoaded: false) rather than refusing them for however long
    # the ~6GB first-boot ColPali weight download takes. Once the background load
    # finishes, colpali.is_ready() flips true and /health starts reporting up — this
    # is what makes /health a meaningful readiness signal, not a liveness ping.
    # With COLPALI_ENABLED unset/false the weights are never downloaded or resident at
    # all — that is where the ~6GB of RSS and the multi-GB first-boot download go, not
    # just the per-page latency. /health reports up immediately in that mode (see
    # routes.py), so Compose's service_healthy condition is satisfied without waiting out
    # a start_period sized for a model that is not being loaded.
    if colpali.enabled():
        asyncio.create_task(_load_model_in_background())
    else:
        logger.info(
            "[vision] COLPALI_ENABLED is false — serving OCR only. "
            "Pages are still rendered, OCR'd and indexed as text; visual (ColPali) "
            "retrieval is off. Set COLPALI_ENABLED=true on a GPU host to restore it."
        )
    yield


app = FastAPI(title="Cerebro Vision Service", lifespan=lifespan)
app.include_router(router)
