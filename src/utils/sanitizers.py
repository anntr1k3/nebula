import re

from config import MAX_MESSAGE_LENGTH


def sanitize_text(text):
    """Strip risky markup and clamp text length."""
    if not text:
        return text
    text = re.sub(r"<[^>]+>", "", text)
    return text[:MAX_MESSAGE_LENGTH]
