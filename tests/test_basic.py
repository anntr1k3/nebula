"""
Базовые тесты для Nebula Chat
"""
import unittest
import sys
import os

# Добавляем корневую директорию в путь
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app, db, User, Room, Message


class BasicTestCase(unittest.TestCase):
    """Базовые тесты приложения"""
    
    def setUp(self):
        """Настройка перед каждым тестом"""
        app.config['TESTING'] = True
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        app.config['WTF_CSRF_ENABLED'] = False
        self.app = app
        self.client = app.test_client()
        
        with app.app_context():
            db.create_all()
    
    def tearDown(self):
        """Очистка после каждого теста"""
        with app.app_context():
            db.session.remove()
            db.drop_all()
    
    def test_app_exists(self):
        """Тест: приложение существует"""
        self.assertIsNotNone(app)
    
    def test_app_is_testing(self):
        """Тест: приложение в режиме тестирования"""
        self.assertTrue(app.config['TESTING'])
    
    def test_home_redirect(self):
        """Тест: главная страница перенаправляет на логин"""
        response = self.client.get('/')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login', response.location)
    
    def test_login_page_loads(self):
        """Тест: страница логина загружается"""
        response = self.client.get('/login')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Nebula Chat', response.data)
    
    def test_register_page_loads(self):
        """Тест: страница регистрации загружается"""
        response = self.client.get('/register')
        self.assertEqual(response.status_code, 200)
    
    def test_user_creation(self):
        """Тест: создание пользователя"""
        with app.app_context():
            user = User(username='testuser')
            user.set_password('password123')
            db.session.add(user)
            db.session.commit()
            
            found_user = User.query.filter_by(username='testuser').first()
            self.assertIsNotNone(found_user)
            self.assertEqual(found_user.username, 'testuser')
            self.assertTrue(found_user.check_password('password123'))
            self.assertFalse(found_user.check_password('wrongpassword'))
    
    def test_user_registration(self):
        """Тест: регистрация через форму"""
        response = self.client.post('/register', data={
            'username': 'newuser',
            'password': 'password123',
            'submit': 'Зарегистрироваться'
        }, follow_redirects=True)
        
        self.assertEqual(response.status_code, 200)
        
        with app.app_context():
            user = User.query.filter_by(username='newuser').first()
            self.assertIsNotNone(user)
    
    def test_duplicate_username(self):
        """Тест: нельзя создать пользователя с существующим именем"""
        with app.app_context():
            user = User(username='testuser')
            user.set_password('password123')
            db.session.add(user)
            db.session.commit()
        
        response = self.client.post('/register', data={
            'username': 'testuser',
            'password': 'password456',
            'submit': 'Зарегистрироваться'
        })
        
        # Проверяем, что регистрация не прошла
        self.assertEqual(response.status_code, 200)
        self.assertIn('занято'.encode('utf-8'), response.data)
    
    def test_room_creation(self):
        """Тест: создание комнаты"""
        with app.app_context():
            user = User(username='testuser')
            user.set_password('password123')
            db.session.add(user)
            db.session.commit()
            
            room = Room(name='Test Room', created_by=user.id)
            db.session.add(room)
            db.session.commit()
            
            found_room = Room.query.filter_by(name='Test Room').first()
            self.assertIsNotNone(found_room)
            self.assertEqual(found_room.name, 'Test Room')
    
    def test_message_creation(self):
        """Тест: создание сообщения"""
        with app.app_context():
            user = User(username='testuser')
            user.set_password('password123')
            db.session.add(user)
            db.session.commit()
            
            room = Room(name='Test Room', created_by=user.id)
            db.session.add(room)
            db.session.commit()
            
            message = Message(text='Hello, World!', user_id=user.id, room_id=room.id)
            db.session.add(message)
            db.session.commit()
            
            found_message = Message.query.filter_by(text='Hello, World!').first()
            self.assertIsNotNone(found_message)
            self.assertEqual(found_message.text, 'Hello, World!')
            self.assertEqual(found_message.author.username, 'testuser')
    
    def test_password_hashing(self):
        """Тест: пароли хешируются"""
        with app.app_context():
            user = User(username='testuser')
            user.set_password('mypassword')
            
            self.assertNotEqual(user.password_hash, 'mypassword')
            self.assertTrue(user.check_password('mypassword'))
    
    def test_sanitize_message(self):
        """Тест: санитизация сообщений"""
        from app import sanitize_message
        
        dangerous_text = '<script>alert("XSS")</script>Hello'
        safe_text = sanitize_message(dangerous_text)
        
        self.assertNotIn('<script>', safe_text)
        self.assertIn('Hello', safe_text)


class APITestCase(unittest.TestCase):
    """Тесты API endpoints"""
    
    def setUp(self):
        """Настройка перед каждым тестом"""
        app.config['TESTING'] = True
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        app.config['WTF_CSRF_ENABLED'] = False
        self.app = app
        self.client = app.test_client()
        
        with app.app_context():
            db.create_all()
            
            # Создаем тестового пользователя
            user = User(username='testuser')
            user.set_password('password123')
            db.session.add(user)
            db.session.commit()
    
    def tearDown(self):
        """Очистка после каждого теста"""
        with app.app_context():
            db.session.remove()
            db.drop_all()
    
    def login(self):
        """Вспомогательная функция для входа"""
        return self.client.post('/login', data={
            'username': 'testuser',
            'password': 'password123'
        }, follow_redirects=True)
    
    def test_api_requires_auth(self):
        """Тест: API требует аутентификации"""
        response = self.client.get('/api/users/search?q=test')
        self.assertEqual(response.status_code, 302)  # Redirect to login
    
    def test_search_users_authenticated(self):
        """Тест: поиск пользователей для авторизованных"""
        self.login()
        
        with app.app_context():
            user2 = User(username='anotheruser')
            user2.set_password('password123')
            db.session.add(user2)
            db.session.commit()
        
        response = self.client.get('/api/users/search?q=another')
        self.assertEqual(response.status_code, 200)
        
        data = response.get_json()
        self.assertIsInstance(data, list)
    
    def test_search_query_too_short(self):
        """Тест: слишком короткий поисковый запрос"""
        self.login()
        
        response = self.client.get('/api/users/search?q=a')
        self.assertEqual(response.status_code, 400)


if __name__ == '__main__':
    unittest.main()
