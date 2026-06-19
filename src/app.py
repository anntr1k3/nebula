"""«Небула» — веб-мессенджер: точка входа и фабрика приложения."""

import logging
import os
import threading
import time
from collections import defaultdict
from logging.handlers import RotatingFileHandler
from pathlib import Path

from flask import Flask, jsonify, request
from flask_compress import Compress
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_socketio import SocketIO

import db
from config import (
    AUTH_TOKEN_LIFETIME,
    MAX_MEDIA_FILE_SIZE,
    MAX_MESSAGE_LENGTH,
    MEDIA_DIR,
    RATE_LIMIT_MESSAGES,
    RATE_LIMIT_WINDOW,
    get_config,
)
from handlers.socket_handlers import SocketRuntime, register_socket_handlers
from routes.ai_api import create_ai_api_bp
from routes.api_tools import create_api_tools_bp
from routes.auth_api import create_auth_api_bp
from routes.chat_api import bind_user_connections, chat_api_bp
from routes.moderation_api import moderation_api_bp
from routes.system_api import create_system_bp
from services.scheduled_worker import start_scheduled_worker
from utils.auth_token_store import build_auth_token_store
from utils.media import ensure_media_dir
from utils.media import save_media_file as save_media_file_to_disk
from utils.sanitizers import sanitize_text
from utils.validators import is_valid_password, is_valid_username, validate_mime_type


def _parse_allowed_origins(raw: object) -> str | list[str]:
    """Нормализует ALLOWED_ORIGINS в формат, понятный Flask-CORS и Flask-SocketIO.

    Значение из .env приходит одной строкой. Список через запятую нужно разбить:
    Flask-SocketIO трактует одиночную строку как ОДИН origin-литерал, поэтому
    ``"a,b,c"`` не совпадает ни с одним реальным origin и handshake отклоняется
    с ``400 Not an accepted origin``. ``"*"`` оставляем как есть.
    """
    if isinstance(raw, (list, tuple)):
        return [str(o).strip() for o in raw if str(o).strip()]
    text = str(raw).strip()
    if text in ("", "*"):
        return "*"
    origins = [o.strip() for o in text.split(",") if o.strip()]
    return origins[0] if len(origins) == 1 else origins


def _install_socketio_emit_lock(socketio: SocketIO) -> threading.RLock:
    """Сериализация emit/комнат: воркер отложенных сообщений + Werkzeug (threading).

    Без общего замка возможны гонки Engine.IO / long-polling и ошибка Werkzeug
    ``write() before start_response``; см. предупреждение о потоках в python-socketio.
    """
    lock: threading.RLock = threading.RLock()
    srv = socketio.server
    for name in ("emit", "send", "enter_room", "leave_room", "close_room", "disconnect"):
        if not hasattr(srv, name):
            continue
        orig = getattr(srv, name)

        def _wrap(fn):
            def _locked(*args, **kwargs):
                with lock:
                    return fn(*args, **kwargs)

            return _locked

        setattr(srv, name, _wrap(orig))
    return lock


def _should_emit_startup_log(app: Flask) -> bool:
    """In debug mode Werkzeug loads the app twice (reloader parent + child); log only from the child."""
    if not app.debug:
        return True
    return os.environ.get("WERKZEUG_RUN_MAIN") == "true"


def _configure_logging(app, log_dir):
    os.makedirs(log_dir, exist_ok=True)

    log_formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    log_path = os.path.join(log_dir, "messenger.log")
    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(log_formatter)
    file_handler.setLevel(logging.INFO)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_formatter)
    console_handler.setLevel(logging.INFO)

    app.logger.handlers.clear()
    app.logger.addHandler(file_handler)
    app.logger.addHandler(console_handler)
    app.logger.setLevel(logging.INFO)
    app.logger.propagate = False

    socketio_logger = logging.getLogger("socketio")
    socketio_logger.handlers.clear()
    socketio_logger.addHandler(file_handler)
    socketio_logger.addHandler(console_handler)
    socketio_logger.setLevel(logging.WARNING)
    socketio_logger.propagate = False

    if _should_emit_startup_log(app):
        app.logger.info("Запуск приложения (бэкенд MySQL)…")


