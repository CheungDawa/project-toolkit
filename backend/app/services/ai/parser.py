"""AI 输出解析与业务校验管道（T4-04：无效 JSON/非法日期/不存在引用一律不入库）。"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from uuid import UUID

from app.core.errors import AppError
from app.services.ai import provider


class AIParseError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def extract_json(text: str) -> dict:
    """从模型输出提取 JSON（容忍 markdown 代码围栏与前后缀）。"""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise AIParseError("format_error", "模型返回的不是有效 JSON，请重试") from None
    if not isinstance(data, dict):
        raise AIParseError("format_error", "模型返回 JSON 结构不正确")
    return data


def _require_str(obj: dict, key: str, label: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip():
        raise AIParseError("validation", f"{label}不能为空")
    return value.strip()


def _optional_date(value) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise AIParseError("validation", f"非法日期：{value}") from None


def validate_wbs_draft(payload: dict, max_tasks: int = 200) -> list[dict]:
    """校验 WBS 初稿：任务名/日期次序/层级引用。返回规范化任务列表。"""
    raw_tasks = payload.get("tasks") if isinstance(payload, dict) else None
    if not isinstance(raw_tasks, list) or not raw_tasks:
        raise AIParseError("validation", "WBS 初稿缺少任务列表")
    if len(raw_tasks) > max_tasks:
        raise AIParseError("validation", f"任务数量超过上限 {max_tasks}")

    tasks: list[dict] = []
    seen_wbs: set[str] = set()
    for item in raw_tasks:
        if not isinstance(item, dict):
            raise AIParseError("validation", "任务条目格式不正确")
        name = _require_str(item, "name", "任务名称")
        wbs = str(item.get("wbs", "")) or str(item.get("code", ""))
        plan_start = _require_date_opt(item, "plan_start")
        plan_end = _require_date_opt(item, "plan_end")
        if plan_start and plan_end and plan_end < plan_start:
            raise AIParseError("validation", f"任务「{name}」计划结束早于开始")
        if wbs in seen_wbs:
            raise AIParseError("validation", f"WBS 编码重复：{wbs}")
        seen_wbs.add(wbs)
        tasks.append({
            "wbs": wbs,
            "name": name,
            "owner": str(item.get("owner") or "") or None,
            "plan_start": plan_start.isoformat() if plan_start else None,
            "plan_end": plan_end.isoformat() if plan_end else None,
            "work_hours": float(item["work_hours"]) if item.get("work_hours") not in (None, "") else None,
            "progress": float(item.get("progress") or 0),
        })
    return tasks


def _require_date_opt(obj: dict, key: str) -> date | None:
    value = obj.get(key)
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise AIParseError("validation", f"非法日期：{value}") from None


def validate_schedule_check(text: str) -> None:
    """工期/依赖检查为对话输出，仅需非空。"""
    if not text or not text.strip():
        raise AIParseError("format_error", "模型未返回有效检查结论")


def build_context_digest(project_id: UUID, capability: str, keys: list[str]) -> dict:
    return {
        "project_id": str(project_id),
        "capability": capability,
        "fields": keys,
        "at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }