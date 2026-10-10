"""工作日历服务（TD-01 / D-05：计算与展示，不自动级联重排）。

数据来源：app_settings.workcalendar.overrides（全局周末/节假日）
+ app_settings.workcalendar.project.<project_id>.exceptions（项目级例外）。
"""
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.setting import Setting

GLOBAL_KEY = "workcalendar.overrides"
PROJECT_KEY_PREFIX = "workcalendar.project."


def _get_json(db: Session, key: str) -> dict:
    setting = db.scalar(select(Setting).where(Setting.key == key))
    if setting is None or not isinstance(setting.value, dict):
        return {}
    return setting.value


def load_calendar(db: Session, project_id: UUID | None = None) -> dict:
    global_data = _get_json(db, GLOBAL_KEY)
    # Python date.weekday() 约定：周一=0 ... 周日=6；周六=5、周日=6
    weekends: list[int] = global_data.get("weekends", [5, 6])
    holidays: set[str] = {str(d) for d in global_data.get("holidays", [])}

    extra_workdays: set[str] = set()
    extra_holidays: set[str] = set()
    if project_id is not None:
        project_data = _get_json(db, f"{PROJECT_KEY_PREFIX}{project_id}.exceptions")
        extra_workdays = {str(d) for d in project_data.get("workdays", [])}
        extra_holidays = {str(d) for d in project_data.get("holidays", [])}

    return {
        "weekends": weekends,
        "holidays": holidays,
        "extra_workdays": extra_workdays,
        "extra_holidays": extra_holidays,
    }


def is_workday(day: date, calendar: dict) -> bool:
    iso = day.isoformat()
    if iso in calendar["extra_workdays"]:
        return True
    if iso in calendar["extra_holidays"] or iso in calendar["holidays"]:
        return False
    return day.weekday() not in calendar["weekends"]


def workdays_between(start: date, end: date, calendar: dict) -> int:
    """闭区间内的工作日数量；start>end 返回 0。"""
    if end < start:
        return 0
    current = start
    count = 0
    while current <= end:
        if is_workday(current, calendar):
            count += 1
        current += timedelta(days=1)
    return count


def advance_workdays(start: date, workdays: int, calendar: dict) -> date:
    """从 start 前进 workdays 个工作日后的日期（workdays<=0 返回 start）。"""
    if workdays <= 0:
        return start
    current = start
    remaining = workdays
    while remaining > 0:
        current += timedelta(days=1)
        if is_workday(current, calendar):
            remaining -= 1
    return current


def calendar_payload(calendar: dict) -> dict:
    """供前端甘特配置（frappe-gantt 使用 JS getDay：周日=0）。"""
    holiday_dates = sorted(set(calendar["holidays"]) | calendar["extra_holidays"])
    # Python weekday(周一=0) → JS getDay(周日=0)： (w+1) % 7
    js_weekends = sorted({(w + 1) % 7 for w in calendar["weekends"]})
    return {
        "weekends": js_weekends,
        "holidays": holiday_dates,
        "extra_workdays": sorted(calendar["extra_workdays"]),
    }