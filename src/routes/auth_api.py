import time
import uuid

from flask import Blueprint, current_app, jsonify
from werkzeug.security import check_password_hash, generate_password_hash

import db
from schemas.auth import LoginBody, RegisterBody
from utils.pydantic_validation import validate_body
from utils.roles import normalize_user_role


def create_auth_api_bp(
    limiter,
    auth_token_store,
    auth_token_lifetime,
    cleanup_expired_tokens,
    is_valid_username,
    is_valid_password,
):
    """Blueprint для /api/register и /api/login.

    Параметры ``is_valid_username`` / ``is_valid_password`` принимаются для
    совместимости вызова — сами правила валидации теперь инкапсулированы
    в pydantic-моделях `RegisterBody` / `LoginBody`.
    """
    _ = (is_valid_username, is_valid_password)  # сохранённая сигнатура фабрики

    auth_api_bp = Blueprint("auth_api", __name__, url_prefix="/api")

    @auth_api_bp.route("/register", methods=["POST"])
    @limiter.limit("5 per minute")
    @validate_body(RegisterBody)
    def register(payload: RegisterBody):
        username = payload.username
        password = payload.password

        if db.get_user(username):
            return jsonify({"success": False, "message": "User already exists"})

        password_hash = generate_password_hash(
            password, method="pbkdf2:sha256", salt_length=16
        )
        if db.create_user(username, password_hash):
            current_app.logger.info(f"Зарегистрирован новый пользователь: {username}")
            return jsonify({"success": True, "message": "Registration successful"})
        return jsonify({"success": False, "message": "Registration failed"})

    @auth_api_bp.route("/login", methods=["POST"])
    @limiter.limit("10 per minute")
    @validate_body(LoginBody)
    def login(payload: LoginBody):
        username = payload.username
        password = payload.password

        user = db.get_user(username)
        if not user:
            current_app.logger.warning(
                f"Попытка входа под несуществующим пользователем: {username}"
            )
            return jsonify({"success": False, "message": "Invalid credentials"})

        if not check_password_hash(user["password_hash"], password):
            current_app.logger.warning(f"Неверный пароль при входе: {username}")
            return jsonify({"success": False, "message": "Invalid credentials"})

        if db.is_user_banned(username):
            ban_reason = user.get("ban_reason", "Rules violation")
            banned_until = user.get("banned_until")

            if banned_until:
                until_str = banned_until.strftime("%Y-%m-%d %H:%M")
                message = (
                    f"Your account is banned until {until_str}. Reason: {ban_reason}"
                )
            else:
                message = f"Your account is permanently banned. Reason: {ban_reason}"

            current_app.logger.warning(
                f"Попытка входа заблокированного пользователя: {username}"
            )
            return jsonify({"success": False, "message": message})

        cleanup_expired_tokens()

        token = str(uuid.uuid4())
        auth_token_store.put(token, username, time.time(), auth_token_lifetime)

        role = normalize_user_role(db.get_user_role(username))

        current_app.logger.info(f"Вход в систему: {username}")
        return jsonify(
            {"success": True, "username": username, "token": token, "role": role}
        )

    return auth_api_bp
