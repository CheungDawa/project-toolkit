"""交付资料与附件 API（T5-03~T5-06；FR-P1-04~06）。"""
from __future__ import annotations

import hashlib
import io
import logging
import mimetypes
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import AppError
from app.models.setting import Setting
from app.models.stage5 import Attachment, Deliverable
from app.schemas.stage5 import DeliverableCreate, DeliverableRead, DeliverableUpdate, TemplateItem
from app.services import audit as audit_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["deliverables"])

TEMPLATE_KEY = "deliverable.templates"
DEFAULT_TEMPLATES = [
    {
        "name": "信息化集成交付清单（默认）",
        "items": [
            {"category": "设备到货", "name": "到货签收单"},
            {"category": "安装调试", "name": "安装调试记录"},
            {"category": "测试", "name": "测试报告"},
            {"category": "培训", "name": "培训签到与评估"},
            {"category": "试运行", "name": "试运行记录"},
            {"category": "验收", "name": "验收报告"},
            {"category": "运维移交", "name": "运维移交清单"},
        ],
    }
]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_templates(db: Session) -> list[dict]:
    setting = db.scalar(select(Setting).where(Setting.key == TEMPLATE_KEY))
    value = setting.value if setting and isinstance(setting.value, list) else []
    return value or DEFAULT_TEMPLATES


# ---------- 模板 ----------

@router.get("/deliverable-templates")
def list_templates(db: Session = Depends(get_db)) -> dict:
    return {"templates": _get_templates(db)}


@router.put("/deliverable-templates")
def update_templates(payload: dict, db: Session = Depends(get_db)) -> dict:
    templates = payload.get("templates")
    if not isinstance(templates, list) or not templates:
        raise AppError(422, "invalid_templates", "模板列表不能为空")
    setting = db.scalar(select(Setting).where(Setting.key == TEMPLATE_KEY))
    if setting is None:
        from app.models.setting import Setting as SettingModel
        setting = SettingModel(key=TEMPLATE_KEY, value=templates, description="交付清单模板")
        db.add(setting)
    else:
        setting.value = templates
    db.commit()
    return {"templates": templates}


@router.post("/projects/{project_id}/deliverables/instantiate")
def instantiate_template(project_id: UUID, payload: dict, db: Session = Depends(get_db)) -> dict:
    """按模板生成交付清单条目。"""
    name = payload.get("template_name") or "信息化集成交付清单（默认）"
    templates = _get_templates(db)
    template = next((t for t in templates if t.get("name") == name), None)
    if template is None:
        raise AppError(404, "not_found", f"模板不存在：{name}")
    created = 0
    for item in template.get("items", []):
        existing = db.scalar(
            select(Deliverable).where(
                Deliverable.project_id == project_id,
                Deliverable.template_id == name,
                Deliverable.name == item.get("name"),
            )
        )
        if existing is None:
            db.add(
                Deliverable(
                    project_id=project_id,
                    template_id=name,
                    category=item.get("category"),
                    name=item.get("name"),
                    note=item.get("description"),
                    submit_status="未提交",
                    review_status="待审核",
                    created_at=_utcnow(),
                    updated_at=_utcnow(),
                )
            )
            created += 1
    db.commit()
    return {"created": created}


# ---------- 台账 ----------

@router.get("/projects/{project_id}/deliverables", response_model=list[DeliverableRead])
def list_deliverables(
    project_id: UUID,
    category: str | None = None,
    submit_status: str | None = None,
    review_status: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
) -> list:
    stmt = select(Deliverable).where(Deliverable.project_id == project_id)
    if category:
        stmt = stmt.where(Deliverable.category == category)
    if submit_status:
        stmt = stmt.where(Deliverable.submit_status == submit_status)
    if review_status:
        stmt = stmt.where(Deliverable.review_status == review_status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Deliverable.name.ilike(like) | Deliverable.owner.ilike(like))
    return list(db.scalars(stmt.order_by(Deliverable.plan_date, Deliverable.name)).all())


@router.post("/projects/{project_id}/deliverables", status_code=201, response_model=DeliverableRead)
def create_deliverable(project_id: UUID, payload: DeliverableCreate, db: Session = Depends(get_db)) -> Deliverable:
    item = Deliverable(project_id=project_id, **payload.model_dump())
    db.add(item)
    db.flush()
    audit_service.record(db, project_id, "deliverable", item.id, "create", f"新增交付资料：{item.name}")
    db.commit()
    db.refresh(item)
    return item


