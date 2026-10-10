"""运行配置：环境变量优先（Docker Compose 注入），见 .env.example。"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Project Toolkit API"
    environment: str = "production"
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg://pt:pt@localhost:5432/projecttoolkit"
    cors_origins: str = ""
    data_dir: str = "/data"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
