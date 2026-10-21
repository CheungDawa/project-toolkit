"""FastAPI 应用工厂。"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import baselines, calendar, dependencies, deliverables, health, issues, milestones, overview, progress, projects, reports, risks
from app.api.settings import router as settings_router
from app.api.stage3 import router as stage3_router
from app.api.tasks import router as tasks_router
from app.api.retro import router as retro_router
from app.api.exports import router as exports_router
from app.core.config import get_settings
from app.core.errors import register_handlers
from app.core.exceptions import register_global_handlers
from app.core.logging import setup_logging


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)

    app = FastAPI(title=settings.app_name, version="0.1.0")

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    register_handlers(app)
    # 兜底放在既有处理器之后注册：Exception 只兜住没人处理的异常，不改变既有状态码
    register_global_handlers(app)
    app.include_router(health.router)
    app.include_router(projects.router)
    app.include_router(settings_router)
    app.include_router(tasks_router)
    app.include_router(dependencies.router)
    app.include_router(milestones.router)
    app.include_router(baselines.router)
    app.include_router(calendar.router)
    app.include_router(risks.router)
    app.include_router(issues.router)
    app.include_router(stage3_router)
    app.include_router(progress.router)
    app.include_router(deliverables.router)
    app.include_router(reports.router)
    app.include_router(overview.router)
    app.include_router(retro_router)
    app.include_router(exports_router)
    return app


app = create_app()
