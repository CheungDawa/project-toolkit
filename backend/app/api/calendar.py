"""工作日历 API（TD-01：供甘特渲染 weekends/holidays）。"""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.services import calendar as calendar_service

router = APIRouter(prefix="/api", tags=["calendar"])


@router.get("/projects/{project_id}/calendar")
def get_calendar(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    return calendar_service.calendar_payload(
        calendar_service.load_calendar(db, project_id)
    )