@router.patch("/deliverables/{deliverable_id}", response_model=DeliverableRead)
def update_deliverable(deliverable_id: UUID, payload: DeliverableUpdate, db: Session = Depends(get_db)) -> Deliverable:
    item = _get_or_404(db, deliverable_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.flush()
    audit_service.record(db, item.project_id, "deliverable", item.id, "update", f"更新交付资料：{item.name}")
    db.commit()
    db.refresh(item)
    return item


@router.delete("/deliverables/{deliverable_id}", status_code=204)
def delete_deliverable(deliverable_id: UUID, db: Session = Depends(get_db)) -> None:
    item = _get_or_404(db, deliverable_id)
    # 级联清理附件：先删磁盘文件再删行，文件缺失不影响主流程
    removed = _purge_attachments(db, "deliverable", item.id)
    summary = f"删除交付资料：{item.name}"
    if removed:
        summary += f"（同时清理 {removed} 个附件）"
    audit_service.record(db, item.project_id, "deliverable", item.id, "delete", summary)
    db.delete(item)
    db.commit()


def _get_or_404(db: Session, deliverable_id: UUID) -> Deliverable:
    item = db.scalar(select(Deliverable).where(Deliverable.id == deliverable_id))
    if item is None:
        raise AppError(404, "not_found", "交付资料不存在")
    return item


# ---------- 附件 ----------
#
# 存储约定（自本次变更起）：
#   DB 存「相对附件根目录」的路径，形如 "<project_id>/<uuid>-<安全文件名>"，
#   换挂载点/换 data_dir 后只需改环境变量即可，不再写死绝对路径。
#   历史数据存的是绝对路径（旧实现 str(Path)），由 _resolve_path 兼容读取，不做迁移。

ATTACHMENT_DIR_NAME = "attachments"
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
_SAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9\u4e00-\u9fa5._-]")
_MEDIA_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
}
# 允许 inline 预览的类型：仅 PDF 与图片。其余类型（含 svg/html，避免同域脚本执行）强制下载。
_INLINE_SAFE_MEDIA_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
}


def _attachment_root() -> Path:
    """附件根目录：<data_dir>/attachments。"""
    return Path(get_settings().data_dir) / ATTACHMENT_DIR_NAME


def _safe_storage_name(raw_name: str | None) -> str:
    """清洗上传文件名，防路径穿越：取 basename + 白名单过滤。

    示例："../../etc/passwd" -> "passwd"，"a/b 报 告.pdf" -> "a_b_报告.pdf"。
    """
    base = Path((raw_name or "").replace("\\", "/")).name
    cleaned = _SAFE_NAME_CHARS.sub("", base.replace(" ", "_")).strip(". ")
    return cleaned[:120] or "attachment"


def _display_name(raw_name: str | None, fallback: str) -> str:
    """展示用文件名：保留中文与原始大小写，仅去掉目录部分并限长。"""
    name = Path((raw_name or "").replace("\\", "/")).name.strip()
    return (name or fallback)[:200]


def _resolve_path(storage_path: str) -> Path:
    """把 DB 中的 storage_path 解析为磁盘路径（兼容历史绝对路径）。

    - 绝对路径（旧数据，如 /data/attachments/xxx）：直接沿用；
    - 相对路径（新数据，如 <project_id>/<uuid>-name.ext）：拼到附件根目录；
    - 相对路径里出现 ".." 企图越出根目录时，退化为根目录下的 basename（读取即 404）。
    """
    raw = (storage_path or "").strip()
    root = _attachment_root()
    if not raw:
        return root / "__missing__"
    candidate = Path(raw)
    if candidate.is_absolute():
        return candidate
    target = root / candidate
    try:
        target.resolve().relative_to(root.resolve())
    except ValueError:
        return root / candidate.name
    return target


def _remove_file(storage_path: str) -> None:
    """删除磁盘附件；文件已不存在或删除失败均不抛出（DB 行照删）。"""
    try:
        path = _resolve_path(storage_path)
        if path.is_file():
            path.unlink()
    except OSError as exc:  # noqa: BLE001
        logger.warning("附件文件删除失败（storage_path=%s）：%s", storage_path, exc)


