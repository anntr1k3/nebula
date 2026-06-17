from flask import Blueprint, current_app, jsonify

from schemas.ai import AiRewriteBody
from services.ai_editor import AiNotConfiguredError, AiServiceError, rewrite_message_text
from utils.auth_helpers import require_auth_user
from utils.pydantic_validation import validate_body


def create_ai_api_bp(limiter):
    ai_api_bp = Blueprint("ai_api", __name__, url_prefix="/api/ai")

    @ai_api_bp.route("/rewrite", methods=["POST"])
    @limiter.limit("30 per hour")
    @validate_body(AiRewriteBody)
    def ai_rewrite(payload: AiRewriteBody):
        username, err = require_auth_user()
        if err:
            return err

        cfg = current_app.config
        try:
            text = rewrite_message_text(
                text=payload.text,
                action=payload.action,
                enabled=bool(cfg.get("AI_ENABLED")),
                api_key=cfg.get("AI_API_KEY"),
                api_base=cfg.get("AI_API_BASE") or "https://api.openai.com/v1",
                model=cfg.get("AI_MODEL") or "gpt-4o-mini",
            )
        except AiNotConfiguredError as e:
            current_app.logger.info(
                "AI rewrite skipped for %s: not configured", username
            )
            return jsonify({"success": False, "message": e.message}), e.status
        except AiServiceError as e:
            current_app.logger.warning(
                "AI rewrite failed for %s: %s", username, e.message
            )
            return jsonify({"success": False, "message": e.message}), e.status

        current_app.logger.info(
            "AI rewrite ok user=%s action=%s len=%s→%s",
            username,
            payload.action,
            len(payload.text),
            len(text),
        )
        return jsonify({"success": True, "text": text, "action": payload.action})

    @ai_api_bp.route("/status", methods=["GET"])
    def ai_status():
        _, err = require_auth_user()
        if err:
            return err
        cfg = current_app.config
        configured = bool(cfg.get("AI_ENABLED")) and bool(
            (cfg.get("AI_API_KEY") or "").strip()
        )
        return jsonify({"success": True, "enabled": configured})

    return ai_api_bp
