"""
Конфигурация приложения
"""
import os
from datetime import timedelta


class Config:
    """Базовая конфигурация"""
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'sqlite:///instance/chat.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }
    
    # Безопасность
    WTF_CSRF_TIME_LIMIT = None
    WTF_CSRF_ENABLED = True
    WTF_CSRF_EXEMPT_LIST = []  # API endpoints будут проверяться отдельно
    SESSION_COOKIE_SECURE = False
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
    
    # Лимиты
    MAX_MESSAGE_LENGTH = int(os.environ.get('MAX_MESSAGE_LENGTH', 500))
    RATE_LIMIT = int(os.environ.get('RATE_LIMIT', 30))
    
    # CORS
    CORS_ORIGINS = os.environ.get('CORS_ORIGINS', 'http://localhost:5000,http://127.0.0.1:5000')
    
    # Логирование
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')
    LOG_FILE = 'logs/app.log'
    LOG_MAX_BYTES = 10 * 1024 * 1024  # 10MB
    LOG_BACKUP_COUNT = 5


class DevelopmentConfig(Config):
    """Конфигурация для разработки"""
    DEBUG = True
    TESTING = False


class ProductionConfig(Config):
    """Конфигурация для продакшена"""
    DEBUG = False
    TESTING = False
    SESSION_COOKIE_SECURE = True
    WTF_CSRF_SSL_STRICT = True
    
    # Проверка обязательных переменных
    @classmethod
    def init_app(cls, app):
        Config.init_app(app)
        
        # Проверка SECRET_KEY
        if not os.environ.get('SECRET_KEY') or \
           os.environ.get('SECRET_KEY') == 'dev-secret-key-change-in-production':
            raise ValueError('SECRET_KEY must be set in production!')


class TestingConfig(Config):
    """Конфигурация для тестирования"""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}
