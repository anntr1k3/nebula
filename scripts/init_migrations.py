#!/usr/bin/env python3
"""
Скрипт для инициализации Flask-Migrate
"""
import os
import sys
import subprocess

# Добавляем корневую директорию в путь
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from flask_migrate import Migrate
from app import app, db

# Инициализация Flask-Migrate
migrate_obj = Migrate(app, db)

def run_command(command, description):
    """Безопасное выполнение команды с проверкой результата"""
    try:
        result = subprocess.run(
            command,
            shell=True,
            check=True,
            capture_output=True,
            text=True,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        print(f'✓ {description}')
        if result.stdout:
            print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f'❌ Ошибка при выполнении: {description}')
        if e.stderr:
            print(f'Ошибка: {e.stderr}')
        return False

def init_migrations():
    """Инициализация системы миграций"""
    with app.app_context():
        try:
            # Создаем папку migrations если её нет
            migrations_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'migrations')
            if not os.path.exists(migrations_dir):
                print('Инициализация Flask-Migrate...')
                if not run_command('flask db init', 'Миграции инициализированы'):
                    sys.exit(1)
            else:
                print('✓ Папка migrations уже существует')
            
            # Создаем первую миграцию
            print('\nСоздание начальной миграции...')
            if not run_command('flask db migrate -m "Initial migration"', 'Миграция создана'):
                print('⚠️  Миграция уже существует или произошла ошибка')
            
            # Применяем миграцию
            print('\nПрименение миграции...')
            if not run_command('flask db upgrade', 'Миграция применена'):
                sys.exit(1)
            
            print('\n✅ Система миграций успешно настроена!')
            print('\nДля создания новых миграций используйте:')
            print('  flask db migrate -m "описание изменений"')
            print('  flask db upgrade')
            
        except Exception as e:
            print(f'❌ Ошибка: {str(e)}')
            import traceback
            traceback.print_exc()
            sys.exit(1)

if __name__ == '__main__':
    init_migrations()
