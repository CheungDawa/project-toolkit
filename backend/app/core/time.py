"""统一时间口径：业务「今天」一律取北京时间（Asia/Shanghai）。

背景：容器默认 UTC，业务日期来自三处不同实现（date.today() / utcnow().date()），
在北京时间 00:00~08:00 之间会相差一天，「生成今日快照」会写到昨天。

健壮性：tzdata 缺失时（python:*-slim 镜像常见）ZoneInfo 会抛 ZoneInfoNotFoundError，
此处按固定 +08:00 偏移退化（上海自 1991 年起无夏令时，等价），并保留 date.today() 兜底，
绝不因缺 tzdata 让整个应用起不来。
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

LOCAL_TZ_NAME = "Asia/Shanghai"
_UTC_PLUS_8 = timezone(timedelta(hours=8), name="UTC+08:00")


def _load_local_tz() -> object:
    """加载上海时区；tzdata 不可用则退化为固定 +08:00（对上海等价）。"""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(LOCAL_TZ_NAME)
    except Exception:  # noqa: BLE001 - 缺 tzdata / 时区名不可用
        return _UTC_PLUS_8


LOCAL_TZ = _load_local_tz()


def today_local() -> date:
    """业务日期口径唯一入口：返回北京时间的当天日期。"""
    try:
        return datetime.now(LOCAL_TZ).date()
    except Exception:  # noqa: BLE001 - 兜底：任何异常都不影响业务主流程
        return date.today()


def now_local() -> datetime:
    """返回带时区信息的北京时间点（日志/时间戳展示用）。"""
    try:
        return datetime.now(LOCAL_TZ)
    except Exception:  # noqa: BLE001
        return datetime.now(_UTC_PLUS_8)
