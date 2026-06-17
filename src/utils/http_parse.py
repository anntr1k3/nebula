"""Safe parsing helpers for HTTP request data."""

from flask import Request


def query_int(
    value, default: int, *, min_value: int | None = None, max_value: int | None = None
) -> int:
    """Parse int from string; on error use default, then clamp to min/max."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    if min_value is not None:
        n = max(n, min_value)
    if max_value is not None:
        n = min(n, max_value)
    return n


def json_body(request: Request) -> dict:
    """Return a JSON object body, or an empty dict for empty/invalid payloads."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}
