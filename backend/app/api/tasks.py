"""任务 API：CRUD / 树 / 排序 / 复制 / 删除 / Excel 导入导出（阶段 2 WBS条1-7）。"""
import io
import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.project import Project
from app.models.task import Task, TaskDependency
from app.schemas.task import (
    DependencyRead,
    TaskBulkUpdate,
    TaskCreate,
    TaskListResponse,
    TaskRead,
    TaskReorder,
    TaskUpdate,
)
from app.services import calendar as calendar_service
from app.services import cycle as cycle_service
from app.services import progress as progress_service
from app.services import wbs as wbs_service
from app.services import audit as audit_service
from app.services import snapshot as snapshot_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["tasks"])

EXPORT_HEADERS = [
    "wbs_code", "name", "owner", "status", "priority",
    "plan_start", "plan_end", "work_hours", "progress", "acceptance_criteria",
]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_live(db: Session, task_id: UUID) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id, Task.deleted_at.is_(None)))
    if task is None:
        raise AppError(404, "not_found", "任务不存在")
    return task


def _get_effective_map(db: Session, project_id: UUID) -> dict[UUID, float]:
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    return progress_service.compute_progress(tasks)


def _to_read(task: Task, effective: dict[UUID, float]) -> TaskRead:
    read = TaskRead.model_validate(task)
    read.effective_progress = round(float(effective.get(task.id, float(task.progress or 0))), 2)
    return read


def _apply_dates_and_duration(db: Session, task: Task) -> None:
    if task.plan_start and task.plan_end and task.plan_end < task.plan_start:
        raise AppError(
            422, "date_invalid", "计划结束日期不能早于计划开始日期",
            fields={"plan_end": ["计划结束日期不能早于计划开始日期"]},
        )
    if task.actual_start and task.actual_end and task.actual_end < task.actual_start:
        raise AppError(
            422, "date_invalid", "实际结束日期不能早于实际开始日期",
            fields={"actual_end": ["实际结束日期不能早于实际开始日期"]},
        )
    calendar = calendar_service.load_calendar(db, task.project_id)
    if task.plan_start and task.plan_end:
        task.duration_days = calendar_service.workdays_between(task.plan_start, task.plan_end, calendar)
    elif task.plan_start and task.duration_days is not None:
        task.plan_end = calendar_service.advance_workdays(task.plan_start, task.duration_days, calendar)


