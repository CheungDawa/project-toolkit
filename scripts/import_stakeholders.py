"""旧干系人管理工具数据导入 Project Toolkit。

用法（在 WSL 宿主机执行，无需容器内路径）：
    python3 scripts/import_stakeholders.py "/mnt/d/Yibin Telecom work/干系人管理_全量数据.json"

字段映射（旧工具 → 本系统）：
- pos        → org        单位
- subPos     → sub_pos    角色分类（决策层/管理层/…）
- name       → name       干系人（为空时回退 role/pos）
- role       → role       职位角色
- influence/interest → influence/interest（1-5 原值保留）
- priority   → priority   P0/P1/P2
- needs      → demands    需求/核心诉求
- plan       → comm_frequency（解码 A=日报 B=周报 E=月度远程会议 F=线下会议）
- channel    → strategy 内沟通方式段（解码 G=微信 H=会议 I=报告 J=邮件 K=电话）
- attrs(C/D) → participation（不知晓/抵制/中立/支持/领导 × 当前/期望）
- note       → strategy 内备注段
- contact    → contact_phone / contact_wechat / contact_email
幂等：项目按 code=GS-xxx 判重；已有干系人的项目跳过导入。
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:8180/api"

PLAN_DECODE = {"A": "日报", "B": "周报", "E": "月度远程会议", "F": "线下会议"}
CHANNEL_DECODE = {"G": "微信", "H": "会议", "I": "报告", "J": "邮件", "K": "电话"}
ATTR_ORDER = [("unknown", "不知晓"), ("resist", "抵制"), ("neutral", "中立"), ("support", "支持"), ("lead", "领导")]


def call(method: str, path: str, payload: dict | None = None):
    data = json.dumps(payload, encoding="utf-8").encode() if payload is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        return exc.code, json.loads(body) if body else {}


def decode_letters(code: str, table: dict[str, str]) -> str:
    return "、".join(table[ch] for ch in str(code or "").upper() if ch in table)


def decode_participation(attrs: dict) -> str:
    parts = []
    for key, label in ATTR_ORDER:
        mark = str((attrs or {}).get(key) or "").upper()
        if mark == "C":
            parts.append(f"{label}（当前）")
        elif mark == "D":
            parts.append(f"{label}（期望）")
    return "；".join(parts)


def map_row(row: dict) -> dict:
    contact = row.get("contact") or {}
    strategy_parts = []
    channels = decode_letters(row.get("channel"), CHANNEL_DECODE)
    if channels:
        strategy_parts.append(f"沟通方式：{channels}")
    participation = decode_participation(row.get("attrs"))
    if participation:
        strategy_parts.append(f"参与程度：{participation}")
    note = str(row.get("note") or "").strip()
    if note:
        strategy_parts.append(f"备注：{note}")

    name = str(row.get("name") or "").strip()
    if not name:
        name = str(row.get("role") or "").strip() or str(row.get("pos") or "").strip() or "未命名"

    return {
        "person_type": "person",
        "name": name,
        "org": str(row.get("pos") or "").strip() or None,
        "role": str(row.get("role") or "").strip() or None,
        "sub_pos": str(row.get("subPos") or "").strip() or None,
        "influence": int(row.get("influence") or 3),
        "interest": int(row.get("interest") or 3),
        "priority": str(row.get("priority") or "").strip() or None,
        "demands": str(row.get("needs") or "").strip() or None,
        "comm_frequency": decode_letters(row.get("plan"), PLAN_DECODE) or None,
        "participation": participation or None,
        "strategy": "；".join(strategy_parts) or None,
        "contact_phone": str(contact.get("phone") or "").strip() or None,
        "contact_wechat": str(contact.get("wechat") or "").strip() or None,
        "contact_email": str(contact.get("email") or "").strip() or None,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：python3 scripts/import_stakeholders.py <JSON路径>")
        return 1
    path = sys.argv[1]
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    status, existing = call("GET", "/projects?size=100")
    if status != 200:
        print("无法访问 API，请先启动服务（http://localhost:8180）")
        return 1
    existing_codes = {p["code"] for p in existing.get("items", [])}

    total_created = 0
    for index, project in enumerate(data.get("projects", []), start=1):
        name = project.get("name") or f"未命名项目{index}"
        code = f"GS-{index:03d}"
        rows = project.get("rows") or []
        print(f"\n[{code}] {name}（{len(rows)} 条干系人）")

        if code in existing_codes:
            status, found = call("GET", f"/projects?q={code}")
            pid = found["items"][0]["id"] if found.get("items") else None
            if not pid:
                print("  已存在但查询失败，跳过")
                continue
            print("  项目已存在，复用")
        else:
            status, created = call("POST", "/projects", {"code": code, "name": name, "description": "由旧干系人管理工具导入"})
            if status != 201:
                print(f"  创建项目失败：{status} {created}")
                continue
            pid = created["id"]
            existing_codes.add(code)
            print("  项目已创建")

        status, current = call("GET", f"/projects/{pid}/stakeholders")
        if status == 200 and current:
            print(f"  已有 {len(current)} 条干系人，跳过导入（幂等）")
            continue

        items = [map_row(r) for r in rows if isinstance(r, dict)]
        if not items:
            print("  无有效行，跳过")
            continue
        status, result = call("POST", f"/projects/{pid}/stakeholders/import", {"items": items})
        if status != 200:
            print(f"  导入失败：{status} {result}")
            continue
        total_created += result.get("created", 0)
        print(f"  导入成功 {result['created']} 条" + (f"，失败 {len(result['errors'])} 条：{result['errors'][:3]}" if result["errors"] else ""))

    print(f"\n完成：共导入 {total_created} 条干系人")
    return 0


if __name__ == "__main__":
    sys.exit(main())