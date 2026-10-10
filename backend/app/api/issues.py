"""问题台账 API（FR-P0-15：关闭必填解决结果）。"""
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.stage3 import Issue
from app.schemas.stage3 import IssueClose, IssueCreate, IssueRead, IssueUpdate
from app.services import audit

router = APIRouter(prefix="/api", tags=["issues"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_issue(db: Session, issue_id: UUID, project_id: UUID | None = None) -> Issue:
    stmt = select(Issue).where(Issue.id == issue_id)
    if project_id is not None:
        stmt = stmt.where(Issue.project_id == project_id)
    issue = db.scalar(stmt)
    if issue is None:
        raise AppError(404, "not_found", "问题不存在")
    return issue


@router.get("/projects/{project_id}/issues", response_model=list[IssueRead])
def list_issues(
    project_id: UUID,
    q: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    overdue: bool = False,
    db: Session = Depends(get_db),
) -> list:
    stmt = select(Issue).where(Issue.project_id == project_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Issue.title.ilike(like) | Issue.detail.ilike(like))
    if status:
        stmt = stmt.where(Issue.status == status)
    if severity:
        stmt = stmt.where(Issue.severity == severity)
    if overdue:
        stmt = stmt.where(Issue.due_date.is_not(None), Issue.due_date < _utcnow().date(), Issue.status != "已关闭")
    return list(db.scalars(stmt.order_by(Issue.created_at)).all())


@router.post("/projects/{project_id}/issues", status_code=201, response_model=IssueRead)
def create_issue(project_id: UUID, payload: IssueCreate, db: Session = Depends(get_db)) -> Issue:
    issue = Issue(project_id=project_id, **payload.model_dump())
    db.add(issue)
    db.flush()
    audit.record(db, project_id, "issue", issue.id, "create", f"创建问题：{issue.title}")
    db.commit()
    db.refresh(issue)
    return issue


@router.patch("/issues/{issue_id}", response_model=IssueRead)
def update_issue(issue_id: UUID, payload: IssueUpdate, db: Session = Depends(get_db)) -> Issue:
    issue = _get_issue(db, issue_id)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(issue, key, value)
    db.flush()
    audit.record(db, issue.project_id, "issue", issue.id, "update", f"更新问题：{issue.title}")
    db.commit()
    db.refresh(issue)
    return issue


@router.post("/issues/{issue_id}/close", response_model=IssueRead)
def close_issue(issue_id: UUID, payload: IssueClose, db: Session = Depends(get_db)) -> Issue:
    """关闭问题：closure_result 必填（A3-5），记录验证时间/人，关闭后不允许改根因与处理措施。"""
    issue = _get_issue(db, issue_id)
    if issue.status == "已关闭":
        raise AppError(422, "already_closed", "问题已关闭")
    if not payload.closure_result.strip():
        raise AppError(
            422, "closure_required", "关闭问题必须填写解决结果",
            fields={"closure_result": ["关闭问题必须填写解决结果"]},
        )
    issue.status = "已关闭"
    issue.closure_result = payload.closure_result
    issue.verified_at = payload.verified_at or _utcnow()
    issue.verified_by = payload.verified_by
    db.flush()
    audit.record(db, issue.project_id, "issue", issue.id, "close", f"关闭问题：{issue.title}")
    db.commit()
    db.refresh(issue)
    return issue


@router.delete("/issues/{issue_id}", status_code=204)
def delete_issue(issue_id: UUID, db: Session = Depends(get_db)) -> None:
    issue = _get_issue(db, issue_id)
    db.delete(issue)
    db.flush()
    audit.record(db, issue.project_id, "issue", issue.id, "delete", f"删除问题：{issue.title}")
    db.commit()