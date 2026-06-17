"""HTTP Bearer token validation (shared with /api/me logic)."""

import time

from flask import current_app, jsonify, request

import db as db_module


def extract_token_from_request(req, *, allow_query: bool = True):
    auth_header = req.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    x = req.headers.get("X-Auth-Token", "").strip()
    if x:
        return x
    if allow_query:
        q = (req.args.get("token") or "").strip()
        return q or None
    return None


def resolve_token_user(token_store, token, lifetime):
    if not token:
        return None, "invalid"
    data = token_store.get(token)
    if not data or not data.get("username"):
        return None, "invalid"
    if time.time() - data["created_at"] > lifetime:
        token_store.delete(token)
        return None, "expired"
    return data["username"], None


def require_auth_user():
    """Return (username, None) or (None, (jsonify(...), status_code))."""
    token_store = current_app.extensions.get("auth_token_store")
    lifetime = current_app.extensions.get("auth_token_lifetime", 3600)
    if token_store is None:
        return None, (
            jsonify({"success": False, "message": "Server is not configured"}),
            500,
        )

    allow_query = current_app.config.get("ALLOW_TOKEN_IN_QUERY", True)
    token = extract_token_from_request(request, allow_query=allow_query)
    username, err = resolve_token_user(token_store, token, lifetime)
    if err == "invalid":
        return None, (
            jsonify({"success": False, "message": "Authentication required"}),
            401,
        )
    if err == "expired":
        return None, (
            jsonify(
                {"success": False, "message": "Session expired, please log in again"}
            ),
            401,
        )
    # DB recreated or user removed: token may still exist in memory/Redis
    if not db_module.get_user(username):
        if token:
            token_store.delete(token)
        return None, (
            jsonify(
                {
                    "success": False,
                    "message": "Account not found. Please sign in again.",
                }
            ),
            401,
        )
    return username, None
