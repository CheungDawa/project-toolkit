"""进度汇总服务（TD-02 / D-04）：默认工时加权，无工时等权重。

父任务 progress 为权威计算值，不落库（DM-3）；人工校正通过 progress_source 标记。
"""
from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from app.models.task import Task


def _children_map(tasks: list[Task]) -> dict[UUID | None, list[Task]]:
    children: dict[UUID | None, list[Task]] = defaultdict(list)
    for task in tasks:
        children[task.parent_id].append(task)
    return children


def _task_weight(task: Task) -> float:
    if task.work_hours is not None and task.work_hours > 0:
        return float(task.work_hours)
    return 1.0


def compute_progress(tasks: list[Task]) -> dict[UUID, float]:
    """对全部任务计算有效进度：叶子取自身 progress，父任务按子树汇总。"""
    children = _tree_map(tasks)
    memo: dict[UUID, float] = {}

    def walk(task: Task) -> float:
        own = float(task.progress) if task.progress is not None else 0.0
        kids = children.get(task.id, [])
        if not kids:
            memo[task.id] = own
            return own
        weights = [_task_weight(kid) for kid in kids]
        values = [walk(kid) for kid in kids]
        total_weight = sum(weights)
        if total_weight <= 0:
            total_weight = float(len(kids))
        memo[task.id] = sum(v * w for v, w in zip(values, weights)) / total_weight
        return memo[task.id]

    for task in tasks:
        if task.id not in memo:
            walk(task)
    return memo


def _tree_map(tasks: list[Task]) -> dict[UUID, list[Task]]:
    children: dict[UUID, list[Task]] = defaultdict(list)
    for task in tasks:
        if task.parent_id is not None:
            children[task.parent_id].append(task)
    return children