import os
import re
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

MEDIA_DIR = "media_files"
AUTH_TOKEN_LIFETIME = 3600
RATE_LIMIT_MESSAGES = 30
RATE_LIMIT_WINDOW = 60
MAX_MEDIA_FILE_SIZE = 20 * 1024 * 1024
MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024
AVATAR_IMAGE_MIMES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_MESSAGE_LENGTH = 10000
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_]{2,32}$")
ALLOWED_MIME_PATTERNS = {
    "image": ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
    "video": ["video/mp4", "video/webm", "video/ogg"],
    "audio": ["audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/webm"],
    "voice": ["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg"],
    "file": [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
    ],
}
MEDIA_EXT_MAP = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/webm": ".webm",
    "audio/mp3": ".mp3",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
}
MEDIA_MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
}


class AppSettings(BaseSettings):
    """Настройки окружения (pydantic-settings).

    Читается из переменных окружения и .env. Имена полей — в верхнем регистре,
    чтобы `Flask.config.from_object(...)` корректно импортировал их в `app.config`.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    SECRET_KEY: str = Field(default_factory=lambda: os.urandom(24).hex())
    ALLOWED_ORIGINS: str = "*"
    REDIS_URL: str | None = None
    ALLOW_TOKEN_IN_QUERY: bool = True
    NEBULA_ENV: str = "development"

    DEBUG: bool = False
    TESTING: bool = False

    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""
    DB_NAME: str = "nebula"
    DB_POOL_SIZE: int = Field(default=10, ge=1)

    AI_ENABLED: bool = False
    AI_API_BASE: str = "https://api.openai.com/v1"
    AI_API_KEY: str | None = None
    AI_MODEL: str = "gpt-4o-mini"


def _apply_env_profile(settings: AppSettings) -> AppSettings:
    """Override flags based on NEBULA_ENV / TESTING while keeping other env values."""
    env = (settings.NEBULA_ENV or "development").lower()

    if settings.TESTING or env in {"test", "testing"}:
        return settings.model_copy(update={
            "TESTING": True,
            "DEBUG": False,
            "ALLOW_TOKEN_IN_QUERY": True,
        })

    if env in {"prod", "production"}:
        allow_query_env = os.getenv("ALLOW_TOKEN_IN_QUERY")
        allow_query = (
            allow_query_env.lower() in ("1", "true", "yes")
            if allow_query_env is not None
            else False
        )
        return settings.model_copy(update={
            "DEBUG": False,
            "TESTING": False,
            "ALLOW_TOKEN_IN_QUERY": allow_query,
        })

    return settings.model_copy(update={"DEBUG": True, "TESTING": False})


def get_config(env_name: str | None = None, testing: bool = False) -> AppSettings:
    """Совместимо с `app.config.from_object(...)`: возвращает инстанс с заглавными атрибутами."""
    overrides: dict[str, Any] = {}
    if env_name is not None:
        overrides["NEBULA_ENV"] = env_name
    if testing:
        overrides["TESTING"] = True

    settings = AppSettings(**overrides) if overrides else AppSettings()
    return _apply_env_profile(settings)


Config: AppSettings = get_config()


class BaseConfig(AppSettings):
    """Deprecated: оставлено для обратной совместимости импорта."""


class DevelopmentConfig(BaseConfig):
    DEBUG: bool = True


class TestConfig(BaseConfig):
    TESTING: bool = True
    DEBUG: bool = False
    ALLOW_TOKEN_IN_QUERY: bool = True


class ProductionConfig(BaseConfig):
    DEBUG: bool = False
