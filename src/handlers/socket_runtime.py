from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, NotRequired, Protocol, TypedDict, cast

from flask import Flask, request
from flask_socketio import SocketIO, emit

from utils.auth_token_store import AuthTokenStore


def socket_sid() -> str:
    """Flask-SocketIO sets ``request.sid``; Werkzeug's Request stubs omit it."""
    return cast(str, getattr(request, "sid", ""))


def payload_str(data: dict[str, Any], key: str) -> str | None:
    value = data.get(key)
    return value if isinstance(value, str) and value else None


def assert_socket_identity(user_sessions: dict[str, str], username: str) -> bool:
    sid = socket_sid()
    if sid not in user_sessions:
        emit(
            "error",
            {"message": "Authentication required. Call user_online after login."},
        )
        return False
    if user_sessions[sid] != username:
        emit("error", {"message": "Authentication error"})
        return False
    return True


class MediaPayload(TypedDict):
    type: str
    data: str
    name: NotRequired[str]


class SendMessagePayload(TypedDict):
    room: str
    username: str
    client_id: NotRequired[str]
    message: NotRequired[str]
    media: NotRequired[MediaPayload]
    media_meta: NotRequired[dict[str, Any]]
    replyTo: NotRequired[dict[str, Any]]
    forwarded: NotRequired[dict[str, Any]]
    ttl_seconds: NotRequired[int]


class DbFacade(Protocol):
    def get_user(self, username: str) -> dict[str, Any] | None: ...
    def update_last_seen(self, username: str) -> bool: ...
    def get_last_seen(self, username: str) -> str | None: ...
    def get_user_rooms(self, username: str) -> list[dict[str, Any]]: ...
    def list_private_room_ids_for_user(self, username: str) -> list[str]: ...
    def get_messages(
        self,
        room_id: str,
        limit: int = 50,
        before_id=None,
        excluded_usernames=None,
    ) -> list[dict[str, Any]]: ...
    def get_blocked_users(self, username: str) -> list[str]: ...
    def user_can_access_room(self, username: str, room_id: str) -> bool: ...
    def is_user_banned(self, username: str) -> bool: ...
    def can_user_post_in_room(self, username: str, room_id: str) -> bool: ...
    def create_message(self, message_data: dict[str, Any]) -> bool: ...
    def get_message_by_id(self, message_id: str) -> dict[str, Any] | None: ...
    def toggle_reaction(self, message_id: str, username: str, emoji: str) -> bool: ...
    def get_message_reactions(self, message_id: str) -> dict[str, list[str]]: ...
    def add_message_read(self, message_id: str, username: str) -> bool: ...
    def get_message_reads(self, message_id: str) -> list[str]: ...
    def update_message(self, message_id: str, new_text: str) -> bool: ...
    def delete_message(self, message_id: str) -> bool: ...
    def pin_message(self, room_id: str, message_id: str, username: str) -> bool: ...
    def unpin_message(self, room_id: str, message_id: str) -> bool: ...


@dataclass(frozen=True, slots=True)
class SocketRuntime:
    """Dependencies for Socket.IO handlers (single bundle for factory wiring)."""

    socketio: SocketIO
    app: Flask
    db: DbFacade
    auth_token_store: AuthTokenStore
    user_sessions: dict[str, str]
    user_connections: dict[str, set[str]]
    check_rate_limit: Callable[[str], bool]
    sanitize_text: Callable[[str], str]
    validate_mime_type: Callable[[str, Sequence[str | None]], tuple[bool, str | None, str]]
    save_media_file: Callable[[str, str | None], str | None]
    auth_token_lifetime: int
    max_message_length: int
    max_media_file_size: int
