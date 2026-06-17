from flask import Blueprint, current_app, jsonify, request

import db
from utils.auth_helpers import require_auth_user
from utils.http_parse import json_body, query_int

moderation_api_bp = Blueprint("moderation_api", __name__, url_prefix="/api/moderation")


def check_moderator_permission(username):
    """True if user is moderator or admin."""
    role = db.get_user_role(username)
    return role in ["moderator", "admin"]


@moderation_api_bp.route("/logs", methods=["GET"])
def get_moderation_logs_route():
    moderator, err = require_auth_user()
    if err:
        return err

    if not check_moderator_permission(moderator):
        return jsonify({"success": False, "message": "Access denied"}), 403

    limit = query_int(request.args.get("limit"), 100, min_value=1, max_value=500)
    action_type = request.args.get("action_type")

    logs = db.get_moderation_logs(limit, None, action_type)
    return jsonify({"success": True, "logs": logs})


@moderation_api_bp.route("/report", methods=["POST"])
def create_report_route():
    reporter, err = require_auth_user()
    if err:
        return err

    data = json_body(request)
    message_id = data.get("message_id")
    reported_by = data.get("reported_by")
    reported_user = data.get("reported_user")
    reason = data.get("reason", "Rules violation")
    report_type = (data.get("report_type") or "other").strip()[:32]

    if not all([message_id, reported_by, reported_user]):
        return jsonify({"success": False, "message": "Missing required fields"}), 400

    if reported_by != reporter:
        return jsonify({"success": False, "message": "Access denied"}), 403

    message = db.get_message_by_id(message_id)
    if not message:
        return jsonify({"success": False, "message": "Message not found"}), 404

    room_id = message.get("room_id")
    if not db.user_can_access_room(reporter, room_id):
        return jsonify({"success": False, "message": "Access denied"}), 403

    actual_reported_user = message.get("username")
    if reported_user != actual_reported_user:
        return jsonify({"success": False, "message": "Invalid message"}), 400

    if db.create_report(
        message_id,
        reported_by,
        actual_reported_user,
        reason,
        report_type=report_type,
        room_id=room_id,
    ):
        current_app.logger.info(
            "Report from %s for message %s", reported_by, message_id
        )
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Could not create report"})


@moderation_api_bp.route("/reports_dashboard", methods=["GET"])
def reports_dashboard():
    moderator, err = require_auth_user()
    if err:
        return err
    if not check_moderator_permission(moderator):
        return jsonify({"success": False, "message": "Access denied"}), 403

    sort_by = request.args.get("sort", "date")
    sort_dir = request.args.get("dir", "desc")
    status = request.args.get("status")
    reports = db.list_reports_filtered(
        status=status,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    room_ids = set()
    for report in reports:
        room_id = report.get("resolved_room_id") or report.get("room_id")
        if room_id:
            room_ids.add(room_id)
    room_rows = db.list_room_rows(room_ids)
    titles = {
        room_id: (room_rows.get(room_id) or {}).get("name") or room_id
        for room_id in room_ids
    }
    grouped = db.group_reports_by_room(reports, titles)
    return jsonify({"success": True, "reports": reports, "grouped": grouped})


@moderation_api_bp.route("/message_context/<message_id>", methods=["GET"])
def message_context(message_id):
    moderator, err = require_auth_user()
    if err:
        return err
    if not check_moderator_permission(moderator):
        return jsonify({"success": False, "message": "Access denied"}), 403
    msg = db.get_message_by_id(message_id)
    if not msg:
        return jsonify({"success": False, "message": "Message not found"}), 404
    room_id = msg.get("room_id")
    title = db.get_room_title(room_id) if room_id else ""
    return jsonify(
        {
            "success": True,
            "message": {
                "message_id": msg.get("message_id"),
                "room_id": room_id,
                "room_title": title,
                "username": msg.get("username"),
                "text": msg.get("text"),
                "created_at": msg["created_at"].isoformat()
                if msg.get("created_at")
                else None,
            },
        }
    )


@moderation_api_bp.route("/report_action", methods=["POST"])
def report_action_route():
    moderator, err = require_auth_user()
    if err:
        return err
    if not check_moderator_permission(moderator):
        return jsonify({"success": False, "message": "Access denied"}), 403

    data = json_body(request)
    report_id = data.get("report_id")
    action = (data.get("action") or "").strip().lower()
    note = data.get("resolution_note") or ""
    reason = data.get("reason") or "Moderation action"

    if not report_id or not action:
        return jsonify({"success": False, "message": "Missing fields"}), 400

    report = db.get_report_by_id(report_id)
    if not report:
        return jsonify({"success": False, "message": "Report not found"}), 404

    target_user = report.get("reported_user")
    message_id = report.get("message_id")

    target_role = db.get_user_role(target_user)
    if target_role == "admin" and action in ("ban_1d", "ban_perm", "warn"):
        return jsonify({"success": False, "message": "Cannot act on administrator"}), 400
    mod_role = db.get_user_role(moderator)
    if (
        mod_role == "moderator"
        and target_role == "moderator"
        and action in ("ban_1d", "ban_perm", "warn")
    ):
        return jsonify({"success": False, "message": "Cannot act on another moderator"}), 400

    if action == "dismiss":
        if db.resolve_report(report_id, moderator, "dismissed", resolution_note=note):
            db.log_moderation_action(
                moderator,
                "dismiss_report",
                target_user,
                message_id,
                note or "Dismissed",
                {"report_id": report_id},
            )
            return jsonify({"success": True})
        return jsonify({"success": False, "message": "Could not dismiss"})

    if action == "warn":
        if db.add_warning(target_user, moderator, reason, message_id):
            db.resolve_report(
                report_id, moderator, "resolved", resolution_note=note or "Warned"
            )
            db.log_moderation_action(
                moderator,
                "resolve_report",
                target_user,
                message_id,
                note or "Warning issued",
                {"report_id": report_id, "action": "warn"},
            )
            return jsonify({"success": True})
        return jsonify({"success": False, "message": "Could not warn"})

    if action == "ban_1d":
        if db.ban_user(target_user, moderator, reason, duration_hours=24):
            db.resolve_report(
                report_id, moderator, "resolved", resolution_note=note or "Banned 1 day"
            )
            db.log_moderation_action(
                moderator,
                "resolve_report",
                target_user,
                message_id,
                note or "Ban 24h",
                {"report_id": report_id, "action": "ban_1d"},
            )
            return jsonify({"success": True})
        return jsonify({"success": False, "message": "Ban failed"})

    if action == "ban_perm":
        if db.ban_user(target_user, moderator, reason, duration_hours=None):
            db.resolve_report(
                report_id, moderator, "resolved", resolution_note=note or "Banned"
            )
            db.log_moderation_action(
                moderator,
                "resolve_report",
                target_user,
                message_id,
                note or "Permanent ban",
                {"report_id": report_id, "action": "ban_perm"},
            )
            return jsonify({"success": True})
        return jsonify({"success": False, "message": "Ban failed"})

    return jsonify({"success": False, "message": "Unknown action"}), 400