def _attachment_payload(attachment: Attachment, with_owner: bool = False) -> dict:
    payload = {
        "id": str(attachment.id),
        "file_name": attachment.file_name,
        "size_bytes": attachment.size_bytes,
        "mime_type": attachment.mime_type,
        "uploaded_at": attachment.uploaded_at.isoformat(),
    }
    if with_owner:
        payload["deliverable_id"] = str(attachment.object_id)
    return payload


def _purge_attachments(db: Session, object_type: str, object_id: UUID) -> int:
    """删除某业务对象的全部附件（磁盘文件 + DB 行），返回清理数量。"""
    rows = db.scalars(
        select(Attachment).where(
            Attachment.object_type == object_type, Attachment.object_id == object_id
        )
    ).all()
    for row in rows:
        _remove_file(row.storage_path)
        db.delete(row)
    return len(rows)


def _guess_media_type(file_name: str, mime_type: str | None) -> str:
    """按扩展名推断 media_type：显式映射 > mimetypes > 上传时记录 > 二进制兜底。"""
    suffix = Path(file_name).suffix.lower()
    if suffix in _MEDIA_TYPES:
        return _MEDIA_TYPES[suffix]
    guessed = mimetypes.guess_type(file_name)[0]
    if guessed:
        return guessed
    return mime_type or "application/octet-stream"


def _content_disposition(file_name: str, disposition: str) -> str:
    """RFC 5987：ASCII 兜底 filename + UTF-8 编码 filename*，保证中文名不乱码。"""
    ascii_name = "".join(ch if ord(ch) < 128 else "_" for ch in file_name).replace('"', "_")
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name, safe='')}"


def _iter_file(path: Path, chunk_size: int = 1024 * 1024):
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            yield chunk


