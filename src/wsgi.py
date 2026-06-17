"""WSGI entry (Gunicorn + gevent-websocket worker): gunicorn --pythonpath src wsgi:app."""

import os

from path_setup import ensure_src_path

ensure_src_path()

os.environ.setdefault("NEBULA_ENV", "production")

from app import create_app  # noqa: E402, I001

_testing = os.getenv("NEBULA_TESTING", "0") == "1"
_strict = os.getenv("NEBULA_STRICT_DB", "1" if not _testing else "0") == "1"
app, socketio = create_app(testing=_testing, strict_db=_strict)
