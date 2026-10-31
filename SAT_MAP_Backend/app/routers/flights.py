"""
LTmap — Flights Router (Disabled)
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api", tags=["flights"])


@router.get("/flights")
async def get_flights():
    """Flights module is disabled."""
    return JSONResponse(content={"status": "disabled", "military_flights": []}, status_code=200)
