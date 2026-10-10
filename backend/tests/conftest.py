"""pytest 公共装置：独立测试库（pt_test）+ Alembic 迁移 + 每用例清表。

关键点：
- DATABASE_URL 必须在导入 app 之前重定向到测试库（engine 在导入时构建）。
- 测试库逐次重建（DROP/CREATE）并经 alembic upgrade head 建表，保证迁移链本身被测试（NFR-11）。
"""
import os
from urllib.parse import urlsplit, urlunsplit

TEST_DB_NAME = "pt_test"


def _derive_urls() -> tuple[str, str]:
    original = os.environ.get("DATABASE_URL", "")
    assert original, "DATABASE_URL 未设置（测试需要显式指定数据库连接）"
    parts = urlsplit(original)
    test_url = urlunsplit((parts.scheme, parts.netloc, f"/{TEST_DB_NAME}", "", ""))
    admin_url = urlunsplit((parts.scheme, parts.netloc, "/postgres", "", ""))
    return test_url, admin_url


TEST_URL, ADMIN_URL = _derive_urls()
os.environ["DATABASE_URL"] = TEST_URL  # 必须在导入 app 模块之前生效

import psycopg  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402


def _reset_test_database() -> None:
    # psycopg3 不识别 SQLAlchemy 方言后缀 "+psycopg"，仅连接串需剥离；Alembic/SQLAlchemy 仍用带方言 URL
    with psycopg.connect(ADMIN_URL.replace("+psycopg", ""), autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB_NAME,)
        ).fetchone()
        if exists:
            conn.execute(f'DROP DATABASE "{TEST_DB_NAME}"')
        conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')


def _run_migrations() -> None:
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config(os.path.join(backend_dir, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    cfg.set_main_option("sqlalchemy.url", TEST_URL)
    command.upgrade(cfg, "head")


_reset_test_database()
_run_migrations()

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.db import SessionLocal, engine, get_db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def db_session():
    """每个用例前清空业务表（projects 级联清理 tasks/依赖/基线/里程碑），保证相互独立。"""
    with engine.connect() as conn:
        conn.execute(text('TRUNCATE TABLE projects CASCADE'))
        conn.commit()
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
