"""
Тесты автоматической очистки сообщений
"""
import unittest
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app, db, User, Room, Message


class CleanupTestCase(unittest.TestCase):
    """Тесты функции очистки"""
    
    def setUp(self):
        """Настройка перед каждым тестом"""
        app.config['TESTING'] = True
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        app.config['WTF_CSRF_ENABLED'] = False
        app.config['RATELIMIT_ENABLED'] = False  # Отключаем rate limiting для тестов
        self.app = app
        self.client = app.test_client()
        
        with app.app_context():
            db.create_all()
            
            # Создаем тестовые данные
            user = User(username='testuser')
            user.set_password('password123')
            db.session.add(user)
            
            room = Room(name='Test Room', created_by=1)
            db.session.add(room)
            db.session.commit()
            
            # Создаем старые и новые сообщения
            old_date = datetime.utcnow() - timedelta(days=100)
            recent_date = datetime.utcnow() - timedelta(days=10)
            
            for i in range(5):
                msg = Message(
                    text=f'Old message {i}',
                    user_id=user.id,
                    room_id=room.id,
                    timestamp=old_date
                )
                db.session.add(msg)
            
            for i in range(3):
                msg = Message(
                    text=f'Recent message {i}',
                    user_id=user.id,
                    room_id=room.id,
                    timestamp=recent_date
                )
                db.session.add(msg)
            
            db.session.commit()
    
    def tearDown(self):
        """Очистка после каждого теста"""
        with app.app_context():
            db.session.remove()
            db.drop_all()
    
    def test_cleanup_disabled_by_default(self):
        """Тест: очистка отключена по умолчанию"""
        with app.app_context():
            from app import cleanup_old_messages_auto
            
            initial_count = Message.query.count()
            self.assertEqual(initial_count, 8)  # 5 старых + 3 новых
            
            # Очистка не должна ничего удалить
            cleanup_old_messages_auto()
            
            final_count = Message.query.count()
            self.assertEqual(final_count, 8)
    
    def test_cleanup_with_age_limit(self):
        """Тест: очистка с установленным лимитом"""
        with app.app_context():
            from app import cleanup_old_messages_auto
            
            # Устанавливаем лимит 90 дней
            os.environ['MAX_MESSAGE_AGE_DAYS'] = '90'
            
            initial_count = Message.query.count()
            self.assertEqual(initial_count, 8)
            
            # Очистка должна удалить старые сообщения
            cleanup_old_messages_auto()
            
            final_count = Message.query.count()
            self.assertEqual(final_count, 3)  # Остались только новые
            
            # Проверяем, что остались правильные сообщения
            remaining = Message.query.all()
            for msg in remaining:
                self.assertIn('Recent', msg.text)
            
            # Очищаем переменную окружения
            del os.environ['MAX_MESSAGE_AGE_DAYS']
    
    def test_api_cleanup_requires_auth(self):
        """Тест: API требует аутентификации"""
        response = self.client.post('/api/admin/cleanup-messages',
                                   json={'days': 90})
        self.assertEqual(response.status_code, 302)  # Redirect to login
    
    def test_api_cleanup_requires_admin(self):
        """Тест: API требует прав администратора"""
        with app.app_context():
            # Создаем второго пользователя
            user2 = User(username='user2')
            user2.set_password('password123')
            db.session.add(user2)
            db.session.commit()
        
        # Входим как второй пользователь
        self.client.post('/login', data={
            'username': 'user2',
            'password': 'password123'
        })
        
        response = self.client.post('/api/admin/cleanup-messages',
                                   json={'days': 90})
        self.assertEqual(response.status_code, 403)  # Access denied
    
    def test_api_cleanup_success(self):
        """Тест: успешная очистка через API"""
        # Входим как первый пользователь (админ)
        self.client.post('/login', data={
            'username': 'testuser',
            'password': 'password123'
        })
        
        response = self.client.post('/api/admin/cleanup-messages',
                                   json={'days': 90})
        
        self.assertEqual(response.status_code, 200)
        
        data = response.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['deleted'], 5)  # Удалено 5 старых сообщений
        self.assertEqual(data['days'], 90)
        
        # Проверяем, что сообщения действительно удалены
        with app.app_context():
            remaining = Message.query.count()
            self.assertEqual(remaining, 3)
    
    def test_api_cleanup_invalid_days(self):
        """Тест: валидация параметра days"""
        self.client.post('/login', data={
            'username': 'testuser',
            'password': 'password123'
        })
        
        # Отрицательное значение
        response = self.client.post('/api/admin/cleanup-messages',
                                   json={'days': 0})
        self.assertEqual(response.status_code, 400)
        
        # Без параметра (должно использовать 90 по умолчанию)
        response = self.client.post('/api/admin/cleanup-messages',
                                   json={})
        self.assertEqual(response.status_code, 200)


if __name__ == '__main__':
    unittest.main()
