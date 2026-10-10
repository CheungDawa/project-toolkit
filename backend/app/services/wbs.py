"""WBS 编码与任务树服务（阶段 2 WBS条3：稳定任务 ID + 可重算编码）。"""
from collections import defaultdict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.task import Task


def list_tree_tasks(db: Session, project_id: UUID) -> list[Task]:
    """按 project 取全部未删除任务（含父任务），按 sort_order 排序。"""
    stmt = (
        select(Task)
        .where(Task.project_id == project_id, Task.deleted_at.is_(None))
        .order_by(Task.sort_order, Task.created_at)
    )
    return list(db.scalars(stmt).all())


def _build_children(tasks: list[Task]) -> dict[UUID | None, list[Task]]:
    children: dict[UUID | None, list[Task]] = defaultdict(list)
    for task in tasks:
        children[task.parent_id].append(task)
    return children


def assign_wbs_codes(tasks: list[Task]) -> None:
    """按当前树结构与 sort_order 重算全部 WBS 编码（1 / 1.1 / 1.1.1）。"""
    children = _build_children(tasks)

    def walk(parent_id: UUID | None, prefix: str) -> None:
        for index, task in enumerate(children.get(parent_id, []), start=1):
            code = f"{prefix}{index}" if not prefix else f"{prefix}.{index}"
            task.wbs_code = code
            walk(task.id, code)

    walk(None, "")


def list_tasks_ordered(db: Session, project_id: UUID) -> list[Task]:
    stmt = (
        select(Task)
        .where(Task.project_id == project_id, Task.deleted_at.is_(None))
        .order_by(Task.wbs_code)
    )
    return list(db.scalars(stmt).all())


def recompute_codes(db: Session, project_id: UUID) -> None:
    """对项目内全部任务重算编码并落库（赋值后必须 commit）。"""
    tasks = list_tree_tasks(db, project_id)
    assign_wbs_codes(tasks)
    db.commit()


def find_subtree_ids(db: Session, project_id: UUID, root_id: UUID) -> set[UUID]:
    """含 root 在内的全部子孙任务 id（软删除过滤）。"""
    tasks = list_tasks_ordered(db, project_id)
    by_parent: dict[UUID | None, list[Task]] = defaultdict(list)
    for task in tasks:
        by_parent[task.parent_id].append(task)

    ids: set[UUID] = set()

    def walk(task_id: UUID) -> None:
        ids.add(task_id)
        for child in by_parent.get(task_id, []):
            walk(child.id)

    walk(root_id)
    return ids