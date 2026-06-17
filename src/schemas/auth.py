"""Pydantic-модели для /api/register и /api/login.

Сообщения об ошибках совпадают 1:1 со строками из
[utils/validators.py] и прежней ручной валидации, чтобы фронтовая
`translateApiMessage` (см. static/js/i18n.js) корректно находила перевод.
"""

from pydantic import BaseModel, ConfigDict, field_validator

from config import USERNAME_PATTERN
from utils.validators import is_valid_password


class _CredentialsBase(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=False,
        extra="ignore",
        validate_default=True,
    )

    username: str = ""
    password: str = ""

    @field_validator("username", mode="before")
    @classmethod
    def _coerce_username(cls, v: object) -> str:
        if v is None:
            return ""
        return str(v).strip()

    @field_validator("password", mode="before")
    @classmethod
    def _coerce_password(cls, v: object) -> str:
        if v is None:
            return ""
        return str(v)


class RegisterBody(_CredentialsBase):
    @field_validator("username", mode="after")
    @classmethod
    def _check_username_rules(cls, v: str) -> str:
        if not v:
            raise ValueError("Fill in all fields")
        if not USERNAME_PATTERN.match(v):
            raise ValueError(
                "Username must be 2-32 characters (letters, digits, underscore)"
            )
        return v

    @field_validator("password", mode="after")
    @classmethod
    def _check_password_rules(cls, v: str) -> str:
        if not v:
            raise ValueError("Fill in all fields")
        ok, message = is_valid_password(v)
        if not ok:
            raise ValueError(message)
        return v


class LoginBody(_CredentialsBase):
    """Логин не предъявляет требований к паролю/нику — валидация идёт по БД."""
