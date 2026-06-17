"""Client-facing message payload builders."""

from collections.abc import Callable
from typing import Any

from utils.json_helpers import parse_json_field
from utils.time_format import isoformat_utc_z


def serialize_saved_message(
    saved_msg: dict[str, Any],
    *,
    read_by_username: str,
    client_id: str | None = None,
    reply_to: dict[str, Any] | None = None,
    forwarded: dict[str, Any] | None = None,
    get_message_by_id: Callable[[str], dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    """Convert a DB message row to the Socket.IO payload expected by clients."""
    payload: dict[str, Any] = {
        "id": saved_msg["message_id"],
        "room": saved_msg["room_id"],
        "username": saved_msg["username"],
        "text": saved_msg.get("text") or "",
        "timestamp": isoformat_utc_z(saved_msg.get("created_at")),
        "reactions": {},
        "read_by": [read_by_username],
    }

    if saved_msg.get("expires_at"):
        payload["expires_at"] = isoformat_utc_z(saved_msg["expires_at"])
    if client_id:
        payload["client_id"] = client_id

    if saved_msg.get("media_type"):
        payload["media"] = {
            "type": saved_msg["media_type"],
            "data": saved_msg["media_data"],
            "name": saved_msg["media_name"],
        }
        media_meta = parse_json_field(saved_msg.get("media_meta"))
        if isinstance(media_meta, dict):
            payload["media"]["meta"] = media_meta

    if reply_to is None and saved_msg.get("reply_to_id") and get_message_by_id:
        reply_msg = get_message_by_id(saved_msg["reply_to_id"])
        if reply_msg:
            reply_to = {
                "id": reply_msg["message_id"],
                "username": reply_msg["username"],
                "text": reply_msg.get("text") or "",
            }
    if reply_to:
        payload["replyTo"] = reply_to

    if forwarded is None and saved_msg.get("forwarded_from"):
        forwarded = {
            "from": saved_msg["forwarded_from"],
            "originalId": saved_msg["forwarded_message_id"],
        }
    if forwarded:
        payload["forwarded"] = forwarded

    return payload
