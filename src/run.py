"""Alternative startup script for app factory mode."""

import os

from path_setup import ensure_src_path

ensure_src_path()

from app import create_app  # noqa: E402, I001


if __name__ == "__main__":
    testing = os.getenv("NEBULA_TESTING", "0") == "1"
    strict_db = os.getenv("NEBULA_STRICT_DB", "1" if not testing else "0") == "1"
    app, socketio = create_app(testing=testing, strict_db=strict_db)
    host = "127.0.0.1"
    port = 5000
    debug_mode = bool(app.config.get("DEBUG", True))
    # Same as _should_emit_startup_log in app: avoid duplicating banner for reloader parent.
    _child_or_no_reloader = (not debug_mode) or (
        os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    )
    if _child_or_no_reloader:
        print("\n" + "=" * 60)
        print("  НЕБУЛА — режим разработки   |   Остановка: Ctrl+C")
        print("=" * 60 + "\n")

    socketio.run(
        app,
        debug=debug_mode,
        host=host,
        port=port,
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )
