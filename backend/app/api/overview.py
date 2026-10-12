"""驾驶舱总览 API：跨项目统计。"""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.project import Project
from app.models.stage3 import Issue, Risk
from app.models.task import Task

router = APIRouter(prefix="/api", tags=["overview"])


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    projects = list(
        db.scalars(
            select(Project).where(Project.deleted_at.is_(None), Project.archived_at.is_(None))
        ).all()
    )
    project_ids = [p.id for p in projects]

    tasks_q = select(Task).where(Task.project_id.in_(project_ids), Task.deleted_at.is_(None))
    tasks = list(db.scalars(tasks_q))

    risks_open = list(
        db.scalars(
            select(Risk).where(
                Risk.project_id.in_(project_ids),
                Risk.archived_at.is_(None),
                Risk.status.notin_(["已关闭", "已转问题", "已转任务"]),
            )
        ).all()
    ) if project_ids else []
    issues_open = list(
        db.scalars(
            select(Issue).where(Issue.project_id.in_(project_ids), Issue.status != "已关闭")
        ).all()
    ) if project_ids else []

    def progress_of(pid):
        pt = [t for t in tasks if t.project_id == pid]
        if not pt:
            return 0
        done = sum(1 for t in pt if t.status == "已完成")
        return round(done / len(pt) * 100)

    project_rows = [
        {
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "status": p.status,
            "plan_start": p.plan_start.isoformat() if p.plan_start else None,
            "plan_end": p.plan_end.isoformat() if p.plan_end else None,
            "task_total": sum(1 for t in tasks if t.project_id == p.id),
            "task_done": sum(1 for t in tasks if t.project_id == p.id and t.status == "已完成"),
            "progress": progress_of(p.id),
            "risk_open": sum(1 for r in risks_open if r.project_id == p.id),
            "issue_open": sum(1 for i in issues_open if i.project_id == p.id),
            "high_risk": sum(
                1 for r in risks_open if r.project_id == p.id and r.level == "高"
            ),
        }
        for p in projects
    ]

    return {
        "totals": {
            "projects": len(projects),
            "tasks": len(tasks),
            "tasks_done": sum(1 for t in tasks if t.status == "已完成"),
            "tasks_doing": sum(1 for t in tasks if t.status == "进行中"),
            "risks_open": len(risks_open),
            "high_risks": sum(1 for r in risks_open if r.level == "高"),
            "issues_open": len(issues_open),
        },
        "projects": sorted(project_rows, key=lambda x: x["progress"], reverse=True),
    }