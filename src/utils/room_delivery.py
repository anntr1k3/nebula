"""Подключение онлайн-сокетов участников комнаты для доставки серверных событий.

Без этого ``socketio.emit(event, room=room_id)`` не дойдёт до тех пользователей,
чей ``sid`` ещё не был подключён к соответствующей Socket.IO-комнате (например,
после `connect`, но до первого `join` по конкретной комнате, либо в случае
отложенной отправки, когда автор сообщения не держит чат открытым).
"""

from __future__ import annotations

import time
from collections.abc import Iterable
from typing import Any

import db

ROOM_AUDIENCE_CACHE_TTL_SEC = 10
_room_audience_cache: dict[str, tuple[float, list[str]]] = {}


def _iter_private_party_usernames(room_id: str) -> Iterable[str]:
    prefix = "private_"
    if not room_id or not room_id.startswith(prefix):
        return ()
    return dict.fromkeys(room_id[len(prefix):].split("_")).keys()


def _iter_group_room_usernames(room_id: str) -> Iterable[str]:
    """Для группы — участники (room_members)."""
    if not room_id or not room_id.startswith("room_"):
        return ()
    now = time.monotonic()
    cached = _room_audience_cache.get(room_id)
    if cached and now - cached[0] < ROOM_AUDIENCE_CACHE_TTL_SEC:
        return list(cached[1])
    usernames = db.list_room_audience_usernames(room_id) or []
    _room_audience_cache[room_id] = (now, list(usernames))
    return usernames


def clear_room_audience_cache(room_id: str | None = None) -> None:
    """Drop cached room audience after membership changes."""
    if room_id:
        _room_audience_cache.pop(room_id, None)
        return
    _room_audience_cache.clear()


def room_audience_usernames(room_id: str) -> list[str]:
    """Логины всех предполагаемых получателей сообщений в комнате."""
    if not room_id:
        return []
    if room_id.startswith("private_"):
        return list(_iter_private_party_usernames(room_id))
    if room_id.startswith("room_"):
        return list(_iter_group_room_usernames(room_id))
    return []


def ensure_online_members_in_room(socketio: Any, app: Any, room_id: str) -> None:
    """Все онлайн-сокеты получателей комнаты подключаются к Socket.IO-комнате.

    Безопасно вызывать повторно: ``enter_room`` идемпотентен для уже подписанных sid.
    """
    if not room_id:
        return
    user_connections = app.extensions.get("nebula_user_connections") or {}
    if not any(user_connections.values()):
        return
    usernames = room_audience_usernames(room_id)
    if not usernames:
        return
    for uname in usernames:
        for sid in list(user_connections.get(uname, ())):
            try:
                socketio.server.enter_room(sid, room_id, namespace="/")
            except Exception:
                pass