@router.get("/projects/{project_id}/tasks", response_model=TaskListResponse)
def list_tasks(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    effective = progress_service.compute_progress(tasks)
    deps = list(
        db.scalars(select(TaskDependency).where(TaskDependency.project_id == project_id)).all()
    )
    return {
        "items": [_to_read(task, effective) for task in tasks],
        "dependencies": deps,
    }


@router.post("/projects/{project_id}/tasks", status_code=201, response_model=TaskRead)
def create_task(project_id: UUID, payload: TaskCreate, db: Session = Depends(get_db)) -> TaskRead:
    parent_id = payload.parent_id
    if parent_id is not None:
        parent = _get_live(db, parent_id)
        if parent.project_id != project_id:
            raise AppError(422, "invalid_parent", "父任务不属于该项目", fields={"parent_id": ["父任务不属于该项目"]})

    siblings = [
        t for t in wbs_service.list_tree_tasks(db, project_id)
        if t.parent_id == parent_id
    ]
    task = Task(
        project_id=project_id,
        parent_id=parent_id,
        sort_order=max((t.sort_order for t in siblings), default=-1) + 1,
        wbs_code=str(uuid.uuid4()),  # 占位唯一，提交后 recompute 重算真实编码
        name=payload.name,
        owner=payload.owner,
        collaborators=list(payload.collaborators or []),
        plan_start=payload.plan_start,
        plan_end=payload.plan_end,
        actual_start=payload.actual_start,
        actual_end=payload.actual_end,
        work_hours=payload.work_hours,
        progress=payload.progress,
        status=payload.status,
        priority=payload.priority,
        acceptance_criteria=payload.acceptance_criteria,
        deliverable_name=payload.deliverable_name,
    )
    _apply_dates_and_duration(db, task)
    db.add(task)
    db.commit()
    wbs_service.recompute_codes(db, project_id)
    audit_service.record(db, project_id, "task", task.id, "create", f"创建任务：{task.name}")
    db.commit()
    snapshot_service.maybe_capture_daily(db, project_id)
    db.refresh(task)
    return _to_read(task, _get_effective_map(db, project_id))


@router.patch("/tasks/{task_id}", response_model=TaskRead)
def update_task(task_id: UUID, payload: TaskUpdate, db: Session = Depends(get_db)) -> TaskRead:
    task = _get_live(db, task_id)
    data = payload.model_dump(exclude_unset=True)

    for key in ("plan_start", "plan_end", "actual_start", "actual_end"):
        if key in data:
            setattr(task, key, data[key])
    for key in (
        "name", "owner", "collaborators", "work_hours", "progress", "status",
        "priority", "acceptance_criteria", "deliverable_name",
    ):
        if key in data:
            setattr(task, key, data[key])

    _apply_dates_and_duration(db, task)
    db.commit()
    db.refresh(task)
    snapshot_service.maybe_capture_daily(db, task.project_id)
    return _to_read(task, _get_effective_map(db, task.project_id))


@router.patch("/projects/{project_id}/tasks/bulk")
def bulk_update_tasks(
    project_id: UUID, payload: TaskBulkUpdate, db: Session = Depends(get_db)
) -> dict:
    """批量更新 WBS 任务（P1-4：一次事务、一次快照、一条汇总审计）。

    语义与单条 PATCH /tasks/{id} 保持一致：只写请求里**显式给出**的字段
    （progress / status / owner），未给出的字段保持原值。日期字段不在本接口
    范围内，因此不做工期重算（不触发工作日历查询），避免 500 条任务时的隐性放大。

    事务边界：全部 setattr 后只 commit 一次 —— 要么整批成功，要么整批回滚；
    不会出现「前 200 条已改、后 300 条失败」的半成品状态。

    容错：个别 id 不存在 / 不属于该项目 / 已被软删除时**不整单失败**，而是收集到
    not_found 一并返回；重复 id 对 updated 与 not_found 均只计一次，not_found 按
    首次出现顺序返回。updated == 0 时仍返回 200（空结果），不抛错 —— 前端并发
    编辑场景下「都被别人删了」属于正常收敛。

    返回：{"updated": int, "not_found": ["uuid", ...]}
    """
    items = payload.items
    requested_ids = [item.id for item in items]

    tasks = list(
        db.scalars(
            select(Task).where(
                Task.id.in_(requested_ids),
                Task.project_id == project_id,
                Task.deleted_at.is_(None),
            )
        ).all()
    )
    task_by_id: dict[UUID, Task] = {task.id: task for task in tasks}

    not_found_ids: list[UUID] = []
    seen_missing: set[UUID] = set()
    touched: dict[UUID, Task] = {}
    for item in items:
        task = task_by_id.get(item.id)
        if task is None:
            # 去重且保持首次出现顺序：请求里重复的未知 id 只报一次
            if item.id not in seen_missing:
                seen_missing.add(item.id)
                not_found_ids.append(item.id)
            continue
        # exclude_unset：区分「显式传 null」与「压根没传」，只写前者到达的字段
        data = item.model_dump(exclude_unset=True, exclude={"id"})
        for key, value in data.items():
            setattr(task, key, value)
        touched[task.id] = task

    updated = len(touched)
    not_found = [str(task_id) for task_id in not_found_ids]
    if updated == 0:
        return {"updated": 0, "not_found": not_found}

    # 唯一的业务事务边界：上面所有 setattr 在此一次性落库，要么全成功要么全回滚
    try:
        db.commit()
    except IntegrityError as exc:  # pragma: no cover - 入参已由 schema 约束，保留兜底
        db.rollback()
        logger.exception("批量更新任务提交失败，已整批回滚")
        raise AppError(
            422, "integrity_error",
            f"数据约束冲突：批量更新未生效（{_integrity_hint(exc)}）",
        ) from None

    first_task_id = next(iter(touched))
    _capture_snapshot_safely(db, project_id)
    try:
        audit_service.record(
            db, project_id, "task", first_task_id, "bulk_update",
            f"批量更新 {updated} 项任务",
            payload_diff={
                "updated": updated,
                "not_found": not_found[:20],
                "fields": sorted({
                    key
                    for item in items
                    for key in item.model_dump(exclude_unset=True, exclude={"id"})
                }),
            },
        )
        # 有意为之的第二次提交（不是事务泄漏）：任务数据已在上面提交完毕，审计是
        # best-effort 的独立写入 —— 失败只记日志、不回滚业务数据、也不向用户报错。
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("批量更新任务后写入审计日志失败（任务数据已提交，不影响更新结果）")
        _safe_rollback(db)

    return {"updated": updated, "not_found": not_found}


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: UUID, db: Session = Depends(get_db)) -> None:
    task = _get_live(db, task_id)
    subtree = wbs_service.find_subtree_ids(db, task.project_id, task_id)
    for item in db.scalars(select(Task).where(Task.id.in_(subtree))).all():
        item.deleted_at = _utcnow()
        # 释放 WBS 编码占位，避免与活跃任务重算冲突（唯一约束覆盖含已删行）
        item.wbs_code = f"DEL-{item.id.hex[:12]}"
    audit_service.record(db, task.project_id, "task", task.id, "delete", f"删除任务（含子任务）：{task.name}")
    db.commit()
    wbs_service.recompute_codes(db, task.project_id)
    snapshot_service.maybe_capture_daily(db, task.project_id)


@router.post("/tasks/{task_id}/copy", response_model=TaskRead)
def copy_task(task_id: UUID, db: Session = Depends(get_db)) -> TaskRead:
    source = _get_live(db, task_id)
    copied = _copy_subtree(db, source, None)
    db.commit()
    wbs_service.recompute_codes(db, source.project_id)
    snapshot_service.maybe_capture_daily(db, source.project_id)
    return _to_read(copied, _get_effective_map(db, source.project_id))


