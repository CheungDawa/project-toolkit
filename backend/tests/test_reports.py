"""周报口径回归测试：「本周进展」必须是本周口径，累计值单列并标注「累计」。

背景（客户误导修复）：旧版周报「一、本周进展」输出的是 project_metrics 的
**项目累计**值（完成 12/31 = 开工以来的累计数），客户会读成本周做了 12 项。
现口径：
- 本周完成：完成日期（actual_end，缺失时对已闭环任务用 updated_at 兜底）落在本周
  （周一~周日，按业务时区今天计算）的任务条数，父子同周完成只计最内层；
- 本周新增风险 / 问题：created_at 落在本周；
- 累计完成 X/Y、整体完成进度 P% 单列一行，显式标注「累计」。

运行环境：依赖容器内 Postgres（conftest 会重建 pt_test 库并跑迁移），本机无法执行。
"""
from datetime import timedelta

from app.core.time import today_local


def _project(client, code="RPT-001") -> str:
    resp = client.post("/api/projects", json={"code": code, "name": "周报口径项目"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _task(client, project_id: str, name: str, **extra) -> dict:
    payload = {"name": name, **extra}
    resp = client.post(f"/api/projects/{project_id}/tasks", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _weekly_text(client, project_id: str) -> str:
    resp = client.get(f"/api/projects/{project_id}/reports/weekly-text")
    assert resp.status_code == 200, resp.text
    return resp.json()["content"]


def _this_week_dates() -> tuple[str, str]:
    """本周内的一天（周三天）与一个明确不在本周的日期（30 天前）。"""
    today = today_local()
    monday = today - timedelta(days=today.weekday())
    return (monday + timedelta(days=2)).isoformat(), (today - timedelta(days=30)).isoformat()


# ---------- 1. 本周口径 vs 累计口径 ----------

def test_weekly_completion_is_week_scoped(client):
    """本周完成只算本周完成日期的任务，累计行仍统计全部已完成（2 项）。"""
    pid = _project(client, "RPT-WK1")
    in_week, last_month = _this_week_dates()
    _task(client, pid, "本周完成", status="已完成", progress=100, actual_end=in_week)
    _task(client, pid, "上月完成", status="已完成", progress=100, actual_end=last_month)

    content = _weekly_text(client, pid)
    assert "本周完成：1 项" in content
    assert "本周新增风险 0 项、本周新增问题 0 项" in content
    # 累计口径：两条任务状态均为已完成
    assert "累计完成 2/2" in content
    assert "整体完成进度 100.0%" in content


# ---------- 2. 无 actual_end 时降级，不拿累计值冒充本周值 ----------

def test_weekly_without_actual_end_is_degraded(client):
    """项目内完全没有实际完成日期：给出补录提示，接口仍 200 且照常输出累计行。"""
    pid = _project(client, "RPT-WK2")
    _task(client, pid, "未填实际完成日期", status="已完成", progress=100)

    resp = client.get(f"/api/projects/{pid}/reports/weekly-text")
    assert resp.status_code == 200, resp.text
    content = resp.json()["content"]
    assert "本周完成：0 项" in content
    assert "未填写实际完成日期" in content
    assert "累计完成 1/1" in content
