import base64
import binascii
import os
import uuid

from config import MAX_MEDIA_FILE_SIZE, MEDIA_EXT_MAP


def ensure_media_dir(media_dir):
    if not os.path.exists(media_dir):
        os.makedirs(media_dir)


def save_media_file(media_data, media_dir, logger):
    """Save media to disk and return `/media/...` path."""
    if not media_data or not media_data.startswith("data:"):
        return media_data

    try:
        header, data = media_data.split(",", 1)
        encoded_data = data.strip()
        estimated_size = (len(encoded_data) * 3) // 4
        if estimated_size > MAX_MEDIA_FILE_SIZE + 3:
            logger.error(
                "Rejected media save: estimated decoded size %s exceeds maximum %s",
                estimated_size,
                MAX_MEDIA_FILE_SIZE,
            )
            return None

        file_data = base64.b64decode(encoded_data, validate=True)
        if len(file_data) > MAX_MEDIA_FILE_SIZE:
            logger.error(
                "Rejected media save: decoded size %s exceeds maximum %s",
                len(file_data),
                MAX_MEDIA_FILE_SIZE,
            )
            return None
        mime = (
            header.split(":")[1].split(";")[0]
            if ":" in header
            else "application/octet-stream"
        )
        ext = MEDIA_EXT_MAP.get(mime, ".bin")

        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = os.path.join(media_dir, filename)

        with open(filepath, "wb") as file_stream:
            file_stream.write(file_data)

        logger.info("Media file saved: %s (%s bytes)", filename, len(file_data))
        return f"/media/{filename}"
    except (ValueError, IndexError, binascii.Error) as exc:
        logger.error("Invalid media data URL: %s", exc)
        return None
    except Exception as exc:
        logger.error("Failed to save media file: %s", exc, exc_info=True)
        return None
