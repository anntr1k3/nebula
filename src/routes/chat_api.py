import uuid
from datetime import datetime

from flask import Blueprint, jsonify, request

import db
from schemas.chat import (
    BlockBody,
    CreateRoomBody,
    ScheduleMessageBody,
    UnblockBody,
    UpdateScheduledMessageBody,
)
from utils.auth_helpers import require_auth_user
from utils.http_parse import json_body
from utils.json_helpers import parse_json_field
from utils.pydantic_validation import validate_body
from utils.room_access_db import user_can_access_room
from utils.room_delivery import clear_room_audience_cache

chat_api_bp = Blueprint("chat_api", __name__, url_prefix="/api")
_user_connections_ref = {}
DEFAULT_USERS_LIMIT = 80
MAX_USERS_LIMIT = 500
DEFAULT_AVATAR = ""


def bind_user_connections(user_connections):
    """Wire live presence map from the app factory."""
    global _user_connections_ref
    _user_connections_ref = user_connections


@chat_api_bp.route("/inbox", methods=["GET"])
def get_inbox():
    viewer, err = require_auth_user()
    if err:
        return err
    username = request.args.get("username")
    if not username or username != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403
    items = db.get_inbox_summary(username)
    return jsonify({"success": True, "items": items})


@chat_api_bp.route("/users", methods=["GET"])
def get_users():
    viewer, err = require_auth_user()
    if err:
        return err
    current_user = request.args.get("current_user")
    if current_user is not None and current_user != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403

    q = (request.args.get("q") or "").strip()
    limit_raw = request.args.get("limit", type=int)
    limit = limit_raw if limit_raw is not None else DEFAULT_USERS_LIMIT
    limit = max(1, min(limit, MAX_USERS_LIMIT))

    user_rows = db.list_users_with_nicknames(
        exclude_username=viewer,
        query=q or None,
        limit=limit,
    )

    users_with_status = []
    for row in user_rows:
        un = row["username"]
        is_online = bool(_user_connections_ref.get(un))
        users_with_status.append(
            {
                "username": un,
                "online": is_online,
                "nickname": row.get("nickname"),
                "avatar": row.get("avatar") or DEFAULT_AVATAR,
                "avatarType": row.get("avatarType") or "emoji",
            }
        )

    return jsonify({"users": users_with_status})


@chat_api_bp.route("/last_seen/<username>", methods=["GET"])
def get_last_seen(username):
    _, err = require_auth_user()
    if err:
        return err
    last_seen = db.get_last_seen(username)
    return jsonify({"username": username, "last_seen": last_seen})


@chat_api_bp.route("/rooms", methods=["GET"])
def get_rooms():
    viewer, err = require_auth_user()
    if err:
        return err
    username = request.args.get("username")
    if username != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403
    rooms = db.get_user_rooms(username)

    user_rooms = []
    for room in rooms:
        user_rooms.append(
            {"id": room["room_id"], "name": room["name"], "members": room["members"]}
        )

    return jsonify({"rooms": user_rooms})


@chat_api_bp.route("/block", methods=["POST"])
@validate_body(BlockBody)
def block_user(payload: BlockBody):
    viewer, err = require_auth_user()
    if err:
        return err

    if payload.username != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403

    if not db.get_user(payload.username):
        return jsonify({"success": False, "message": "User not found"})

    if db.block_user(payload.username, payload.block_username):
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Block failed"})


@chat_api_bp.route("/unblock", methods=["POST"])
@validate_body(UnblockBody)
def unblock_user(payload: UnblockBody):
    viewer, err = require_auth_user()
    if err:
        return err

    if payload.username != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403

    if db.unblock_user(payload.username, payload.unblock_username):
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Unblock failed"})


@chat_api_bp.route("/blocked", methods=["GET"])
def get_blocked_users():
    viewer, err = require_auth_user()
    if err:
        return err
    username = request.args.get("username")
    if not username or username != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403

    blocked = db.get_blocked_users(username)
    return jsonify({"blocked": blocked})


@chat_api_bp.route("/rooms", methods=["POST"])
@validate_body(CreateRoomBody)
def create_room(payload: CreateRoomBody):
    viewer, err = require_auth_user()
    if err:
        return err

    if payload.creator != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403

    room_id = f"room_{uuid.uuid4().hex[:8]}_{int(datetime.now().timestamp())}"
    all_members = list(dict.fromkeys([*payload.members, payload.creator]))

    if db.create_room(room_id, payload.name, all_members):
        clear_room_audience_cache(room_id)
        return jsonify({"success": True, "room_id": room_id})
    return jsonify({"success": False, "message": "Could not create group"})


