"""AI 提示词与项目上下文装配（数据最小化白名单，TD-03）。"""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.stage3 import Issue, Risk
from app.models.task import Task
from app.services import wbs as wbs_service

WBS_DRAFT_SYSTEM = (
    "你是资深信息化项目经理的 WBS 分解助手。根据项目描述输出 WBS 初稿，仅输出 JSON，"
    "结构：{\"tasks\":[{\"wbs\":\"1\",\"parent_wbs\":null,\"name\":\"任务名\",\"owner\":\"负责人\","
    "\"plan_start\":\"YYYY-MM-DD\",\"plan_end\":\"YYYY-MM-DD\",\"work_hours\":数字,\"progress\":0}]}。"
    "要求：2-4 级分解、任务名简洁、日期合法且结束不早于开始、wbs 唯一且 parent_wbs 引用前序条目。"
)

SCHEDULE_CHECK_SYSTEM = (
    "你是项目计划检查助手。基于给出的任务与依赖，指出工期冲突、依赖倒挂、关键路径风险。"
    "用中文简明回答，引用任务 WBS 编号。不要输出 JSON，直接给结论与建议。"
)

RISK_ADVICE_SYSTEM = (
    "你是项目风险管理助手。基于风险台账、问题台账与进度偏差，提出风险建议。"
    "逐条引用依据（风险/问题编号或任务 WBS），说明风险等级变化与建议措施。用中文。"
)

WEEKLY_REPORT_SYSTEM = (
    "你是项目周报助手。基于提供的真实数据生成周报初稿，结构：本周进展、下周计划、风险与问题、需协调事项。"
    "仅使用提供的数据；缺失信息标注“信息不足”。用中文。"
)

QA_SYSTEM = (
    "你是项目管理问答助手。基于提供的项目上下文回答，只能引用上下文中的真实字段，"
    "不要编造。若上下文不足，明确说明“信息不足”。用中文。"
)


def _fmt_date(value) -> str | None:
    return value.isoformat() if value else None


def project_tasks_context(db: Session, project_id: UUID) -> str:
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    lines = []
    for task in tasks:
        lines.append(
            f"- {task.wbs_code} {task.name}（状态:{task.status} 进度:{task.progress or 0}% "
            f"计划:{_fmt_date(task.plan_start)}~{_fmt_date(task.plan_end)} 工时:{task.work_hours or '-'}）"
        )
    return "\n".join(lines) or "（暂无任务）"


def project_risks_context(db: Session, project_id: UUID) -> str:
    risks = list(db.scalars(select(Risk).where(Risk.project_id == project_id, Risk.archived_at.is_(None))))
    lines = []
    for idx, risk in enumerate(risks, start=1):
        lines.append(
            f"- 风险{idx}：{risk.description[:80]}（等级:{risk.level} 状态:{risk.status} 责任人:{risk.owner or '-'}）"
        )
    return "\n".join(lines) or "（暂无风险台账）"


def project_issues_context(db: Session, project_id: UUID) -> str:
    issues = list(db.scalars(select(Issue).where(Issue.project_id == project_id)))
    lines = []
    for idx, issue in enumerate(issues, start=1):
        lines.append(
            f"- 问题{idx} {issue.title}（严重度:{issue.severity or '-'} 状态:{issue.status} "
            f"期限:{_fmt_date(issue.due_date)}）"
        )
    return "\n".join(lines) or "（暂无问题台账）"


def project_progress_summary(db: Session, project_id: UUID) -> str:
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    done = sum(1 for t in tasks if t.status == "已完成")
    total = len(tasks)
    hours = sum(float(t.work_hours or 0) for t in tasks)
    return f"任务总数 {total}，已完成 {done}，总工时 {hours:.1f}"


def capability_context(db: Session, project_id: UUID, capability: str) -> tuple[str, list[str]]:
    """返回 (提示词上下文文本, 已发送字段白名单)。"""
    if capability == "wbs":
        project = db.scalar(select(Project).where(Project.id == project_id))
        text = f"项目：{project.name}（阶段:{project.phase or '-'}）\n描述：{project.description or '（无描述）'}"
        return text, ["project.name", "project.phase", "project.description"]
    if capability == "schedule":
        return project_tasks_context(db, project_id), ["tasks.*(wbs/name/status/dates/hours)"]
    if capability == "risk":
        return (
            project_tasks_context(db, project_id) + "\n---风险---\n" + project_risks_context(db, project_id)
            + "\n---问题---\n" + project_issues_context(db, project_id),
            ["tasks.*", "risks.*", "issues.*"],
        )
    if capability == "report":
        return (
            "进度：" + project_progress_summary(db, project_id) + "\n---任务---\n"
            + project_tasks_context(db, project_id) + "\n---风险---\n" + project_risks_context(db, project_id)
            + "\n---问题---\n" + project_issues_context(db, project_id),
            ["progress_summary", "tasks.*", "risks.*", "issues.*"],
        )
    if capability == "qa":
        return (
            project_tasks_context(db, project_id) + "\n---风险---\n" + project_risks_context(db, project_id)
            + "\n---问题---\n" + project_issues_context(db, project_id),
            ["tasks.*", "risks.*", "issues.*"],
        )
    raise ValueError(f"unknown capability: {capability}")


def weekly_report_meta() -> str:
    now = datetime.now(timezone.utc).astimezone()
    return (
        f"统计截止日期：{now.date().isoformat()} ｜ 数据来源：Project Toolkit（任务/风险/问题聚合）"
        f" ｜ 生成时间：{now.strftime('%Y-%m-%d %H:%M')} ｜ 说明：缺失数据已标注“信息不足”"
    )