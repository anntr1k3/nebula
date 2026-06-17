"""Auth token storage: in-memory or Redis (shared across workers)."""

from __future__ import annotations

import json
import logging
import time
from typing import Protocol

logger = logging.getLogger(__name__)

KEY_PREFIX = "nebula:auth:"


class AuthTokenStore(Protocol):
    def put(
        self, token: str, username: str, created_at: float, ttl_seconds: int
    ) -> None: ...

    def get(self, token: str) -> dict | None:
        """Return {"username", "created_at"} or None."""

    def delete(self, token: str) -> None: ...

    def clear_all(self) -> None: ...

    def cleanup_expired(self, lifetime_seconds: int) -> None: ...


class MemoryAuthTokenStore:
    def __init__(self) -> None:
        self._data: dict[str, dict] = {}

    def put(
        self, token: str, username: str, created_at: float, ttl_seconds: int
    ) -> None:
        _ = ttl_seconds
        self._data[token] = {"username": username, "created_at": created_at}

    def get(self, token: str) -> dict | None:
        if not token:
            return None
        return self._data.get(token)

    def delete(self, token: str) -> None:
        self._data.pop(token, None)

    def clear_all(self) -> None:
        self._data.clear()

    def cleanup_expired(self, lifetime_seconds: int) -> None:
        now = time.time()
        expired = [
            t
            for t, d in self._data.items()
            if now - d.get("created_at", 0) > lifetime_seconds
        ]
        for t in expired:
            self._data.pop(t, None)


class RedisAuthTokenStore:
    def __init__(self, url: str) -> None:
        import redis

        self._r = redis.from_url(url, decode_responses=True)
        self._prefix = KEY_PREFIX

    def put(
        self, token: str, username: str, created_at: float, ttl_seconds: int
    ) -> None:
        payload = json.dumps({"username": username, "created_at": created_at})
        ttl = max(1, int(ttl_seconds))
        self._r.setex(f"{self._prefix}{token}", ttl, payload)

    def get(self, token: str) -> dict | None:
        if not token:
            return None
        raw = self._r.get(f"{self._prefix}{token}")
        if not raw:
            return None
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                return None
            return {
                "username": data.get("username"),
                "created_at": float(data.get("created_at", 0)),
            }
        except (json.JSONDecodeError, TypeError, ValueError):
            return None

    def delete(self, token: str) -> None:
        self._r.delete(f"{self._prefix}{token}")

    def clear_all(self) -> None:
        pattern = f"{self._prefix}*"
        batch: list[str] = []
        for key in self._r.scan_iter(match=pattern, count=500):
            batch.append(key)
            if len(batch) >= 500:
                self._r.delete(*batch)
                batch.clear()
        if batch:
            self._r.delete(*batch)

    def cleanup_expired(self, lifetime_seconds: int) -> None:
        _ = lifetime_seconds


def build_auth_token_store(redis_url: str | None, app_logger) -> AuthTokenStore:
    if redis_url:
        try:
            store = RedisAuthTokenStore(redis_url)
            app_logger.info(
                "Токены авторизации: Redis (%s)",
                redis_url.split("@")[-1] if "@" in redis_url else redis_url,
            )
            return store
        except Exception as e:
            app_logger.warning("Redis для токенов недоступен, используется память: %s", e)
    return MemoryAuthTokenStore()
