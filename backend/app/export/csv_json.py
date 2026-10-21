"""统一 CSV / JSON 导出。

columns: list[dict]，每个元素 {"key": <字段名>, "header": <中文表头>}。
rows: list[dict]，单元格值统一 str() 处理（日期/UUID 等）。
"""
from __future__ import annotations

import csv
import io
import json
from typing import Any


def _cell(value: Any) -> str:
    """单元格值 → 字符串；None 视为空串。"""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def to_csv_bytes(rows: list[dict], columns: list[dict]) -> str:
    """渲染 CSV 文本（含表头行，UTF-8 含 BOM 便于 Excel 打开）。"""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([col["header"] for col in columns])
    for row in rows:
        writer.writerow([_cell(row.get(col["key"], "")) for col in columns])
    # 加 BOM，确保中文在 Excel 中不乱码
    return "\ufeff" + buf.getvalue()


def to_json_bytes(rows: list[dict]) -> str:
    """渲染 JSON 文本（ensure_ascii=False 保留中文，日期/UUID 经 default=str）。"""
    return json.dumps(rows, ensure_ascii=False, default=str, indent=2)
