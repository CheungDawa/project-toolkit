"""AI 适配层 / 校验 / 建议流测试。

说明：使用本地 mock OpenAI 兼容服务（测试装置，用于验证适配、解析、降级与错误路径；
产品中禁止用固定回复模拟 AI——S-5）。
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from sqlalchemy import select

from app.models.ai import AiActionProposal


class MockOpenAIHandler(BaseHTTPRequestHandler):
    """可编程 mock：/chat/completions 返回设定内容。"""

    responses: dict = {}

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        mode = self.responses.get("mode", "ok")
        if mode == "timeout":
            return  # 不响应，触发客户端超时
        if mode == "http500":
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b"internal error")
            return
        body = {
            "id": "mock-1",
            "choices": [{"message": {"role": "assistant", "content": self.responses.get("content", "{}")}}],
            "usage": {"total_tokens": 12},
        }
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def _start_mock():
    server = HTTPServer(("127.0.0.1", 0), MockOpenAIHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def _configure(client, port: int, mode: str = "ok", content: str = "{}"):
    MockOpenAIHandler.responses = {"mode": mode, "content": content}
    resp = client.put(
        "/api/settings/model.default",
        json={
            "value": {
                "provider": "openai",
                "base_url": f"http://127.0.0.1:{port}",
                "model": "mock-model",
                "api_key": "sk-mock-key-123456789",
                "timeout": 2,
                "enabled": True,
            }
        },
    )
    assert resp.status_code == 200


def _project(client, code="AI-001") -> str:
    resp = client.post("/api/projects", json={"code": code, "name": "AI 测试项目"})
    return resp.json()["id"]


def test_ai_not_configured_degraded(client):
    """NFR-04：未配置模型时非 AI 功能全部可用，AI 能力返回友好错误。"""
    assert client.get("/api/health").status_code == 200
    pid = _project(client)
    assert client.post("/api/projects").status_code == 422  # 业务校验仍在

    resp = client.post(f"/api/ai/projects/{pid}/wbs-draft")
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "model_not_configured"

    assert client.get("/api/ai/status").json() == {"configured": False, "config": None}


def test_ai_status_masked(client):
    port = _start_mock()[1]
    _configure(client, port)
    status = client.get("/api/ai/status").json()
    assert status["configured"] is True
    assert status["config"]["api_key_masked"] == "sk-****6789"
    # 密钥不完整回传（NFR-05 / A4-8）
    settings = client.get("/api/settings").json()
    model_cfg = next(s for s in settings if s["key"] == "model.default")
    assert "sk-mock-key-123456789" not in json.dumps(model_cfg)
    assert model_cfg["value"]["api_key"] == "sk-****6789"


def test_wbs_draft_proposal_flow(client):
    port = _start_mock()[1]
    payload = json.dumps({
        "tasks": [
            {"wbs": "1", "name": "项目启动", "plan_start": "2026-10-01", "plan_end": "2026-10-05"},
            {"wbs": "1.1", "parent_wbs": "1", "name": "需求确认", "owner": "张三"},
            {"wbs": "2", "name": "测试验收"},
        ]
    })
    _configure(client, port, content=payload)
    pid = _project(client)

    resp = client.post(f"/api/ai/projects/{pid}/wbs-draft")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["action_type"] == "wbs_draft"
    assert body["status"] == "pending"
    assert len(body["diff_preview"]["add"]) == 3
    # pending 状态不写业务表（BR-05 / A4-5）
    assert client.get(f"/api/projects/{pid}/tasks").json()["items"] == []

    # 接受 → 写入任务树 + 重算编码
    accept = client.post(f"/api/ai/proposals/{body['id']}/accept", json={"confirm": False})
    assert accept.status_code == 200
    assert accept.json()["status"] == "accepted"
    tasks = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    by_name = {t["name"]: t for t in tasks}
    assert by_name["项目启动"]["wbs_code"] == "1"
    assert by_name["需求确认"]["wbs_code"] == "1.1"
    assert by_name["测试验收"]["wbs_code"] == "2"
    assert by_name["需求确认"]["owner"] == "张三"


def test_wbs_draft_reject_no_write(client):
    port = _start_mock()[1]
    payload = json.dumps({"tasks": [{"wbs": "1", "name": "不应落库"}]})
    _configure(client, port, content=payload)
    pid = _project(client)
    proposal = client.post(f"/api/ai/projects/{pid}/wbs-draft").json()

    reject = client.post(f"/api/ai/proposals/{proposal['id']}/reject")
    assert reject.status_code == 200
    assert reject.json()["status"] == "rejected"
    assert client.get(f"/api/projects/{pid}/tasks").json()["items"] == []


def test_invalid_wbs_draft_not_persisted(client):
    port = _start_mock()[1]
    # 非法日期：结束早于开始
    payload = json.dumps({
        "tasks": [
            {"wbs": "1", "name": "坏任务", "plan_start": "2026-10-10", "plan_end": "2026-10-01"}
        ]
    })
    _configure(client, port, content=payload)
    pid = _project(client)
    resp = client.post(f"/api/ai/projects/{pid}/wbs-draft")
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "format_error"
    assert client.get(f"/api/projects/{pid}/tasks").json()["items"] == []


def test_non_json_model_output_rejected(client):
    port = _start_mock()[1]
    _configure(client, port, content="这不是JSON")
    pid = _project(client)
    resp = client.post(f"/api/ai/projects/{pid}/wbs-draft")
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "format_error"


def test_model_timeout_error_path(client):
    port = _start_mock()[1]
    _configure(client, port, mode="timeout")
    pid = _project(client)
    resp = client.post(f"/api/ai/projects/{pid}/wbs-draft")
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] in ("timeout", "api_error")


def test_high_impact_requires_confirm(client):
    port = _start_mock()[1]
    _configure(client, port, content='{"tasks":[{"wbs":"1","name":"X"}]}')
    pid = _project(client)
    proposal = client.post(f"/api/ai/projects/{pid}/wbs-draft").json()
    proposal_id = proposal["id"]
    # 改为高影响类型（模拟批量改期类建议），需二次确认
    from app.core.db import SessionLocal
    session = SessionLocal()
    row = session.get(AiActionProposal, proposal_id)
    row.action_type = "bulk_reschedule"
    row.payload = {"task_ids": ["11111111-1111-1111-1111-111111111111"]}
    session.commit()
    session.close()

    bad = client.post(f"/api/ai/proposals/{proposal_id}/accept", json={"confirm": False})
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "high_impact_confirm_required"