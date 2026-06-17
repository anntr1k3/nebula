"""User role values from DB / auth responses."""

_VALID = frozenset({"user", "moderator", "admin"})


def normalize_user_role(role: str | None) -> str:
    if role in _VALID:
        return role
    return "user"
