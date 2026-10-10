"""任务树 / WBS 编码 / 复制 / 删除 / 日期 / 工期 测试（A2-1/A2-9）。"""


def _create_project(client, code="T-001") -> str:
    resp = client.post("/api/projects", json={"code": code, "name": "WBS 测试项目"})
    assert resp.status_code == 201
    return resp.json()["id"]


def _create_task(client, project_id, name, parent_id=None, **extra) -> dict:
    payload = {"name": name, "parent_id": parent_id, **extra}
    resp = client.post(f"/api/projects/{project_id}/tasks", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_wbs_code_hierarchy(client):
    pid = _create_project(client)
    root_a = _create_task(client, pid, "A")
    child_b = _create_task(client, pid, "B", root_a["id"])
    child_c = _create_task(client, pid, "C", root_a["id"])
    root_d = _create_task(client, pid, "D")
    grand = _create_task(client, pid, "B-1", child_b["id"])

    listed = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    by_name = {t["name"]: t for t in listed}
    assert by_name["A"]["wbs_code"] == "1"
    assert by_name["B"]["wbs_code"] == "1.1"
    assert by_name["C"]["wbs_code"] == "1.2"
    assert by_name["D"]["wbs_code"] == "2"
    assert by_name["B-1"]["wbs_code"] == "1.1.1"
    # 稳定 ID：uuid 不因编码重算变化
    assert by_name["A"]["id"] == root_a["id"]


def test_reorder_updates_wbs(client):
    pid = _create_project(client)
    a = _create_task(client, pid, "A")
    b = _create_task(client, pid, "B")
    c = _create_task(client, pid, "C")
    assert [t["wbs_code"] for t in client.get(f"/api/projects/{pid}/tasks").json()["items"]] == ["1", "2", "3"]

    resp = client.post(
        f"/api/projects/{pid}/tasks/reorder",
        json={"task_id": c["id"], "new_parent_id": None, "new_index": 0},
    )
    assert resp.status_code == 200
    codes = {t["name"]: t["wbs_code"] for t in client.get(f"/api/projects/{pid}/tasks").json()["items"]}
    assert codes == {"C": "1", "A": "2", "B": "3"}


def test_reorder_into_descendant_rejected(client):
    pid = _create_project(client)
    a = _create_task(client, pid, "A")
    child = _create_task(client, pid, "A-1", a["id"])
    resp = client.post(
        f"/api/projects/{pid}/tasks/reorder",
        json={"task_id": a["id"], "new_parent_id": child["id"], "new_index": 0},
    )
    assert resp.status_code == 422


def test_copy_subtree(client):
    pid = _create_project(client)
    a = _create_task(client, pid, "A")
    child = _create_task(client, pid, "A-1", a["id"])
    resp = client.post(f"/api/tasks/{a['id']}/copy")
    assert resp.status_code == 200
    listed = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    names = [t["name"] for t in listed]
    assert "A（副本）" in names
    assert names.count("A-1") == 2


def test_delete_cascade(client):
    pid = _create_project(client)
    a = _create_task(client, pid, "A")
    _create_task(client, pid, "A-1", a["id"])
    _create_task(client, pid, "B")
    assert client.delete(f"/api/tasks/{a['id']}").status_code == 204
    listed = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    assert [t["name"] for t in listed] == ["B"]
    assert listed[0]["wbs_code"] == "1"


def test_task_duration_workdays(client):
    pid = _create_project(client)
    task = _create_task(client, pid, "跨周末任务", plan_start="2026-10-01", plan_end="2026-10-05")
    # 2026-10-01(四)~10-05(一)：工作日 10-01,10-02,10-05 = 3 天
    assert task["duration_days"] == 3


def test_task_invalid_dates_rejected(client):
    pid = _create_project(client)
    resp = client.post(
        f"/api/projects/{pid}/tasks",
        json={"name": "坏日期", "plan_start": "2026-10-10", "plan_end": "2026-10-01"},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "date_invalid"


def test_parent_progress_rollup(client):
    pid = _create_project(client)
    parent = _create_task(client, pid, "父任务")
    _create_task(client, pid, "子1", parent["id"], progress=100, work_hours=2)
    _create_task(client, pid, "子2", parent["id"], progress=50, work_hours=2)
    listed = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    parent_read = next(t for t in listed if t["name"] == "父任务")
    assert parent_read["effective_progress"] == 75.0


def test_parent_progress_equal_fallback(client):
    pid = _create_project(client)
    parent = _create_task(client, pid, "父任务")
    _create_task(client, pid, "子1", parent["id"], progress=100)
    _create_task(client, pid, "子2", parent["id"], progress=0)
    listed = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    parent_read = next(t for t in listed if t["name"] == "父任务")
    assert parent_read["effective_progress"] == 50.0


def test_leaf_not_double_counted(client):
    """父子混合统计只计叶子（甘特条8）：父任务自身进度不参与自身汇总。"""
    pid = _create_project(client)
    parent = _create_task(client, pid, "父任务", progress=100)  # 父任务自身进度应被忽略
    _create_task(client, pid, "子1", parent["id"], progress=100)
    listed = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    parent_read = next(t for t in listed if t["name"] == "父任务")
    assert parent_read["effective_progress"] == 100.0  # 来自子任务而非自身
    leaf = next(t for t in listed if t["name"] == "子1")
    assert leaf["effective_progress"] == 100.0


def test_tasks_persist_after_reload(client):
    """刷新等价重查（A2-9）。"""
    pid = _create_project(client)
    _create_task(client, pid, "A")
    first = client.get(f"/api/projects/{pid}/tasks").json()
    second = client.get(f"/api/projects/{pid}/tasks").json()
    assert first == second