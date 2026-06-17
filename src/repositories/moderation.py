import json
from datetime import datetime


def get_user_role(get_db_cursor, logger, Error, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute("SELECT role FROM users WHERE username = %s", (username,))
            result = cursor.fetchone()
            return result["role"] if result else "user"
    except Error as error:
        logger.error("Failed to get user role: %s", error)
        return "user"


def ban_user(
    get_db_cursor,
    logger,
    Error,
    username,
    banned_by,
    reason,
    duration_hours,
    log_action_fn,
):
    try:
        with get_db_cursor() as (cursor, _):
            if duration_hours:
                cursor.execute(
                    """
                    UPDATE users
                    SET is_banned = TRUE, ban_reason = %s,
                        banned_until = DATE_ADD(NOW(), INTERVAL %s HOUR),
                        banned_by = %s
                    WHERE username = %s
                    """,
                    (reason, duration_hours, banned_by, username),
                )
            else:
                cursor.execute(
                    """
                    UPDATE users
                    SET is_banned = TRUE, ban_reason = %s,
                        banned_until = NULL, banned_by = %s
                    WHERE username = %s
                    """,
                    (reason, banned_by, username),
                )

            cursor.execute(
                """
                INSERT INTO ban_history (username, banned_by, reason, duration_hours)
                VALUES (%s, %s, %s, %s)
                """,
                (username, banned_by, reason, duration_hours),
            )

        log_action_fn(
            banned_by, "ban", username, None, reason, {"duration_hours": duration_hours}
        )
        logger.info("User %s banned by %s", username, banned_by)
        return True
    except Error as error:
        logger.error("Failed to ban user: %s", error)
        return False


def unban_user(get_db_cursor, logger, Error, username, unbanned_by, log_action_fn):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                UPDATE users
                SET is_banned = FALSE, ban_reason = NULL,
                    banned_until = NULL, banned_by = NULL
                WHERE username = %s
                """,
                (username,),
            )

            cursor.execute(
                """
                UPDATE ban_history
                SET unbanned_at = NOW(), unbanned_by = %s
                WHERE username = %s AND unbanned_at IS NULL
                """,
                (unbanned_by, username),
            )

        if unbanned_by != "system":
            log_action_fn(unbanned_by, "unban", username, None, "User unbanned", None)
        else:
            logger.info("Expired ban for %s was lifted automatically", username)
        logger.info("User %s unbanned by %s", username, unbanned_by)
        return True
    except Error as error:
        logger.error("Failed to unban user: %s", error)
        return False


def is_user_banned(get_db_cursor, logger, Error, username, unban_user_fn):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT is_banned, banned_until
                FROM users
                WHERE username = %s
                """,
                (username,),
            )
            result = cursor.fetchone()

        if not result or not result["is_banned"]:
            return False

        if result["banned_until"] and datetime.now() > result["banned_until"]:
            unban_user_fn(username, "system")
            return False

        return True
    except Error as error:
        logger.error("Failed to check ban state: %s", error)
        return False


