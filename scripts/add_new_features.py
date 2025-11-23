#!/usr/bin/env python3
"""
Скрипт миграции для добавления новых функций:
- Реакции на сообщения
- Ответы на сообщения (reply)
- Онлайн статусы пользователей
"""

import sys
import os

# Добавляем родительскую директорию в путь для импорта
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app, db
from sqlalchemy import inspect, text

def migrate():
    """Применение миграций к базе данных"""
    with app.app_context():
        try:
            print("🔄 Начинаем миграцию базы данных...")
            
            # Проверяем, какие колонки уже существуют
            inspector = inspect(db.engine)
            
            # Миграция таблицы message
            message_columns = [col['name'] for col in inspector.get_columns('message')]
            
            if 'reply_to_id' not in message_columns:
                print("  ➕ Добавляем колонку reply_to_id в таблицу message...")
                db.session.execute(text(
                    'ALTER TABLE message ADD COLUMN reply_to_id INTEGER'
                ))
                # Создаем индекс (IF NOT EXISTS поддерживается в SQLite 3.9+)
                try:
                    if db.engine.dialect.name == 'sqlite':
                        db.session.execute(text(
                            'CREATE INDEX IF NOT EXISTS idx_message_reply ON message(reply_to_id)'
                        ))
                    else:
                        # Для других БД проверяем существование индекса перед созданием
                        db.session.execute(text(
                            'CREATE INDEX idx_message_reply ON message(reply_to_id)'
                        ))
                except Exception:
                    # Индекс может уже существовать, игнорируем ошибку
                    pass
                print("  ✅ Колонка reply_to_id добавлена")
            else:
                print("  ℹ️  Колонка reply_to_id уже существует")
            
            if 'reactions' not in message_columns:
                print("  ➕ Добавляем колонку reactions в таблицу message...")
                db.session.execute(text(
                    "ALTER TABLE message ADD COLUMN reactions TEXT DEFAULT '{}'"
                ))
                print("  ✅ Колонка reactions добавлена")
            else:
                print("  ℹ️  Колонка reactions уже существует")
            
            # Миграция таблицы user
            user_columns = [col['name'] for col in inspector.get_columns('user')]
            
            if 'is_online' not in user_columns:
                print("  ➕ Добавляем колонку is_online в таблицу user...")
                db.session.execute(text(
                    'ALTER TABLE user ADD COLUMN is_online BOOLEAN DEFAULT 0 NOT NULL'
                ))
                print("  ✅ Колонка is_online добавлена")
            else:
                print("  ℹ️  Колонка is_online уже существует")
            
            if 'last_seen' not in user_columns:
                print("  ➕ Добавляем колонку last_seen в таблицу user...")
                db.session.execute(text(
                    "ALTER TABLE user ADD COLUMN last_seen DATETIME"
                ))
                # Устанавливаем текущее время для всех существующих пользователей
                db.session.execute(text(
                    "UPDATE user SET last_seen = CURRENT_TIMESTAMP WHERE last_seen IS NULL"
                ))
                # Создаем индекс (IF NOT EXISTS поддерживается в SQLite 3.9+)
                try:
                    if db.engine.dialect.name == 'sqlite':
                        db.session.execute(text(
                            'CREATE INDEX IF NOT EXISTS idx_user_last_seen ON user(last_seen)'
                        ))
                    else:
                        # Для других БД проверяем существование индекса перед созданием
                        db.session.execute(text(
                            'CREATE INDEX idx_user_last_seen ON user(last_seen)'
                        ))
                except Exception:
                    # Индекс может уже существовать, игнорируем ошибку
                    pass
                print("  ✅ Колонка last_seen добавлена")
            else:
                print("  ℹ️  Колонка last_seen уже существует")
            
            db.session.commit()
            print("\n✅ Миграция успешно завершена!")
            print("\n📋 Добавленные функции:")
            print("  • Реакции на сообщения (эмодзи)")
            print("  • Ответы на сообщения (reply)")
            print("  • Онлайн статусы пользователей")
            print("  • Упоминания @username")
            
        except Exception as e:
            db.session.rollback()
            print(f"\n❌ Ошибка миграции: {str(e)}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

if __name__ == '__main__':
    migrate()
