"""驾驶舱总览 API：跨项目统计 + 管理预警（任务书一：服务管理决策）。

预警口径（全部来自真实数据，不推断、不编造）：
- 异常项目     plan_end 已过且未完成的任务（overdue_tasks）
- 逾期里程碑   plan_date < 今天 且 actual_date 为空
- 高优风险     开放风险（未决/已发生）中 level=高，按 score 降序
- 待验收交付物 已提交待审核；以及 plan_date 已过仍未提交
- 需协调事项   开放问题（待处理/处理中）中：严重度=高 或 已逾期；责任人为空的标注
排序：danger 优先于 warning，同级按逾期天数降序。

性能口径（P1-6）：所有跨项目统计都在进入项目循环**之前**一次性按 project_id 预聚合
（overdue_tasks_by_project / overdue_ms_by_project / risk_cnt_by_project /
high_risk_cnt_by_project / issue_cnt_by_project），项目行循环内只做字典查表，
整体复杂度 O(N + P) 而非 O(P × N)。预聚合是唯一数据源，项目行标记与「异常项目」
预警共用同一份逾期任务桶，避免两处口径漂移。

同文件还提供 GET /api/overview/todos：驾驶舱待办聚合接口，一次返回全部项目的
里程碑（今天起 7 天内）、逾期任务、待审核交付物，替代前端逐项目 3N 次请求；
口径与前端原逐项目拉取后的过滤逻辑完全一致（未删除、未归档项目；任务未删除；
交付物无归档字段故不过滤），按 date 升序，交付物 plan_date 为空的排最后。
"""
from collections import defaultdict
from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.time import today_local
from app.models.project import Project
from app.models.stage3 import Issue, Risk
from app.models.stage5 import Deliverable
from app.models.task import Milestone, Task
from app.services.progress import project_metrics

router = APIRouter(prefix="/api", tags=["overview"])

_RISK_CLOSED = ["已关闭", "已转问题", "已转任务"]
_ISSUE_CLOSED = "已关闭"
_TASK_DONE = "已完成"
_MILESTONE_DONE = "已完成"

# 驾驶舱「即将到期里程碑」窗口：今天起 7 天内（闭区间 [today, today+7]）
_MILESTONE_WINDOW_DAYS = 7


def _days_over(target: date | None, today: date) -> int:
    if target is None:
        return 0
    return (today - target).days


