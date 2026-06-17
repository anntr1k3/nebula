"""Разбор JSON из БД: уже dict/list или строка/bytes."""

from __future__ import annotations

import json
from typing import Any


def parse_json_field(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, dict | list):
        return val
    if isinstance(val, bytes | str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return None
    return None
