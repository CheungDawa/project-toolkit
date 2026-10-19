"""全局异常兜底：把裸奔的异常转成与 AppError 同形状的错误响应。

响应形态与 app.core.errors 保持一致：{"error": {"code", "message"}}。

- sqlalchemy.exc.IntegrityError → 422 "integrity_error"
  之前会直接 500，只有 docker logs 能看到原因；现在给出可读的中文原因并保留约束名。
- 其余未捕获异常 → 500 "internal_error"
  服务端 logger.exception 打印完整堆栈（含路径与方法），响应只给通用提示，不泄漏内部细节。

兼容性：Starlette 按异常类的 MRO 依次查找已注册的处理器，**越具体的类优先命中**，
因此新增的 Exception 兜底不会覆盖既有 AppError / RequestValidationError /
HTTPException 的处理逻辑与状态码。
"""
from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

INTEGRITY_CODE = "integrity_error"
INTERNAL_CODE = "internal_error"
INTEGRITY_PREFIX = "数据约束冲突："
INTERNAL_MESSAGE = "服务器内部错误，请查看容器日志"
MAX_DETAIL_LENGTH = 160

# 约束名 → 面向用户的中文提示（命中时优先展示，避免暴露数据库原文）
CONSTRAINT_HINTS: dict[str, str] = {
    "uq_projects_code": "项目编号已存在",
    "uq_tasks_project_wbs": "同一项目下 WBS 编码重复",
    "uq_deps_project_pair": "任务依赖关系重复",
    "uq_baseline_task": "该基线中已存在此任务快照",
    "ck_tasks_progress_range": "进度必须在 0 到 100 之间",
    "ck_tasks_plan_dates": "计划结束日期不能早于计划开始日期",
    "ck_tasks_actual_dates": "实际结束日期不能早于实际开始日期",
    "ck_risks_probability": "风险发生概率必须在 1 到 5 之间",
    "ck_risks_impact": "风险影响程度必须在 1 到 5 之间",
    "ck_assessments_probability": "评估发生概率必须在 1 到 5 之间",
    "ck_assessments_impact": "评估影响程度必须在 1 到 5 之间",
    "ck_stakeholders_influence": "干系人影响力必须在 1 到 5 之间",
    "ck_stakeholders_interest": "干系人关注度必须在 1 到 5 之间",
}

CONSTRAINT_PATTERN = re.compile(r'constraint\s+"([^"]+)"', re.IGNORECASE)


def _error_body(code: str, message: str) -> dict[str, Any]:
    """与 app.core.errors._body 一致的响应体形状。"""
    return {"error": {"code": code, "message": message}}


def _constraint_name(exc: IntegrityError) -> str | None:
    """取违反的约束名：优先 psycopg 诊断信息，其次从错误文本中提取。"""
    original = getattr(exc, "orig", None)
    name = getattr(getattr(original, "diag", None), "constraint_name", None)
    if name:
        return str(name)
    matched = CONSTRAINT_PATTERN.search(str(original or exc))
    return matched.group(1) if matched else None


def _first_line(exc: Exception) -> str:
    """错误首行（截断），避免把整段 SQL / 绑定参数返回给前端。"""
    original = getattr(exc, "orig", None)
    lines = str(original or exc).strip().splitlines()
    if not lines:
        return "未知原因"
    return lines[0][:MAX_DETAIL_LENGTH]


async def integrity_error_handler(_: Request, exc: IntegrityError) -> JSONResponse:
    """数据库约束冲突 → 422，错误码 integrity_error。"""
    detail = _first_line(exc)
    name = _constraint_name(exc)
    hint = CONSTRAINT_HINTS.get(name) if name else None
    if hint:
        message = f"{INTEGRITY_PREFIX}{hint}（{name}）"
    else:
        message = f"{INTEGRITY_PREFIX}{detail}"
    logger.warning("数据库约束冲突（%s）：%s", name or "unknown", detail)
    return JSONResponse(status_code=422, content=_error_body(INTEGRITY_CODE, message))


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """兜底：打印完整堆栈，返回通用 500。"""
    logger.exception("未捕获异常：%s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content=_error_body(INTERNAL_CODE, INTERNAL_MESSAGE))


def register_global_handlers(app: FastAPI) -> None:
    """在既有 register_handlers(app) 之后调用，补充注册兜底处理器。"""
    app.add_exception_handler(IntegrityError, integrity_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
