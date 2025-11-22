"""
Скрипт для инициализации Flask-Migrate
"""
from flask_migrate import Migrate
from app import app, db

migrate = Migrate(app, db)

if __name__ == '__main__':
    print("Flask-Migrate инициализирован!")
    print("Используйте следующие команды:")
    print("  flask db init       - инициализация миграций")
    print("  flask db migrate    - создание миграции")
    print("  flask db upgrade    - применение миграций")
    print("  flask db downgrade  - откат миграций")
