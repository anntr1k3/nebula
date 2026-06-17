import os
import re
import uuid

from flask import Blueprint, abort, jsonify, request, send_from_directory

from config import (
    AVATAR_IMAGE_MIMES,
    MAX_AVATAR_FILE_SIZE,
    MEDIA_EXT_MAP,
    MEDIA_MIME_BY_EXT,
)
from utils.auth_helpers import require_auth_user
from utils.http_parse import query_int
from utils.roles import normalize_user_role
from utils.room_access_db import user_can_access_room


def _safe_static_path(static_folder, filename):
    root = os.path.normpath(os.path.abspath(static_folder))
    candidate = os.path.normpath(os.path.abspath(os.path.join(root, filename)))
    if candidate != root and not candidate.startswith(root + os.sep):
        return None
    return candidate


def _is_immutable_static_asset(path: str) -> bool:
    """Вернуть True для ассетов, которые безопасно кэшировать надолго.

    В проекте ассеты версионируются через query-параметр `?v=nebula-*` в `index.html`,
    поэтому можно включать long-cache по пути (CSS/JS/шрифты/иконки).
    """
    ext = os.path.splitext(path)[1].lower()
    return ext in (
        ".css",
        ".js",
        ".map",
        ".ico",
        ".png",
        ".jpg",
        ".jpeg",
        ".svg",
        ".webp",
        ".gif",
        ".woff",
        ".woff2",
        ".ttf",
        ".otf",
        ".json",
        ".webmanifest",
    )


def _has_cache_buster() -> bool:
    return bool(request.args.get("v"))


def _apply_cache_headers(resp, *, immutable: bool) -> None:
    if immutable:
        # 1 year
        resp.cache_control.public = True
        resp.cache_control.max_age = 31536000
        resp.cache_control.immutable = True
    else:
        # SPA shell should update immediately after deploy.
        resp.cache_control.no_cache = True
        resp.cache_control.must_revalidate = True


