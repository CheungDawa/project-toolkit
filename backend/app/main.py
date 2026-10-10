"""FastAPI 应用工厂。"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, projects
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
    return app


app = create_app()
