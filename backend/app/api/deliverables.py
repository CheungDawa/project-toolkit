"""交付资料与附件 API（T5-03~T5-06；FR-P1-04~06）。"""
from __future__ import annotations

import hashlib
import io
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
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

router = APIRouter(prefix="/api", tags=["deliverables"])

TEMPLATE_KEY = "deliverable.templates"
DEFAULT_TEMPLATES = [
    {
        "name": "信息化项目交付清单（默认）",
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
                Deliverable.project_id == UUID(project_id),
                Deliverable.template_id == name,
                Deliverable.name == item.get("name"),
            )
        )
        if existing is None:
            db.add(
                Deliverable(
                    project_id=UUID(project_id),
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
    db.delete(item)
    db.commit()


def _get_or_404(db: Session, deliverable_id: UUID) -> Deliverable:
    item = db.scalar(select(Deliverable).where(Deliverable.id == deliverable_id))
    if item is None:
        raise AppError(404, "not_found", "交付资料不存在")
    return item


# ---------- 附件 ----------

@router.post("/deliverables/{deliverable_id}/attachments", status_code=201)
async def upload_attachment(deliverable_id: UUID, file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    item = _get_or_404(db, deliverable_id)
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise AppError(422, "file_too_large", "附件不能超过 50MB")
    sha256 = hashlib.sha256(content).hexdigest()
    settings = get_settings()
    attach_dir = Path(settings.data_dir) / "attachments"
    attach_dir.mkdir(parents=True, exist_ok=True)
    storage_name = f"{uuid.uuid4().hex}-{file.filename}"
    storage_path = attach_dir / storage_name
    storage_path.write_bytes(content)

    attachment = Attachment(
        object_type="deliverable",
        object_id=item.id,
        file_name=file.filename or storage_name,
        storage_path=str(storage_path),
        size_bytes=len(content),
        mime_type=file.content_type,
        sha256=sha256,
        uploaded_at=_utcnow(),
    )
    db.add(attachment)
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
    return [
        {
            "id": str(a.id),
            "file_name": a.file_name,
            "size_bytes": a.size_bytes,
            "mime_type": a.mime_type,
            "uploaded_at": a.uploaded_at.isoformat(),
        }
        for a in rows
    ]


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