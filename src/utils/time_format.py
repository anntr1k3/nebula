"""Serialize datetimes for JSON / Socket.IO so JS Date.parse uses UTC."""

from __future__ import annotations

from datetime import UTC, datetime


def isoformat_utc_z(dt: datetime | None) -> str | None:
    """ISO-8601 instant with Z suffix (UTC). Naive datetimes are treated as UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt.isoformat().replace("+00:00", "Z")