def _copy_subtree(db: Session, source: Task, new_parent_id: UUID | None) -> Task:
    new_task = Task(
        project_id=source.project_id,
        parent_id=new_parent_id,
        sort_order=source.sort_order,
        wbs_code=str(uuid.uuid4()),  # 占位唯一，提交后重算
        name=f"{source.name}（副本）" if new_parent_id is None else source.name,
        owner=source.owner,
        collaborators=list(source.collaborators or []),
        plan_start=source.plan_start,
        plan_end=source.plan_end,
        actual_start=source.actual_start,
        actual_end=source.actual_end,
        duration_days=source.duration_days,
        work_hours=source.work_hours,
        progress=source.progress,
        status=source.status,
        priority=source.priority,
        acceptance_criteria=source.acceptance_criteria,
        deliverable_name=source.deliverable_name,
    )
    db.add(new_task)
    db.flush()
    children = [
        t for t in wbs_service.list_tree_tasks(db, source.project_id)
        if t.parent_id == source.id
    ]
    for child in children:
        _copy_subtree(db, child, new_task.id)
    return new_task


@router.post("/projects/{project_id}/tasks/reorder")
def reorder_task(project_id: UUID, payload: TaskReorder, db: Session = Depends(get_db)) -> dict:
    task = _get_live(db, payload.task_id)
    if task.project_id != project_id:
        raise AppError(422, "invalid_project", "任务不属于该项目")

    if payload.new_parent_id is not None:
        parent = _get_live(db, payload.new_parent_id)
        if parent.project_id != project_id:
            raise AppError(422, "invalid_parent", "目标父任务不属于该项目", fields={"new_parent_id": ["目标父任务不属于该项目"]})
        if parent.id == task.id or parent.id in wbs_service.find_subtree_ids(db, project_id, task.id):
            raise AppError(422, "invalid_reorder", "不能移动到自身或其子孙任务下", fields={"new_parent_id": ["不能移动到自身或其子孙任务下"]})
        task.parent_id = parent.id

    siblings = [
        t for t in wbs_service.list_tree_tasks(db, project_id)
        if t.parent_id == task.parent_id and t.id != task.id
    ]
    siblings.sort(key=lambda t: (t.sort_order, t.created_at))
    index = min(payload.new_index, len(siblings))
    siblings.insert(index, task)
    for position, item in enumerate(siblings):
        item.sort_order = position
    db.commit()
    wbs_service.recompute_codes(db, project_id)
    snapshot_service.maybe_capture_daily(db, project_id)
    return {"ok": True}


@router.get("/projects/{project_id}/tasks/export")
def export_tasks(project_id: UUID, db: Session = Depends(get_db)) -> StreamingResponse:
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    wb = Workbook()
    ws = wb.active
    ws.title = "任务"
    ws.append(EXPORT_HEADERS)
    for task in tasks:
        ws.append([
            task.wbs_code,
            task.name,
            task.owner or "",
            task.status or "",
            task.priority or "",
            task.plan_start.isoformat() if task.plan_start else "",
            task.plan_end.isoformat() if task.plan_end else "",
            float(task.work_hours) if task.work_hours is not None else "",
            float(task.progress or 0),
            task.acceptance_criteria or "",
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="tasks_{project_id}.xlsx"'},
    )


# ---------- Excel 导入 ----------

IMPORT_TEMPLATE_FILENAME = "WBS导入模板.xlsx"
ROOT_KEY = "__root__"  # 顶级任务分组键（区别于任何 UUID 字符串）

IMPORT_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "wbs_code": ("wbs_code", "wbs", "本行编码", "本行wbs编码", "wbs编码", "任务编码", "编码"),
    "name": ("name", "任务名称", "名称", "任务"),
    "owner": ("owner", "负责人", "责任人"),
    "status": ("status", "状态"),
    "priority": ("priority", "优先级"),
    "plan_start": ("plan_start", "计划开始", "计划开始日期", "开始日期"),
    "plan_end": ("plan_end", "计划结束", "计划结束日期", "完成日期", "结束日期"),
    "work_hours": ("work_hours", "工时", "计划工时"),
    "progress": ("progress", "进度", "完成比例", "完成度"),
    "acceptance_criteria": ("acceptance_criteria", "验收标准", "交付标准"),
}

IMPORT_HEADER_COMMENTS: dict[str, str] = {
    "wbs_code": "本行任务自己的 WBS 编码（不是父编码）。留空或单段（如 2）＝顶级任务；层级用点号表达，如 2.1、2.1.1。",
    "name": "必填。任务名称，最多 200 字。",
    "owner": "选填。负责人，最多 100 字。",
    "status": "选填。默认「未开始」，最多 30 字。",
    "priority": "选填。如 高/中/低，最多 20 字。",
    "plan_start": "选填。计划开始日期，建议 YYYY-MM-DD。",
    "plan_end": "选填。计划结束日期，不能早于计划开始日期。",
    "work_hours": "选填。计划工时（小时），不能为负数。",
    "progress": "选填。0~100 的数字，默认 0；写 30 或 30% 都表示 30%。",
    "acceptance_criteria": "选填。验收标准。",
}

