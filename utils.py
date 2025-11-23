"""
Вспомогательные функции для приложения
"""
import os
import logging
from logging.handlers import RotatingFileHandler


class ColoredFormatter(logging.Formatter):
    """Форматтер с цветами для консоли"""
    
    COLORS = {
        'DEBUG': '\033[36m',    # Cyan
        'INFO': '\033[32m',     # Green
        'WARNING': '\033[33m',  # Yellow
        'ERROR': '\033[31m',    # Red
        'CRITICAL': '\033[35m', # Magenta
        'RESET': '\033[0m'
    }
    
    def format(self, record):
        if hasattr(record, 'no_color'):
            return super().format(record)
        
        color = self.COLORS.get(record.levelname, self.COLORS['RESET'])
        record.levelname = f"{color}{record.levelname}{self.COLORS['RESET']}"
        return super().format(record)


def print_startup_banner(app, host, port, debug):
    """Красивый баннер при запуске приложения"""
    
    banner = f"""
╔══════════════════════════════════════════════════════════════╗
║                      NEBULA CHAT SERVER                      ║
╚══════════════════════════════════════════════════════════════╝

🚀 Server Configuration:
   ├─ Host:        {host}
   ├─ Port:        {port}
   ├─ Debug:       {'✓ Enabled' if debug else '✗ Disabled'}
   ├─ Environment: {os.environ.get('FLASK_ENV', 'development')}
   └─ URL:         http://{host}:{port}

📊 Database:
   ├─ Type:        SQLite
   └─ Path:        {app.config.get('SQLALCHEMY_DATABASE_URI', 'N/A').replace('sqlite:///', '')}

📝 Logging:
   ├─ Level:       {app.config.get('LOG_LEVEL', 'INFO')}
   ├─ File:        {app.config.get('LOG_FILE', 'logs/app.log')}
   └─ Max Size:    {app.config.get('LOG_MAX_BYTES', 10485760) // 1024 // 1024} MB

🔒 Security:
   ├─ Rate Limit:  ✓ Enabled
   ├─ CORS:        {os.environ.get('CORS_ORIGINS', 'localhost')}
   └─ Max Message: {app.config.get('MAX_MESSAGE_LENGTH', 500)} chars

{'⚠️  WARNING: Using default SECRET_KEY - NOT SAFE!' if not os.environ.get('SECRET_KEY') else '✓ SECRET_KEY configured'}

╔══════════════════════════════════════════════════════════════╗
║  Server is ready! Press CTRL+C to stop                       ║
╚══════════════════════════════════════════════════════════════╝
"""
    print(banner)


def setup_logging(app):
    """Настройка системы логирования"""
    
    # Создаем папку для логов, если её нет
    log_dir = os.path.dirname(app.config.get('LOG_FILE', 'logs/app.log'))
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    # Уровень логирования
    log_level = getattr(logging, app.config.get('LOG_LEVEL', 'INFO').upper())
    
    # Формат логов для файла
    file_formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s in %(module)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Формат логов для консоли (с цветами)
    console_formatter = ColoredFormatter(
        '%(levelname)s | %(message)s'
    )
    
    # Файловый обработчик с ротацией
    file_handler = RotatingFileHandler(
        app.config.get('LOG_FILE', 'logs/app.log'),
        maxBytes=app.config.get('LOG_MAX_BYTES', 10 * 1024 * 1024),
        backupCount=app.config.get('LOG_BACKUP_COUNT', 5),
        encoding='utf-8'
    )
    file_handler.setFormatter(file_formatter)
    file_handler.setLevel(log_level)
    
    # Консольный обработчик
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(console_formatter)
    console_handler.setLevel(log_level)
    
    # Настройка логгера приложения
    app.logger.addHandler(file_handler)
    app.logger.addHandler(console_handler)
    app.logger.setLevel(log_level)
    
    # Настройка корневого логгера
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # Удаляем существующие обработчики, чтобы избежать дублирования
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)
    
    # Уменьшаем уровень логирования для сторонних библиотек
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    logging.getLogger('socketio').setLevel(logging.ERROR)
    logging.getLogger('engineio').setLevel(logging.ERROR)
