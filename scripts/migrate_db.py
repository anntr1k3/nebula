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
                try:
                    db.session.execute(text('ALTER TABLE room ADD COLUMN is_private BOOLEAN DEFAULT 0 NOT NULL'))
                    db.session.commit()
                    print("✓ Поле is_private добавлено")
                except Exception as e:
                    db.session.rollback()
                    print(f"⚠️  Ошибка при добавлении is_private: {str(e)}")
            
            if 'is_group' not in room_columns:
                print("Добавление поля is_group...")
                try:
                    db.session.execute(text('ALTER TABLE room ADD COLUMN is_group BOOLEAN DEFAULT 0 NOT NULL'))
                    db.session.commit()
                    print("✓ Поле is_group добавлено")
                except Exception as e:
                    db.session.rollback()
                    print(f"⚠️  Ошибка при добавлении is_group: {str(e)}")
            
            if 'created_by' not in room_columns:
                print("Добавление поля created_by...")
                try:
                    db.session.execute(text('ALTER TABLE room ADD COLUMN created_by INTEGER'))
                    db.session.commit()
                    print("✓ Поле created_by добавлено")
                except Exception as e:
                    db.session.rollback()
                    print(f"⚠️  Ошибка при добавлении created_by: {str(e)}")
            
            # Проверяем финальное состояние
            room_columns_after = [col['name'] for col in inspector.get_columns('room')]
            if all(col in room_columns_after for col in ['is_private', 'is_group', 'created_by']):
                print("\n✅ Миграция завершена успешно!")
                print("\nТеперь вы можете запустить приложение с новым функционалом:")
                print("  - Поиск пользователей для личной переписки")
                print("  - Создание групп")
                print("  - Приглашение друзей в группы")
            else:
                print("\n⚠️  Некоторые поля не были добавлены")
                print("   Проверьте ошибки выше и попробуйте снова")
            
        except Exception as e:
            db.session.rollback()
            print(f"\n❌ Ошибка миграции: {str(e)}")
            import traceback
            traceback.print_exc()
            print("\nПопробуйте удалить базу данных и создать её заново:")
            print("  1. Удалите файл chat.db")
            print("  2. Запустите приложение снова")

if __name__ == '__main__':
    print("=== Миграция базы данных ===\n")
    migrate_database()
