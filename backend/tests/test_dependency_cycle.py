"""依赖管理与循环校验测试（A2-4）。"""


def _project(client, code="DEP-001") -> str:
    resp = client.post("/api/projects", json={"code": code, "name": "依赖测试"})
    return resp.json()["id"]


def _task(client, pid, name) -> str:
    resp = client.post(f"/api/projects/{pid}/tasks", json={"name": name})
    return resp.json()["id"]


def _dep(client, pid, pred, succ, dep_type="FS"):
    return client.post(
        f"/api/projects/{pid}/dependencies",
        json={"predecessor_id": pred, "successor_id": succ, "dep_type": dep_type},
    )


def test_dependency_cycle_rejected(client):
    pid = _project(client)
    a, b, c = _task(client, pid, "A"), _task(client, pid, "B"), _task(client, pid, "C")
    assert _dep(client, pid, a, b).status_code == 201
    assert _dep(client, pid, b, c).status_code == 201
    resp = _dep(client, pid, c, a)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "dependency_cycle"


def test_self_dependency_rejected(client):
    pid = _project(client)
    a = _task(client, pid, "A")
    resp = _dep(client, pid, a, a)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "self_dependency"


def test_duplicate_dependency_rejected(client):
    pid = _project(client)
    a, b = _task(client, pid, "A"), _task(client, pid, "B")
    assert _dep(client, pid, a, b).status_code == 201
    assert _dep(client, pid, a, b).status_code == 422


def test_dependency_list_and_delete(client):
    pid = _project(client)
    a, b = _task(client, pid, "A"), _task(client, pid, "B")
    dep = _dep(client, pid, a, b).json()
    listed = client.get(f"/api/projects/{pid}/dependencies").json()
    assert len(listed) == 1
    assert listed[0]["id"] == dep["id"]
    assert client.delete(f"/api/dependencies/{dep['id']}").status_code == 204
    assert client.get(f"/api/projects/{pid}/dependencies").json() == []


def test_dependency_across_projects_rejected(client):
    pid1, pid2 = _project(client, "DEP-001"), _project(client, "DEP-002")
    a = _task(client, pid1, "A")
    b = _task(client, pid2, "B")
    resp = _dep(client, pid1, a, b)
    assert resp.status_code == 404