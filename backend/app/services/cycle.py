"""依赖循环检测（阶段 2 甘特条7 / A2-4：循环依赖被拒绝）。"""
from collections import defaultdict, deque
from uuid import UUID

from app.models.task import TaskDependency


def would_create_cycle(dependencies: list[TaskDependency], predecessor_id: UUID, successor_id: UUID) -> bool:
    """新增边 predecessor→successor 前检查：若 successor 已可达 predecessor 则成环。"""
    if predecessor_id == successor_id:
        return True
    adj: dict[UUID, list[UUID]] = defaultdict(list)
    for dep in dependencies:
        adj[dep.predecessor_id].append(dep.successor_id)
    return _reachable(adj, successor_id, predecessor_id)


def _reachable(adj: dict[UUID, list[UUID]], start: UUID, target: UUID) -> bool:
    seen: set[UUID] = set()
    queue = deque([start])
    while queue:
        node = queue.popleft()
        if node == target:
            return True
        if node in seen:
            continue
        seen.add(node)
        queue.extend(adj.get(node, []))
    return False