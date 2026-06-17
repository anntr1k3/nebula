"""Room access using the process-wide db facade (avoids repeating lambdas in routes)."""

import db


def user_can_access_room(username: str | None, room_id: str | None) -> bool:
    if not username:
        return False
    return db.user_can_access_room(username, room_id)
