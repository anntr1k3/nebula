from config import ALLOWED_MIME_PATTERNS, USERNAME_PATTERN


def is_valid_username(username):
    """Return True if username matches the configured pattern."""
    if not username or not isinstance(username, str):
        return False
    return bool(USERNAME_PATTERN.match(username))


def is_valid_password(password):
    """Check password against basic security rules."""
    if not password or not isinstance(password, str):
        return False, "Password cannot be empty"

    if len(password) < 8:
        return False, "Password must be at least 8 characters"

    if len(password) > 128:
        return False, "Password is too long (max 128 characters)"

    if not any(c.isalpha() for c in password):
        return False, "Password must contain at least one letter"

    if not any(c.isdigit() for c in password):
        return False, "Password must contain at least one digit"

    return True, "OK"


def validate_mime_type(data_url, allowed_types):
    """
    Validate MIME type in a data URL.

    Returns:
        tuple[bool, str | None, str]: ok, mime type, message.
    """
    if not data_url or not data_url.startswith("data:"):
        return False, None, "Invalid data format"

    try:
        header = data_url.split(",")[0]
        mime_type = header.split(":")[1].split(";")[0]

        for allowed_type in allowed_types:
            if allowed_type in ALLOWED_MIME_PATTERNS:
                if mime_type in ALLOWED_MIME_PATTERNS[allowed_type]:
                    return True, mime_type, "OK"
            elif mime_type == allowed_type:
                return True, mime_type, "OK"

        return False, mime_type, f"File type not allowed: {mime_type}"
    except Exception:
        return False, None, "Could not validate file type"
