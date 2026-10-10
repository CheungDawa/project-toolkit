"""AI 閫傞厤灞?鏍￠獙/寤鸿娴佹祴璇曘€?
璇存槑锛氫娇鐢ㄦ湰鍦?mock OpenAI 鍏煎鏈嶅姟锛堟祴璇曡缃紝鐢ㄤ簬楠岃瘉閫傞厤銆佽В鏋愩€侀檷绾т笌閿欒璺緞锛?浜у搧涓姝㈢敤鍥哄畾鍥炲妯℃嫙 AI鈥斺€擲-5锛夈€?"""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from sqlalchemy import select

from app.models.ai import AiActionProposal
from app.models.task import Task


class MockOpenAIHandler(BaseHTTPRequestHandler):
    """鍙紪绋?mock锛?chat/completions 杩斿洖璁惧畾鍐呭銆?""

    responses: dict = {}

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        mode = self.responses.get("mode", "ok")
        if mode == "timeout":
            return  # 涓嶅搷搴旓紝瑙﹀彂瀹㈡埛绔秴鏃?        if mode == "http500":
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
    resp = client.post("/api/projects", json={"code": code, "name": "AI 娴嬭瘯椤圭洰"})
    return resp.json()["id"]


def test_ai_not_configured_degraded(client):
    """NFR-04锛氭湭閰嶇疆妯″瀷鏃堕潪 AI 鍔熻兘鍏ㄩ儴鍙敤锛孉I 鑳藉姏杩斿洖鍙嬪ソ閿欒銆?""
    assert client.get("/api/health").status_code == 200
    pid = _project(client)
    assert client.post("/api/projects").status_code == 422  # 涓氬姟鏍￠獙浠嶅湪

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
    # 瀵嗛挜涓嶅畬鏁村洖浼狅紙NFR-05 / A4-8锛?    settings = client.get("/api/settings").json()
    model_cfg = next(s for s in settings if s["key"] == "model.default")
    assert "sk-mock-key-123456789" not in json.dumps(model_cfg)
    assert model_cfg["value"]["api_key"] == "sk-****6789"


def test_wbs_draft_proposal_flow(client):
    port = _start_mock()[1]
    payload = json.dumps({
        "tasks": [
            {"wbs": "1", "name": "椤圭洰鍚姩", "plan_start": "2026-10-01", "plan_end": "2026-10-05"},
            {"wbs": "1.1", "parent_wbs": "1", "name": "闇€姹傜‘璁?, "owner": "寮犱笁"},
            {"wbs": "2", "name": "娴嬭瘯楠屾敹"},
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
    # pending 鐘舵€佷笉鍐欎笟鍔¤〃锛圔R-05 / A4-5锛?    assert client.get(f"/api/projects/{pid}/tasks").json()["items"] == []

    # 鎺ュ彈 鈫?鍐欏叆浠诲姟鏍?+ 閲嶇畻缂栫爜
    accept = client.post(f"/api/ai/proposals/{body['id']}/accept", json={"confirm": False})
    assert accept.status_code == 200
    assert accept.json()["status"] == "accepted"
    tasks = client.get(f"/api/projects/{pid}/tasks").json()["items"]
    by_name = {t["name"]: t for t in tasks}
    assert by_name["椤圭洰鍚姩"]["wbs_code"] == "1"
    assert by_name["闇€姹傜‘璁?]["wbs_code"] == "1.1"
    assert by_name["娴嬭瘯楠屾敹"]["wbs_code"] == "2"
    assert by_name["闇€姹傜‘璁?]["owner"] == "寮犱笁"


def test_wbs_draft_reject_no_write(client):
    port = _start_mock()[1]
    payload = json.dumps({"tasks": [{"wbs": "1", "name": "涓嶅簲钀藉簱"}]})
    _configure(client, port, content=payload)
    pid = _project(client)
    proposal = client.post(f"/api/ai/projects/{pid}/wbs-draft").json()

    reject = client.post(f"/api/ai/proposals/{proposal['id']}/reject")
    assert reject.status_code == 200
    assert reject.json()["status"] == "rejected"
    assert client.get(f"/api/projects/{pid}/tasks").json()["items"] == []


def test_invalid_wbs_draft_not_persisted(client):
    port = _start_mock()[1]
    # 闈炴硶鏃ユ湡锛氱粨鏉熸棭浜庡紑濮?    payload = json.dumps({
        "tasks": [
            {"wbs": "1", "name": "鍧忎换鍔?, "plan_start": "2026-10-10", "plan_end": "2026-10-01"}
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
    _configure(client, port, content="杩欎笉鏄疛SON")
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
    # 鏋勯€犻珮褰卞搷寤鸿锛坉elete_tasks锛夐渶浜屾纭
    port = _start_mock()[1]
    _configure(client, port, content='{"tasks":[{"wbs":"1","name":"X"}]}')
    pid = _project(client)
    proposal = client.post(f"/api/ai/projects/{pid}/wbs-draft").json()
    proposal_id = proposal["id"]
    # 鎶?action_type 鏀逛负楂樺奖鍝嶏紙妯℃嫙鎵归噺鏀规湡绫诲缓璁級
    from app.models.ai import AiActionProposal
    db_session = client.app.dependency_overrides  # noqa: F841
    # 鐩存帴鏀瑰簱锛堟祴璇曞唴鏂逛究锛?    import app.core.db as dbmod
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