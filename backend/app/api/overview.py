"""驾驶舱总览 API：跨项目统计 + 管理预警（任务书一：服务管理决策）。

预警口径（全部来自真实数据，不推断、不编造）：
- 异常项目     plan_end 已过且未完成的任务（overdue_tasks）
- 逾期里程碑   plan_date < 今天 且 actual_date 为空
- 高优风险     开放风险（未决/已发生）中 level=高，按 score 降序
- 待验收交付物 已提交待审核；以及 plan_date 已过仍未提交
- 需协调事项   开放问题（待处理/处理中）中：严重度=高 或 已逾期；责任人为空的标注
排序：danger 优先于 warning，同级按逾期天数降序。
"""
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.project import Project
from app.models.stage3 import Issue, Risk
from app.models.stage5 import Deliverable
from app.models.task import Milestone, Task

router = APIRouter(prefix="/api", tags=["overview"])

_RISK_CLOSED = ["已关闭", "已转问题", "已转任务"]
_ISSUE_CLOSED = "已关闭"


def _days_over(target: date | None, today: date) -> int:
    if target is None:
        return 0
    return (today - target).days


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    today = date.today()
    projects = list(
        db.scalars(
            select(Project).where(Project.deleted_at.is_(None), Project.archived_at.is_(None))
        ).all()
    )
    project_ids = [p.id for p in projects]
    proj_by_id = {p.id: p for p in projects}

    tasks = (
        list(db.scalars(select(Task).where(Task.project_id.in_(project_ids), Task.deleted_at.is_(None))))
        if project_ids
        else []
    )
    risks_open = (
        list(
            db.scalars(
                select(Risk).where(
                    Risk.project_id.in_(project_ids),
                    Risk.archived_at.is_(None),
                    Risk.status.notin_(_RISK_CLOSED),
                )
            ).all()
        )
        if project_ids
        else []
    )
    issues_open = (
        list(
            db.scalars(
                select(Issue).where(Issue.project_id.in_(project_ids), Issue.status != _ISSUE_CLOSED)
            ).all()
        )
        if project_ids
        else []
    )
    milestones = (
        list(db.scalars(select(Milestone).where(Milestone.project_id.in_(project_ids))))
        if project_ids
        else []
    )
    deliverables = (
        list(db.scalars(select(Deliverable).where(Deliverable.project_id.in_(project_ids))))
        if project_ids
        else []
    )

    def progress_of(pid):
        pt = [t for t in tasks if t.project_id == pid]
        if not pt:
            return 0
        done = sum(1 for t in pt if t.status == "已完成")
        return round(done / len(pt) * 100)

    def overdue_tasks_of(pid):
        return [
            t
            for t in tasks
            if t.project_id == pid
            and t.status != "已完成"
            and t.plan_end is not None
            and t.plan_end < today
        ]

    def overdue_milestones_of(pid):
        return [
            m
            for m in milestones
            if m.project_id == pid and m.plan_date is not None and m.plan_date < today and m.actual_date is None
        ]

    def proj_label(pid) -> str:
        p = proj_by_id.get(pid)
        return f"{p.code} {p.name}" if p else "未知项目"

    # ---------- 项目行（现有字段 + 异常标记） ----------
    project_rows = []
    for p in projects:
        od_tasks = overdue_tasks_of(p.id)
        od_miles = overdue_milestones_of(p.id)
        high_risk_cnt = sum(1 for r in risks_open if r.project_id == p.id and r.level == "高")
        project_rows.append(
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
                "high_risk": high_risk_cnt,
                "overdue_tasks": len(od_tasks),
                "overdue_milestones": len(od_miles),
            }
        )

    # ---------- 管理预警（五类，统一结构 kind/severity/days） ----------
    alerts: list[dict] = []

    def add(
        kind: str,
        severity: str,
        days: int,
        project_id,
        title: str,
        detail: str,
        **extra,
    ) -> None:
        alert = {
            "kind": kind,
            "severity": severity,  # danger=红 / warning=黄
            "days": days,
            "project_id": str(project_id),
            "project_label": proj_label(project_id),
            "title": title,
            "detail": detail,
        }
        alert.update(extra)
        alerts.append(alert)

    # 1) 异常项目：逾期任务最多的项目汇总为一条（含严重度）
    by_pid_overdue: dict = {}
    for t in tasks:
        if t.status != "已完成" and t.plan_end is not None and t.plan_end < today:
            by_pid_overdue.setdefault(t.project_id, []).append(t)
    for pid, od in by_pid_overdue.items():
        worst = max(od, key=lambda t: _days_over(t.plan_end, today))
        add(
            "project",
            "danger",
            _days_over(worst.plan_end, today),
            pid,
            f"{len(od)} 项任务逾期未完成",
            f"最迟一项「{worst.name}」计划 {worst.plan_end.isoformat()}，已超期 {_days_over(worst.plan_end, today)} 天",
            overdue_count=len(od),
        )

    # 2) 逾期里程碑
    for m in milestones:
        if m.plan_date is not None and m.plan_date < today and m.actual_date is None:
            d = _days_over(m.plan_date, today)
            add(
                "milestone",
                "danger" if d >= 7 else "warning",
                d,
                m.project_id,
                f"里程碑逾期：{m.name}",
                f"计划 {m.plan_date.isoformat()}，已逾期 {d} 天尚未完成",
                milestone_id=str(m.id),
            )

    # 3) 高优风险（level=高，按 score 降序在前端分组呈现，此处不聚合）
    for r in risks_open:
        if r.level == "高":
            add(
                "risk",
                "danger",
                0,
                r.project_id,
                f"高风险（{r.score} 分）：{(r.description or '')[:40]}",
                f"概率 {r.probability} × 影响 {r.impact}，状态「{r.status}」"
                + (f"，责任人 {r.owner}" if r.owner else "，责任人未指定"),
                risk_id=str(r.id),
                score=r.score,
            )

    # 4) 待验收交付物：已提交待审核；逾期未提交
    for dv in deliverables:
        if dv.submit_status == "已提交" and dv.review_status == "待审核":
            d = _days_over(dv.plan_date, today) if dv.plan_date else 0
            add(
                "deliverable",
                "warning" if d < 7 else "danger",
                d,
                dv.project_id,
                f"交付物待审核：{dv.name}",
                "已提交，等待验收结论"
                + (f"（计划 {dv.plan_date.isoformat()}，已滞后 {d} 天）" if d > 0 else ""),
                deliverable_id=str(dv.id),
            )
        elif dv.submit_status == "未提交" and dv.plan_date is not None and dv.plan_date < today:
            d = _days_over(dv.plan_date, today)
            add(
                "deliverable",
                "danger",
                d,
                dv.project_id,
                f"交付物逾期未提交：{dv.name}",
                f"计划 {dv.plan_date.isoformat()}，已超期 {d} 天",
                deliverable_id=str(dv.id),
            )

    # 5) 需协调事项：开放问题中 严重度=高 或 已逾期 或 责任人缺失
    for i in issues_open:
        d = _days_over(i.due_date, today) if i.due_date else 0
        high = (i.severity or "") == "高"
        no_owner = not (i.owner or "").strip()
        if not (high or d > 0 or no_owner):
            continue  # 常规开放问题不进入驾驶舱，避免噪音
        add(
            "coordination",
            "danger" if (high and d > 0) else "warning",
            d,
            i.project_id,
            f"问题需协调：{i.title}",
            f"状态「{i.status}」"
            + ("，严重度高" if high else "")
            + (f"，已逾期 {d} 天" if d > 0 else "")
            + ("，责任人未指定" if no_owner else ""),
            issue_id=str(i.id),
        )

    # 排序：danger > warning；同级按 days 降序、标题稳定序
    sev_rank = {"danger": 0, "warning": 1}
    alerts.sort(key=lambda a: (sev_rank.get(a["severity"], 9), -a["days"], a["title"]))

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
        "alerts": alerts,
        "alert_summary": {
            "danger": sum(1 for a in alerts if a["severity"] == "danger"),
            "warning": sum(1 for a in alerts if a["severity"] == "warning"),
        },
    }
