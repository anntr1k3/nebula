"""Socket.IO handler registration entrypoint."""

from handlers.socket_messages import register_message_handlers
from handlers.socket_presence import register_presence_handlers
from handlers.socket_runtime import SocketRuntime


def register_socket_handlers(rt: SocketRuntime) -> None:
    register_presence_handlers(rt)
    register_message_handlers(rt)
