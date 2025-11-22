"""
Вспомогательные функции для приложения
"""
import os
import logging
from logging.handlers import RotatingFileHandler


def setup_logging(app):
    """Настройка системы логирования"""
    
    # Создаем папку для логов, если её нет
    log_dir = os.path.dirname(app.config.get('LOG_FILE', 'logs/app.log'))
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    # Уровень логирования
    log_level = getattr(logging, app.config.get('LOG_LEVEL', 'INFO').upper())
    
    # Формат логов
    formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s in %(module)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Файловый обработчик с ротацией
    file_handler = RotatingFileHandler(
        app.config.get('LOG_FILE', 'logs/app.log'),
        maxBytes=app.config.get('LOG_MAX_BYTES', 10 * 1024 * 1024),
        backupCount=app.config.get('LOG_BACKUP_COUNT', 5),
        encoding='utf-8'
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(log_level)
    
    # Консольный обработчик
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
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
    logging.getLogger('werkzeug').setLevel(logging.WARNING)
    logging.getLogger('socketio').setLevel(logging.WARNING)
    logging.getLogger('engineio').setLevel(logging.WARNING)
    
    app.logger.info('Logging system initialized')
    app.logger.info(f'Log level: {app.config.get("LOG_LEVEL", "INFO")}')
    app.logger.info(f'Log file: {app.config.get("LOG_FILE", "logs/app.log")}')
