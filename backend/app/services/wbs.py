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


# WBS 编码中非数字段（如已删除任务的 DEL- 前缀）的排序兜底值，确保排在最后
_WBS_NON_NUMERIC = 10 ** 6


def wbs_sort_key(code: str | None) -> tuple:
    """WBS 编码数值化排序键：'1.10' > '1.2'，非法段用大数兜底。"""
    if not code:
        return (_WBS_NON_NUMERIC,)
    segments: list[int] = []
    for part in str(code).split("."):
        try:
            segments.append(int(part.strip()))
        except (TypeError, ValueError):
            segments.append(_WBS_NON_NUMERIC)
    return tuple(segments)


def _sort_key(task: Task) -> tuple:
    """同层排序键：sort_order 优先，其次创建时间（None 视为 0）。"""
    created = task.created_at.timestamp() if task.created_at is not None else 0.0
    return (task.sort_order, created)


def sort_tasks_by_tree(tasks: list[Task]) -> list[Task]:
    """按树序 DFS 排列任务（父在前、子紧随其后，同层按 sort_order/created_at）。

    根节点定义：parent_id 为空，或 parent_id 指向的任务不在集合内（已删除 / 被过滤）。
    使用显式栈迭代，避免深树递归爆栈；并对环做访问标记，保证不会死循环。
    """
    known_ids = {task.id for task in tasks}
    children: dict[UUID | None, list[Task]] = defaultdict(list)
    for task in tasks:
        parent_key = task.parent_id if task.parent_id in known_ids else None
        children[parent_key].append(task)
    for siblings in children.values():
        siblings.sort(key=_sort_key)

    ordered: list[Task] = []
    visited: set[UUID] = set()

    def drain(roots: list[Task]) -> None:
        stack: list[Task] = list(reversed(roots))
        while stack:
            task = stack.pop()
            if task.id in visited:
                continue
            visited.add(task.id)
            ordered.append(task)
            for child in reversed(children.get(task.id, [])):
                if child.id not in visited:
                    stack.append(child)

    drain(children.get(None, []))
    # 纯环等异常数据：补充从剩余节点出发再排一次，保证不丢任务
    while True:
        remaining = [task for task in tasks if task.id not in visited]
        if not remaining:
            break
        drain([remaining[0]])

    return ordered


def list_tasks_ordered(db: Session, project_id: UUID) -> list[Task]:
    """取项目任务并按树序 DFS 排列（替代原 wbs_code 字符串排序）。

    字符串排序会把 '1.10' 排在 '1.2' 之前；树序同时保证父任务先于子任务出现，
    影响 GET tasks / Excel 导出 / 报告任务表 / 基线快照顺序。
    """
    return sort_tasks_by_tree(list_tree_tasks(db, project_id))


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