IMPORT_GUIDE_LINES: tuple[str, ...] = (
    "WBS 任务导入填写说明",
    "",
    "1. 第 1 行为表头，请勿修改列名；数据从第 2 行开始（本表「任务导入」）。",
    "2. 第 1 列 wbs_code 是本行任务「自己的编码」，不是父任务编码：",
    "   - 单段（如 2）或留空 → 顶级任务；",
    "   - 多层（如 2.1.1）的父节点自动取 2.1，可以来自本批次，也可以是项目里已有的任务。",
    "3. 父编码找不到时该行会被导入为顶级任务，并在导入结果中给出告警（不会丢数据）。",
    "4. 必填列：任务名称。其余列留空即可（进度默认 0）。",
    "5. 日期写法：YYYY-MM-DD（也支持 YYYY/MM/DD、YYYY.MM.DD、YYYY年MM月DD日、YYYYMMDD 和 Excel 日期格式单元格）。",
    "6. 进度只能是 0~100 的数字；工时不能为负数；计划结束日期不能早于计划开始日期。",
    "7. 导入后系统会按行序重新生成 WBS 编码并计算工期（按工作日历，至少 1 天）。",
    "8. 导入结果会在页面上逐行反馈：created=成功条数，errors=失败行，warnings=提示行。",
)


def _load_workbook(content: bytes) -> Workbook:
    """读取上传的 xlsx：优先取公式计算结果，结果为空时退回读取公式原文。

    openpyxl 在 data_only=True 时对「从未被 Excel 保存过」的文件只能读到 None，
    因此回退一次再 load，避免把有公式的表误判为空表。
    """
    try:
        workbook = load_workbook(io.BytesIO(content), data_only=True)
    except Exception:  # noqa: BLE001
        raise AppError(422, "invalid_file", "无法解析 Excel 文件，请上传 .xlsx 文件") from None

    if not _sheet_has_value(workbook.active):
        try:
            workbook = load_workbook(io.BytesIO(content), data_only=False)
        except Exception:  # noqa: BLE001
            raise AppError(422, "invalid_file", "无法解析 Excel 文件，请上传 .xlsx 文件") from None
    return workbook


def _sheet_has_value(sheet) -> bool:
    return any(
        cell is not None and str(cell).strip() != ""
        for row in sheet.iter_rows(values_only=True)
        for cell in row
    )


def _norm_text(value: object) -> str:
    """单元格值 → 去空白字符串；None → 空串。"""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _cell(values: tuple, index: int | None) -> object:
    """按列索引取值；列不存在或行过短一律视为空值。"""
    if index is None or index >= len(values):
        return None
    return values[index]


def _fit_text(value: str, limit: int, label: str, excel_row: int, warnings: list[dict]) -> str:
    """超长文本截断并记 warning，避免数据库 DataError 升级为整批 500。"""
    if len(value) <= limit:
        return value
    warnings.append({"row": excel_row, "message": f"{label}超过 {limit} 字符，已自动截断"})
    return value[:limit]


_EXCEL_EPOCH = date(1899, 12, 30)
_DATE_FORMATS = ("%Y-%m-%d", "%Y%m%d")


def _parse_date(value: object, label: str) -> date | None:
    """把单元格解析成 date。

    支持 date/datetime、Excel 日期序列号（1~80000）、YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD、
    YYYY年MM月DD日、YYYYMMDD，日期后可带时间部分；解析不了抛 ValueError 变成行级错误。
    """
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, bool):
        raise ValueError(f"{label} 日期不正确：{value}")
    if isinstance(value, (int, float)):
        serial = float(value)
        if 1 <= serial <= 80000:
            return _EXCEL_EPOCH + timedelta(days=int(serial))
        raise ValueError(f"{label} 日期不正确：数值 {value} 不是合法的 Excel 日期序列号")

    text = _norm_text(value)
    normalized = (
        text.replace("年", "-").replace("月", "-").replace("日", "")
        .replace("/", "-").replace(".", "-")
    )
    normalized = normalized.split(" ")[0].strip().strip("-")
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(normalized, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"{label} 日期格式不正确，应为 YYYY-MM-DD（当前值：{text}）")


def _parse_number(value: object, label: str) -> float:
    """解析数字（文本数字、千分位空格均可），失败抛 ValueError。"""
    if isinstance(value, bool) or value is None:
        raise ValueError(f"{label}必须是数字")
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(_norm_text(value).replace(",", ""))
    except ValueError:
        raise ValueError(f"{label}必须是数字（当前值：{_norm_text(value)}）") from None


def _parse_work_hours(value: object) -> float | None:
    """工时：空值算未填写（None），有值必须 >= 0。"""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    number = _parse_number(value, "工时")
    if number < 0:
        raise ValueError(f"工时不能为负数（当前值：{number:g}）")
    return number


