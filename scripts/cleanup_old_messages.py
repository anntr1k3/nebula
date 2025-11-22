#!/usr/bin/env python3
"""
Скрипт для очистки старых сообщений
Удаляет сообщения старше заданного количества дней
"""
import os
import sys
from datetime import datetime, timedelta

# Добавляем корневую директорию в путь
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app, db, Message

def cleanup_old_messages(days=90):
    """
    Удаление сообщений старше указанного количества дней
    
    Args:
        days: количество дней (по умолчанию 90)
    """
    with app.app_context():
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            
            # Подсчитываем количество сообщений для удаления
            old_messages = Message.query.filter(Message.timestamp < cutoff_date).count()
            
            if old_messages == 0:
                print(f'✓ Нет сообщений старше {days} дней')
                return
            
            print(f'Найдено {old_messages} сообщений старше {days} дней')
            
            # Запрашиваем подтверждение
            confirm = input(f'Удалить {old_messages} сообщений? (yes/no): ')
            
            if confirm.lower() != 'yes':
                print('Отменено')
                return
            
            # Удаляем старые сообщения
            deleted = Message.query.filter(Message.timestamp < cutoff_date).delete()
            db.session.commit()
            
            print(f'✅ Удалено {deleted} сообщений')
            
        except Exception as e:
            db.session.rollback()
            print(f'❌ Ошибка: {str(e)}')
            sys.exit(1)

if __name__ == '__main__':
    # Проверка на --help
    if len(sys.argv) > 1 and sys.argv[1] in ['--help', '-h', 'help']:
        print('=' * 60)
        print('Скрипт очистки старых сообщений Nebula Chat')
        print('=' * 60)
        print()
        print('Использование:')
        print('  python scripts/cleanup_old_messages.py [дни]')
        print()
        print('Параметры:')
        print('  дни    Количество дней (по умолчанию: 90)')
        print('         Сообщения старше этого срока будут удалены')
        print()
        print('Примеры:')
        print('  python scripts/cleanup_old_messages.py      # 90 дней')
        print('  python scripts/cleanup_old_messages.py 30   # 30 дней')
        print('  python scripts/cleanup_old_messages.py 365  # 1 год')
        print()
        print('Примечание:')
        print('  Скрипт запросит подтверждение перед удалением')
        print('=' * 60)
        sys.exit(0)
    
    # Парсинг аргументов
    days = 90  # По умолчанию
    
    if len(sys.argv) > 1:
        try:
            days = int(sys.argv[1])
        except ValueError:
            print(f'❌ Ошибка: "{sys.argv[1]}" не является числом')
            print('Используйте: python scripts/cleanup_old_messages.py [дни]')
            print('Или: python scripts/cleanup_old_messages.py --help')
            sys.exit(1)
        
        if days < 1:
            print('❌ Ошибка: количество дней должно быть больше 0')
            sys.exit(1)
    
    print(f'Очистка сообщений старше {days} дней...\n')
    cleanup_old_messages(days)
