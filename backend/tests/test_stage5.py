"""阶段 5 测试：快照/燃尽（BR-03）/交付清单/附件/Word 导出。"""
import io
import json

from openpyxl import Workbook


def _project(client, code="ST5-001") -> str:
    resp = client.post("/api/projects", json={"code": code, "name": "阶段5测试", "plan_start": "2026-10-01", "plan_end": "2026-12-31"})
    return resp.json()["id"]


def _task(client, pid, name, **extra) -> dict:
    resp = client.post(f"/api/projects/{pid}/tasks", json={"name": name, **extra})
    return resp.json()


# ---------- 快照与燃尽（BR-03 / A5-1/A5-2） ----------

def test_snapshot_captured_and_burndown_real(client):
    pid = _project(client)
    # 手动快照（空项目）
    s1 = client.post(f"/api/projects/{pid}/snapshots")
    assert s1.status_code == 201
    assert s1.json()["total_tasks"] == 0

    # 创建任务后手动快照
    _task(client, pid, "A", status="进行中", work_hours=10)
    _task(client, pid, "B", status="已完成", work_hours=5)
    s2 = client.post(f"/api/projects/{pid}/snapshots").json()
    assert s2["total_tasks"] == 2
    assert s2["completed_tasks"] == 1
    assert s2["remaining_tasks"] == 1
    assert s2["total_hours"] == 15.0
    assert s2["remaining_hours"] == 10.0

    burndown = client.get(f"/api/projects/{pid}/burndown").json()
    dates = [p["date"] for p in burndown["snapshots"]]
    assert len(dates) == 2  # 两条真实记录
    assert burndown["snapshots"][-1]["remaining_tasks"] == 1
    # 理想线存在（从首快照到 plan_end=2026-12-31，仅生成到今天）
    assert burndown["ideal"]


def test_burndown_empty_state(client):
    """无历史快照时返回空（A5-2：不生成虚假曲线）。"""
    pid = _project(client)
    burndown = client.get(f"/api/projects/{pid}/burndown").json()
    assert burndown["snapshots"] == []
    assert burndown["ideal"] == []


def test_daily_first_write_auto_capture(client):
    """daily_first_write：当天首次写操作自动采集，当天只一条。"""
    pid = _project(client)
    _task(client, pid, "A")
    _task(client, pid, "B")
    snaps = client.get(f"/api/projects/{pid}/snapshots").json()
    assert len(snaps) == 1  # 当天只一条
    assert snaps[0]["total_tasks"] == 2


# ---------- 交付资料与模板（A5-4/A5-6） ----------

def test_deliverable_template_and_instantiate(client):
    pid = _project(client)
    resp = client.post(f"/api/projects/{pid}/deliverables/instantiate", json={"template_name": "信息化集成交付清单（默认）"})
    assert resp.status_code == 200
    assert resp.json()["created"] == 7

    items = client.get(f"/api/projects/{pid}/deliverables").json()
    assert len(items) == 7
    categories = {i["category"] for i in items}
    assert "验收" in categories and "设备到货" in categories

    # 重复实例化不重复创建
    resp2 = client.post(f"/api/projects/{pid}/deliverables/instantiate", json={"template_name": "信息化集成交付清单（默认）"})
    assert resp2.json()["created"] == 0


def test_deliverable_crud_and_status(client):
    pid = _project(client)
    created = client.post(
        f"/api/projects/{pid}/deliverables",
        json={"name": "验收报告", "category": "验收", "plan_date": "2026-12-20"},
    )
    assert created.status_code == 201
    did = created.json()["id"]

    updated = client.patch(f"/api/deliverables/{did}", json={"submit_status": "已提交", "review_status": "已通过"})
    assert updated.status_code == 200
    assert updated.json()["submit_status"] == "已提交"
    assert updated.json()["review_status"] == "已通过"


def test_deliverable_attachment_upload(client):
    pid = _project(client)
    item = client.post(f"/api/projects/{pid}/deliverables", json={"name": "测试附件" }).json()
    resp = client.post(
        f"/api/deliverables/{item['id']}/attachments",
        files={"file": ("验收单.pdf", b"%PDF-1.4 demo", "application/pdf")},
    )
    assert resp.status_code == 201
    assert resp.json()["size_bytes"] == len(b"%PDF-1.4 demo")
    atts = client.get(f"/api/deliverables/{item['id']}/attachments").json()
    assert len(atts) == 1


def test_deliverable_excel_roundtrip(client):
    pid = _project(client)
    client.post(f"/api/projects/{pid}/deliverables", json={"name": "周报", "category": "测试"})
    exported = client.get(f"/api/projects/{pid}/deliverables/export")
    assert exported.status_code == 200

    # 用导出的文件再导入到新项目（字段保真）
    pid2 = _project(client, "ST5-002")
    files = {"file": ("d.xlsx", exported.content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    result = client.post(f"/api/projects/{pid2}/deliverables/import", files=files)
    assert result.status_code == 200
    assert result.json()["created"] == 1
    items2 = client.get(f"/api/projects/{pid2}/deliverables").json()
    assert items2[0]["name"] == "周报"


# ---------- Word 报告（A5-7 数据一致） ----------

def test_weekly_report_export(client):
    pid = _project(client)
    _task(client, pid, "任务A", status="已完成")
    resp = client.get(f"/api/projects/{pid}/reports/weekly/export")
    assert resp.status_code == 200
    assert resp.content.startswith(b"PK")  # docx 是 zip 容器
    text = client.get(f"/api/projects/{pid}/reports/weekly-text").json()
    assert "统计截止日期" in text["meta"]


def test_final_report_export(client):
    pid = _project(client)
    _task(client, pid, "任务A", status="已完成")
    resp = client.get(f"/api/projects/{pid}/reports/final/export")
    assert resp.status_code == 200
    assert resp.content.startswith(b"PK")