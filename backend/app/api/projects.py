"""项目档案 API（阶段 1 提示词条 5-7：CRUD、归档、删除、搜索/筛选/排序/分页）。

业务校验规则（与阶段 1 验收对应）：
- 编号重复 → 422 "项目编号已存在"（A1-5）
- 日期倒置（结束早于开始）→ 422 字段级错误（A1-5）
- 删除为软删除（deleted_at 置位；编号不释放，见 04 文档设计原则）
"""
from datetime import date, datetime, timezone
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectPage, ProjectRead, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])

SORT_FIELDS = {"code", "name", "plan_start", "created_at", "updated_at"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _validate_date_pairs(
    plan_start: date | None,
    plan_end: date | None,
    actual_start: date | None,
    actual_end: date | None,
) -> None:
    fields: dict[str, list[str]] = {}
    if plan_start and plan_end and plan_end < plan_start:
        fields["plan_end"] = ["计划结束日期不能早于计划开始日期"]
    if actual_start and actual_end and actual_end < actual_start:
        fields["actual_end"] = ["实际结束日期不能早于实际开始日期"]
    if fields:
        raise AppError(422, "date_invalid", "日期范围不合法", fields=fields)


def _ensure_code_available(db: Session, code: str) -> None:
    exists = db.scalar(select(Project.id).where(Project.code == code).limit(1))
    if exists:
        raise AppError(422, "code_exists", "项目编号已存在", fields={"code": ["项目编号已存在"]})


def _code_taken_error() -> AppError:
    return AppError(422, "code_exists", "项目编号已存在", fields={"code": ["项目编号已存在"]})


def _get_or_404(db: Session, project_id: UUID) -> Project:
    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    )
    if project is None:
        raise AppError(404, "not_found", "项目不存在")
    return project


@router.post("", status_code=201, response_model=ProjectRead)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> Any:
    _validate_date_pairs(
        payload.plan_start, payload.plan_end, payload.actual_start, payload.actual_end
    )
    _ensure_code_available(db, payload.code)
    project = Project(**payload.model_dump())
    db.add(project)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _code_taken_error() from None
    db.refresh(project)
    return project


@router.get("", response_model=ProjectPage)
def list_projects(
    q: str | None = None,
    status: str | None = None,
    phase: str | None = None,
    archived: Literal["exclude", "include", "only"] = "exclude",
    sort: str = "-created_at",
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> Any:
    if sort.lstrip("-") not in SORT_FIELDS:
        raise AppError(
            422, "invalid_sort", "不支持的排序字段", fields={"sort": [f"仅支持 {sorted(SORT_FIELDS)}"]}
        )

    stmt = select(Project).where(Project.deleted_at.is_(None))
    if archived == "exclude":
        stmt = stmt.where(Project.archived_at.is_(None))
    elif archived == "only":
        stmt = stmt.where(Project.archived_at.is_not(None))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(Project.code.ilike(like), Project.name.ilike(like), Project.customer.ilike(like))
        )
    if status:
        stmt = stmt.where(Project.status == status)
    if phase:
        stmt = stmt.where(Project.phase == phase)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    column = getattr(Project, sort.lstrip("-"))
    stmt = stmt.order_by(column.desc() if sort.startswith("-") else column.asc())
    stmt = stmt.offset((page - 1) * size).limit(size)
    items = list(db.scalars(stmt).all())
    return {"items": items, "total": total, "page": page, "size": size}


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: UUID, db: Session = Depends(get_db)) -> Any:
    return _get_or_404(db, project_id)


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(project_id: UUID, payload: ProjectUpdate, db: Session = Depends(get_db)) -> Any:
    project = _get_or_404(db, project_id)
    data = payload.model_dump(exclude_unset=True)
    if "code" in data and data["code"] != project.code:
        _ensure_code_available(db, data["code"])
    _validate_date_pairs(
        data.get("plan_start", project.plan_start),
        data.get("plan_end", project.plan_end),
        data.get("actual_start", project.actual_start),
        data.get("actual_end", project.actual_end),
    )
    for key, value in data.items():
        setattr(project, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _code_taken_error() from None
    db.refresh(project)
    return project


@router.post("/{project_id}/archive", response_model=ProjectRead)
def archive_project(project_id: UUID, db: Session = Depends(get_db)) -> Any:
    project = _get_or_404(db, project_id)
    project.archived_at = project.archived_at or _utcnow()
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: UUID, db: Session = Depends(get_db)) -> Response:
    project = _get_or_404(db, project_id)
    project.deleted_at = _utcnow()
    db.commit()
    return Response(status_code=204)
