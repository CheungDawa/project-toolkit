"""FastAPI 应用工厂。"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import ai, baselines, calendar, dependencies, health, issues, milestones, projects, risks
from app.api.settings import router as settings_router
from app.api.stage3 import router as stage3_router
from app.api.tasks import router as tasks_router
from app.core.config import get_settings
from app.core.errors import register_handlers
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
    app.include_router(ai.router)
    return app


app = create_app()