def _parse_progress(value: object) -> float:
    """进度：空值 0；接受数字或百分数文本（"80%" → 80）；必须落在 [0, 100]。"""
    text = _norm_text(value)
    if not text:
        return 0.0
    try:
        number = _parse_number(text.rstrip("%").strip(), "进度")
    except ValueError:
        raise ValueError(f"进度必须是 0 到 100 之间的数字（当前值：{text}）") from None
    if number < 0 or number > 100:
        raise ValueError(f"进度必须在 0 到 100 之间（含两端），当前值：{number:g}")
    return number


def _detect_columns(rows: list[tuple]) -> tuple[dict[str, int], list[tuple[int, tuple]]]:
    """识别表头行。

    返回 (列名 → 列索引, [(Excel 行号, 行数据)])。
    第 1 行命中任一列别名即视为表头；否则按导出文件的固定列顺序解析且全部行都是数据行。
    """
    alias_table = {
        key: tuple(alias.lower() for alias in aliases)
        for key, aliases in IMPORT_COLUMN_ALIASES.items()
    }
    columns: dict[str, int] = {}
    header = rows[0] if rows else ()
    for index, cell in enumerate(header):
        text = _norm_text(cell).lower()
        if not text:
            continue
        for key, aliases in alias_table.items():
            if key in columns:
                continue
            if text in aliases:
                columns[key] = index
                break

    if "name" not in columns and "wbs_code" not in columns:
        # 无表头：按导出文件的固定列顺序解析（第 1 行也是数据）
        return (
            {name: index for index, name in enumerate(EXPORT_HEADERS)},
            [(index + 1, tuple(row)) for index, row in enumerate(rows)],
        )

    if "name" not in columns:
        raise AppError(
            422, "invalid_file",
            "表头缺少「任务名称」列（可用列名：name / 任务名称 / 名称）",
        )
    return columns, [(index + 2, tuple(row)) for index, row in enumerate(rows[1:])]


def _parent_code(own_code: str) -> str:
    """本行编码 → 父编码：2.1.12 → 2.1；单段编码 → ""（表示顶级任务）。"""
    if "." not in own_code:
        return ""
    return own_code.rsplit(".", 1)[0].strip().strip(".")


@dataclass
class _ImportRow:
    """导入中间行（可能尚未落库），承载校验后的字段与解析出的层级关系。"""

    excel_row: int = 0
    own_code: str = ""
    parent_code: str = ""
    name: str = ""
    owner: str | None = None
    status: str = "未开始"
    priority: str | None = None
    plan_start: date | None = None
    plan_end: date | None = None
    work_hours: float | None = None
    progress: float = 0.0
    acceptance_criteria: str | None = None
    task_id: UUID = field(default_factory=uuid.uuid4)
    parent_id: UUID | None = None
    parent_key: str = ROOT_KEY
    sort_order: int = 0
    task: Task | None = None


def _build_import_row(
    excel_row: int,
    values: tuple,
    columns: dict[str, int],
    warnings: list[dict],
) -> _ImportRow:
    """单行校验与归一化；任何不合法都抛 ValueError，由调用方转成行级错误。"""
    def cell(name: str) -> object:
        return _cell(values, columns.get(name))

    name = _norm_text(cell("name"))
    if not name:
        raise ValueError("任务名称不能为空")
    if len(name) > 200:
        raise ValueError(f"任务名称超过 200 字符（当前 {len(name)} 字符）")

    own_code = _norm_text(cell("wbs_code")).strip(".")
    plan_start = _parse_date(cell("plan_start"), "计划开始")
    plan_end = _parse_date(cell("plan_end"), "计划结束")
    if plan_start and plan_end and plan_end < plan_start:
        raise ValueError(
            f"计划结束日期不能早于计划开始日期（{plan_start.isoformat()} → {plan_end.isoformat()}）"
        )

    status = _norm_text(cell("status")) or "未开始"
    owner = _norm_text(cell("owner")) or None
    priority = _norm_text(cell("priority")) or None
    criteria = _norm_text(cell("acceptance_criteria")) or None

    return _ImportRow(
        excel_row=excel_row,
        own_code=own_code,
        parent_code=_parent_code(own_code),
        name=name,
        owner=_fit_text(owner, 100, "负责人（owner）", excel_row, warnings) if owner else None,
        status=_fit_text(status, 30, "状态（status）", excel_row, warnings),
        priority=_fit_text(priority, 20, "优先级（priority）", excel_row, warnings) if priority else None,
        plan_start=plan_start,
        plan_end=plan_end,
        work_hours=_parse_work_hours(cell("work_hours")),
        progress=_parse_progress(cell("progress")),
        acceptance_criteria=criteria,
    )


