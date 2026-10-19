"""交付资料与周报/收尾 Word 报告 API（T5-07；FR-P1-08）。"""
from __future__ import annotations

import io
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from docx import Document
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.time import LOCAL_TZ, now_local, today_local
from app.models.project import Project
from app.models.stage3 import Issue, Risk, Stakeholder
from app.models.stage5 import Deliverable
from app.models.task import Milestone, Task
from app.schemas.stage5 import DeliverableRead
from app.services import progress as progress_service
from app.services import wbs as wbs_service

router = APIRouter(prefix="/api", tags=["reports"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _metrics_of(db: Session, project_id: UUID) -> dict:
    """项目级进度/工时统一口径（与 WBS 页根任务有效进度一致）。"""
    return progress_service.project_metrics(wbs_service.list_tasks_ordered(db, project_id))


def _progress_text(task: Task, effective: dict) -> str:
    """任务行进度文本：父任务取子树汇总后的有效进度，统一 1 位小数。"""
    value = effective.get(task.id, float(task.progress or 0))
    return f"{round(float(value), 1)}%"


# ---------- 周报「本周口径」聚合（文本版与 Word 版共用，保证两处口径一致） ----------


def _local_date(value: datetime | None) -> date | None:
    """把库里的（UTC）时间戳换算成业务时区（北京时间）日期。"""
    if value is None:
        return None
    try:
        return value.astimezone(LOCAL_TZ).date()
    except Exception:  # noqa: BLE001 - 时间戳异常时退回其自身日期，不阻断报告生成
        return value.date()


def _week_window(today: date | None = None) -> tuple[date, date]:
    """本周区间（周一 ~ 周日），基准为业务时区「今天」。"""
    base = today or today_local()
    monday = base - timedelta(days=base.weekday())
    return monday, monday + timedelta(days=6)


def _in_week(value: date | None, week_start: date, week_end: date) -> bool:
    return value is not None and week_start <= value <= week_end


def _is_finished(task: Task) -> bool:
    """任务是否已闭环：状态「已完成」或进度 100%（与 progress_service 判定同口径）。"""
    if task.status == progress_service.STATUS_DONE:
        return True
    return float(task.progress or 0) >= 100.0


def _has_counted_descendant(
    task_id: UUID, children: dict[UUID, list[Task]], counted_ids: set[UUID]
) -> bool:
    """子树内是否已有任务被计入本周完成（用于父子不重复计数）。"""
    seen: set[UUID] = {task_id}
    stack: list[Task] = list(children.get(task_id, ()))
    while stack:
        node = stack.pop()
        if node.id in seen:  # 防御异常数据造成的环
            continue
        seen.add(node.id)
        if node.id in counted_ids:
            return True
        stack.extend(children.get(node.id, ()))
    return False


def _weekly_completion(
    tasks: list[Task], week_start: date, week_end: date
) -> tuple[int, bool, bool]:
    """本周完成任务数（本周口径，与 project_metrics 的累计口径分离）。

    返回 (本周完成数, 是否使用了 updated_at 兜底, 项目内是否存在 actual_end)。
    - 完成日期优先取 actual_end；缺失时只对「已闭环」任务用 updated_at 的业务日期兜底，
      否则任何被编辑过的任务都会被算作本周完成，反而更误导。
    - 项目内完全没有 actual_end 时不做兜底，直接返回 0 由调用方给出降级提示，
      避免用「更新时间」冒充真实完成量。
    - 父子任务同周完成时只计最内层，避免父任务与子任务重复计数。
    """
    has_actual_end = any(task.actual_end is not None for task in tasks)
    if not has_actual_end:
        return 0, False, False

    candidates: dict[UUID, bool] = {}  # task_id -> 是否使用了 updated_at 兜底
    for task in tasks:
        done_date = task.actual_end
        used_fallback = False
        if done_date is None and _is_finished(task):
            done_date = _local_date(task.updated_at)
            used_fallback = done_date is not None
        if not _in_week(done_date, week_start, week_end):
            continue
        candidates[task.id] = used_fallback

    children: dict[UUID, list[Task]] = {}
    for task in tasks:
        if task.parent_id is not None:
            children.setdefault(task.parent_id, []).append(task)

    counted = 0
    used_fallback = False
    for task in tasks:
        if task.id not in candidates:
            continue
        if _has_counted_descendant(task.id, children, set(candidates)):
            continue
        counted += 1
        used_fallback = used_fallback or candidates[task.id]
    return counted, used_fallback, True


def _weekly_new_counts(
    db: Session, project_id: UUID, week_start: date, week_end: date
) -> tuple[int, int]:
    """本周新增风险（未归档）/ 本周新增问题，按 created_at 的业务日期判定。"""
    risks = list(
        db.scalars(
            select(Risk).where(Risk.project_id == project_id, Risk.archived_at.is_(None))
        )
    )
    issues = list(db.scalars(select(Issue).where(Issue.project_id == project_id)))
    new_risks = sum(1 for r in risks if _in_week(_local_date(r.created_at), week_start, week_end))
    new_issues = sum(1 for i in issues if _in_week(_local_date(i.created_at), week_start, week_end))
    return new_risks, new_issues


def _weekly_progress_lines(
    db: Session, project_id: UUID, tasks: list[Task], metrics: dict
) -> list[str]:
    """周报「一、本周进展」正文：先本周口径，再单列累计口径（均带明确标签）。"""
    week_start, week_end = _week_window()
    counted, used_fallback, has_actual_end = _weekly_completion(tasks, week_start, week_end)
    new_risks, new_issues = _weekly_new_counts(db, project_id, week_start, week_end)
    span = f"{week_start.isoformat()} ~ {week_end.isoformat()}"

    if not has_actual_end:
        weekly_line = (
            f"- 本周完成：{counted} 项（项目内任务未填写实际完成日期，"
            f"无法统计本周工作量，建议在 WBS 页补录）"
        )
    elif used_fallback:
        weekly_line = (
            f"- 本周完成：{counted} 项（部分任务未填写实际完成日期，按更新时间估算；统计区间 {span}）"
        )
    else:
        weekly_line = f"- 本周完成：{counted} 项（统计区间 {span}）"

    return [
        weekly_line,
        f"- 本周新增风险 {new_risks} 项、本周新增问题 {new_issues} 项",
        f"- 累计完成 {metrics['completed_tasks']}/{metrics['total_tasks']}，"
        f"累计总工时 {metrics['total_hours']:.1f}h，整体完成进度 {metrics['progress']}%",
    ]


@router.get("/projects/{project_id}/reports/weekly-text")
def weekly_text(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    """周报文本（真实数据聚合，带三要素）。

    「一、本周进展」为**本周口径**（本周完成项数 / 本周新增风险问题），
    项目累计值另起一行并显式标注「累计」，避免客户把开工以来的累计数读成本周工作量。
    """
    now = now_local()
    metrics = _metrics_of(db, project_id)
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    open_risks = list(db.scalars(select(Risk).where(Risk.project_id == project_id, Risk.archived_at.is_(None))))
    open_issues = list(db.scalars(select(Issue).where(Issue.project_id == project_id, Issue.status != "已关闭")))
    lines = [
        f"统计截止日期：{today_local().isoformat()}",
        f"数据来源：Project Toolkit（任务/风险/问题/交付清单聚合）",
        f"生成时间：{now.strftime('%Y-%m-%d %H:%M')}",
        "",
        "一、本周进展",
        *_weekly_progress_lines(db, project_id, tasks, metrics),
        "二、下周计划",
        "- （信息不足：请按实际情况填写）",
        "三、风险与问题",
        f"- 累计开放风险 {len(open_risks)} 项、累计未关闭问题 {len(open_issues)} 项",
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
    doc.add_paragraph(f"项目编号：{project.code}    统计日期：{today_local().isoformat()}")
    tasks = wbs_service.list_tasks_ordered(db, project.id)
    metrics = progress_service.project_metrics(tasks)
    effective = progress_service.compute_progress(tasks)
    doc.add_heading("一、本周进展", level=2)
    # 与文本版共用同一聚合，保证「本周口径 + 累计口径」两处完全一致
    for line in _weekly_progress_lines(db, project.id, tasks, metrics):
        doc.add_paragraph(line[2:] if line.startswith("- ") else line)
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
        row[3].text = _progress_text(task, effective)
        row[4].text = f"{task.plan_start or '-'} ~ {task.plan_end or '-'}"
    doc.add_heading("三、风险与问题", level=2)
    risks = list(db.scalars(select(Risk).where(Risk.project_id == project.id, Risk.archived_at.is_(None))))
    issues = list(db.scalars(select(Issue).where(Issue.project_id == project.id, Issue.status != "已关闭")))
    doc.add_paragraph(f"累计开放风险 {len(risks)} 项；累计未关闭问题 {len(issues)} 项")
    doc.add_paragraph("（详细台账请见系统）")
    return doc


def _build_final_doc(db: Session, project: Project) -> Document:
    doc = Document()
    doc.add_heading(f"项目收尾报告：{project.name}", level=1)
    doc.add_paragraph(f"项目编号：{project.code}    生成日期：{_utcnow().astimezone().date().isoformat()}")
    doc.add_paragraph(f"客户：{project.customer or '-'}    项目经理：{project.manager or '-'}")
    doc.add_paragraph(f"计划周期：{project.plan_start or '-'} ~ {project.plan_end or '-'}")

    tasks = wbs_service.list_tasks_ordered(db, project.id)
    metrics = progress_service.project_metrics(tasks)
    doc.add_heading("一、项目完成情况", level=2)
    doc.add_paragraph(
        f"任务完成：{metrics['completed_tasks']}/{metrics['total_tasks']}；整体进度 {metrics['progress']}%"
    )
    doc.add_paragraph(f"总工时 {metrics['total_hours']:.1f}h，剩余工时 {metrics['remaining_hours']:.1f}h")
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


@router.get("/projects/{project_id}/stakeholders/report/export")
def export_stakeholder_report(project_id: UUID, db: Session = Depends(get_db)) -> StreamingResponse:
    """干系人管理报告 Word 导出（按单位→角色分类分组，含统计/矩阵/联系方式/参与程度）。"""
    from app.core.errors import AppError
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise AppError(404, "not_found", "项目不存在")
    stakeholders = list(db.scalars(select(Stakeholder).where(Stakeholder.project_id == project_id)))
    if not stakeholders:
        raise AppError(422, "empty", "该项目暂无干系人数据")

    doc = Document()
    doc.add_heading(f"干系人管理报告：{project.name}", level=1)
    now = _utcnow().astimezone()
    doc.add_paragraph(f"项目编号：{project.code}    导出日期：{now.date().isoformat()}")

    # 统计
    p0 = sum(1 for s in stakeholders if s.priority == "P0")
    p1 = sum(1 for s in stakeholders if s.priority == "P1")
    p2 = sum(1 for s in stakeholders if s.priority == "P2")
    hi_inf = sum(1 for s in stakeholders if s.influence >= 4)
    doc.add_heading("一、统计摘要", level=2)
    doc.add_paragraph(f"干系人总数：{len(stakeholders)}    P0 重点管理：{p0}    P1 重点关注：{p1}    P2 一般跟进：{p2}    高影响力(≥4)：{hi_inf}")

    # 按单位→角色分类分组
    org_map: dict[str, dict[str, list[Stakeholder]]] = {}
    for s in stakeholders:
        org = s.org or "未分类"
        sub = s.sub_pos or "未分类"
        if org not in org_map:
            org_map[org] = {}
        if sub not in org_map[org]:
            org_map[org][sub] = []
        org_map[org][sub].append(s)

    doc.add_heading("二、干系人明细（按单位分组）", level=2)
    for org, sub_map in org_map.items():
        total = sum(len(v) for v in sub_map.values())
        p = doc.add_paragraph()
        p.add_run(f"■ {org}（{total} 人）").bold = True
        for sub, people in sub_map.items():
            p2 = doc.add_paragraph()
            p2.paragraph_format.left_indent = 365760  # 0.4 inch indent (int for python-docx)
            p2.add_run(f"├ {sub}（{len(people)} 人）").bold = True
            table = doc.add_table(rows=1, cols=7)
            table.style = "Light Grid Accent 1"
            for i, text in enumerate(["姓名", "职位/角色", "优先级", "参与程度", "联系方式", "需求/诉求", "沟通计划"]):
                table.rows[0].cells[i].text = text
            for s in people:
                row = table.add_row().cells
                row[0].text = s.name
                row[1].text = s.role or "-"
                row[2].text = s.priority or "-"
                row[3].text = s.participation or "-"
                contact = []
                if s.contact_phone:
                    contact.append(f"📱{s.contact_phone}")
                if s.contact_wechat:
                    contact.append(f"💬{s.contact_wechat}")
                if s.contact_email:
                    contact.append(f"✉️{s.contact_email}")
                row[4].text = "\n".join(contact) or "-"
                row[5].text = s.demands or "-"
                row[6].text = s.comm_frequency or "-"
            doc.add_paragraph()  # 空行分隔

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    filename = f"stakeholders_report_{project.code}_{now.date().isoformat()}.docx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )