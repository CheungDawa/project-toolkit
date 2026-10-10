"""计划基线测试（BR-02 / A2-6）。"""


def _project(client) -> str:
    resp = client.post("/api/projects", json={"code": "BASE-001", "name": "基线测试"})
    return resp.json()["id"]


def _task(client, pid, name, **extra) -> dict:
    resp = client.post(f"/api/projects/{pid}/tasks", json={"name": name, **extra})
    return resp.json()


def test_baseline_snapshot_immutable(client):
    pid = _project(client)
    a = _task(client, pid, "A", plan_start="2026-10-01", plan_end="2026-10-05", progress=10)
    b = _task(client, pid, "B")

    resp = client.post(f"/api/projects/{pid}/baselines", json={"name": "基线1"})
    assert resp.status_code == 201
    baseline = resp.json()
    assert baseline["version"] == 1

    # 修改当前计划
    updated = client.patch(
        f"/api/tasks/{a['id']}",
        json={"plan_start": "2026-11-01", "plan_end": "2026-11-05", "progress": 80},
    )
    assert updated.status_code == 200

    diff = client.get(f"/api/projects/{pid}/baselines/{baseline['id']}/diff").json()
    row_a = next(r for r in diff if r["wbs_code"] == "1")
    assert row_a["changed"] is True
    assert row_a["current"]["plan_start"] == "2026-11-01"
    # 基线侧保持冻结时值
    assert row_a["baseline"]["plan_start"] == "2026-10-01"
    assert row_a["baseline"]["progress"] == 10.0
    row_b = next(r for r in diff if r["wbs_code"] == "2")
    assert row_b["changed"] is False


def test_baseline_version_increments(client):
    pid = _project(client)
    _task(client, pid, "A")
    client.post(f"/api/projects/{pid}/baselines", json={"name": "v1"})
    resp = client.post(f"/api/projects/{pid}/baselines", json={"name": "v2"})
    assert resp.status_code == 201
    assert resp.json()["version"] == 2


def test_baseline_empty_plan_rejected(client):
    pid = _project(client)
    resp = client.post(f"/api/projects/{pid}/baselines", json={"name": "空基线"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "empty_plan"