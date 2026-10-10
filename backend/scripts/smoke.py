"""开发冒烟脚本：在 backend 容器内验证基础 API（README 记录用法）。

用途：
- compose up 后快速验证健康检查、创建、重复校验与列表
- 重启容器后用 --status 验证数据持久化（A1-3 前置）
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:8000/api"


def _request(method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode()
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        return exc.code, json.loads(body) if body else {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Project Toolkit 基础冒烟")
    parser.add_argument("--code", default="PT-DEMO-001")
    parser.add_argument("--name", default="演示项目（冒烟脚本创建）")
    parser.add_argument("--status", action="store_true", help="仅查询，不创建")
    args = parser.parse_args()

    ok = True

    health_code, health = _request("GET", "/health")
    print(f"[health] {health_code} {health}")
    ok &= health_code == 200 and health.get("status") == "ok" and health.get("db") == "ok"

    if not args.status:
        create_code, create_body = _request(
            "POST", "/projects", {"code": args.code, "name": args.name}
        )
        print(f"[create] {create_code} id={create_body.get('id', create_body)}")
        if create_code not in (201, 422):
            ok = False

        dup_code, dup_body = _request("POST", "/projects", {"code": args.code, "name": args.name})
        print(f"[create-duplicate] {dup_code} {dup_body}")
        if dup_code != 422 or dup_body.get("error", {}).get("code") != "code_exists":
            ok = False

    list_code, listing = _request("GET", "/projects?size=5")
    codes = [item["code"] for item in listing.get("items", [])]
    print(f"[list] {list_code} total={listing.get('total')} codes={codes}")
    if list_code != 200:
        ok = False
    if not args.status and args.code not in codes:
        ok = False

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