def add_warning(
    get_db_cursor, logger, Error, username, issued_by, reason, message_id, log_action_fn
):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                INSERT INTO warnings (username, issued_by, reason, message_id)
                VALUES (%s, %s, %s, %s)
                """,
                (username, issued_by, reason, message_id),
            )
            cursor.execute(
                "UPDATE users SET warnings_count = warnings_count + 1 WHERE username = %s",
                (username,),
            )

        log_action_fn(issued_by, "warn", username, message_id, reason, None)
        logger.info("Warning issued to %s by %s", username, issued_by)
        return True
    except Error as error:
        logger.error("Failed to add warning: %s", error)
        return False


def log_moderation_action(
    get_db_cursor,
    logger,
    Error,
    moderator,
    action_type,
    target_username,
    target_message_id,
    reason,
    details,
):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                INSERT INTO moderation_logs
                (moderator_username, action_type, target_username,
                 target_message_id, reason, details)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    moderator,
                    action_type,
                    target_username,
                    target_message_id,
                    reason,
                    json.dumps(details) if details else None,
                ),
            )
            return True
    except Error as error:
        logger.error("Failed to write moderation log: %s", error)
        return False


def get_moderation_logs(
    get_db_cursor, logger, Error, limit=100, moderator=None, action_type=None
):
    try:
        with get_db_cursor() as (cursor, _):
            query = """
                SELECT id, moderator_username, action_type, target_username,
                       target_message_id, reason, details, created_at
                FROM moderation_logs
                WHERE 1=1
            """
            params = []
            if moderator:
                query += " AND moderator_username = %s"
                params.append(moderator)
            if action_type:
                query += " AND action_type = %s"
                params.append(action_type)
            query += " ORDER BY created_at DESC LIMIT %s"
            params.append(limit)
            cursor.execute(query, params)
            logs = cursor.fetchall()

        for item in logs:
            item["created_at"] = item["created_at"].isoformat()
            if item.get("details"):
                item["details"] = json.loads(item["details"])
        return logs
    except Error as error:
        logger.error("Failed to get moderation logs: %s", error)
        return []


def create_report(
    get_db_cursor,
    logger,
    Error,
    message_id,
    reported_by,
    reported_user,
    reason,
    *,
    room_id=None,
    report_type="other",
):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                INSERT INTO reports
                (message_id, room_id, report_type, reported_by, reported_user, reason)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    message_id,
                    room_id,
                    (report_type or "other")[:32],
                    reported_by,
                    reported_user,
                    reason,
                ),
            )
            logger.info("Report from %s for message %s", reported_by, message_id)
            return True
    except Error as error:
        logger.error("Failed to create report: %s", error)
        return False


def list_reports_filtered(
    get_db_cursor,
    logger,
    Error,
    *,
    status=None,
    sort_by="date",
    sort_dir="desc",
):
    """status: None = all non-dismissed pending+reviewed+resolved, or one of reports.status."""
    try:
        with get_db_cursor() as (cursor, _):
            if status:
                st_clause = "r.status = %s"
                params = [status]
            else:
                st_clause = "r.status IN ('pending', 'reviewed', 'resolved')"
                params = []
            order = "r.created_at ASC" if sort_dir == "asc" else "r.created_at DESC"
            if sort_by == "type":
                order = (
                    "r.report_type ASC, r.created_at DESC"
                    if sort_dir != "asc"
                    else "r.report_type ASC, r.created_at ASC"
                )
            cursor.execute(
                f"""
                SELECT r.*, m.text as message_text,
                       COALESCE(r.room_id, m.room_id) AS resolved_room_id
                FROM reports r
                LEFT JOIN messages m ON r.message_id = m.message_id
                WHERE {st_clause}
                ORDER BY {order}
                LIMIT 500
                """,
                tuple(params),
            )
            reports = cursor.fetchall()

        for report in reports:
            report["created_at"] = report["created_at"].isoformat()
            if report.get("reviewed_at"):
                report["reviewed_at"] = report["reviewed_at"].isoformat()
        return reports
    except Error as error:
        logger.error("Failed to list reports: %s", error)
        return []


def get_report_by_id(get_db_cursor, logger, Error, report_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT r.*, m.text as message_text,
                       COALESCE(r.room_id, m.room_id) AS resolved_room_id
                FROM reports r
                LEFT JOIN messages m ON r.message_id = m.message_id
                WHERE r.id = %s
                """,
                (report_id,),
            )
            row = cursor.fetchone()
            if row and row.get("created_at"):
                row["created_at"] = row["created_at"].isoformat()
            if row and row.get("reviewed_at"):
                row["reviewed_at"] = row["reviewed_at"].isoformat()
            return row
    except Error as error:
        logger.error("Failed to get report by id: %s", error)
        return None


def group_reports_by_room(reports, room_titles):
    """room_titles: dict room_id -> title."""
    groups = {}
    for report in reports:
        room_id = report.get("resolved_room_id") or report.get("room_id") or "unknown"
        groups.setdefault(room_id, []).append(report)
    out = []
    for room_id, reps in sorted(groups.items(), key=lambda x: x[0]):
        out.append(
            {
                "room_id": room_id,
                "room_title": room_titles.get(room_id, room_id),
                "reports": reps,
            }
        )
    return out


def resolve_report(
    get_db_cursor, logger, Error, report_id, reviewed_by, status, resolution_note=None
):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                UPDATE reports
                SET status = %s, reviewed_by = %s,
                    reviewed_at = NOW(), resolution_note = %s
                WHERE id = %s
                """,
                (status, reviewed_by, resolution_note, report_id),
            )
            logger.info("Report %s resolved by %s", report_id, reviewed_by)
            return True
    except Error as error:
        logger.error("Failed to resolve report: %s", error)
        return False