@chat_api_bp.route("/pinned/<room_id>", methods=["GET"])
def get_pinned(room_id):
    viewer, err = require_auth_user()
    if err:
        return err
    if not user_can_access_room(viewer, room_id):
        return jsonify({"success": False, "message": "Access denied"}), 403
    pinned = db.get_pinned_messages(room_id)
    return jsonify({"pinned": pinned})


@chat_api_bp.route("/pin", methods=["POST"])
def pin_message_route():
    viewer, err = require_auth_user()
    if err:
        return err
    data = json_body(request)
    room_id = data.get("room_id")
    message_id = data.get("message_id")
    username = data.get("username")

    if not all([room_id, message_id, username]):
        return jsonify({"success": False, "message": "Missing required fields"})

    if username != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403

    if not user_can_access_room(viewer, room_id):
        return jsonify({"success": False, "message": "Access denied"}), 403

    if db.pin_message(room_id, message_id, username):
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Pin failed"})


@chat_api_bp.route("/unpin", methods=["POST"])
def unpin_message_route():
    viewer, err = require_auth_user()
    if err:
        return err
    data = json_body(request)
    room_id = data.get("room_id")
    message_id = data.get("message_id")

    if not all([room_id, message_id]):
        return jsonify({"success": False, "message": "Missing required fields"})

    if not user_can_access_room(viewer, room_id):
        return jsonify({"success": False, "message": "Access denied"}), 403

    if db.unpin_message(room_id, message_id):
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Unpin failed"})


@chat_api_bp.route("/draft", methods=["GET"])
def get_draft_single():
    viewer, err = require_auth_user()
    if err:
        return err
    username = request.args.get("username")
    room_id = request.args.get("room_id")
    if not username or username != viewer or not room_id:
        return jsonify({"success": False, "message": "Invalid request"}), 400
    if not db.user_can_access_room(viewer, room_id):
        return jsonify({"success": False, "message": "Access denied"}), 403
    text = db.get_message_draft(viewer, room_id)
    return jsonify({"success": True, "text": text})


@chat_api_bp.route("/draft", methods=["POST"])
def save_draft():
    viewer, err = require_auth_user()
    if err:
        return err
    data = json_body(request)
    username = data.get("username")
    room_id = data.get("room_id")
    text = data.get("text", "")
    if not username or username != viewer or not room_id:
        return jsonify({"success": False, "message": "Invalid request"}), 400
    if not db.user_can_access_room(viewer, room_id):
        return jsonify({"success": False, "message": "Access denied"}), 403
    if (text or "").strip():
        if db.upsert_message_draft(viewer, room_id, text):
            return jsonify({"success": True})
    else:
        if db.delete_message_draft(viewer, room_id):
            return jsonify({"success": True})
    return jsonify({"success": False, "message": "Save failed"})


@chat_api_bp.route("/drafts", methods=["GET"])
def list_drafts():
    viewer, err = require_auth_user()
    if err:
        return err
    username = request.args.get("username")
    if not username or username != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403
    rows = db.list_drafts_for_user(viewer)
    return jsonify({"success": True, "drafts": rows})


@chat_api_bp.route("/chat_mute", methods=["POST"])
def set_chat_mute_route():
    viewer, err = require_auth_user()
    if err:
        return err
    data = json_body(request)
    username = data.get("username")
    room_id = data.get("room_id")
    muted = bool(data.get("muted", True))
    if not username or username != viewer or not room_id:
        return jsonify({"success": False, "message": "Invalid request"}), 400
    if not db.user_can_access_room(viewer, room_id):
        return jsonify({"success": False, "message": "Access denied"}), 403
    if db.set_chat_mute(viewer, room_id, muted):
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Failed"})


@chat_api_bp.route("/chat_mute", methods=["GET"])
def get_chat_mute_list():
    viewer, err = require_auth_user()
    if err:
        return err
    username = request.args.get("username")
    if not username or username != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403
    rooms = db.list_muted_rooms(viewer)
    return jsonify({"success": True, "muted_rooms": rooms})