def _sort_by_date(rows: list[dict]) -> list[dict]:
    """按 date（ISO 字符串）升序；date 为 None 的排最后，同日期保持稳定序。

    注意：None **排最后是有意的产品口径**（交付物 plan_date 允许为空，无日期的
    条目视为「不限期待办」，放末尾而不是排最前），不要改成排最前。
    """
    return sorted(rows, key=lambda row: (row["date"] is None, row["date"] or ""))


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    today = today_local()
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

    # 统一口径：进度/工时/计数全部来自 project_metrics（叶子加权，父子不重复计入）
    tasks_by_project: dict[UUID, list[Task]] = defaultdict(list)
    for task in tasks:
        tasks_by_project[task.project_id].append(task)

    # ---------- 一次性预聚合（P1-6：把 O(P×N) 的全表扫描收敛为 O(N) 单遍） ----------
    # 逾期任务：未完成 且 有计划结束日 且 已过计划结束日。
    # 这份桶同时是「项目行 overdue_tasks」与「异常项目预警」的唯一数据源。
    overdue_tasks_by_project: dict[UUID, list[Task]] = defaultdict(list)
    for task in tasks:
        if task.status != _TASK_DONE and task.plan_end is not None and task.plan_end < today:
            overdue_tasks_by_project[task.project_id].append(task)

    # 逾期里程碑：有计划日期 且 已过期 且 尚未实际完成
    # 同时保留一份「按查询顺序」的扁平列表，供预警生成使用 —— 与重构前的遍历顺序
    # 完全一致，确保 alerts 的稳定排序不受分组影响；条件只在下面写一次。
    overdue_ms_flat: list[Milestone] = []
    overdue_ms_by_project: dict[UUID, list[Milestone]] = defaultdict(list)
    for milestone in milestones:
        if (
            milestone.plan_date is not None
            and milestone.plan_date < today
            and milestone.actual_date is None
        ):
            overdue_ms_flat.append(milestone)
            overdue_ms_by_project[milestone.project_id].append(milestone)

    # 开放风险计数 / 高风险计数
    risk_cnt_by_project: dict[UUID, int] = defaultdict(int)
    high_risk_cnt_by_project: dict[UUID, int] = defaultdict(int)
    for risk in risks_open:
        risk_cnt_by_project[risk.project_id] += 1
        if risk.level == "高":
            high_risk_cnt_by_project[risk.project_id] += 1

    # 开放问题计数
    issue_cnt_by_project: dict[UUID, int] = defaultdict(int)
    for issue in issues_open:
        issue_cnt_by_project[issue.project_id] += 1

    def metrics_of(pid) -> dict:
        return project_metrics(tasks_by_project.get(pid, []))

    def proj_label(pid) -> str:
        p = proj_by_id.get(pid)
        return f"{p.code} {p.name}" if p else "未知项目"

    # ---------- 项目行（现有字段 + 异常标记） ----------
    project_rows = []
    for p in projects:
        metrics = metrics_of(p.id)
        project_rows.append(
            {
                "id": str(p.id),
                "code": p.code,
                "name": p.name,
                "status": p.status,
                "plan_start": p.plan_start.isoformat() if p.plan_start else None,
                "plan_end": p.plan_end.isoformat() if p.plan_end else None,
                "task_total": metrics["total_tasks"],
                "task_done": metrics["completed_tasks"],
                "progress": metrics["progress"],
                "risk_open": risk_cnt_by_project.get(p.id, 0),
                "issue_open": issue_cnt_by_project.get(p.id, 0),
                "high_risk": high_risk_cnt_by_project.get(p.id, 0),
                "overdue_tasks": len(overdue_tasks_by_project.get(p.id, [])),
                "overdue_milestones": len(overdue_ms_by_project.get(p.id, [])),
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
    for pid, od in overdue_tasks_by_project.items():
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
    for m in overdue_ms_flat:
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
            "tasks_done": sum(1 for t in tasks if t.status == _TASK_DONE),
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


@router.get("/overview/todos")
def overview_todos(db: Session = Depends(get_db)) -> dict:
    """驾驶舱待办聚合：一次请求返回全量里程碑 / 逾期任务 / 待审核交付物。

    背景（P0-2）：前端驾驶舱原先对每个项目并发请求里程碑、任务、交付物三个接口，
    N 个项目就是 3N 次请求；本接口用 1 次 Project 查询 + 3 次 IN 查询完成聚合，
    请求数从 O(N) 降为 O(1)。

    口径（与前端逐项目拉取后的过滤逻辑严格对齐，不新增语义）：
    - 项目范围：未删除（deleted_at 为空）且未归档（archived_at 为空）；
    - milestones：未完成（status != "已完成" 且 actual_date 为空），
      且 plan_date 落在 [今天, 今天 + 7 天] 闭区间；date = plan_date；
    - tasks：未完成（status != "已完成"）且 plan_end < 今天；date = plan_end；
      仅统计未删除（deleted_at 为空）任务；
    - deliverables：review_status == "待审核"；date = plan_date（可为 null，排最后）；
      交付物表无归档/软删除字段，故不加 archived 过滤；
    - 三组均按 date 升序（None 排最后），project_label = "{code} {name}"。

    返回：{"today": "YYYY-MM-DD", "milestones": [], "tasks": [], "deliverables": []}
    空数据一律返回空数组，不返回 null。
    """
    today = today_local()
    projects = list(
        db.scalars(
            select(Project).where(Project.deleted_at.is_(None), Project.archived_at.is_(None))
        ).all()
    )
    project_ids = [p.id for p in projects]
    if not project_ids:
        return {"today": today.isoformat(), "milestones": [], "tasks": [], "deliverables": []}

    proj_by_id = {p.id: p for p in projects}
    window_end = today + timedelta(days=_MILESTONE_WINDOW_DAYS)

    def proj_label(pid: UUID) -> str:
        p = proj_by_id.get(pid)
        return f"{p.code} {p.name}" if p else "未知项目"

    milestone_rows = db.scalars(
        select(Milestone).where(
            Milestone.project_id.in_(project_ids),
            Milestone.plan_date.is_not(None),
            Milestone.plan_date >= today,
            Milestone.plan_date <= window_end,
            Milestone.actual_date.is_(None),
            # status 可空：NULL 视为「未完成」（与前端 JS 的 !== "已完成" 语义一致）
            or_(Milestone.status.is_(None), Milestone.status != _MILESTONE_DONE),
        )
    ).all()

    task_rows = db.scalars(
        select(Task).where(
            Task.project_id.in_(project_ids),
            Task.deleted_at.is_(None),
            Task.plan_end.is_not(None),
            Task.plan_end < today,
            Task.status != _TASK_DONE,
        )
    ).all()

    deliverable_rows = db.scalars(
        select(Deliverable).where(
            Deliverable.project_id.in_(project_ids),
            Deliverable.review_status == "待审核",
        )
    ).all()

    milestones = _sort_by_date([
        {
            "id": str(m.id),
            "name": m.name,
            "project_id": str(m.project_id),
            "project_label": proj_label(m.project_id),
            "date": m.plan_date.isoformat() if m.plan_date else None,
        }
        for m in milestone_rows
    ])

    tasks = _sort_by_date([
        {
            "id": str(t.id),
            "name": t.name,
            "project_id": str(t.project_id),
            "project_label": proj_label(t.project_id),
            "date": t.plan_end.isoformat() if t.plan_end else None,
        }
        for t in task_rows
    ])

    deliverables = _sort_by_date([
        {
            "id": str(d.id),
            "name": d.name,
            "project_id": str(d.project_id),
            "project_label": proj_label(d.project_id),
            "date": d.plan_date.isoformat() if d.plan_date else None,
        }
        for d in deliverable_rows
    ])

    return {
        "today": today.isoformat(),
        "milestones": milestones,
        "tasks": tasks,
        "deliverables": deliverables,
    }
