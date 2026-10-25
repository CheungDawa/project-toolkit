"""示例项目数据批量导入脚本：干系人清单 + 项目任务清单（WBS）。

【使用说明】
本脚本演示如何从 Excel 表格向 Project Toolkit 批量自动化导入项目干系人与 WBS 任务树；
要求 Project Toolkit 运行于 http://localhost:8180，并已安装 pandas 与 openpyxl。
用法：
    python scripts/import_excel_sample.py [干系人Excel路径] [WBS清单Excel路径]

若不传参数，默认尝试读取 ./data/sample_stakeholders.xlsx 与 ./data/sample_wbs.xlsx。
"""
import json
import math
import os
import sys
import urllib.error
import urllib.request

import pandas as pd

BASE = os.getenv("PT_API_URL", "http://localhost:8180/api")
F_STAKE = sys.argv[1] if len(sys.argv) > 1 else r"./data/sample_stakeholders.xlsx"
F_LIST = sys.argv[2] if len(sys.argv) > 2 else r"./data/sample_wbs.xlsx"
CODE = "GS-DEMO-001"
NAME = "智慧园区数字化交付示范工程"


def call(method, path, payload=None):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        try:
            return exc.code, json.loads(body)
        except Exception:
            return exc.code, {"raw": body}


def clean(v):
    """None/NaN/空串 → None；其余转干净字符串（电话科学计数法还原）。"""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (int,)):
        return str(v)
    s = str(v).strip()
    return s if s else None


def ensure_project():
    status, page = call("GET", f"/projects?q={CODE}")
    for p in page.get("items", []):
        if p["code"] == CODE:
            print(f"[项目] {CODE} 已存在，复用（{p['name']}）")
            return p["id"]
    status, created = call(
        "POST",
        "/projects",
        {
            "code": CODE,
            "name": NAME,
            "customer": "示范园区建设方",
            "manager": "项目经理",
            "status": "进行中",
            "phase": "实施建设",
            "description": "示范园区数字化交付示范工程（批量导入示例工程）",
        },
    )
    if status != 201:
        print(f"[项目] 创建失败：{status} {created}")
        sys.exit(1)
    print(f"[项目] {CODE} 已创建")
    return created["id"]


def import_stakeholders(pid):
    if not os.path.exists(F_STAKE):
        print(f"[干系人] 文件不存在，跳过：{F_STAKE}")
        return 0
    status, current = call("GET", f"/projects/{pid}/stakeholders")
    if status == 200 and current:
        print(f"[干系人] 已有 {len(current)} 条，跳过（幂等）")
        return 0
    df = pd.read_excel(F_STAKE, sheet_name="项目干系人", header=1)
    df["公司"] = df["公司"].ffill()
    df["部门"] = df["部门"].ffill()
    items = []
    for _, row in df.iterrows():
        name = clean(row["姓名"])
        if not name:
            continue
        position = clean(row["职位"])
        prole = clean(row["项目角色"])
        role = "、".join(x for x in [position, prole] if x) or None
        note = clean(row["备注"])
        item = {
            "person_type": "person",
            "name": name,
            "org": clean(row["公司"]),
            "sub_pos": clean(row["部门"]),
            "role": role,
            "influence": 3,
            "interest": 3,
            "contact_phone": clean(row["联系方式"]),
            "strategy": f"备注：{note}" if note else None,
        }
        items.append(item)
    if not items:
        print("[干系人] 无有效数据")
        return 0
    status, result = call("POST", f"/projects/{pid}/stakeholders/import", {"items": items})
    if status != 200:
        print(f"[干系人] 导入失败：{status} {result}")
        return 0
    errs = result.get("errors") or []
    print(
        f"[干系人] 导入成功 {result.get('created')} 条"
        + (f"，失败 {len(errs)} 条：{errs[:2]}" if errs else "")
    )
    return result.get("created", 0)


def map_status(raw):
    s = str(raw or "").strip()
    if not s:
        return "未开始", 0
    if "暂时不用验收" in s or ("已完成" in s and "验收" not in s and "准备" not in s):
        return "已完成", 100
    if "正在准备验收" in s or "已开展" in s or "已完成采购" in s or "已沟通" in s:
        return "进行中", 0
    return "未开始", 0