@chat_api_bp.route("/messages/schedule", methods=["POST"])
@validate_body(ScheduleMessageBody)
def schedule_message_route(payload: ScheduleMessageBody):
    viewer, err = require_auth_user()
    if err:
        return err

    if payload.username and payload.username != viewer:
        return jsonify({"success": False, "message": "Access denied"}), 403
    if not db.can_user_post_in_room(viewer, payload.room_id):
        return jsonify({"success": False, "message": "Cannot post here"}), 403

    row = {
        "room_id": payload.room_id,
        "username": viewer,
        "text": payload.text,
        "media_type": payload.media_type,
        "media_path": payload.media_path,
        "media_name": payload.media_name,
        "media_meta": payload.media_meta,
        "reply_to_json": payload.reply_to,
        "scheduled_at": payload.scheduled_at,
    }
    sid = db.insert_scheduled_message(row)
    if sid:
        return jsonify({"success": True, "scheduled_id": sid})
    return jsonify({"success": False, "message": "Could not schedule"})


def _serialize_scheduled_message(row: dict) -> dict:
    """Р¤РѕСЂРјР°С‚ РґР»СЏ Р»РµРЅС‚С‹ С‡Р°С‚Р° (С‚РѕР»СЊРєРѕ Сѓ Р°РІС‚РѕСЂР°, РїРѕРєР° РЅРµ РѕС‚РїСЂР°РІР»РµРЅРѕ)."""
    sched_id = row["id"]
    media_type = row.get("media_type")
    media = None
    if media_type and row.get("media_path"):
        media = {
            "type": media_type,
            "data": row["media_path"],
            "name": row.get("media_name"),
        }
        meta = parse_json_field(row.get("media_meta"))
        if isinstance(meta, dict):
            media["meta"] = meta
    reply = parse_json_field(row.get("reply_to_json"))
    return {
        "scheduled_id": sched_id,
        "message_id": f"scheduled_{sched_id}",
        "username": row["username"],
        "text": row.get("text") or "",
        "scheduled_at": row.get("scheduled_at"),
        "created_at": row.get("created_at"),
        "is_scheduled": True,
        "media": media,
        "replyTo": reply if isinstance(reply, dict) else None,
        "timestamp": row.get("scheduled_at") or row.get("created_at"),
    }


@chat_api_bp.route("/messages/scheduled", methods=["GET"])
def list_scheduled_messages_route():
    viewer, err = require_auth_user()
    if err:
        return err
    room_id = (request.args.get("room_id") or "").strip()
    if not room_id:
        return jsonify({"success": False, "message": "Invalid request"}), 400
    if not db.user_can_access_room(viewer, room_id):
        return jsonify({"success": False, "message": "Access denied"}), 403
    rows = db.list_pending_scheduled_for_room(viewer, room_id)
    return jsonify(
        {
            "success": True,
            "messages": [_serialize_scheduled_message(r) for r in rows],
        }
    )


@chat_api_bp.route("/messages/scheduled/<int:sched_id>", methods=["PATCH"])
@validate_body(UpdateScheduledMessageBody)
def update_scheduled_message_route(sched_id: int, payload: UpdateScheduledMessageBody):
    viewer, err = require_auth_user()
    if err:
        return err
    row = db.get_pending_scheduled(sched_id, viewer)
    if not row:
        return jsonify({"success": False, "message": "Not found"}), 404
    if not db.user_can_access_room(viewer, row["room_id"]):
        return jsonify({"success": False, "message": "Access denied"}), 403
    updates: dict[str, str | datetime] = {}
    if payload.text is not None:
        updates["text"] = payload.text
    if payload.scheduled_at is not None:
        updates["scheduled_at"] = payload.scheduled_at
    if not db.update_pending_scheduled(sched_id, viewer, updates):
        return jsonify({"success": False, "message": "Could not update"}), 500
    fresh = db.get_pending_scheduled(sched_id, viewer)
    return jsonify(
        {
            "success": True,
            "message": _serialize_scheduled_message(fresh) if fresh else None,
        }
    )


@chat_api_bp.route("/messages/scheduled/<int:sched_id>", methods=["DELETE"])
def delete_scheduled_message_route(sched_id: int):
    viewer, err = require_auth_user()
    if err:
        return err
    row = db.get_pending_scheduled(sched_id, viewer)
    if not row:
        return jsonify({"success": False, "message": "Not found"}), 404
    if not db.user_can_access_room(viewer, row["room_id"]):
        return jsonify({"success": False, "message": "Access denied"}), 403
    if not db.delete_pending_scheduled(sched_id, viewer):
        return jsonify({"success": False, "message": "Could not delete"}), 500
    return jsonify({"success": True})

