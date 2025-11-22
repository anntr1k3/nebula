"""
Скрипт миграции базы данных для добавления новых полей
"""
import os
from app import app, db, Room, User
from sqlalchemy import inspect, text

def migrate_database():
    """Миграция базы данных"""
    with app.app_context():
        inspector = inspect(db.engine)
        
        # Проверяем, существует ли таблица room_members
        if 'room_members' not in inspector.get_table_names():
            print("Создание таблицы room_members...")
            db.create_all()
            print("✓ Таблица room_members создана")
        
        # Проверяем наличие новых полей в таблице room
        room_columns = [col['name'] for col in inspector.get_columns('room')]
        
        try:
            # Добавляем новые поля, если их нет
            if 'is_private' not in room_columns:
                print("Добавление поля is_private...")
                with db.engine.connect() as conn:
                    conn.execute(text('ALTER TABLE room ADD COLUMN is_private BOOLEAN DEFAULT 0 NOT NULL'))
                    conn.commit()
                print("✓ Поле is_private добавлено")
            
            if 'is_group' not in room_columns:
                print("Добавление поля is_group...")
                with db.engine.connect() as conn:
                    conn.execute(text('ALTER TABLE room ADD COLUMN is_group BOOLEAN DEFAULT 0 NOT NULL'))
                    conn.commit()
                print("✓ Поле is_group добавлено")
            
            if 'created_by' not in room_columns:
                print("Добавление поля created_by...")
                with db.engine.connect() as conn:
                    conn.execute(text('ALTER TABLE room ADD COLUMN created_by INTEGER'))
                    conn.commit()
                print("✓ Поле created_by добавлено")
            
            # Удаляем ограничение уникальности для name, если оно есть
            print("Обновление ограничений таблицы room...")
            # Для SQLite нужно пересоздать таблицу
            if db.engine.dialect.name == 'sqlite':
                print("Пересоздание таблицы room для SQLite...")
                with db.engine.connect() as conn:
                    # Создаем временную таблицу
                    conn.execute(text('''
                        CREATE TABLE room_new (
                            id INTEGER PRIMARY KEY,
                            name VARCHAR(100) NOT NULL,
                            is_private BOOLEAN DEFAULT 0 NOT NULL,
                            is_group BOOLEAN DEFAULT 0 NOT NULL,
                            created_by INTEGER,
                            created_at DATETIME,
                            FOREIGN KEY(created_by) REFERENCES user(id) ON DELETE SET NULL
                        )
                    '''))
                    
                    # Копируем данные
                    conn.execute(text('''
                        INSERT INTO room_new (id, name, created_at, is_private, is_group, created_by)
                        SELECT id, name, created_at, 
                               COALESCE(is_private, 0), 
                               COALESCE(is_group, 0), 
                               created_by
                        FROM room
                    '''))
                    
                    # Удаляем старую таблицу
                    conn.execute(text('DROP TABLE room'))
                    
                    # Переименовываем новую таблицу
                    conn.execute(text('ALTER TABLE room_new RENAME TO room'))
                    
                    conn.commit()
                print("✓ Таблица room обновлена")
            
            print("\n✅ Миграция завершена успешно!")
            print("\nТеперь вы можете запустить приложение с новым функционалом:")
            print("  - Поиск пользователей для личной переписки")
            print("  - Создание групп")
            print("  - Приглашение друзей в группы")
            
        except Exception as e:
            print(f"\n⚠️ Ошибка миграции: {str(e)}")
            print("Возможно, поля уже существуют или требуется ручная миграция.")
            print("\nПопробуйте удалить базу данных и создать её заново:")
            print("  1. Удалите файл chat.db")
            print("  2. Запустите приложение снова")

if __name__ == '__main__':
    print("=== Миграция базы данных ===\n")
    migrate_database()
