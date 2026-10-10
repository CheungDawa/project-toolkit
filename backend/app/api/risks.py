"""风险台账 API（FR-P0-12~14）：CRUD / 评分引擎 / 评估历史 / 转化 / 筛选。"""
import uuid
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.stage3 import Issue, Risk, RiskAssessment
from app.models.task import Task
from app.schemas.stage3 import (
    RiskAssessmentCreate,
    RiskAssessmentRead,
    RiskConvertRequest,
    RiskCreate,
    RiskRead,
    RiskUpdate,
)
from app.services import audit, risk_score

router = APIRouter(prefix="/api", tags=["risks"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_risk(db: Session, risk_id: UUID, project_id: UUID | None = None) -> Risk:
    stmt = select(Risk).where(Risk.id == risk_id)
    if project_id is not None:
        stmt = stmt.where(Risk.project_id == project_id)
    risk = db.scalar(stmt)
    if risk is None:
        raise AppError(404, "not_found", "风险不存在")
    return risk


def _apply_score(db: Session, risk: Risk) -> None:
    risk.score, risk.level = risk_score.evaluate(db, risk.probability, risk.impact)


@router.get("/projects/{project_id}/risks", response_model=list[RiskRead])
def list_risks(
    project_id: UUID,
    q: str | None = None,
    status: str | None = None,
    level: str | None = None,
    high_only: bool = False,
    db: Session = Depends(get_db),
) -> list:
    stmt = select(Risk).where(Risk.project_id == project_id, Risk.archived_at.is_(None))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Risk.description.ilike(like) | Risk.owner.ilike(like) | Risk.category.ilike(like))
    if status:
        stmt = stmt.where(Risk.status == status)
    if level:
        stmt = stmt.where(Risk.level == level)
    if high_only:
        stmt = stmt.where(Risk.level == "高")
    return list(db.scalars(stmt.order_by(Risk.score.desc(), Risk.created_at)).all())


@router.post("/projects/{project_id}/risks", status_code=201, response_model=RiskRead)
def create_risk(project_id: UUID, payload: RiskCreate, db: Session = Depends(get_db)) -> Risk:
    risk = Risk(project_id=project_id, **payload.model_dump())
    _apply_score(db, risk)
    db.add(risk)
    db.flush()
    audit.record(db, project_id, "risk", risk.id, "create", f"创建风险：{risk.description[:50]}")
    db.commit()
    db.refresh(risk)
    return risk


@router.patch("/risks/{risk_id}", response_model=RiskRead)
def update_risk(risk_id: UUID, payload: RiskUpdate, db: Session = Depends(get_db)) -> Risk:
    risk = _get_risk(db, risk_id)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(risk, key, value)
    if "probability" in data or "impact" in data:
        _apply_score(db, risk)
    db.flush()
    audit.record(db, risk.project_id, "risk", risk.id, "update", f"更新风险：{risk.description[:50]}")
    db.commit()
    db.refresh(risk)
    return risk


@router.delete("/risks/{risk_id}", status_code=204)
def archive_risk(risk_id: UUID, db: Session = Depends(get_db)) -> None:
    risk = _get_risk(db, risk_id)
    risk.archived_at = _utcnow()
    db.flush()
    audit.record(db, risk.project_id, "risk", risk.id, "archive", f"归档风险：{risk.description[:50]}")
    db.commit()


@router.get("/risks/{risk_id}/assessments", response_model=list[RiskAssessmentRead])
def list_assessments(risk_id: UUID, db: Session = Depends(get_db)) -> list:
    _get_risk(db, risk_id)
    return list(
        db.scalars(
            select(RiskAssessment)
            .where(RiskAssessment.risk_id == risk_id)
            .order_by(RiskAssessment.assessed_at)
        ).all()
    )


@router.post("/risks/{risk_id}/assessments", status_code=201, response_model=RiskAssessmentRead)
def add_assessment(risk_id: UUID, payload: RiskAssessmentCreate, db: Session = Depends(get_db)) -> RiskAssessment:
    risk = _get_risk(db, risk_id)
    score, level = risk_score.evaluate(db, payload.probability, payload.impact)
    assessment = RiskAssessment(
        risk_id=risk_id,
        probability=payload.probability,
        impact=payload.impact,
        score=score,
        level=level,
        assessed_at=_utcnow(),
        basis=payload.basis,
    )
    # 同步更新当前风险评分
    risk.probability = payload.probability
    risk.impact = payload.impact
    risk.score, risk.level = score, level
    db.add(assessment)
    db.flush()
    audit.record(
        db, risk.project_id, "risk", risk.id, "assess",
        f"风险评估：概率{payload.probability}×影响{payload.impact}→{level}",
    )
    db.commit()
    db.refresh(assessment)
    return assessment


@router.post("/risks/{risk_id}/convert", response_model=dict)
def convert_risk(risk_id: UUID, payload: RiskConvertRequest, db: Session = Depends(get_db)) -> dict:
    """风险转问题或行动任务（BR-04：原始风险记录保留，仅状态变更）。"""
    risk = _get_risk(db, risk_id)
    if payload.target == "issue":
        issue = Issue(
            project_id=risk.project_id,
            risk_id=risk.id,
            title=f"[风险转化] {risk.description[:100]}",
            detail=risk.description,
            severity="高" if risk.level == "高" else ("中" if risk.level == "中" else "低"),
        )
        db.add(issue)
        db.flush()
        risk.status = "已转问题"
        audit.record(
            db, risk.project_id, "issue", issue.id, "convert_from_risk",
            f"风险转问题（原风险保留）：{risk.description[:50]}",
        )
    else:
        task = Task(
            project_id=risk.project_id,
            wbs_code=str(uuid.uuid4()),  # 占位，recompute 重算
            name=payload.task_name or f"[风险行动] {risk.description[:50]}",
            owner=payload.task_owner,
            status="未开始",
            risk_id=risk.id,
        )
        db.add(task)
        db.flush()
        from app.services import wbs as wbs_service
        wbs_service.recompute_codes(db, risk.project_id)
        risk.status = "已转任务"
        audit.record(
            db, risk.project_id, "task", task.id, "convert_from_risk",
            f"风险转任务：{risk.description[:50]}",
        )
    db.commit()
    return {"ok": True, "risk_status": risk.status}