@router.post("/deliverables/{deliverable_id}/attachments", status_code=201)
async def upload_attachment(deliverable_id: UUID, file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    item = _get_or_404(db, deliverable_id)
    content = await file.read()
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise AppError(422, "file_too_large", "附件不能超过 50MB")
    sha256 = hashlib.sha256(content).hexdigest()
    safe_name = _safe_storage_name(file.filename)
    storage_name = f"{uuid.uuid4().hex}-{safe_name}"
    # DB 只存相对路径：<project_id>/<uuid>-<name>，绝对路径换挂载点即失联
    relative_path = f"{item.project_id}/{storage_name}"
    target_dir = _attachment_root() / str(item.project_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / storage_name).write_bytes(content)

    attachment = Attachment(
        object_type="deliverable",
        object_id=item.id,
        file_name=_display_name(file.filename, safe_name),
        storage_path=relative_path,
        size_bytes=len(content),
        mime_type=file.content_type,
        sha256=sha256,
        uploaded_at=_utcnow(),
    )
    db.add(attachment)
    db.flush()
    audit_service.record(db, item.project_id, "attachment", attachment.id, "upload", f"上传附件：{attachment.file_name}")
    db.commit()
    return {"id": str(attachment.id), "file_name": attachment.file_name, "size_bytes": attachment.size_bytes}


@router.get("/deliverables/{deliverable_id}/attachments")
def list_attachments(deliverable_id: UUID, db: Session = Depends(get_db)) -> list[dict]:
    _get_or_404(db, deliverable_id)
    rows = db.scalars(
        select(Attachment).where(
            Attachment.object_type == "deliverable", Attachment.object_id == deliverable_id
        )
    ).all()
    return [_attachment_payload(a) for a in rows]


@router.get("/projects/{project_id}/deliverables/attachments")
def list_project_attachments(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    """按项目一次性取回全部交付资料附件（供列表页展示「附件(n)」徽标，避免逐行拉取）。"""
    deliverable_ids = list(
        db.scalars(select(Deliverable.id).where(Deliverable.project_id == project_id)).all()
    )
    if not deliverable_ids:
        return {"attachments": []}
    rows = db.scalars(
        select(Attachment)
        .where(
            Attachment.object_type == "deliverable",
            Attachment.object_id.in_(deliverable_ids),
        )
        .order_by(Attachment.uploaded_at)
    ).all()
    return {"attachments": [_attachment_payload(a, with_owner=True) for a in rows]}


@router.get("/attachments/{attachment_id}/download")
def download_attachment(
    attachment_id: UUID,
    inline: bool = Query(False, description="传 1/true 时用 inline 方式返回，供浏览器直接预览"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """下载/预览附件。文件缺失返回 404（统一错误结构 {"error": {...}}）。"""
    attachment = _get_attachment_or_404(db, attachment_id)
    path = _resolve_path(attachment.storage_path)
    if not path.is_file():
        raise AppError(404, "not_found", "附件文件不存在，可能已被清理")
    media_type = _guess_media_type(attachment.file_name, attachment.mime_type)
    disposition = "inline" if inline and media_type in _INLINE_SAFE_MEDIA_TYPES else "attachment"
    headers = {
        "Content-Disposition": _content_disposition(attachment.file_name, disposition),
        "Content-Length": str(path.stat().st_size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=0, must-revalidate",
    }
    return StreamingResponse(_iter_file(path), media_type=media_type, headers=headers)


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: UUID, db: Session = Depends(get_db)) -> None:
    """删除单个附件：DB 行 + 磁盘文件（文件已丢失也算成功）。"""
    attachment = _get_attachment_or_404(db, attachment_id)
    project_id = _attachment_project_id(db, attachment)
    file_name = attachment.file_name
    _remove_file(attachment.storage_path)
    audit_service.record(db, project_id, "attachment", attachment.id, "delete", f"删除附件：{file_name}")
    db.delete(attachment)
    db.commit()


def _get_attachment_or_404(db: Session, attachment_id: UUID) -> Attachment:
    attachment = db.scalar(select(Attachment).where(Attachment.id == attachment_id))
    if attachment is None:
        raise AppError(404, "not_found", "附件不存在")
    return attachment


def _attachment_project_id(db: Session, attachment: Attachment) -> UUID | None:
    """按多态关联反查所属项目（用于审计日志）；未知类型返回 None。"""
    if attachment.object_type == "deliverable":
        item = db.scalar(select(Deliverable).where(Deliverable.id == attachment.object_id))
        return item.project_id if item else None
    return None


# ---------- Excel 导入导出 ----------

@router.get("/projects/{project_id}/deliverables/export")
def export_deliverables(project_id: UUID, db: Session = Depends(get_db)) -> StreamingResponse:
    items = db.scalars(select(Deliverable).where(Deliverable.project_id == project_id)).all()
    wb = Workbook()
    ws = wb.active
    ws.title = "交付资料"
    ws.append(["category", "name", "owner", "plan_date", "submit_status", "review_status", "note"])
    for item in items:
        ws.append([
            item.category or "",
            item.name,
            item.owner or "",
            item.plan_date.isoformat() if item.plan_date else "",
            item.submit_status,
            item.review_status,
            item.note or "",
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="deliverables_{project_id}.xlsx"'},
    )


@router.post("/projects/{project_id}/deliverables/import")
async def import_deliverables(
    project_id: UUID, file: UploadFile = File(...), db: Session = Depends(get_db)
) -> dict:
    content = await file.read()
    try:
        wb = load_workbook(io.BytesIO(content))
    except Exception:  # noqa: BLE001
        raise AppError(422, "invalid_file", "无法解析 Excel 文件") from None
    ws = wb.active
    created = 0
    errors: list[dict] = []
    for row_index, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        values = list(row) + [None] * 7
        category, name, owner, plan_date, submit_status, review_status, note = values[:7]
        try:
            if not name or not str(name).strip():
                raise ValueError("名称不能为空")
            db.add(
                Deliverable(
                    project_id=project_id,
                    category=str(category).strip() if category else None,
                    name=str(name).strip(),
                    owner=str(owner).strip() if owner else None,
                    plan_date=date.fromisoformat(str(plan_date).strip()) if plan_date else None,
                    submit_status=str(submit_status).strip() or "未提交",
                    review_status=str(review_status).strip() or "待审核",
                    note=str(note).strip() if note else None,
                    created_at=_utcnow(),
                    updated_at=_utcnow(),
                )
            )
            created += 1
        except Exception as exc:  # noqa: BLE001
            errors.append({"row": row_index, "message": str(exc)})
    db.commit()
    return {"created": created, "errors": errors}


def _parse_date(value) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value).strip()[:10])