@router.post("/projects/{project_id}/tasks/import")
async def import_tasks(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """批量导入任务（一次成功的导入 = 一次事务提交）。

    列语义（与 export 严格一致，保证「导出 → 导入」round-trip 不改变树结构）：
        第 1 列 wbs_code = **本行自身的 WBS 编码**（不是父编码）
        其余依 EXPORT_HEADERS 顺序：name / owner / status / priority / plan_start /
        plan_end / work_hours / progress / acceptance_criteria

    表头识别：第 1 行命中列名别名（中英文均可，见 IMPORT_COLUMN_ALIASES）即视为表头；
    没有表头时按导出文件的固定列顺序解析。整行空白的行静默跳过。

    容错规则：
        - 层级：父编码 = 本行编码去掉最后一段（2.1.12 → 2.1；单段 → 顶级）。
          父编码在本批次 → 挂到该行；在数据库现存任务中 → 挂到该任务；
          都找不到 → **作为顶级任务导入并给出 warning**（不静默、也不整行失败）。
        - progress 必须是 0~100 的数字（支持 "80%" 写法），越界 → 行级错误。
        - 日期支持 YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYY年MM月DD日 / YYYYMMDD /
          Excel 日期序列号；plan_end 早于 plan_start → 行级错误。
        - 长度超限的 owner / status / priority 自动截断并给出 warning，避免整批失败。
        - duration_days 按项目工作日历计算（与创建/更新任务的 API 语义一致：工作日数量）；
          起止日全为休息日时退回自然日（含首尾），保底至少 1 天。

    返回：{"created": int, "errors": [{"row", "message"}], "warnings": [{"row", "message"}]}
    """
    content = await file.read()
    workbook = _load_workbook(content)
    sheet = workbook.active
    raw_rows = list(sheet.iter_rows(values_only=True))
    if not raw_rows:
        raise AppError(422, "invalid_file", "Excel 文件为空，没有可导入的数据")
    columns, data_rows = _detect_columns(raw_rows)

    # ---------- 第 1 遍：全量读入内存并逐行校验，收集行级错误（不中断） ----------
    errors: list[dict] = []
    warnings: list[dict] = []
    accepted: list[_ImportRow] = []
    code_owner: dict[str, int] = {}

    for excel_row, values in data_rows:
        values = tuple(values or ())
        if not any(_norm_text(value) for value in values):
            continue
        warning_mark = len(warnings)
        try:
            row = _build_import_row(excel_row, values, columns, warnings)
        except ValueError as exc:
            del warnings[warning_mark:]  # 未通过校验的行不保留其告警
            errors.append({"row": excel_row, "message": str(exc)})
            continue
        if row.own_code in code_owner:
            del warnings[warning_mark:]
            errors.append({
                "row": excel_row,
                "message": f"WBS 编码「{row.own_code}」与第 {code_owner[row.own_code]} 行重复",
            })
            continue
        if row.own_code:
            code_owner[row.own_code] = excel_row
        accepted.append(row)

    if not accepted:
        return {"created": 0, "errors": errors, "warnings": warnings}

    # ---------- 第 2 遍：父子关系 / 排序 / 编码 / 工期 → 单次提交 ----------
    existing_tasks = wbs_service.list_tree_tasks(db, project_id)
    sort_start: dict[str, int] = {}
    for task in existing_tasks:
        key = ROOT_KEY if task.parent_id is None else str(task.parent_id)
        sort_start[key] = max(sort_start.get(key, 0), int(task.sort_order or 0) + 1)

    rows_by_code = {row.own_code: row for row in accepted if row.own_code}
    missing_codes = sorted({
        row.parent_code for row in accepted
        if row.parent_code and row.parent_code not in rows_by_code
    })
    db_parents: dict[str, UUID] = {}
    if missing_codes:
        found = db.execute(
            select(Task.id, Task.wbs_code).where(
                Task.project_id == project_id,
                Task.deleted_at.is_(None),
                Task.wbs_code.in_(missing_codes),
            )
        ).all()
        db_parents = {str(code): task_id for task_id, code in found}

    sort_next: dict[str, int] = {}
    for row in accepted:
        if row.parent_code:
            parent_row = rows_by_code.get(row.parent_code)
            if parent_row is not None:
                row.parent_id = parent_row.task_id
                row.parent_key = str(parent_row.task_id)
            elif row.parent_code in db_parents:
                row.parent_id = db_parents[row.parent_code]
                row.parent_key = str(row.parent_id)
            else:
                row.parent_key = ROOT_KEY
                warnings.append({
                    "row": row.excel_row,
                    "message": f"父编码「{row.parent_code}」不在本批次也不在现有任务中，已作为顶级任务导入",
                })
        position = sort_next.get(row.parent_key, sort_start.get(row.parent_key, 0))
        row.sort_order = position
        sort_next[row.parent_key] = position + 1

    calendar = calendar_service.load_calendar(db, project_id)
    new_tasks: list[Task] = []
    for row in accepted:
        task = Task(
            id=row.task_id,
            project_id=project_id,
            parent_id=row.parent_id,
            sort_order=row.sort_order,
            wbs_code=str(uuid.uuid4()),  # 占位，落库前统一重算
            name=row.name,
            owner=row.owner,
            collaborators=[],
            plan_start=row.plan_start,
            plan_end=row.plan_end,
            work_hours=row.work_hours,
            progress=row.progress,
            status=row.status,
            priority=row.priority,
            acceptance_criteria=row.acceptance_criteria,
        )
        if task.plan_start and task.plan_end:
            workdays = calendar_service.workdays_between(task.plan_start, task.plan_end, calendar)
            if workdays <= 0:
                # 起止日全是休息日：退回自然日（含首尾），保证工期至少 1 天
                workdays = (task.plan_end - task.plan_start).days + 1
            task.duration_days = workdays
        row.task = task
        new_tasks.append(task)
        db.add(task)

    # 显式 id + 内存中的 parent_id，使 assign_wbs_codes 能在提交前算出真实编码，
    # 从而全程只有一次 INSERT（无 uuid 占位编码、无二次 commit）
    wbs_service.assign_wbs_codes(existing_tasks + new_tasks)

    created = len(new_tasks)
    try:
        db.commit()
    except IntegrityError as exc:  # pragma: no cover - 校验已基本拦截，保留兜底
        db.rollback()
        logger.exception("批量导入任务提交失败，已整批回滚")
        raise AppError(
            422, "integrity_error",
            f"数据约束冲突：导入内容与现有数据冲突，请检查后重试（{_integrity_hint(exc)}）",
        ) from None

    _record_import_audit(db, project_id, created, errors, warnings)
    _capture_snapshot_safely(db, project_id)
    return {"created": created, "errors": errors, "warnings": warnings}


def _integrity_hint(exc: IntegrityError) -> str:
    """把 IntegrityError 压缩成一行可读提示（不暴露整段 SQL）。"""
    original = getattr(exc, "orig", None)
    detail = str(original or exc).strip().splitlines()
    return detail[0][:160] if detail else "unknown"


def _record_import_audit(
    db: Session, project_id: UUID, created: int, errors: list[dict], warnings: list[dict]
) -> None:
    """导入成功后写一条审计；失败只记日志，绝不影响已提交的数据。"""
    try:
        audit_service.record(
            db, project_id, "task", None, "import",
            f"批量导入任务：成功 {created} 条，失败 {len(errors)} 条，告警 {len(warnings)} 条",
            payload_diff={
                "created": created,
                "errors": errors[:20],
                "warnings": warnings[:20],
            },
        )
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("批量导入任务后写入审计日志失败（任务数据已提交，不影响导入结果）")
        _safe_rollback(db)


def _capture_snapshot_safely(db: Session, project_id: UUID) -> None:
    """按快照策略采集当日快照；失败只记日志。"""
    try:
        snapshot_service.maybe_capture_daily(db, project_id)
    except Exception:  # noqa: BLE001
        logger.exception("写操作后采集进度快照失败")
        _safe_rollback(db)


def _safe_rollback(db: Session) -> None:
    try:
        db.rollback()
    except Exception:  # noqa: BLE001
        logger.exception("回滚会话失败")


@router.get("/projects/{project_id}/tasks/import-template")
def download_import_template(project_id: UUID) -> StreamingResponse:
    """下载 WBS 导入模板：第 1 行为表头（与导入解析/导出列严格一致），另附填写说明表。

    说明写在独立工作表 + 表头单元格批注里，保证「任务导入」表只有表头和示例数据行，
    用户删除示例行后即可直接上传，不会把说明文字误导入成任务。
    """
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "任务导入"
    sheet.append(list(EXPORT_HEADERS))
    for index, header in enumerate(EXPORT_HEADERS, start=1):
        note = IMPORT_HEADER_COMMENTS.get(header)
        if note:
            sheet.cell(row=1, column=index).comment = Comment(note, "project-toolkit")

    for example in (
        ("1", "需求调研", "张三", "进行中", "高", "2026-10-01", "2026-10-10", 40, 30, "完成调研报告"),
        ("1.1", "现场访谈", "李四", "未开始", "中", "2026-10-01", "2026-10-05", 16, 0, "覆盖关键用户"),
        ("2", "方案设计", "王五", "未开始", "高", "2026-10-11", "2026-10-20", 24, 0, "通过评审"),
    ):
        sheet.append(list(example))
    sheet.freeze_panes = "A2"

    guide = workbook.create_sheet("填写说明")
    for line in IMPORT_GUIDE_LINES:
        guide.append([line])

    buf = io.BytesIO()
    workbook.save(buf)
    buf.seek(0)
    filename = quote(IMPORT_TEMPLATE_FILENAME)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


# ---------- 跨项目克隆 WBS ----------

def _ensure_project_exists(db: Session, project_id: UUID, label: str) -> Project:
    """项目必须存在且未删除，否则 404。"""
    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    )
    if project is None:
        raise AppError(404, "not_found", f"{label}不存在")
    return project


