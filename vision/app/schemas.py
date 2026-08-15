from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str                 # "up" | "down"
    model: str
    device: str
    modelLoaded: bool
    tesseractVersion: str
    uptimeSeconds: float


# Request/response models for /classify and /embed_pages land in Phase 4 —
# see phase 4 §2.3 and §5.3. Both endpoints are 501 stubs until then.