def create_app(testing=False, strict_db=True):
    package_dir = Path(__file__).resolve().parent
    project_root = package_dir.parent
    app = Flask(
        __name__,
        static_folder=str(project_root / "static"),
    )
    config_cls = get_config(testing=testing)
    app.config.from_object(config_cls)
    app.config["MAX_CONTENT_LENGTH"] = MAX_MEDIA_FILE_SIZE + 1024 * 1024

    @app.errorhandler(413)
    def request_entity_too_large(_error):
        return jsonify({"success": False, "message": "File too large"}), 413

    redis_url = app.config.get("REDIS_URL")
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri=redis_url if redis_url else "memory://",
    )

    @limiter.request_filter
    def exempt_public_static_get():
        """Do not count SPA shell and static assets toward default limits.

        All of them are served by few view functions; a single page load issues
        many GETs (css, js, favicon), so a low default cap causes 429 and a
        broken UI. API routes stay under ``/api/`` and remain limited.
        """
        if request.method != "GET":
            return False
        p = request.path or ""
        if p.startswith("/api/"):
            # High-frequency read-only API requests (polling/bootstrapping) must not
            # be throttled by the default limits, otherwise the UI loses inbox state.
            # Sensitive routes (login/register/upload/moderation mutations) remain limited
            # via route-specific limits or by being non-GET.
            allow = (
                p in ("/api/me", "/api/inbox", "/api/users", "/api/rooms", "/api/blocked", "/api/chat_mute")
                or p.startswith("/api/profile")
                or p.startswith("/api/pinned/")
                or p == "/api/messages"
                or p.startswith("/api/messages/scheduled")
                or p in ("/api/draft", "/api/drafts")
                or p.startswith("/api/search_")
                or p.startswith("/api/ai/status")
            )
            return allow
        if p.startswith("/socket.io"):
            return False
        if p in ("/", "/login", "/admin"):
            return True
        if p.startswith(("/css/", "/js/", "/media/")):
            return True
        ext = os.path.splitext(p)[1].lower()
        return ext in (
            ".css",
            ".js",
            ".ico",
            ".png",
            ".svg",
            ".webp",
            ".woff",
            ".woff2",
            ".json",
            ".map",
            ".webmanifest",
        )

    # Не сжимать audio/video: Range-запросы плеера + Flask-Compress → write() before start_response
    app.config["COMPRESS_MIMETYPES"] = [
        "text/html",
        "text/css",
        "text/xml",
        "text/plain",
        "text/javascript",
        "application/json",
        "application/javascript",
        "image/svg+xml",
    ]
    Compress(app)

    log_dir = str(project_root / "logs")
    _configure_logging(app, log_dir)

    if not os.getenv("SECRET_KEY"):
        app.logger.warning(
            "SECRET_KEY не задан! Используется временный ключ, сессии не сохранятся между перезапусками."
        )

    _env = (os.getenv("NEBULA_ENV") or "").lower()
    if _env in {"prod", "production"} and not testing and not redis_url:
        app.logger.warning(
            "В production не задан REDIS_URL: лимиты и токены не разделяются между "
            "воркерами. Укажите REDIS_URL при нескольких процессах."
        )

    allowed_origins = _parse_allowed_origins(app.config.get("ALLOWED_ORIGINS", "*"))
    CORS(app, origins=allowed_origins)
    socketio = SocketIO(
        app,
        cors_allowed_origins=allowed_origins,
        max_http_buffer_size=MAX_MEDIA_FILE_SIZE,
        transports=["websocket", "polling"],
        async_mode=os.getenv("NEBULA_SOCKETIO_ASYNC_MODE", "threading"),
        async_handlers=False,
        logger=False,
        engineio_logger=False,
        ping_timeout=60,
        ping_interval=25,
    )
    app.extensions["nebula_socketio_emit_lock"] = _install_socketio_emit_lock(socketio)
    app.extensions["socketio"] = socketio

    media_root = str(project_root / MEDIA_DIR)
    ensure_media_dir(media_root)

    auth_token_store = build_auth_token_store(redis_url, app.logger)
    user_sessions: dict[str, str] = {}
    user_connections: dict[str, set[str]] = {}
    message_timestamps: defaultdict[str, list[float]] = defaultdict(list)
    app.extensions["nebula_user_connections"] = user_connections
    app.extensions["auth_token_store"] = auth_token_store
    app.extensions["auth_token_lifetime"] = AUTH_TOKEN_LIFETIME

    def cleanup_expired_tokens():
        auth_token_store.cleanup_expired(AUTH_TOKEN_LIFETIME)

    def check_rate_limit(username):
        now = time.time()
        message_timestamps[username] = [
            ts for ts in message_timestamps[username] if now - ts < RATE_LIMIT_WINDOW
        ]
        if len(message_timestamps[username]) >= RATE_LIMIT_MESSAGES:
            return False
        message_timestamps[username].append(now)
        return True

    def save_media_file(media_data, media_type):
        _ = media_type
        return save_media_file_to_disk(media_data, media_root, app.logger)

    db_ready = db.init_connection_pool()
    if not db_ready:
        app.logger.warning("Пул соединений с БД недоступен")
        if strict_db:
            raise RuntimeError("Database connection failed")

    app.register_blueprint(create_api_tools_bp(media_root))
    app.register_blueprint(create_ai_api_bp(limiter))
    bind_user_connections(user_connections)
    app.register_blueprint(chat_api_bp)
    app.register_blueprint(moderation_api_bp)
    app.register_blueprint(
        create_auth_api_bp(
            limiter=limiter,
            auth_token_store=auth_token_store,
            auth_token_lifetime=AUTH_TOKEN_LIFETIME,
            cleanup_expired_tokens=cleanup_expired_tokens,
            is_valid_username=is_valid_username,
            is_valid_password=is_valid_password,
        )
    )
    app.register_blueprint(
        create_system_bp(
            limiter=limiter,
            db=db,
            app=app,
            media_dir=media_root,
            max_media_file_size=MAX_MEDIA_FILE_SIZE,
            auth_token_store=auth_token_store,
            user_sessions=user_sessions,
            user_connections=user_connections,
            message_timestamps=message_timestamps,
        )
    )

    socket_runtime = SocketRuntime(
        socketio=socketio,
        app=app,
        db=db,
        auth_token_store=auth_token_store,
        user_sessions=user_sessions,
        user_connections=user_connections,
        check_rate_limit=check_rate_limit,
        sanitize_text=sanitize_text,
        validate_mime_type=validate_mime_type,
        save_media_file=save_media_file,
        auth_token_lifetime=AUTH_TOKEN_LIFETIME,
        max_message_length=MAX_MESSAGE_LENGTH,
        max_media_file_size=MAX_MEDIA_FILE_SIZE,
    )
    register_socket_handlers(socket_runtime)
    app.extensions["nebula_socket_runtime"] = socket_runtime

    if not testing:
        start_scheduled_worker(app, socketio)

    return app, socketio
