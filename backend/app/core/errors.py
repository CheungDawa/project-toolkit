"""统一错误结构：{"error": {"code", "message", "fields?"}}。

前端按此单一形态处理；业务校验（编号重复、日期倒置等）与参数校验共用 422。
"""
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """统一业务错误：status_code + code + message(+fields)。"""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        fields: dict[str, list[str]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = fields


def _body(code: str, message: str, fields: dict[str, list[str]] | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if fields:
        error["fields"] = fields
    return {"error": error}


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=_body(exc.code, exc.message, exc.fields))


async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields: dict[str, list[str]] = {}
    for item in exc.errors():
        loc = [str(part) for part in item.get("loc", []) if part not in ("body",)]
        if loc and loc[0] in ("query", "path"):
            loc = loc[1:]
        key = ".".join(loc) if loc else "body"
        fields.setdefault(key, []).append(str(item.get("msg", "参数不正确")))
    return JSONResponse(status_code=422, content=_body("validation_error", "请求参数不正确", fields))


_HTTP_MESSAGES = {
    404: ("not_found", "资源不存在"),
    405: ("method_not_allowed", "请求方法不支持"),
    400: ("bad_request", "请求不正确"),
}


async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code, message = _HTTP_MESSAGES.get(exc.status_code, ("http_error", str(exc.detail)))
    return JSONResponse(status_code=exc.status_code, content=_body(code, message))


def register_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
