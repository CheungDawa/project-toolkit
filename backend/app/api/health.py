"""健康检查：GET /api/health（compose healthcheck 依赖）。"""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> object:
    try:
        db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:  # noqa: BLE001
        db_status = "unavailable"
    if db_status != "ok":
        return JSONResponse(status_code=503, content={"status": "degraded", "db": db_status})
    return {"status": "ok", "db": db_status}
