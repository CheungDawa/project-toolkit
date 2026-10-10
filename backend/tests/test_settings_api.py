"""系统设置 API 测试（T1-10）。"""


def test_settings_list_has_seeds(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    keys = [item["key"] for item in resp.json()]
    assert "workcalendar.overrides" in keys
    assert "risk.matrix" in keys
    assert "progress.rule" in keys
    assert "snapshot.policy" in keys
    assert "model.default" in keys


def test_get_setting(client):
    resp = client.get("/api/settings/progress.rule")
    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == "progress.rule"
    assert body["value"]["method"] == "work_hours"


def test_update_setting_persists(client):
    resp = client.put("/api/settings/snapshot.policy", json={"value": {"mode": "manual"}})
    assert resp.status_code == 200
    assert resp.json()["value"]["mode"] == "manual"

    again = client.get("/api/settings/snapshot.policy")
    assert again.status_code == 200
    assert again.json()["value"]["mode"] == "manual"


def test_update_missing_setting_404(client):
    resp = client.put("/api/settings/no.such.key", json={"value": 1})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"