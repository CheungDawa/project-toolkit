"""阶段 3 测试：风险评分/评估历史/转化（BR-04）/问题闭环/变更/干系人/审计/隔离。"""


def _project(client, code="ST3-001") -> str:
    resp = client.post("/api/projects", json={"code": code, "name": "阶段3测试"})
    assert resp.status_code == 201
    return resp.json()["id"]


def _risk(client, pid, **extra) -> dict:
    payload = {"description": "测试风险", "probability": 3, "impact": 3, **extra}
    resp = client.post(f"/api/projects/{pid}/risks", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------- 风险评分（FR-P0-20 / A3-2） ----------

def test_risk_score_and_level(client):
    pid = _project(client)
    low = _risk(client, pid, probability=1, impact=2)
    mid = _risk(client, pid, probability=3, impact=2)
    high = _risk(client, pid, probability=5, impact=5)
    assert (low["score"], low["level"]) == (2, "低")
    assert (mid["score"], mid["level"]) == (6, "中")
    assert (high["score"], high["level"]) == (25, "高")


def test_risk_matrix_configurable(client):
    pid = _project(client)
    # 修改评分规则：low<=6, medium<=12 → 6 分变为"低"
    resp = client.put(
        "/api/settings/risk.matrix",
        json={"value": {"rows": [1, 2, 3, 4, 5], "cols": [1, 2, 3, 4, 5], "levels": {"low": 6, "medium": 12, "high": 25}}},
    )
    assert resp.status_code == 200
    risk = _risk(client, pid, probability=3, impact=2)
    assert (risk["score"], risk["level"]) == (6, "低")
    # 还原默认阈值，避免污染后续用例
    client.put(
        "/api/settings/risk.matrix",
        json={"value": {"rows": [1, 2, 3, 4, 5], "cols": [1, 2, 3, 4, 5], "levels": {"low": 4, "medium": 9, "high": 25}}},
    )


def test_risk_assessment_history(client):
    pid = _project(client)
    risk = _risk(client, pid, probability=2, impact=2)
    r1 = client.post(
        f"/api/risks/{risk['id']}/assessments",
        json={"probability": 4, "impact": 3, "basis": "供应商延期"},
    )
    assert r1.status_code == 201
    assert r1.json()["score"] == 12 and r1.json()["level"] == "高"

    history = client.get(f"/api/risks/{risk['id']}/assessments").json()
    assert len(history) == 1
    assert history[0]["basis"] == "供应商延期"

    # 当前风险已同步更新
    listed = client.get(f"/api/projects/{pid}/risks").json()
    current = next(r for r in listed if r["id"] == risk["id"])
    assert current["score"] == 12 and current["level"] == "高"


def test_risk_high_filter(client):
    pid = _project(client)
    _risk(client, pid, probability=1, impact=1)
    _risk(client, pid, probability=5, impact=5)
    high = client.get(f"/api/projects/{pid}/risks", params={"high_only": True}).json()
    assert len(high) == 1 and high[0]["level"] == "高"


# ---------- 转化（BR-04 / A3-4） ----------

def test_risk_convert_to_issue_keeps_record(client):
    pid = _project(client)
    risk = _risk(client, pid, probability=5, impact=5)
    resp = client.post(f"/api/risks/{risk['id']}/convert", json={"target": "issue"})
    assert resp.status_code == 200
    assert resp.json()["risk_status"] == "已转问题"

    issues = client.get(f"/api/projects/{pid}/issues").json()
    assert len(issues) == 1
    assert issues[0]["risk_id"] == risk["id"]
    assert issues[0]["severity"] == "高"

    # 原始风险记录仍在（BR-04）
    risks = client.get(f"/api/projects/{pid}/risks").json()
    assert any(r["id"] == risk["id"] and r["status"] == "已转问题" for r in risks)


def test_risk_convert_to_task(client):
    pid = _project(client)
    risk = _risk(client, pid, probability=4, impact=4)
    resp = client.post(
        f"/api/risks/{risk['id']}/convert",
        json={"target": "task", "task_name": "补充安全加固", "task_owner": "张三"},
    )
    assert resp.status_code == 200
    assert resp.json()["risk_status"] == "已转任务"

    tasks = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    task = next(t for t in tasks if t["name"] == "补充安全加固")
    assert task["risk_id"] == risk["id"]
    assert task["owner"] == "张三"
    assert task["wbs_code"] == "1"


# ---------- 问题闭环（A3-5） ----------

def test_issue_close_requires_result(client):
    pid = _project(client)
    resp = client.post(f"/api/projects/{pid}/issues", json={"title": "联调失败", "severity": "高"})
    iid = resp.json()["id"]

    bad = client.post(f"/api/issues/{iid}/close", json={"closure_result": ""})
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "closure_required"

    good = client.post(f"/api/issues/{iid}/close", json={"closure_result": "已修复并复测通过", "verified_by": "李四"})
    assert good.status_code == 200
    body = good.json()
    assert body["status"] == "已关闭"
    assert body["closure_result"] == "已修复并复测通过"
    assert body["verified_by"] == "李四"

    dup = client.post(f"/api/issues/{iid}/close", json={"closure_result": "再关一次"})
    assert dup.status_code == 422
    assert dup.json()["error"]["code"] == "already_closed"


def test_issue_overdue_filter(client):
    pid = _project(client)
    client.post(f"/api/projects/{pid}/issues", json={"title": "逾期问题", "due_date": "2026-09-01"})
    client.post(f"/api/projects/{pid}/issues", json={"title": "正常问题", "due_date": "2026-12-31"})
    overdue = client.get(f"/api/projects/{pid}/issues", params={"overdue": True}).json()
    assert [i["title"] for i in overdue] == ["逾期问题"]


# ---------- 变更 ----------

def test_change_flow(client):
    pid = _project(client)
    created = client.post(
        f"/api/projects/{pid}/changes",
        json={"title": "新增报表", "origin": "客户要求", "scope_impact": "增加一个报表页面"},
    )
    assert created.status_code == 201
    cid = created.json()["id"]

    updated = client.patch(f"/api/changes/{cid}", json={"approval_status": "已批准", "implementation_plan": "下周实施"})
    assert updated.status_code == 200
    assert updated.json()["approval_status"] == "已批准"

    assert client.delete(f"/api/changes/{cid}").status_code == 204
    assert client.get(f"/api/projects/{pid}/changes").json() == []


# ---------- 干系人与沟通（P1，A3-1） ----------

def test_stakeholder_and_communication(client):
    pid = _project(client)
    s = client.post(
        f"/api/projects/{pid}/stakeholders",
        json={"name": "业主代表", "org": "某单位", "influence": 5, "interest": 4},
    )
    assert s.status_code == 201
    sid = s.json()["id"]

    comm = client.post(
        f"/api/stakeholders/{sid}/communications",
        json={"comm_date": "2026-10-09", "content": "确认验收时间", "conclusion": "暂定下月", "follow_up_action": "发函确认"},
    )
    assert comm.status_code == 201

    comms = client.get(f"/api/stakeholders/{sid}/communications").json()
    assert len(comms) == 1
    assert comms[0]["follow_up_action"] == "发函确认"


# ---------- 跨项目隔离（A3-6） ----------

def test_cross_project_isolation(client):
    pid1 = _project(client, "ISO-001")
    pid2 = _project(client, "ISO-002")
    client.post(f"/api/projects/{pid1}/risks", json={"description": "项目1风险"})
    client.post(f"/api/projects/{pid2}/risks", json={"description": "项目2风险"})
    client.post(f"/api/projects/{pid1}/issues", json={"title": "项目1问题"})
    client.post(f"/api/projects/{pid2}/stakeholders", json={"name": "项目2干系人"})

    r1 = client.get(f"/api/projects/{pid1}/risks").json()
    r2 = client.get(f"/api/projects/{pid2}/risks").json()
    assert [x["description"] for x in r1] == ["项目1风险"]
    assert [x["description"] for x in r2] == ["项目2风险"]
    assert [x["title"] for x in client.get(f"/api/projects/{pid1}/issues").json()] == ["项目1问题"]
    assert [x["name"] for x in client.get(f"/api/projects/{pid2}/stakeholders").json()] == ["项目2干系人"]


# ---------- 审计（T3-10 / A3-7） ----------

def test_audit_logs_recorded(client):
    pid = _project(client)
    risk = _risk(client, pid, probability=2, impact=2)
    client.post(f"/api/risks/{risk['id']}/assessments", json={"probability": 3, "impact": 2, "basis": "更新评估"})

    logs = client.get(f"/api/projects/{pid}/audit").json()
    actions = [log["action"] for log in logs]
    assert "create" in actions  # 项目创建
    assert "assess" in actions  # 风险评估

    filtered = client.get(f"/api/projects/{pid}/audit", params={"action": "assess"}).json()
    assert len(filtered) == 1
    assert filtered[0]["object_type"] == "risk"