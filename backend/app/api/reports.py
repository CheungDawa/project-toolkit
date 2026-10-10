"""交付资料与周报/收尾 Word 报告 API（T5-07；FR-P1-08）。"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from docx import Document
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.project import Project
from app.models.stage3 import Issue, Risk
from app.models.stage5 import Deliverable
from app.models.task import Milestone, Task
from app.schemas.stage5 import DeliverableRead
from app.services import wbs as wbs_service

router = APIRouter(prefix="/api", tags=["reports"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/projects/{project_id}/reports/weekly-text")
def weekly_text(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    """周报文本（真实数据聚合，带三要素）。"""
    now = _utcnow().astimezone()
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    completed = sum(1 for t in tasks if t.status == "已完成")
    hours_total = sum(float(t.work_hours or 0) for t in tasks)
    lines = [
        f"统计截止日期：{now.date().isoformat()}",
        f"数据来源：Project Toolkit（任务/风险/问题/交付清单聚合）",
        f"生成时间：{now.strftime('%Y-%m-%d %H:%M')}",
        "",
        "一、本周进展",
        f"- 任务完成：{completed}/{len(tasks)}，总工时 {hours_total:.1f}h，完成进度 "
        f"{round(completed / len(tasks) * 100) if tasks else 0}%",
        "二、下周计划",
        "- （信息不足：请按实际情况填写）",
        "三、风险与问题",
        f"- 开放风险 {len(list(db.scalars(select(Risk).where(Risk.project_id == project_id, Risk.archived_at.is_(None)))))} 项、"
        f"未关闭问题 {len(list(db.scalars(select(Issue).where(Issue.project_id == project_id, Issue.status != '已关闭'))))} 项",
        "四、需协调事项",
        "- （信息不足：请按实际情况填写）",
    ]
    return {"meta": " | ".join(lines[:3]), "content": "\n".join(lines)}


@router.get("/projects/{project_id}/reports/{report_type}/export")
def export_report(project_id: UUID, report_type: str, db: Session = Depends(get_db)) -> StreamingResponse:
    """Word 导出：weekly=周报 / final=项目收尾报告（python-docx 模板字段映射）。"""
    if report_type not in ("weekly", "final"):
        from app.core.errors import AppError
        raise AppError(422, "invalid_report_type", "仅支持 weekly / final")
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        from app.core.errors import AppError
        raise AppError(404, "not_found", "项目不存在")

    if report_type == "weekly":
        document = _build_weekly_doc(db, project)
        filename = f"weekly_report_{project.code}_{_utcnow().date().isoformat()}.docx"
    else:
        document = _build_final_doc(db, project)
        filename = f"final_report_{project.code}_{_utcnow().date().isoformat()}.docx"

    buf = io.BytesIO()
    document.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_weekly_doc(db: Session, project: Project) -> Document:
    doc = Document()
    doc.add_heading(f"项目周报：{project.name}", level=1)
    doc.add_paragraph(f"项目编号：{project.code}    统计日期：{_utcnow().astimezone().date().isoformat()}")
    tasks = wbs_service.list_tasks_ordered(db, project.id)
    completed = sum(1 for t in tasks if t.status == "已完成")
    doc.add_heading("一、本周进展", level=2)
    doc.add_paragraph(f"任务完成 {completed}/{len(tasks)}")
    doc.add_heading("二、任务明细", level=2)
    table = doc.add_table(rows=1, cols=5)
    table.style = "Light Grid Accent 1"
    hdr = table.rows[0].cells
    for i, text in enumerate(["WBS", "任务", "状态", "进度", "计划起止"]):
        hdr[i].text = text
    for task in tasks:
        row = table.add_row().cells
        row[0].text = task.wbs_code
        row[1].text = task.name
        row[2].text = task.status
        row[3].text = f"{task.progress or 0}%"
        row[4].text = f"{task.plan_start or '-'} ~ {task.plan_end or '-'}"
    doc.add_heading("三、风险与问题", level=2)
    risks = list(db.scalars(select(Risk).where(Risk.project_id == project.id, Risk.archived_at.is_(None))))
    issues = list(db.scalars(select(Issue).where(Issue.project_id == project.id, Issue.status != "已关闭")))
    doc.add_paragraph(f"开放风险 {len(risks)} 项；未关闭问题 {len(issues)} 项")
    doc.add_paragraph("（详细台账请见系统）")
    return doc


def _build_final_doc(db: Session, project: Project) -> Document:
    doc = Document()
    doc.add_heading(f"项目收尾报告：{project.name}", level=1)
    doc.add_paragraph(f"项目编号：{project.code}    生成日期：{_utcnow().astimezone().date().isoformat()}")
    doc.add_paragraph(f"客户：{project.customer or '-'}    项目经理：{project.manager or '-'}")
    doc.add_paragraph(f"计划周期：{project.plan_start or '-'} ~ {project.plan_end or '-'}")

    tasks = wbs_service.list_tasks_ordered(db, project.id)
    completed = sum(1 for t in tasks if t.status == "已完成")
    doc.add_heading("一、项目完成情况", level=2)
    doc.add_paragraph(f"任务完成率：{completed}/{len(tasks)}")
    milestones = list(db.scalars(select(Milestone).where(Milestone.project_id == project.id)))
    doc.add_paragraph(f"里程碑 {len(milestones)} 项：{ '、'.join(m.name for m in milestones) or '-' }")

    doc.add_heading("二、交付资料清单", level=2)
    items = list(db.scalars(select(Deliverable).where(Deliverable.project_id == project.id)))
    table = doc.add_table(rows=1, cols=4)
    table.style = "Light Grid Accent 1"
    for i, text in enumerate(["类别", "资料名称", "提交状态", "审核状态"]):
        table.rows[0].cells[i].text = text
    for item in items:
        row = table.add_row().cells
        row[0].text = item.category or "-"
        row[1].text = item.name
        row[2].text = item.submit_status
        row[3].text = item.review_status

    doc.add_heading("三、风险与问题", level=2)
    risks = list(db.scalars(select(Risk).where(Risk.project_id == project.id, Risk.archived_at.is_(None))))
    issues = list(db.scalars(select(Issue).where(Issue.project_id == project.id)))
    doc.add_paragraph(f"风险 {len(risks)} 项、问题 {len(issues)} 项（明细见系统台账）")
    return doc