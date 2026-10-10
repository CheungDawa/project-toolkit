"""模型服务适配层（FR-P0-26）：OpenAI 兼容协议，配置可分离，密钥仅服务端。

错误分类：timeout / api_error / format_error；瞬态错误自动重试一次。
"""
from __future__ import annotations

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.setting import Setting

MODEL_KEY = "model.default"
DEFAULT_TIMEOUT = 60


class ModelNotConfigured(Exception):
    pass


class ModelCallError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ModelConfig:
    def __init__(self, provider: str, base_url: str, model: str, api_key: str, timeout: int) -> None:
        self.provider = provider
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout = timeout

    @property
    def display_name(self) -> str:
        return f"{self.provider}/{self.model}"


def load_config(db: Session) -> ModelConfig:
    setting = db.scalar(select(Setting).where(Setting.key == MODEL_KEY))
    value = setting.value if setting and isinstance(setting.value, dict) else {}
    if not value.get("base_url") or not value.get("model"):
        raise ModelNotConfigured()
    return ModelConfig(
        provider=str(value.get("provider", "openai")),
        base_url=str(value["base_url"]),
        model=str(value["model"]),
        api_key=str(value.get("api_key", "")),
        timeout=int(value.get("timeout", DEFAULT_TIMEOUT)),
    )


def is_configured(db: Session) -> bool:
    try:
        load_config(db)
        return True
    except ModelNotConfigured:
        return False


def _chat_once(config: ModelConfig, messages: list[dict], temperature: float) -> tuple[str, int]:
    url = f"{config.base_url}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    payload = {"model": config.model, "messages": messages, "temperature": temperature}
    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=config.timeout)
    except httpx.TimeoutException:
        raise ModelCallError("timeout", "模型调用超时") from None
    except httpx.HTTPError as exc:
        raise ModelCallError("api_error", f"模型服务不可达：{exc.__class__.__name__}") from None

    if resp.status_code >= 400:
        raise ModelCallError("api_error", f"模型服务返回 {resp.status_code}：{resp.text[:200]}")

    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        usage = int((data.get("usage") or {}).get("total_tokens") or 0)
    except Exception:  # noqa: BLE001
        raise ModelCallError("format_error", "模型返回格式不正确") from None
    return str(content), usage


def call_model(db: Session, messages: list[dict], temperature: float = 0.0) -> tuple[str, int, str]:
    """返回 (content, token_usage, model_identifier)。瞬态错误自动重试一次。"""
    config = load_config(db)
    try:
        content, usage = _chat_once(config, messages, temperature)
        return content, usage, config.display_name
    except ModelCallError as exc:
        if exc.code in ("timeout", "api_error"):
            content, usage = _chat_once(config, messages, temperature)
            return content, usage, config.display_name
        raise


def safe_config_summary(db: Session) -> dict | None:
    """配置摘要（密钥脱敏，仅供页面展示）。"""
    try:
        config = load_config(db)
    except ModelNotConfigured:
        return None
    key = config.api_key
    masked = f"{key[:3]}****{key[-4:]}" if key and len(key) > 7 else ("已设置" if key else "未设置")
    return {
        "provider": config.provider,
        "base_url": config.base_url,
        "model": config.model,
        "api_key_masked": masked,
        "timeout": config.timeout,
    }