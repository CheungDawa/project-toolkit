"""里程碑 CRUD 测试（FR-P0-18）。"""


def test_milestone_crud(client):
    resp = client.post("/api/projects", json={"code": "MS-001", "name": "里程碑测试"})
    pid = resp.json()["id"]

    created = client.post(
        f"/api/projects/{pid}/milestones",
        json={"name": "初验", "plan_date": "2026-12-01", "status": "计划中"},
    )
    assert created.status_code == 201
    mid = created.json()["id"]

    listed = client.get(f"/api/projects/{pid}/milestones").json()
    assert len(listed) == 1
    assert listed[0]["name"] == "初验"

    updated = client.patch(f"/api/milestones/{mid}", json={"status": "已完成", "actual_date": "2026-12-05"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "已完成"

    assert client.delete(f"/api/milestones/{mid}").status_code == 204
    assert client.get(f"/api/projects/{pid}/milestones").json() == []