def create_system_bp(
    limiter,
    db,
    app,
    media_dir,
    max_media_file_size,
    auth_token_store,
    user_sessions,
    user_connections,
    message_timestamps,
):
    system_bp = Blueprint("system_api", __name__)

    def _serve_spa():
        idx = os.path.join(app.static_folder, "index.html")
        if os.path.isfile(idx):
            resp = send_from_directory(app.static_folder, "index.html", conditional=True)
            _apply_cache_headers(resp, immutable=False)
            return resp
        abort(503, "Frontend missing: static/index.html not found.")

    @system_bp.route("/")
    def index():
        return _serve_spa()

    @system_bp.route("/admin")
    def admin_panel():
        return _serve_spa()

    @system_bp.route("/login")
    def login_page():
        return _serve_spa()

    @system_bp.route("/api/upload_media", methods=["POST"])
    @limiter.limit("30 per minute")
    def upload_media():
        uploader, err = require_auth_user()
        if err:
            return err

        if "file" not in request.files:
            return jsonify({"success": False, "message": "No file selected"}), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({"success": False, "message": "No file selected"}), 400
        if file.content_length and file.content_length > max_media_file_size:
            return jsonify(
                {"success": False, "message": "File too large (max 20 MB)"}
            ), 400

        media_type = request.form.get("media_type", "file")
        if media_type not in {"image", "video", "audio", "voice", "file"}:
            media_type = "file"

        try:
            ext = os.path.splitext(file.filename)[1] or ".bin"
            mime = file.content_type or "application/octet-stream"
            ext = MEDIA_EXT_MAP.get(mime, ext)
            filename = f"{uuid.uuid4().hex}{ext}"
            filepath = os.path.join(media_dir, filename)
            file.save(filepath)
            if os.path.getsize(filepath) > max_media_file_size:
                os.remove(filepath)
                return jsonify(
                    {"success": False, "message": "File too large (max 20 MB)"}
                ), 400
            app.logger.info(
                f"Загрузка файла: {uploader} → {filename} ({media_type})"
            )
            return jsonify(
                {
                    "success": True,
                    "path": f"/media/{filename}",
                    "type": media_type,
                    "name": file.filename,
                }
            )
        except Exception as error:
            app.logger.error(f"Ошибка загрузки файла: {error}", exc_info=True)
            return jsonify({"success": False, "message": "Upload failed"}), 500

    @system_bp.route("/api/upload_avatar", methods=["POST"])
    @limiter.limit("20 per minute")
    def upload_avatar():
        uploader, err = require_auth_user()
        if err:
            return err

        if "file" not in request.files:
            return jsonify({"success": False, "message": "No file selected"}), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({"success": False, "message": "No file selected"}), 400

        mime = (file.content_type or "").split(";")[0].strip().lower()
        if mime not in AVATAR_IMAGE_MIMES:
            return jsonify(
                {
                    "success": False,
                    "message": "Allowed types: JPEG, PNG, WebP, GIF",
                }
            ), 400

        raw = file.stream.read(MAX_AVATAR_FILE_SIZE + 1)
        if len(raw) > MAX_AVATAR_FILE_SIZE:
            return jsonify(
                {"success": False, "message": "Image too large (max 2 MB)"}
            ), 400

        ext = AVATAR_IMAGE_MIMES[mime]
        safe_user = re.sub(r"[^a-zA-Z0-9_]", "_", uploader)[:32] or "user"
        filename = f"av_{safe_user}_{uuid.uuid4().hex[:12]}{ext}"
        filepath = os.path.join(media_dir, filename)
        try:
            with open(filepath, "wb") as out:
                out.write(raw)
            app.logger.info(f"Загрузка аватара: {uploader} → {filename}")
            return jsonify(
                {
                    "success": True,
                    "path": f"/media/{filename}",
                    "avatarType": "image",
                }
            )
        except OSError as error:
            app.logger.error(f"Ошибка загрузки аватара: {error}", exc_info=True)
            return jsonify({"success": False, "message": "Upload failed"}), 500

    @system_bp.route("/media/<filename>")
    def serve_media(filename):
        if not filename or ".." in filename or "/" in filename or "\\" in filename:
            abort(404)
        ext = os.path.splitext(filename)[1].lower()
        mimetype = MEDIA_MIME_BY_EXT.get(ext)
        resp = send_from_directory(
            media_dir,
            filename,
            conditional=True,
            mimetype=mimetype,
        )
        # Медиа может обновляться под тем же именем редко, но обычно уникально (uuid).
        # Дадим умеренный кэш, чтобы не мешать демонстрации и тестам.
        resp.cache_control.public = True
        resp.cache_control.max_age = 3600
        return resp

    @system_bp.route("/health")
    def health_check():
        try:
            with db.get_db_cursor() as (cursor, _):
                cursor.execute("SELECT 1")
            return jsonify({"status": "ok", "database": "connected"}), 200
        except Exception as error:
            app.logger.error(f"Проверка здоровья БД не прошла: {error}")
            return jsonify(
                {"status": "error", "database": "disconnected"}
            ), 503

    @system_bp.route("/api/messages", methods=["GET"])
    def get_messages():
        room = request.args.get("room")
        before_id = request.args.get("before")
        limit = query_int(request.args.get("limit"), 50, min_value=1, max_value=100)

        if not room:
            return jsonify({"messages": [], "has_more": False})

        viewer, err = require_auth_user()
        if err:
            return err

        if not user_can_access_room(viewer, room):
            return jsonify({"success": False, "message": "Access denied"}), 403

        messages = db.list_room_messages_for_viewer(room, viewer, limit, before_id)

        has_more = len(messages) >= limit
        return jsonify({"messages": messages, "has_more": has_more})

    @system_bp.route("/api/me", methods=["GET"])
    def me():
        username, err = require_auth_user()
        if err:
            return err
        role = normalize_user_role(db.get_user_role(username))
        return jsonify({"success": True, "username": username, "role": role})

    @system_bp.route("/api/clear_cache", methods=["POST"])
    def clear_cache():
        username, err = require_auth_user()
        if err:
            return err
        if db.get_user_role(username) != "admin":
            return jsonify({"success": False, "message": "Administrators only"}), 403

        auth_token_store.clear_all()
        user_sessions.clear()
        user_connections.clear()
        message_timestamps.clear()
        app.logger.warning("Кэш сессий и токенов полностью очищен.")
        return jsonify({"success": True, "message": "Cache cleared"})

    @system_bp.route("/<path:filename>")
    def serve_spa_assets(filename):
        if filename.startswith(("api/", "media/", "socket.io")):
            abort(404)
        safe = _safe_static_path(app.static_folder, filename)
        if safe and os.path.isfile(safe):
            resp = send_from_directory(app.static_folder, filename, conditional=True)
            _apply_cache_headers(
                resp,
                immutable=_is_immutable_static_asset(filename) and _has_cache_buster(),
            )
            return resp
        idx = os.path.join(app.static_folder, "index.html")
        if os.path.isfile(idx):
            resp = send_from_directory(app.static_folder, "index.html", conditional=True)
            _apply_cache_headers(resp, immutable=False)
            return resp
        abort(404)

    return system_bp
