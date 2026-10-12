"""驾驶舱总览 / 管理预警测试（任务书一：五类预警 + 紧急度排序）。

口径见 app/api/overview.py 模块注释；全部数据经 API 构造，日期相对今天生成。
"""
from datetime import date, timedelta

TODAY = date.today()
AGO = lambda days: (TODAY - timedelta(days=days)).isoformat()  # noqa: E731
AHEAD = lambda days: (TODAY + timedelta(days=days)).isoformat()  # noqa: E731

def _create_project(client, code="OV-001", name="预警测试项目") -> str:
    resp = client.post("/api/projects", json={"code": code, "name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _overview(client) -> dict:
    resp = client.get("/api/overview")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _kinds(alerts: list[dict]) -> list[str]:
    return [a["kind"] for a in alerts]


def test_overview_empty_database(client):
    data = _overview(client)
    assert data["totals"]["projects"] == 0
    assert data["alerts"] == []
    assert data["alert_summary"] == {"danger": 0, "warning": 0}


def test_overview_alert_overdue_task(client):
    pid = _create_project(client)
    resp = client.post(
        f"/api/projects/{pid}/tasks",
        json={"name": "逾期任务", "plan_end": AGO(15), "status": "进行中"},
    )
    assert resp.status_code == 201
    # 对照：未到期任务不产生预警
    client.post(f"/api/projects/{pid}/tasks", json={"name": "正常任务", "plan_end": AHEAD(10)})
    # 对照：已完成任务即使超期也不预警
    client.post(
        f"/api/projects/{pid}/tasks",
        json={"name": "超期但已完成", "plan_end": AGO(5), "status": "已完成", "progress": 100},
    )

    data = _overview(client)
    kinds = _kinds(data["alerts"])
    assert kinds.count("project") == 1
    alert = data["alerts"][0]
    assert alert["severity"] == "danger"
    assert alert["overdue_count"] == 1
    assert "已超期 15 天" in alert["detail"]
    # 项目行异常标记
    row = next(p for p in data["projects"] if p["id"] == pid)
    assert row["overdue_tasks"] == 1
    assert row["task_total"] == 3 and row["task_done"] == 1


def test_overview_alert_overdue_milestone(client):
    pid = _create_project(client)
    client.post(
        f"/api/projects/{pid}/milestones",
        json={"name": "初验里程碑", "plan_date": AGO(9)},
    )  # 逾期 9 天 → danger
    client.post(
        f"/api/projects/{pid}/milestones",
        json={"name": "短期逾期", "plan_date": AGO(3)},
    )  # 逾期 3 天 → warning
    client.post(
        f"/api/projects/{pid}/milestones",
        json={"name": "已完成里程碑", "plan_date": AGO(30), "actual_date": AGO(28)},
    )  # 已完成不预警

    alerts = [a for a in _overview(client)["alerts"] if a["kind"] == "milestone"]
    assert len(alerts) == 2
    sev = {a["title"]: a["severity"] for a in alerts}
    assert sev["里程碑逾期：初验里程碑"] == "danger"
    assert sev["里程碑逾期：短期逾期"] == "warning"


def test_overview_alert_high_risk(client):
    pid = _create_project(client)
    resp = client.post(
        f"/api/projects/{pid}/risks",
        json={"description": "核心设备到货延迟", "probability": 5, "impact": 5, "owner": "张三"},
    )
    assert resp.status_code == 201
    # 对照：中低风险不进入预警
    client.post(
        f"/api/projects/{pid}/risks",
        json={"description": "一般风险", "probability": 2, "impact": 2},
    )
    # 对照：已关闭高风险不预警
    closed = client.post(
        f"/api/projects/{pid}/risks",
        json={"description": "已关闭的高风险", "probability": 5, "impact": 4},
    ).json()
    client.patch(f"/api/risks/{closed['id']}", json={"status": "已关闭"})

    alerts = [a for a in _overview(client)["alerts"] if a["kind"] == "risk"]
    assert len(alerts) == 1
    assert alerts[0]["severity"] == "danger"
    assert alerts[0]["score"] == 25
    assert "张三" in alerts[0]["detail"]


def test_overview_alert_deliverable(client):
    pid = _create_project(client, code="OV-DLV")
    # 已提交待审核 → 预警（warning）
    client.post(
        f"/api/projects/{pid}/deliverables",
        json={"name": "初验报告", "submit_status": "已提交", "review_status": "待审核"},
    )
    # 已提交且已通过 → 不预警
    client.post(
        f"/api/projects/{pid}/deliverables",
        json={"name": "终验报告", "submit_status": "已提交", "review_status": "已通过"},
    )
    # 逾期未提交 → 预警（danger）
    client.post(
        f"/api/projects/{pid}/deliverables",
        json={"name": "开工报告", "plan_date": AGO(6), "submit_status": "未提交"},
    )

    alerts = [a for a in _overview(client)["alerts"] if a["kind"] == "deliverable"]
    assert len(alerts) == 2
    by_name = {a["title"]: a for a in alerts}
    assert by_name["交付物待审核：初验报告"]["severity"] == "warning"
    assert by_name["交付物逾期未提交：开工报告"]["severity"] == "danger"
    assert by_name["交付物逾期未提交：开工报告"]["days"] == 6


def test_overview_alert_coordination(client):
    pid = _create_project(client, code="OV-CRD")
    # 高严重度 + 逾期 → danger
    client.post(
        f"/api/projects/{pid}/issues",
        json={"title": "光缆被挖断", "severity": "高", "owner": "李四", "due_date": AGO(2)},
    )
    # 责任人缺失 → warning
    client.post(
        f"/api/projects/{pid}/issues",
        json={"title": "界面口径未对齐", "severity": "中", "owner": None, "status": "处理中"},
    )
    # 常规开放问题（不高、不逾期、有责任人）→ 不进驾驶舱
    client.post(
        f"/api/projects/{pid}/issues",
        json={"title": "普通问题", "severity": "低", "owner": "王五", "status": "待处理"},
    )
    # 已关闭 → 不预警
    closed = client.post(
        f"/api/projects/{pid}/issues",
        json={"title": "已闭环问题", "severity": "高", "owner": "赵六"},
    ).json()
    client.post(f"/api/issues/{closed['id']}/close", json={"closure_result": "已解决"})

    alerts = [a for a in _overview(client)["alerts"] if a["kind"] == "coordination"]
    assert len(alerts) == 2
    by_title = {a["title"]: a for a in alerts}
    assert by_title["问题需协调：光缆被挖断"]["severity"] == "danger"
    assert by_title["问题需协调：界面口径未对齐"]["severity"] == "warning"


def test_overview_alerts_sorted_by_urgency(client):
    pid = _create_project(client, code="OV-SORT")
    # 构造：warning（逾期 3 天里程碑）+ danger（逾期 15 天任务）+ danger（高风险）+ warning（逾期仅 1 天的问题）
    client.post(f"/api/projects/{pid}/tasks", json={"name": "严重逾期任务", "plan_end": AGO(15)})
    client.post(f"/api/projects/{pid}/milestones", json={"name": "短期逾期", "plan_date": AGO(3)})
    client.post(
        f"/api/projects/{pid}/risks",
        json={"description": "高危风险项", "probability": 5, "impact": 5},
    )
    client.post(
        f"/api/projects/{pid}/issues",
        json={"title": "刚逾期的问题", "severity": "中", "owner": "钱七", "due_date": AGO(1)},
    )

    alerts = _overview(client)["alerts"]
    assert len(alerts) == 4
    # danger 全部在前，且 danger 中按 days 降序（任务 15 天 > 风险 0 天）
    assert [a["severity"] for a in alerts] == ["danger", "danger", "warning", "warning"]
    assert alerts[0]["kind"] == "project" and alerts[0]["days"] == 15
    assert alerts[1]["kind"] == "risk"
    assert alerts[2]["kind"] == "milestone"  # 3 天 > 1 天
    assert alerts[3]["kind"] == "coordination" and alerts[3]["days"] == 1


def test_overview_alerts_isolated_across_projects(client):
    """A 项目的异常不应污染 B 项目的项目行。"""
    pa = _create_project(client, code="OV-A", name="问题项目")
    pb = _create_project(client, code="OV-B", name="正常项目")
    client.post(f"/api/projects/{pa}/tasks", json={"name": "A 逾期任务", "plan_end": AGO(10)})
    client.post(f"/api/projects/{pb}/tasks", json={"name": "B 正常任务", "plan_end": AHEAD(10)})

    data = _overview(client)
    row_a = next(p for p in data["projects"] if p["code"] == "OV-A")
    row_b = next(p for p in data["projects"] if p["code"] == "OV-B")
    assert (row_a["overdue_tasks"], row_a["overdue_milestones"]) == (1, 0)
    assert (row_b["overdue_tasks"], row_b["overdue_milestones"]) == (0, 0)
    assert all(a["project_id"] == pa for a in data["alerts"])
