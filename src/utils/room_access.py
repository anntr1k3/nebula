"""Room access checks for HTTP, WebSocket, and batch DB queries."""


def _private_room_user_ids(room_id: str | None) -> list[str] | None:
    """Segments of a private_* room id after the prefix; None if not a private room."""
    if not room_id or not room_id.startswith("private_"):
        return None
    return room_id.replace("private_", "").split("_")


def _private_room_user_is_member(room_id: str, username: str) -> bool | None:
    """For private_* rooms return whether username is in the id; else None."""
    parts = _private_room_user_ids(room_id)
    if parts is None:
        return None
    return username in parts


def private_chat_access(room_id: str | None, username: str) -> bool | None:
    """None if not a private_* room; otherwise whether ``username`` is a participant."""
    if not room_id or not room_id.startswith("private_"):
        return None
    return bool(_private_room_user_is_member(room_id, username))


def can_access_room_with_member_set(
    member_room_ids: set[str], username: str, room_id: str | None
) -> bool:
    """Same as can_access_room, but group membership is a precomputed set of room_ids."""
    if not room_id:
        return False
    priv = _private_room_user_is_member(room_id, username)
    if priv is not None:
        return priv
    if room_id.startswith("room_"):
        return room_id in member_room_ids
    return False


def private_room_peer_username(room_id: str, username: str) -> str | None:
    """First other participant in private_* (for titles); None if not private or empty."""
    parts = _private_room_user_ids(room_id)
    if parts is None:
        return None
    for p in parts:
        if p != username:
            return p
    return None


def private_two_party_counterparty(room_id: str, username: str) -> str | None:
    """If private_* encodes exactly two distinct users, return the other. Else None."""
    parts = _private_room_user_ids(room_id)
    if parts is None or len(parts) != 2:
        return None
    a, b = parts
    if a == b:
        return None
    if username == a:
        return b
    if username == b:
        return a
    return None
