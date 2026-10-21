"""统一 Excel 导出（openpyxl 已装）。

columns: list[dict]，每个元素 {"key": <字段名>, "header": <中文表头>}。
rows: list[dict]，每个元素按 key 取单元格值（缺失补空串）。
"""
from __future__ import annotations

from io import BytesIO

from openpyxl import Workbook


def build_workbook(rows: list[dict], columns: list[dict]) -> BytesIO:
    """按列定义渲染工作簿，返回内存 BytesIO（已 seek(0)）。"""
    wb = Workbook()
    ws = wb.active
    ws.append([col["header"] for col in columns])
    for row in rows:
        ws.append([row.get(col["key"], "") for col in columns])
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def to_excel_bytes(rows: list[dict], columns: list[dict]) -> bytes:
    """同 build_workbook，但返回原始字节（供 StreamingResponse 使用）。"""
    return build_workbook(rows, columns).getvalue()
