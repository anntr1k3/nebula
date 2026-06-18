import os
import re
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

import db
from utils.auth_helpers import require_auth_user
from utils.http_parse import json_body, query_int
from utils.room_access_db import user_can_access_room

DEFAULT_AVATAR = ""


def _is_safe_avatar_media_path(path: str) -> bool:
    """Uploaded avatars: /media/av_<sanitized_user>_<12hex>.<ext>"""
    if not path or not path.startswith("/media/") or len(path) > 500:
        return False
    name = path[7:]
    if ".." in name or "/" in name or "\\" in name:
        return False
    return bool(
        re.match(r"^av_(.+)_([a-f0-9]{12})\.(jpg|png|webp|gif)$", name)
    )


def _delete_avatar_file(media_dir: str, media_path: str) -> None:
    if not media_dir or not media_path.startswith("/media/"):
        return
    name = media_path.rsplit("/", 1)[-1]
    if not name.startswith("av_") or ".." in name or "/" in name or "\\" in name:
        return
    path = os.path.join(media_dir, name)
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


def create_api_tools_bp(media_dir: str | None = None):
    api_tools_bp = Blueprint("api_tools", __name__, url_prefix="/api")

    @api_tools_bp.route("/export_chat", methods=["GET"])
    def export_chat():
        """Export chat history as JSON."""
        viewer, err = require_auth_user()
        if err:
            return err
        room_id = request.args.get("room")
        username = request.args.get("username")
        limit = query_int(request.args.get("limit"), 1000, min_value=1, max_value=5000)
        if not room_id or not username:
            return jsonify(
                {"success": False, "message": "room and username are required"}
            ), 400
        if username != viewer:
            return jsonify({"success": False, "message": "Access denied"}), 403
        if not user_can_access_room(username, room_id):
            return jsonify({"success": False, "message": "Access denied"}), 403
        filtered = db.list_room_messages_for_viewer(room_id, username, limit)
        for m in filtered:
            if m.get("created_at"):
                m["created_at"] = m["created_at"].isoformat()
        return jsonify(
            {
                "success": True,
                "room": room_id,
                "exported_at": datetime.now().isoformat(),
                "messages": filtered,
            }
        )

    @api_tools_bp.route("/search_global", methods=["GET"])
    def search_global_messages():
        """Search across all chats the user can access."""
        viewer, err = require_auth_user()
        if err:
            return err
        username = request.args.get("username", "").strip()
        query_text = request.args.get("q", "").strip()
        limit = query_int(request.args.get("limit"), 50, min_value=1, max_value=200)
        room_filter = (request.args.get("room") or "").strip() or None
        author = (request.args.get("author") or "").strip() or None
        media_kind = (request.args.get("media_kind") or "").strip() or None
        date_from = (request.args.get("date_from") or "").strip() or None
        date_to = (request.args.get("date_to") or "").strip() or None

        has_filters = bool(
            room_filter or author or media_kind or date_from or date_to
        )
        if not username:
            return jsonify(
                {
                    "success": False,
                    "message": "username is required",
                    "results": [],
                }
            ), 400
        if username != viewer:
            return jsonify(
                {"success": False, "message": "Access denied", "results": []}
            ), 403
        if not query_text and not has_filters:
            return jsonify(
                {
                    "success": False,
                    "message": "Enter a query or choose filters",
                    "results": [],
                }
            ), 400
        if query_text and len(query_text) < 2 and not has_filters:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Query must be at least 2 characters",
                        "results": [],
                    }
                ),
                400,
            )

        if room_filter or author or media_kind or date_from or date_to:
            df = None
            dt = None
            if date_from:
                try:
                    df = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    df = None
            if date_to:
                try:
                    dt = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    dt = None
            results = db.search_messages_advanced(
                username,
                query_text,
                room_id=room_filter,
                date_from=df,
                date_to=dt,
                author=author,
                media_kind=media_kind,
                limit=limit,
            )
        else:
            results = db.search_messages_global(username, query_text, limit)
        blocked_users = set(db.get_blocked_users(username))
        results = [r for r in results if r.get("username") not in blocked_users]
        return jsonify({"success": True, "results": results})

    @api_tools_bp.route("/search_room", methods=["GET"])
    def search_room_messages():
        """Search within one chat (local)."""
        viewer, err = require_auth_user()
        if err:
            return err
        username = request.args.get("username", "").strip()
        room_id = (request.args.get("room") or "").strip()
        query_text = request.args.get("q", "").strip()
        limit = query_int(request.args.get("limit"), 50, min_value=1, max_value=200)

        if not username or not room_id:
            return jsonify(
                {"success": False, "message": "username and room required", "results": []}
            ), 400
        if username != viewer:
            return jsonify(
                {"success": False, "message": "Access denied", "results": []}
            ), 403
        if not user_can_access_room(username, room_id):
            return jsonify(
                {"success": False, "message": "Access denied", "results": []}
            ), 403
        if len(query_text) < 1:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Query required",
                        "results": [],
                    }
                ),
                400,
            )

        results = db.search_messages_advanced(
            username,
            query_text,
            room_id=room_id,
            limit=limit,
        )
        blocked_users = set(db.get_blocked_users(username))
        results = [r for r in results if r.get("username") not in blocked_users]
        return jsonify({"success": True, "results": results})

    @api_tools_bp.route("/profile/<username>", methods=["GET"])
    def get_profile(username):
        profile = db.get_user_profile(username)
        if not profile:
            return jsonify(
                {"avatar": DEFAULT_AVATAR, "avatarType": "emoji", "bio": "", "nickname": username}
            )
        return jsonify(
            {
                "avatar": profile.get("avatar") or DEFAULT_AVATAR,
                "avatarType": profile.get("avatar_type") or "emoji",
                "bio": profile.get("bio") or "",
                "nickname": profile.get("nickname") or username,
            }
        )

    @api_tools_bp.route("/profile", methods=["POST"])
    def update_profile():
        viewer, err = require_auth_user()
        if err:
            return err
        data = json_body(request)
        username = data.get("username")
        if not username or username != viewer:
            return jsonify({"success": False, "message": "Access denied"}), 403
        if not db.get_user(username):
            return jsonify({"success": False, "message": "User not found"})

        raw_type = (data.get("avatarType") or "emoji").strip().lower()
        avatar_type = raw_type if raw_type in ("emoji", "image") else "emoji"
        avatar_val = data.get("avatar")
        avatar = (avatar_val or "").strip() if avatar_val is not None else ""

        if avatar_type == "image":
            if not _is_safe_avatar_media_path(avatar):
                return jsonify(
                    {"success": False, "message": "Invalid avatar image path"}
                ), 400
        else:
            if len(avatar) > 32:
                avatar = avatar[:32]

        old = db.get_user_profile(username)
        old_avatar = (old or {}).get("avatar") or ""
        old_type = ((old or {}).get("avatar_type") or "emoji").strip().lower()

        if db.upsert_user_profile(
            username,
            bio=data.get("bio"),
            avatar=avatar,
            avatar_type=avatar_type,
            nickname=data.get("nickname"),
        ):
            if media_dir and old_type == "image" and old_avatar.startswith("/media/"):
                if old_avatar != avatar or avatar_type != "image":
                    _delete_avatar_file(media_dir, old_avatar)
            try:
                socketio = current_app.extensions.get("socketio")
                if socketio:
                    prof = db.get_user_profile(username) or {}
                    at = (prof.get("avatar_type") or "emoji").strip().lower()
                    if at not in ("emoji", "image"):
                        at = "emoji"
                    av_out = (prof.get("avatar") or "").strip() or DEFAULT_AVATAR
                    socketio.emit(
                        "user_profile_updated",
                        {
                            "username": username,
                            "avatar": av_out,
                            "avatarType": at,
                            "nickname": (prof.get("nickname") or "").strip() or username,
                        },
                        namespace="/",
                    )
            except Exception:
                current_app.logger.warning(
                    "Profile was saved, but profile update event was not emitted.",
                    exc_info=True,
                )
            return jsonify({"success": True})
        return jsonify({"success": False, "message": "Save failed"})

    return api_tools_bp

