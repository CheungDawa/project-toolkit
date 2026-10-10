"""工作日历服务测试（TD-01：周末/节假日/项目级例外）。"""
from datetime import date

from app.services import calendar as calendar_service


def _calendar(**overrides):
    data = {"weekends": [0, 6], "holidays": [], "extra_workdays": set(), "extra_holidays": set()}
    data.update(overrides)
    return data


def test_workdays_between_skips_weekend():
    cal = _calendar()
    # 2026-10-01(四) ~ 2026-10-05(一)
    assert calendar_service.workdays_between(date(2026, 10, 1), date(2026, 10, 5), cal) == 3


def test_workdays_between_skips_holiday():
    cal = _calendar(holidays={"2026-10-01", "2026-10-02"})
    assert calendar_service.workdays_between(date(2026, 10, 1), date(2026, 10, 5), cal) == 1


def test_project_exception_workday():
    # 周六（2026-10-03）被项目例外标记为工作日
    cal = _calendar(extra_workdays={"2026-10-03"})
    assert calendar_service.workdays_between(date(2026, 10, 1), date(2026, 10, 5), cal) == 4


def test_project_exception_holiday():
    # 周一（2026-10-05）被项目例外标记为休息日
    cal = _calendar(extra_holidays={"2026-10-05"})
    assert calendar_service.workdays_between(date(2026, 10, 1), date(2026, 10, 5), cal) == 2


def test_advance_workdays():
    cal = _calendar()
    # 从周四(10-01)前进 1 个工作日 → 周五(10-02)
    assert calendar_service.advance_workdays(date(2026, 10, 1), 1, cal) == date(2026, 10, 2)
    # 前进 2 个工作日 → 下周一(10-05)
    assert calendar_service.advance_workdays(date(2026, 10, 1), 2, cal) == date(2026, 10, 5)


def test_reverse_range_returns_zero():
    cal = _calendar()
    assert calendar_service.workdays_between(date(2026, 10, 5), date(2026, 10, 1), cal) == 0