"""Декоратор `validate_body` для автоматического парсинга тела запроса через Pydantic.

Валидация тела JSON-запроса происходит через Pydantic-модель; при ошибке
возвращается JSON вида ``{"success": False, "message": <string>}`` с тем же
английским текстом, что ожидает фронтовая `translateApiMessage`.
"""

from collections.abc import Callable
from functools import wraps
from typing import TypeVar

from flask import jsonify, request
from pydantic import BaseModel, ValidationError
from werkzeug.exceptions import BadRequest

T = TypeVar("T", bound=BaseModel)

_PYDANTIC_FALLBACKS: dict[str, str] = {
    "missing": "Fill in all fields",
    "json_invalid": "Invalid request",
    "json_type": "Invalid request",
    "model_type": "Invalid request",
}


def _first_error_message(err: ValidationError) -> str:
    """Взять первую ошибку и свести её к прежней английской строке."""
    errors = err.errors()
    if not errors:
        return "Invalid request"

    first = errors[0]
    msg = first.get("msg", "") or ""
    err_type = first.get("type", "") or ""

    # Наши собственные сообщения из @field_validator/@model_validator
    # приходят с префиксом 'Value error, ' в pydantic v2.
    if err_type in {"value_error", "assertion_error"}:
        if msg.startswith("Value error, "):
            return msg[len("Value error, "):]
        if msg.startswith("Assertion failed, "):
            return msg[len("Assertion failed, "):]
        return msg

    if err_type in _PYDANTIC_FALLBACKS:
        return _PYDANTIC_FALLBACKS[err_type]

    return "Invalid request"


def validate_body(model: type[T]) -> Callable[[Callable], Callable]:
    """Распарсить `request.json` в модель и передать её как kwarg `payload`.

    При ошибке валидации — `jsonify({"success": False, "message": ...})`.
    """

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if request.get_data(cache=True) and not request.is_json:
                return jsonify({"success": False, "message": "Invalid request"}), 400
            try:
                raw = request.get_json(silent=False) if request.is_json else None
            except BadRequest:
                return jsonify({"success": False, "message": "Invalid request"}), 400
            if raw is None:
                raw = {}
            try:
                payload = model.model_validate(raw)
            except ValidationError as exc:
                return jsonify(
                    {"success": False, "message": _first_error_message(exc)}
                )
            kwargs["payload"] = payload
            return fn(*args, **kwargs)

        return wrapper

    return decorator
