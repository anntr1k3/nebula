#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Скрипт для добавления полей avatar и language в таблицу user
"""
import sys
import os

# Добавляем родительскую директорию в путь
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app, db
from sqlalchemy import inspect, text

def add_profile_fields():
    """Добавление полей avatar и language в таблицу user"""
    with app.app_context():
        try:
            # Проверяем, существуют ли уже поля
            inspector = inspect(db.engine)
            columns = [col['name'] for col in inspector.get_columns('user')]
            
            if 'avatar' not in columns:
                print('Добавление поля avatar...')
                db.session.execute(text("ALTER TABLE user ADD COLUMN avatar VARCHAR(10) DEFAULT '👤' NOT NULL"))
                print('✓ Поле avatar добавлено')
            else:
                print('✓ Поле avatar уже существует')
            
            if 'language' not in columns:
                print('Добавление поля language...')
                db.session.execute(text("ALTER TABLE user ADD COLUMN language VARCHAR(2) DEFAULT 'ru' NOT NULL"))
                print('✓ Поле language добавлено')
            else:
                print('✓ Поле language уже существует')
            
            db.session.commit()
            print('\n✓ Миграция успешно завершена!')
            
        except Exception as e:
            db.session.rollback()
            print(f'\n✗ Ошибка миграции: {str(e)}')
            sys.exit(1)

if __name__ == '__main__':
    add_profile_fields()
