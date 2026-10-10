"""项目 CRUD API 测试（对应阶段 1 验收 A1-5 的可自动化部分）。"""
from datetime import date


def _create(client, code="PT-001", **overrides):
    payload = {"code": code, "name": "测试项目", **overrides}
    return client.post("/api/projects", json=payload)


def test_create_and_get(client):
    resp = _create(client, customer="某客户", plan_start="2026-01-01", plan_end="2026-06-30")
    assert resp.status_code == 201
    body = resp.json()
    assert body["code"] == "PT-001"
    assert body["customer"] == "某客户"
    assert body["id"]

    detail = client.get(f"/api/projects/{body['id']}")
    assert detail.status_code == 200
    assert detail.json()["code"] == "PT-001"


def test_duplicate_code_rejected(client):
    assert _create(client).status_code == 201
    resp = _create(client)
    assert resp.status_code == 422
    error = resp.json()["error"]
    assert error["code"] == "code_exists"
    assert "项目编号已存在" in error["fields"]["code"][0]


def test_invalid_plan_dates_rejected(client):
    resp = _create(client, plan_start="2026-01-10", plan_end="2026-01-01")
    assert resp.status_code == 422
    error = resp.json()["error"]
    assert error["code"] == "date_invalid"
    assert error["fields"].get("plan_end")


def test_invalid_actual_dates_rejected(client):
    resp = _create(client, actual_start="2026-03-10", actual_end="2026-03-01")
    assert resp.status_code == 422
    assert resp.json()["error"]["fields"].get("actual_end")


def test_validation_error_shape(client):
    resp = client.post("/api/projects", json={"code": ""})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "validation_error"
    assert "code" in body["error"]["fields"]


def test_list_search_filter_pagination(client):
    for i in range(1, 6):
        assert (
            _create(
                client,
                code=f"PT-{i:03d}",
                name=f"演示项目{i}",
                status="进行中" if i % 2 else "已完成",
            ).status_code
            == 201
        )

    listed = client.get("/api/projects", params={"status": "进行中", "page": 1, "size": 2})
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2

    searched = client.get("/api/projects", params={"q": "演示项目3"})
    assert searched.json()["total"] == 1

    sorted_resp = client.get("/api/projects", params={"sort": "code", "size": 100})
    codes = [item["code"] for item in sorted_resp.json()["items"]]
    assert codes == sorted(codes)

    bad_sort = client.get("/api/projects", params={"sort": "hacked_field"})
    assert bad_sort.status_code == 422


def test_missing_project_returns_unified_404(client):
    resp = client.get("/api/projects/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


def test_update_archive_delete_flow(client):
    created = _create(client).json()
    pid = created["id"]

    updated = client.patch(
        f"/api/projects/{pid}",
        json={"name": "改名", "plan_start": "2026-02-01", "plan_end": "2026-02-10"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "改名"
    assert date.fromisoformat(updated.json()["plan_start"]) == date(2026, 2, 1)

    # 合并校验：已存在 plan_start=2026-02-01，仅把 plan_end 改早 → 拒绝
    bad = client.patch(f"/api/projects/{pid}", json={"plan_end": "2026-01-15"})
    assert bad.status_code == 422
    assert bad.json()["error"]["fields"].get("plan_end")

    # 归档：默认列表隐藏，显式筛选可见
    archived = client.post(f"/api/projects/{pid}/archive")
    assert archived.status_code == 200
    assert archived.json()["archived_at"]
    assert client.get("/api/projects").json()["total"] == 0
    assert client.get("/api/projects", params={"archived": "only"}).json()["total"] == 1
    assert client.get("/api/projects", params={"archived": "include"}).json()["total"] == 1

    # 软删除：之后不可见
    deleted = client.delete(f"/api/projects/{pid}")
    assert deleted.status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404
    assert client.get("/api/projects", params={"archived": "include"}).json()["total"] == 0

    # 编号不释放：删除后新建同编号仍提示已存在
    dup = _create(client, code="PT-001")
    assert dup.status_code == 422


def test_list_matches_deleted_data_source(client):
    """NFR-02 基线：同一数据源（数据库）驱动列表，刷新等价于重查。"""
    _create(client, code="PERSIST-001")
    first = client.get("/api/projects").json()
    second = client.get("/api/projects").json()
    assert first == second
    assert first["total"] == 1
