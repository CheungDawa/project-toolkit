"""里程碑 API（阶段 2 甘特条2：里程碑展示；FR-P0-18）。"""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.task import Milestone
from app.schemas.task import MilestoneCreate, MilestoneRead, MilestoneUpdate

router = APIRouter(prefix="/api", tags=["milestones"])


@router.get("/projects/{project_id}/milestones", response_model=list[MilestoneRead])
def list_milestones(project_id: UUID, db: Session = Depends(get_db)) -> list:
    return list(
        db.scalars(
            select(Milestone).where(Milestone.project_id == project_id).order_by(Milestone.plan_date)
        ).all()
    )


@router.post("/projects/{project_id}/milestones", status_code=201, response_model=MilestoneRead)
def create_milestone(project_id: UUID, payload: MilestoneCreate, db: Session = Depends(get_db)) -> Milestone:
    milestone = Milestone(project_id=project_id, **payload.model_dump())
    db.add(milestone)
    db.commit()
    db.refresh(milestone)
    return milestone


@router.patch("/milestones/{milestone_id}", response_model=MilestoneRead)
def update_milestone(milestone_id: UUID, payload: MilestoneUpdate, db: Session = Depends(get_db)) -> Milestone:
    milestone = _get_or_404(db, milestone_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(milestone, key, value)
    db.commit()
    db.refresh(milestone)
    return milestone


@router.delete("/milestones/{milestone_id}", status_code=204)
def delete_milestone(milestone_id: UUID, db: Session = Depends(get_db)) -> None:
    milestone = _get_or_404(db, milestone_id)
    db.delete(milestone)
    db.commit()


def _get_or_404(db: Session, milestone_id: UUID) -> Milestone:
    milestone = db.scalar(select(Milestone).where(Milestone.id == milestone_id))
    if milestone is None:
        raise AppError(404, "not_found", "里程碑不存在")
    return milestone