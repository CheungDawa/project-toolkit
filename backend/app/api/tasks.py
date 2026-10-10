"""任务 API：CRUD / 树 / 排序 / 复制 / 删除 / Excel 导入导出（阶段 2 WBS条1-7）。"""
import io
import uuid
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.task import Task, TaskDependency
from app.schemas.task import (
    DependencyRead,
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
    return _to_read(task, _get_effective_map(db, task.project_id))


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: UUID, db: Session = Depends(get_db)) -> None:
    task = _get_live(db, task_id)
    subtree = wbs_service.find_subtree_ids(db, task.project_id, task_id)
    for item in db.scalars(select(Task).where(Task.id.in_(subtree))).all():
        item.deleted_at = _utcnow()
    db.commit()
    wbs_service.recompute_codes(db, task.project_id)


@router.post("/tasks/{task_id}/copy", response_model=TaskRead)
def copy_task(task_id: UUID, db: Session = Depends(get_db)) -> TaskRead:
    source = _get_live(db, task_id)
    copied = _copy_subtree(db, source, None)
    db.commit()
    wbs_service.recompute_codes(db, source.project_id)
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


@router.post("/projects/{project_id}/tasks/import")
async def import_tasks(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    content = await file.read()
    try:
        wb = load_workbook(io.BytesIO(content))
    except Exception:  # noqa: BLE001
        raise AppError(422, "invalid_file", "无法解析 Excel 文件") from None
    ws = wb.active
    rows = list(ws.iter_rows(min_row=2, values_only=True))

    created = 0
    errors: list[dict] = []
    for row_index, row in enumerate(rows, start=2):
        values = list(row) + [None] * 10
        wbs_code, name, owner, status, priority, plan_start, plan_end, work_hours, progress, criteria = values[:10]
        try:
            if not name or not str(name).strip():
                raise ValueError("任务名称不能为空")
            parent = None
            if wbs_code:
                parent = db.scalar(
                    select(Task).where(
                        Task.project_id == project_id,
                        Task.wbs_code == str(wbs_code).strip(),
                        Task.deleted_at.is_(None),
                    )
                )
                if parent is None:
                    raise ValueError(f"父 WBS 不存在：{wbs_code}")
            task = Task(
                project_id=project_id,
                parent_id=parent.id if parent else None,
                wbs_code=str(uuid.uuid4()),  # 占位唯一，导入完成后重算
                name=str(name).strip(),
                owner=str(owner).strip() if owner not in (None, "") else None,
                status=str(status).strip() if status not in (None, "") else "未开始",
                priority=str(priority).strip() if priority not in (None, "") else None,
                plan_start=_to_date(plan_start),
                plan_end=_to_date(plan_end),
                work_hours=float(work_hours) if work_hours not in (None, "") else None,
                progress=float(progress) if progress not in (None, "") else 0,
                acceptance_criteria=str(criteria).strip() if criteria not in (None, "") else None,
            )
            if task.plan_start and task.plan_end and task.plan_end < task.plan_start:
                raise ValueError("计划结束日期早于开始日期")
            db.add(task)
            created += 1
        except Exception as exc:  # noqa: BLE001
            errors.append({"row": row_index, "message": str(exc)})
    db.commit()
    wbs_service.recompute_codes(db, project_id)
    return {"created": created, "errors": errors}


def _to_date(value) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value).strip()[:10])