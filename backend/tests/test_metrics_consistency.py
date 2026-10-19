"""进度口径一致性回归测试（本轮 P0-3 / P0-4 / 时区修复的回归锁）。

统一口径见 app/services/progress.py::project_metrics：
- 叶子任务 = 集合内没有子任务的任务；父任务自身 progress 不参与计算
- 权重 = work_hours > 0 取其值，否则 1.0
- progress = Σ(w × p) / Σ(w)（只遍历叶子，缺 progress 记 0）
- total_hours / remaining_hours 只累计叶子，父任务工时不再重复计入

覆盖点：
1. WBS 树序排列（1.1 … 1.12，而非字符串序 1.1, 1.10, 1.11, 1.12, 1.2 …）
2. 工时只统计叶子（父任务 2 个子任务各 10h → 20h，旧口径 40h）
3. 驾驶舱进度 == WBS 根任务 effective_progress（round 1 位小数）
4. 快照 remaining_hours ≤ total_hours，且父任务工时不被重复计入

运行环境：依赖容器内 Postgres（conftest 会重建 pt_test 库并跑迁移），本机无法执行。
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.core.time import today_local
from app.services import wbs as wbs_service
from app.services.progress import project_metrics


def _project(client, code="MC-001") -> str:
    resp = client.post("/api/projects", json={"code": code, "name": "口径一致性项目"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _task(client, project_id, name, parent_id=None, **extra) -> dict:
    payload = {"name": name, "parent_id": parent_id, **extra}
    resp = client.post(f"/api/projects/{project_id}/tasks", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _load_tasks(db_session, project_id: str):
    """按项目读取全部任务（树序）。"""
    return wbs_service.list_tasks_ordered(db_session, uuid.UUID(project_id))


def _root_task(client, project_id: str) -> dict:
    """WBS 页根任务（编码 '1'）及其 effective_progress。"""
    items = client.get(f"/api/projects/{project_id}/tasks").json()["items"]
    return next(t for t in items if t["wbs_code"] == "1")


# ---------- 1. WBS 编码排序（P0-4） ----------

def test_wbs_sorted_numerically(client):
    """12 个兄弟子任务必须按 1.1 … 1.12 排列（字符串序会把 1.10 排在 1.2 前）。"""
    pid = _project(client, "MC-ORD")
    parent = _task(client, pid, "P")

    for index in range(1, 13):
        _task(client, pid, f"子{index}", parent_id=parent["id"])

    items = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    children = [t["wbs_code"] for t in items if t["parent_id"] == parent["id"]]
    assert children == [f"1.{i}" for i in range(1, 13)]
    # 树序：父任务排在所有子任务之前
    assert items[0]["wbs_code"] == "1"
    assert items[0]["name"] == "P"


def test_wbs_sort_key_numeric():
    """wbs_sort_key 按数值段比较：非法段（DEL- 前缀）用大数兜底排最后。"""
    codes = ["1.10", "1.2", "2", "1", "DEL-0a1b2c3d4e5f", "1.11.8", "2.1.12.1.4"]
    assert sorted(codes, key=wbs_service.wbs_sort_key) == [
        "1",
        "1.2",
        "1.10",
        "1.11.8",
        "2",
        "2.1.12.1.4",
        "DEL-0a1b2c3d4e5f",
    ]


# ---------- 2. 工时只统计叶子（P0-3） ----------

def test_metrics_leaf_only_hours(client, db_session):
    """父任务自身工时不再重复计入：2 个叶子各 10h → total_hours 20（旧口径 40）。"""
    pid = _project(client, "MC-HRS")
    parent = _task(client, pid, "父任务", work_hours=10)
    _task(client, pid, "子1", parent_id=parent["id"], work_hours=10, progress=50)
    _task(client, pid, "子2", parent_id=parent["id"], work_hours=10, progress=0)

    metrics = project_metrics(_load_tasks(db_session, pid))
    assert metrics["total_hours"] == 20.0
    # 工时加权进度：(10×50 + 10×0) / 20 = 25.0
    assert metrics["progress"] == 25.0
    # 剩余工时：10×(1-0.5) + 10×1 = 15.0
    assert metrics["remaining_hours"] == 15.0
    assert metrics["total_tasks"] == 3
    assert metrics["leaf_tasks"] == 2
    assert metrics["completed_tasks"] == 0
    assert metrics["remaining_tasks"] == 2


def test_metrics_empty_project():
    """空项目不报错，进度为 0.0，其余计数为 0。"""
    metrics = project_metrics([])
    assert metrics == {
        "progress": 0.0,
        "total_hours": 0,
        "remaining_hours": 0,
        "total_tasks": 0,
        "leaf_tasks": 0,
        "completed_tasks": 0,
        "remaining_tasks": 0,
    }


# ---------- 3. 驾驶舱 == WBS 根任务有效进度 ----------

def test_overview_progress_matches_wbs_root(client):
    """驾驶舱项目行 progress 必须等于 WBS 页根任务 effective_progress（round 1 位）。"""
    pid = _project(client, "MC-OV")
    parent = _task(client, pid, "父任务")
    _task(client, pid, "子1", parent_id=parent["id"], work_hours=10, progress=100)
    _task(client, pid, "子2", parent_id=parent["id"], work_hours=30, progress=50)

    root = _root_task(client, pid)
    row = next(p for p in client.get("/api/overview").json()["projects"] if p["id"] == pid)

    # 根任务有效进度 = (10×100 + 30×50) / 40 = 62.5
    assert root["effective_progress"] == 62.5
    assert row["progress"] == round(root["effective_progress"], 1)
    assert row["progress"] == 62.5
    assert row["task_total"] == 3


# ---------- 4. 快照工时（燃尽图起点） ----------

def test_snapshot_hours_leaf_only(client):
    """快照工时只取叶子，且 remaining_hours ≤ total_hours。"""
    pid = _project(client, "MC-SNAP")
    parent = _task(client, pid, "父任务", work_hours=10)
    _task(client, pid, "子1", parent_id=parent["id"], work_hours=10, progress=50)
    _task(client, pid, "子2", parent_id=parent["id"], work_hours=10, progress=0)

    snap = client.post(f"/api/projects/{pid}/snapshots").json()
    assert snap["total_hours"] == 20.0  # 父任务自带 10h 不再重复计入
    assert snap["remaining_hours"] == 15.0
    assert snap["remaining_hours"] <= snap["total_hours"]
    assert snap["total_tasks"] == 3
    assert snap["completed_tasks"] == 0
    assert snap["remaining_tasks"] == 2


# ---------- 5. 报告与统一口径一致 ----------

def test_weekly_report_progress_matches_wbs_root(client):
    """周报文本里的完成进度必须与 WBS 根任务有效进度一致。"""
    pid = _project(client, "MC-RPT")
    parent = _task(client, pid, "父任务")
    _task(client, pid, "子1", parent_id=parent["id"], work_hours=10, progress=100)
    _task(client, pid, "子2", parent_id=parent["id"], work_hours=30, progress=50)

    content = client.get(f"/api/projects/{pid}/reports/weekly-text").json()["content"]
    root = _root_task(client, pid)
    assert f"完成进度 {round(root['effective_progress'], 1)}%" in content


# ---------- 6. 时区统一 ----------

def test_today_local_is_shanghai_date():
    """today_local 返回北京时间日期（等价于 UTC+8，上海无夏令时）。

    容器时区通常是 UTC，若退回 date.today() 会在 00:00~08:00 之间差一天。
    """
    expected = (datetime.now(timezone.utc) + timedelta(hours=8)).date()
    assert today_local() == expected
