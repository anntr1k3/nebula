#!/usr/bin/env python3
"""
Скрипт для инициализации Flask-Migrate
"""
import os
import sys

# Добавляем корневую директорию в путь
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from flask_migrate import Migrate, init, migrate, upgrade
from app import app, db

# Инициализация Flask-Migrate
migrate_obj = Migrate(app, db)

def init_migrations():
    """Инициализация системы миграций"""
    with app.app_context():
        try:
            # Создаем папку migrations если её нет
            if not os.path.exists('migrations'):
                print('Инициализация Flask-Migrate...')
                os.system('flask db init')
                print('✓ Миграции инициализированы')
            else:
                print('Папка migrations уже существует')
            
            # Создаем первую миграцию
            print('\nСоздание начальной миграции...')
            os.system('flask db migrate -m "Initial migration"')
            print('✓ Миграция создана')
            
            # Применяем миграцию
            print('\nПрименение миграции...')
            os.system('flask db upgrade')
            print('✓ Миграция применена')
            
            print('\n✅ Система миграций успешно настроена!')
            print('\nДля создания новых миграций используйте:')
            print('  flask db migrate -m "описание изменений"')
            print('  flask db upgrade')
            
        except Exception as e:
            print(f'❌ Ошибка: {str(e)}')
            sys.exit(1)

if __name__ == '__main__':
    init_migrations()
