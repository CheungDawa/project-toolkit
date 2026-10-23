"""统一数据导出接口（tasks/deliverables/risks/issues/milestones/overview）。

GET /api/exports/data?resource=&project_id=&format=
- resource: tasks | deliverables | risks | issues | milestones | overview
- project_id: 除 overview 外必填（overview 为跨项目汇总，忽略该参数）
- format: csv | xlsx | json

列定义（字段名 + 中文表头）参考现有 tasks.py:export_tasks / deliverables.py:export_deliverables，
统一搬到这里实现；旧的各资源独立导出接口保留不动（向后兼容）。
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.export.csv_json import to_csv_bytes, to_json_bytes
from app.export.excel import build_workbook
from app.models.project import Project
from app.models.retro import Retrospective, RetroActionItem
from app.models.stage3 import Issue, Risk
from app.models.stage5 import Deliverable
from app.models.task import Milestone, Task

router = APIRouter(prefix="/api", tags=["exports"])

_RESOURCES = {"tasks", "deliverables", "risks", "issues", "milestones", "overview", "retrospectives"}
_FORMATS = {"csv", "xlsx", "json"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# 各资源的列定义：key=模型字段，header=中文表头
_COLUMN_DEFS: dict[str, list[dict]] = {
    "tasks": [
        {"key": "wbs_code", "header": "WBS编码"},
        {"key": "name", "header": "任务名称"},
        {"key": "owner", "header": "负责人"},
        {"key": "status", "header": "状态"},
        {"key": "priority", "header": "优先级"},
        {"key": "plan_start", "header": "计划开始"},
        {"key": "plan_end", "header": "计划结束"},
        {"key": "work_hours", "header": "工时"},
        {"key": "progress", "header": "进度"},
        {"key": "acceptance_criteria", "header": "验收标准"},
    ],
    "deliverables": [
        {"key": "category", "header": "类别"},
        {"key": "name", "header": "交付物名称"},
        {"key": "owner", "header": "负责人"},
        {"key": "plan_date", "header": "计划日期"},
        {"key": "submit_status", "header": "提交状态"},
        {"key": "review_status", "header": "审核状态"},
        {"key": "note", "header": "备注"},
    ],
    "risks": [
        {"key": "id", "header": "ID"},
        {"key": "description", "header": "风险描述"},
        {"key": "category", "header": "类别"},
        {"key": "level", "header": "等级"},
        {"key": "owner", "header": "负责人"},
        {"key": "status", "header": "状态"},
        {"key": "score", "header": "评分"},
        {"key": "probability", "header": "概率"},
        {"key": "impact", "header": "影响"},
    ],
    "issues": [
        {"key": "id", "header": "ID"},
        {"key": "title", "header": "问题标题"},
        {"key": "detail", "header": "详情"},
        {"key": "severity", "header": "严重度"},
        {"key": "owner", "header": "负责人"},
        {"key": "due_date", "header": "截止日期"},
        {"key": "status", "header": "状态"},
    ],
    "milestones": [
        {"key": "id", "header": "ID"},
        {"key": "name", "header": "里程碑名称"},
        {"key": "plan_date", "header": "计划日期"},
        {"key": "actual_date", "header": "实际日期"},
        {"key": "status", "header": "状态"},
        {"key": "description", "header": "描述"},
    ],
    "retrospectives": [
        {"key": "retro_title", "header": "复盘标题"},
        {"key": "scope", "header": "复盘范围"},
        {"key": "occurred_on", "header": "发生日期"},
        {"key": "category", "header": "类别"},
        {"key": "content", "header": "内容"},
        {"key": "priority", "header": "优先级"},
        {"key": "owner", "header": "负责人"},
        {"key": "due_date", "header": "截止日期"},
        {"key": "status", "header": "状态"},
        {"key": "converted", "header": "是否已转化"},
        {"key": "link_type", "header": "转化类型"},
    ],
    "overview": [
        {"key": "id", "header": "项目ID"},
        {"key": "code", "header": "项目编号"},
        {"key": "name", "header": "项目名称"},
        {"key": "status", "header": "状态"},
        {"key": "plan_start", "header": "计划开始"},
        {"key": "plan_end", "header": "计划结束"},
        {"key": "task_total", "header": "任务总数"},
        {"key": "task_done", "header": "已完成"},
        {"key": "progress", "header": "进度%"},
        {"key": "risk_open", "header": "开放风险"},
        {"key": "high_risk", "header": "高风险"},
        {"key": "issue_open", "header": "未关闭问题"},
        {"key": "overdue_tasks", "header": "逾期任务"},
    ],
}


def _fmt_date(value) -> str | None:
    return value.isoformat() if isinstance(value, date) else None


def _build_rows(resource: str, db: Session, project_id: UUID | None) -> list[dict]:
    """按 resource 直查模型并映射为行（日期/UUID 已转字符串）。"""
    if resource == "tasks":
        tasks = db.scalars(
            select(Task).where(Task.project_id == project_id, Task.deleted_at.is_(None))
        ).all()
        return [
            {
                "wbs_code": t.wbs_code,
                "name": t.name,
                "owner": t.owner or "",
                "status": t.status or "",
                "priority": t.priority or "",
                "plan_start": _fmt_date(t.plan_start),
                "plan_end": _fmt_date(t.plan_end),
                "work_hours": float(t.work_hours) if t.work_hours is not None else "",
                "progress": float(t.progress or 0),
                "acceptance_criteria": t.acceptance_criteria or "",
            }
            for t in tasks
        ]
    if resource == "deliverables":
        items = db.scalars(select(Deliverable).where(Deliverable.project_id == project_id)).all()
        return [
            {
                "category": d.category or "",
                "name": d.name,
                "owner": d.owner or "",
                "plan_date": _fmt_date(d.plan_date),
                "submit_status": d.submit_status,
                "review_status": d.review_status,
                "note": d.note or "",
            }
            for d in items
        ]
    if resource == "risks":
        risks = db.scalars(
            select(Risk).where(Risk.project_id == project_id, Risk.archived_at.is_(None))
        ).all()
        return [
            {
                "id": str(r.id),
                "description": r.description,
                "category": r.category or "",
                "level": r.level or "",
                "owner": r.owner or "",
                "status": r.status,
                "score": r.score,
                "probability": r.probability,
                "impact": r.impact,
            }
            for r in risks
        ]
    if resource == "issues":
        issues = db.scalars(select(Issue).where(Issue.project_id == project_id)).all()
        return [
            {
                "id": str(i.id),
                "title": i.title,
                "detail": i.detail or "",
                "severity": i.severity or "",
                "owner": i.owner or "",
                "due_date": _fmt_date(i.due_date),
                "status": i.status,
            }
            for i in issues
        ]
    if resource == "milestones":
        mss = db.scalars(select(Milestone).where(Milestone.project_id == project_id)).all()
        return [
            {
                "id": str(m.id),
                "name": m.name,
                "plan_date": _fmt_date(m.plan_date),
                "actual_date": _fmt_date(m.actual_date),
                "status": m.status or "",
                "description": m.description or "",
            }
            for m in mss
        ]
    if resource == "retrospectives":
        items = list(
            db.scalars(
                select(RetroActionItem)
                .where(RetroActionItem.project_id == project_id)
                .order_by(RetroActionItem.created_at)
            ).all()
        )
        retros = {
            r.id: r
            for r in db.scalars(
                select(Retrospective).where(Retrospective.project_id == project_id)
            ).all()
        }
        scope_map = {"phase": "阶段", "milestone": "里程碑", "sprint": "迭代", "whole": "项目整体"}
        cat_map = {"good": "做得好", "improve": "待改进", "action": "行动项"}
        status_map = {"open": "待办", "in_progress": "进行中", "done": "已完成", "closed": "已关闭"}
        return [
            {
                "retro_title": retros[i.retro_id].title if i.retro_id in retros else "",
                "scope": scope_map.get(retros[i.retro_id].scope, "") if i.retro_id in retros else "",
                "occurred_on": _fmt_date(retros[i.retro_id].occurred_on) if i.retro_id in retros else "",
                "category": cat_map.get(i.category, i.category),
                "content": i.content,
                "priority": i.priority or "",
                "owner": i.owner or "",
                "due_date": _fmt_date(i.due_date),
                "status": status_map.get(i.status, i.status),
                "converted": "是" if i.converted else "否",
                "link_type": i.link_type or "",
            }
            for i in items
        ]
    # overview：跨项目汇总（复用 /api/overview 的数据结构）
    from app.api.overview import overview

    data = overview(db=db)
    totals = data["totals"]
    rows = [
        {
            "id": "",
            "code": "",
            "name": "（汇总）",
            "status": "",
            "plan_start": "",
            "plan_end": "",
            "task_total": totals["tasks"],
            "task_done": totals["tasks_done"],
            "progress": "",
            "risk_open": totals["risks_open"],
            "high_risk": totals["high_risks"],
            "issue_open": totals["issues_open"],
            "overdue_tasks": "",
        }
    ]
    for p in data["projects"]:
        rows.append(
            {
                "id": p["id"],
                "code": p["code"],
                "name": p["name"],
                "status": p.get("status") or "",
                "plan_start": p.get("plan_start") or "",
                "plan_end": p.get("plan_end") or "",
                "task_total": p["task_total"],
                "task_done": p["task_done"],
                "progress": p["progress"],
                "risk_open": p["risk_open"],
                "high_risk": p["high_risk"],
                "issue_open": p["issue_open"],
                "overdue_tasks": p.get("overdue_tasks", 0),
            }
        )
    return rows


@router.get("/exports/data")
def export_data(
    resource: str = Query(..., description="tasks|deliverables|risks|issues|milestones|overview"),
    project_id: UUID | None = Query(None, description="除 overview 外必填"),
    format: str = Query("csv", description="csv|xlsx|json"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    if resource not in _RESOURCES:
        raise AppError(422, "invalid_resource", f"resource 仅支持：{sorted(_RESOURCES)}")
    if format not in _FORMATS:
        raise AppError(422, "invalid_format", f"format 仅支持：{sorted(_FORMATS)}")

    if resource != "overview":
        if project_id is None:
            raise AppError(422, "missing_project_id", f"resource={resource} 需要 project_id")
        project = db.scalar(select(Project).where(Project.id == project_id))
        if project is None:
            raise AppError(404, "not_found", "项目不存在")

    rows = _build_rows(resource, db, project_id)
    columns = _COLUMN_DEFS[resource]
    today = _utcnow().date().isoformat()
    filename_base = f"{resource}_{today}"

    if format == "xlsx":
        buf = build_workbook(rows, columns)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.xlsx"'},
        )
    if format == "csv":
        content = to_csv_bytes(rows, columns)
        return StreamingResponse(
            iter([content.encode("utf-8")]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename_base + '.csv')}"},
        )
    # json
    content = to_json_bytes(rows)
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename_base + '.json')}"},
    )