@router.post("/projects/{project_id}/tasks/clone-from/{source_project_id}")
def clone_tasks_from_project(
    project_id: UUID,
    source_project_id: UUID,
    with_dates: bool = False,
    db: Session = Depends(get_db),
) -> dict:
    """从另一个项目深拷贝整棵 WBS 树，追加为目标项目的顶级任务（不覆盖已有任务）。

    适用场景：电信交付项目高度同构（安防 / 云迁移 / 交调站…），新项目直接
    复用历史项目的 WBS 模板，避免逐条手搭。

    复制字段：name / owner / collaborators / work_hours / priority /
    acceptance_criteria / deliverable_name。
    重置字段（新项目不携带旧项目的执行痕迹）：status →「未开始」、progress → 0。
    不复制：actual_start / actual_end / duration_days / risk_id / progress_source
    （progress_source / duration_days 走模型默认或重算）。

    日期行为（query 参数 with_dates，默认 false）：
    - false：plan_start / plan_end 置空，duration_days 置空（新项目通常重新排期）；
    - true：连同 plan_start / plan_end 一起复制，并按 _apply_dates_and_duration
      的语义（项目工作日历）重算 duration_days；起止日全为休息日时按自然日
      （含首尾）保底至少 1 天，与导入/创建任务口径一致。

    层级与顺序：保持源项目的父子结构与同层顺序；顶级任务接在目标项目已有
    顶级任务之后（sort_order 递增）。编码在提交前统一重算（目标已有任务保持
    原有相对顺序与编码，克隆树作为新的顶级分支接续编号），全程单次 commit，
    成功后写一条审计（审计失败只记日志，不影响已提交数据）。

    边界：源项目无任务 → {"created": 0}（不报错）；源 == 目标 → 等价于整树
    复制一份（允许）；源/目标项目不存在或已删除 → 404。
    """
    target_project = _ensure_project_exists(db, project_id, "目标项目")
    source_project = _ensure_project_exists(db, source_project_id, "源项目")

    # 源树用树序（父先于子）遍历，保证建子任务时其父已在本批克隆中
    source_tasks = wbs_service.list_tasks_ordered(db, source_project_id)
    if not source_tasks:
        return {"created": 0, "with_dates": with_dates}

    target_tasks = wbs_service.list_tree_tasks(db, project_id)
    next_top_order = max(
        (task.sort_order for task in target_tasks if task.parent_id is None),
        default=-1,
    ) + 1

    calendar = calendar_service.load_calendar(db, project_id)
    cloned_by_source_id: dict[UUID, Task] = {}
    order_counters: dict[UUID | None, int] = {}
    new_tasks: list[Task] = []

    for source in source_tasks:
        parent = (
            cloned_by_source_id.get(source.parent_id)
            if source.parent_id is not None else None
        )
        # 源项目中父任务已被单独删除的孤儿节点：挂为顶级任务，不丢数据
        group_key = parent.id if parent is not None else None
        position = order_counters.get(group_key)
        if position is None:
            position = next_top_order if group_key is None else 0
        order_counters[group_key] = position + 1

        cloned = Task(
            id=uuid.uuid4(),
            project_id=project_id,
            parent_id=group_key,
            sort_order=position,
            wbs_code=str(uuid.uuid4()),  # 占位，提交前统一重算
            name=source.name,
            owner=source.owner,
            collaborators=list(source.collaborators or []),
            plan_start=source.plan_start if with_dates else None,
            plan_end=source.plan_end if with_dates else None,
            work_hours=source.work_hours,
            progress=0,
            status="未开始",
            priority=source.priority,
            acceptance_criteria=source.acceptance_criteria,
            deliverable_name=source.deliverable_name,
        )
        if with_dates and cloned.plan_start and cloned.plan_end:
            workdays = calendar_service.workdays_between(
                cloned.plan_start, cloned.plan_end, calendar
            )
            if workdays <= 0:
                workdays = (cloned.plan_end - cloned.plan_start).days + 1
            cloned.duration_days = workdays
        cloned_by_source_id[source.id] = cloned
        new_tasks.append(cloned)
        db.add(cloned)

    # 目标已有任务 + 克隆树一起重算编码：已有任务相对顺序不变（编码稳定），
    # 克隆树作为新的顶级分支接在其后，编号连续且不会与既有编码冲突
    wbs_service.assign_wbs_codes(target_tasks + new_tasks)

    try:
        db.commit()
    except IntegrityError as exc:  # pragma: no cover - 常规克隆无约束冲突，保留兜底
        db.rollback()
        logger.exception("跨项目克隆 WBS 提交失败，已整批回滚")
        raise AppError(
            422, "integrity_error",
            f"数据约束冲突：克隆任务与现有数据冲突（{_integrity_hint(exc)}）",
        ) from None

    created = len(new_tasks)
    try:
        audit_service.record(
            db, project_id, "task", None, "clone",
            f"跨项目复制 WBS：从项目 {source_project.code} 复制 {created} 条任务到 "
            f"{target_project.code}（with_dates={'是' if with_dates else '否'}）",
            payload_diff={
                "source_project_id": str(source_project_id),
                "created": created,
                "with_dates": with_dates,
            },
        )
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("跨项目克隆 WBS 后写入审计日志失败（任务数据已提交，不影响克隆结果）")
        _safe_rollback(db)

    _capture_snapshot_safely(db, project_id)
    return {"created": created, "with_dates": with_dates}