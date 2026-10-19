"""进度汇总服务（TD-02 / D-04）：默认工时加权，无工时等权重。

父任务 progress 为权威计算值，不落库（DM-3）；人工校正通过 progress_source 标记。

统一口径规则（project_metrics 与 compute_progress 共用，全系统唯一）：
- 汇总只依据叶子任务的工时与进度，**中间层任务自身的工时与进度不参与汇总**。
  工作应分解到叶子任务承载；若中间层确实有独立工作量，请为其建立叶子子任务。
- 权重 = work_hours > 0 时取其值，否则 1.0；父任务进度 = Σ(w × p) / Σ(w)，
  其中 w / p 均取自该子树下的全部叶子（等价于「按叶子工时加权」）。
- 由此保证：驾驶舱进度 == WBS 根任务 effective_progress 在任何树结构下都成立。
"""
from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from app.models.task import Task

# 任务状态：已完成（与前端 TASK_STATUS_OPTIONS 保持一致）
STATUS_DONE = "已完成"


def _children_map(tasks: list[Task]) -> dict[UUID | None, list[Task]]:
    children: dict[UUID | None, list[Task]] = defaultdict(list)
    for task in tasks:
        children[task.parent_id].append(task)
    return children


def _tree_map(tasks: list[Task]) -> dict[UUID, list[Task]]:
    children: dict[UUID, list[Task]] = defaultdict(list)
    for task in tasks:
        if task.parent_id is not None:
            children[task.parent_id].append(task)
    return children


def _task_weight(task: Task) -> float:
    if task.work_hours is not None and task.work_hours > 0:
        return float(task.work_hours)
    return 1.0


def _leaf_progress(task: Task) -> float:
    """任务的进度值，缺失视为 0。"""
    if task.progress is None:
        return 0.0
    return float(task.progress)


def _leaf_hours(task: Task) -> float:
    """任务的工时值，缺失视为 0。"""
    if task.work_hours is None:
        return 0.0
    return float(task.work_hours)


def _is_done(task: Task) -> bool:
    """任务是否已完成：状态为已完成，或进度已达 100%。"""
    if task.status == STATUS_DONE:
        return True
    return _leaf_progress(task) >= 100.0


def leaf_tasks(tasks: list[Task]) -> list[Task]:
    """叶子任务集合：在给定集合内没有任何子任务的任务。

    父任务被软删除 / 父任务不在当前集合内时，其子任务同样视为叶子。
    """
    parent_ids = {task.parent_id for task in tasks if task.parent_id is not None}
    return [task for task in tasks if task.id not in parent_ids]


def compute_progress(tasks: list[Task]) -> dict[UUID, float]:
    """对全部任务计算有效进度：叶子取自身 progress，父任务按子树「叶子工时」加权汇总。

    与 project_metrics 共用同一口径，保证「驾驶舱进度 == WBS 根任务 effective_progress」。
    实现为迭代式后序遍历（显式栈），避免深树递归爆栈；重复/环形数据不会死循环。
    """
    children = _tree_map(tasks)

    # 后序遍历：子节点先于父节点进入 order
    order: list[Task] = []
    visited: set[UUID] = set()
    for task in tasks:
        if task.id in visited:
            continue
        stack: list[tuple[Task, bool]] = [(task, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                order.append(node)
                continue
            if node.id in visited:
                continue
            visited.add(node.id)
            stack.append((node, True))
            for child in children.get(node.id, []):
                if child.id not in visited:
                    stack.append((child, False))

    weighted: dict[UUID, float] = {}  # Σ(w × p)：子树叶子的加权进度和
    weights: dict[UUID, float] = {}  # Σ(w)：子树叶子的权重和
    memo: dict[UUID, float] = {}

    for task in order:
        kids = children.get(task.id, [])
        if not kids:
            own_weight = _task_weight(task)
            own_progress = _leaf_progress(task)
            weighted[task.id] = own_weight * own_progress
            weights[task.id] = own_weight
            memo[task.id] = own_progress
            continue
        # 父任务：权重与进度全部来自子树叶子；中间层自身的工时与进度不参与
        total_weighted = sum(weighted.get(kid.id, 0.0) for kid in kids)
        total_weight = sum(weights.get(kid.id, 0.0) for kid in kids)
        if total_weight <= 0:
            total_weight = float(len(kids))
            total_weighted = sum(memo.get(kid.id, 0.0) for kid in kids)
        weighted[task.id] = total_weighted
        weights[task.id] = total_weight
        memo[task.id] = total_weighted / total_weight

    return memo


def project_metrics(tasks: list[Task]) -> dict:
    """全系统唯一的进度/工时口径（驾驶舱 / 快照 / 报告共用）。

    - 叶子任务 = 没有任何子任务的任务；父任务自身的 progress 与 work_hours 不参与计算
    - 权重 = work_hours > 0 时取其值，否则 1.0
    - progress = Σ(weight × progress) / Σ(weight)，只遍历叶子（缺 progress 记 0）
    - total_hours = Σ 叶子的 (work_hours or 0)
    - remaining_hours = Σ 叶子的 (work_hours or 0) × (1 - progress/100)
      特例（有意为之，勿当 bug 改掉）：已完成叶子（status=已完成 或 progress≥100）
      剩余工时按 0 计——燃尽图不应保留已闭环工作的余额，且与看板拖到「已完成」
      自动置 100%（KanbanPage.tsx）的产品行为一致
    - 计数：total_tasks = 全部任务数；leaf_tasks / completed_tasks /
      remaining_tasks 只统计叶子，避免父子重复计数

    返回 dict：progress（round 1 位小数）、total_hours、remaining_hours、
    total_tasks、leaf_tasks、completed_tasks、remaining_tasks。
    """
    leaves = leaf_tasks(tasks)

    weighted_sum = 0.0
    weight_sum = 0.0
    total_hours = 0.0
    remaining_hours = 0.0
    completed_tasks = 0

    for leaf in leaves:
        progress = _leaf_progress(leaf)
        hours = _leaf_hours(leaf)
        weight = _task_weight(leaf)

        weighted_sum += weight * progress
        weight_sum += weight
        total_hours += hours
        # 已完成（或进度 100%）的任务剩余工时为 0
        remaining_hours += 0.0 if _is_done(leaf) else hours * (1 - progress / 100.0)
        if leaf.status == STATUS_DONE:
            completed_tasks += 1

    progress_value = round(weighted_sum / weight_sum, 1) if weight_sum > 0 else 0.0
    return {
        "progress": progress_value,
        "total_hours": round(total_hours, 2),
        "remaining_hours": round(remaining_hours, 2),
        "total_tasks": len(tasks),
        "leaf_tasks": len(leaves),
        "completed_tasks": completed_tasks,
        "remaining_tasks": len(leaves) - completed_tasks,
    }
