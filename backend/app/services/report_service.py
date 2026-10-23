"""统一报告引擎（前置：统一进度口径服务）。

设计要点（来自架构/产品决策）：
- 所有报告数字走 `get_project_progress()` 单一口径，保证报告内部自洽；
- 周期窗口：daily=给定日(默认今天)、weekly=自然周(周一~周日，含今天所在周)、
  monthly=自然月(含今天所在月)；start/end 同时给出则以其为准；
- 各 section 过滤规则：tasks/milestones/deliverables 按周期窗过滤；
  open_risks/open_issues 取「未关闭」全量（与驾驶舱一致口径），不做周期过滤；
  overview_todos 直接复用 `app.api.overview.overview_todos`（跨项目待办聚合）；
  kpi 为项目级统一口径（非周期）。
- 时间一律走 `today_local()`（Asia/Shanghai），不使用 UTC。
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import LOCAL_TZ, now_local, today_local
from app.models.project import Project
from app.models.stage3 import Issue, Risk
from app.models.stage5 import Deliverable
from app.models.task import Milestone, Task
from app.services import progress as progress_service
from app.services import wbs as wbs_service

# 风险关闭口径（与 overview.py 保持一致：已关闭/已转问题/已转任务 视为非开放）
_RISK_CLOSED = ["已关闭", "已转问题", "已转任务"]
_ISSUE_CLOSED = "已关闭"
_TASK_DONE = "已完成"


# ---------- 统一进度口径（报告引擎前置，所有 KPI 唯一来源） ----------


def get_project_progress(db: Session, project_id: UUID) -> dict:
    """项目级统一进度口径（驾驶舱 / 快照 / 报告共用，保证自洽）。

    返回字段：
    - total: 任务总数（全部任务，含父任务）
    - done: 已完成数（status == 已完成）
    - doing: 进行中/未逾期数（total - done - overdue，含未开始与进行中）
    - overdue: 逾期数（status != 已完成 且 plan_end < 今天，Asia/Shanghai）
    - progress_pct: 整体进度百分比（project_metrics 口径，与 WBS 根任务一致；
      该值为叶子工时加权，可能与 done/total 的比例不同，属正常——与驾驶舱同源）
    - risk_open: 未关闭风险数（不过滤 level）
    - high_risk: 高风险数（level == 高）
    - issue_open: 未关闭问题数（status != 已关闭）

    自洽性：total == done + doing + overdue（四个计数来自同一份任务清单）。
    """
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    metrics = progress_service.project_metrics(tasks)
    today = today_local()

    done = sum(1 for t in tasks if t.status == _TASK_DONE)
    overdue = sum(
        1 for t in tasks
        if t.status != _TASK_DONE and t.plan_end is not None and t.plan_end < today
    )
    total = len(tasks)
    doing = total - done - overdue

    risks_open = list(
        db.scalars(
            select(Risk).where(
                Risk.project_id == project_id,
                Risk.archived_at.is_(None),
                Risk.status.notin_(_RISK_CLOSED),
            )
        ).all()
    )
    issues_open = list(
        db.scalars(
            select(Issue).where(Issue.project_id == project_id, Issue.status != _ISSUE_CLOSED)
        ).all()
    )

    return {
        "total": total,
        "done": done,
        "doing": doing,
        "overdue": overdue,
        "progress_pct": metrics["progress"],
        "risk_open": len(risks_open),
        "high_risk": sum(1 for r in risks_open if r.level == "高"),
        "issue_open": len(issues_open),
    }


# ---------- 周期窗口 ----------


def _resolve_window(
    period_type: str, start: date | None, end: date | None
) -> tuple[date, date]:
    """解析报告周期窗口（自然日/周/月）。start/end 同时给出则以其为准。"""
    today = today_local()
    if start is not None and end is not None:
        return start, end
    if period_type == "weekly":
        monday = today - timedelta(days=today.weekday())
        return monday, monday + timedelta(days=6)
    if period_type == "monthly":
        first = today.replace(day=1)
        if first.month == 12:
            nxt = first.replace(year=first.year + 1, month=1)
        else:
            nxt = first.replace(month=first.month + 1)
        return first, nxt - timedelta(days=1)
    # daily（默认）
    return today, today


def _in_window(value: date | None, start: date, end: date) -> bool:
    return value is not None and start <= value <= end


def _overlaps_window(s: date | None, e: date | None, win_start: date, win_end: date) -> bool:
    """判定工期区间与周期窗口是否有交集（覆盖跨周/跨月进行中的长任务）。"""
    if s is None and e is None:
        return False
    start_d = s or e
    end_d = e or s
    return start_d <= win_end and end_d >= win_start


# ---------- 结构化报告组装 ----------


def build_report(
    db: Session,
    project_id: UUID,
    period_type: str = "daily",
    start: date | None = None,
    end: date | None = None,
    include_overview: bool = False,
) -> dict:
    """组装结构化报告（统一口径，供 JSON 与 Word 导出共用）。

    返回顶层结构（前端据此渲染）：
    {
      project_id, period_type, start, end, generated_at, text,
      tasks[], milestones[], open_risks[], open_issues[],
      deliverables[], overview_todos{}, kpi{}
    }
    """
    if period_type not in ("daily", "weekly", "monthly"):
        from app.core.errors import AppError

        raise AppError(422, "invalid_period", "period_type 仅支持 daily/weekly/monthly")

    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        from app.core.errors import AppError

        raise AppError(404, "not_found", "项目不存在")

    win_start, win_end = _resolve_window(period_type, start, end)

    tasks = wbs_service.list_tasks_ordered(db, project_id)
    milestones = list(db.scalars(select(Milestone).where(Milestone.project_id == project_id)).all())
    risks_open = list(
        db.scalars(
            select(Risk).where(
                Risk.project_id == project_id,
                Risk.archived_at.is_(None),
                Risk.status.notin_(_RISK_CLOSED),
            )
        ).all()
    )
    issues_open = list(
        db.scalars(
            select(Issue).where(Issue.project_id == project_id, Issue.status != _ISSUE_CLOSED)
        ).all()
    )
    deliverables = list(
        db.scalars(select(Deliverable).where(Deliverable.project_id == project_id)).all()
    )

    today = today_local()
    task_rows = [
        {
            "id": str(t.id),
            "wbs_code": t.wbs_code,
            "name": t.name,
            "status": t.status,
            "owner": t.owner,
            "plan_start": t.plan_start.isoformat() if t.plan_start else None,
            "plan_end": t.plan_end.isoformat() if t.plan_end else None,
            "progress": float(t.progress or 0),
            "is_overdue": bool(
                t.status != _TASK_DONE and t.plan_end is not None and t.plan_end < today
            ),
        }
        for t in tasks
        if _overlaps_window(t.plan_start, t.plan_end, win_start, win_end)
        or (t.status != _TASK_DONE and t.plan_end is not None and t.plan_end < today)
    ]

    milestone_rows = [
        {
            "id": str(m.id),
            "name": m.name,
            "plan_date": m.plan_date.isoformat() if m.plan_date else None,
            "actual_date": m.actual_date.isoformat() if m.actual_date else None,
            "status": m.status,
            "is_overdue": bool(
                m.status != "已达成" and m.plan_date is not None and m.plan_date < today
            ),
        }
        for m in milestones
        if _in_window(m.plan_date, win_start, win_end)
        or (m.status != "已达成" and m.plan_date is not None and m.plan_date < today)
    ]

    open_risk_rows = [
        {
            "id": str(r.id),
            "name": r.description,
            "level": r.level,
            "owner": r.owner,
            "status": r.status,
        }
        for r in risks_open
    ]

    open_issue_rows = [
        {
            "id": str(i.id),
            "name": i.title,
            "severity": i.severity,
            "status": i.status,
            "owner": i.owner,
        }
        for i in issues_open
    ]

    deliverable_rows = [
        {
            "id": str(d.id),
            "name": d.name,
            "owner": d.owner or "",
            "submit_status": d.submit_status,
            "review_status": d.review_status,
        }
        for d in deliverables
        if _in_window(d.plan_date, win_start, win_end)
    ]

    # overview_todos 仅在 include_overview=True 时聚合（按需查询，避免单项目报告扫描全库）
    if include_overview:
        from app.api.overview import overview_todos

        todos = overview_todos(db=db)
    else:
        todos = {"milestones": [], "tasks": [], "deliverables": []}

    return {
        "project_id": str(project_id),
        "period_type": period_type,
        "start": win_start.isoformat(),
        "end": win_end.isoformat(),
        "generated_at": now_local().astimezone(LOCAL_TZ).isoformat(timespec="seconds"),
        # 可编辑叙述占位：前端可填充后随 export 合并（本轮不强制回写）
        "text": "",
        "tasks": task_rows,
        "milestones": milestone_rows,
        "open_risks": open_risk_rows,
        "open_issues": open_issue_rows,
        "deliverables": deliverable_rows,
        "overview_todos": todos,
        "kpi": get_project_progress(db, project_id),
    }