def create_task(pid, name, owner=None, status="未开始", progress=0, note=None):
    payload = {"name": name, "status": status, "progress": progress}
    if owner:
        payload["owner"] = owner
    if note:
        payload["acceptance_criteria"] = note
    status_code, created = call("POST", f"/projects/{pid}/tasks", payload)
    if status_code != 201:
        raise RuntimeError(f"任务创建失败 {status_code}: {created} ({name})")
    return created


def import_wbs(pid):
    if not os.path.exists(F_LIST):
        print(f"[WBS] 文件不存在，跳过：{F_LIST}")
        return
    status, existing = call("GET", f"/projects/{pid}/tasks")
    if status == 200 and existing.get("items"):
        print(f"[WBS] 已有 {len(existing['items'])} 条任务，跳过（幂等）")
        return
    df = pd.read_excel(F_LIST, sheet_name="汇总表", header=0)
    df.columns = ["序号", "大类", "小类", "建设内容", "供应商", "状态", "状态说明"]
    df["大类"] = df["大类"].ffill()
    df = df.dropna(subset=["大类"])

    # 分组行识别
    groups, current_group = [], None
    for _, row in df.iterrows():
        cat = clean(row["大类"])
        sub = clean(row["小类"])
        content = clean(row["建设内容"])
        if content is None and sub and ("、" in sub or sub.startswith(("一", "二", "三", "四", "五"))):
            current_group = {"cat": cat, "title": sub.rstrip("：:"), "rows": []}
            groups.append(current_group)
            continue
        rec = {
            "cat": cat,
            "group": current_group,
            "sub": sub,
            "content": content,
            "vendor": clean(row["供应商"]),
            "status": clean(row["状态"]),
            "note": clean(row["状态说明"]),
        }
        if current_group and current_group["cat"] == cat:
            current_group["rows"].append(rec)
        else:
            if current_group:
                current_group = None
            groups.append(rec)

    # 一级任务=大类
    cat_nodes = {}
    for cat in ["软件系统", "硬件集成", "综合保障"]:
        cat_nodes[cat] = create_task(pid, cat)
        print(f"[WBS] 一级：{cat}")

    for item in groups:
        if "rows" in item:  # 组节点（挂在大类下）
            g = _create_child(pid, cat_nodes.get(item["cat"], cat_nodes["软件系统"])["id"], item["title"])
            print(f"[WBS]   组：{item['title']}（{item['cat']}）")
            for rec in item["rows"]:
                add_detail(pid, g["id"], rec, level=3)
        else:
            target_parent = cat_nodes.get(item["cat"], cat_nodes["软件系统"])["id"]
            add_detail(pid, target_parent, item, level=2)


def _create_child(pid, parent_id, name, **kw):
    payload = {"name": name, "parent_id": parent_id}
    payload.update(kw)
    status, created = call("POST", f"/projects/{pid}/tasks", payload)
    if status != 201:
        raise RuntimeError(f"子任务创建失败 {status}: {created} ({name})")
    return created


def add_detail(pid, parent_id, rec, level):
    content = rec["content"]
    vendor = rec["vendor"]
    status_raw = rec["status"] or "待定"
    note_parts = [f"清单状态：{status_raw}"]
    if rec["note"]:
        note_parts.append(f"说明：{rec['note']}")
    owner = None
    if vendor and "客户" not in vendor and "暂不做" not in vendor:
        owner = vendor
    else:
        note_parts.append(f"供应商栏原文：{vendor}")
    status, progress = map_status(status_raw)
    name = (
        f"{rec['sub']}. {content}"
        if rec["sub"] and str(rec["sub"]).replace(".", "").isdigit()
        else content
    )
    t = _create_child(
        pid,
        parent_id,
        name,
        owner=owner,
        status=status,
        progress=progress,
        acceptance_criteria="；".join(note_parts),
    )
    print(f"[WBS]     {'  ' * (level - 1)}{t['wbs_code']} {name[:34]}（{status}）")


def main():
    status, _ = call("GET", "/overview")
    if status != 200:
        print(f"API 不可达（{BASE}）")
        return 1
    pid = ensure_project()
    import_stakeholders(pid)
    import_wbs(pid)
    print("\n完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
