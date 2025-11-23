import os
import logging
import json
import re
from datetime import datetime, timedelta, timezone
from flask import Flask, render_template, redirect, url_for, flash, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_wtf import FlaskForm
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from wtforms import StringField, PasswordField, SubmitField
from wtforms.validators import DataRequired, Length, ValidationError, Regexp
from werkzeug.security import generate_password_hash, check_password_hash
import bleach
import secrets
import hmac
from dotenv import load_dotenv

# Загрузка переменных окружения
load_dotenv()

logger = logging.getLogger(__name__)

# Инициализация приложения
app = Flask(__name__)

# Загрузка конфигурации
from config import config
config_name = os.environ.get('FLASK_ENV', 'development')
app.config.from_object(config[config_name])

# Проверка SECRET_KEY
if os.environ.get('FLASK_ENV') == 'production':
    if not os.environ.get('SECRET_KEY') or \
       os.environ.get('SECRET_KEY') == 'dev-secret-key-change-in-production':
        raise ValueError('SECRET_KEY must be set in production environment!')
elif not os.environ.get('SECRET_KEY'):
    logger.warning('Using default SECRET_KEY - NOT SAFE FOR PRODUCTION!')

# Инициализация расширений
db = SQLAlchemy(app)

# CORS настройки для SocketIO
cors_origins = os.environ.get('CORS_ORIGINS', 'http://localhost:5000,http://127.0.0.1:5000')
if cors_origins == '*' and os.environ.get('FLASK_ENV') == 'production':
    logger.warning('CORS set to * in production - consider restricting!')

socketio = SocketIO(app, cors_allowed_origins=cors_origins, logger=True, engineio_logger=False)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message = None  # Убираем всплывающее сообщение

# Rate limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://",
    headers_enabled=True
)

# WebSocket rate limiting (простой in-memory счетчик)
from collections import defaultdict

websocket_rate_limit = defaultdict(list)
WS_MESSAGE_LIMIT = 30  # сообщений
WS_TIME_WINDOW = 60  # секунд

# Функция для получения текущего UTC времени
def utc_now():
    return datetime.now(timezone.utc)

# Таблица связи многие-ко-многим для участников групп
room_members = db.Table('room_members',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
    db.Column('room_id', db.Integer, db.ForeignKey('room.id', ondelete='CASCADE'), primary_key=True),
    db.Column('joined_at', db.DateTime, default=utc_now)
)

# Модели базы данных
class User(UserMixin, db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    avatar = db.Column(db.String(10), default='👤', nullable=False)  # Эмодзи аватар
    language = db.Column(db.String(2), default='ru', nullable=False)  # 'ru' или 'en'
    created_at = db.Column(db.DateTime, default=utc_now, index=True)
    is_online = db.Column(db.Boolean, default=False, nullable=False)
    last_seen = db.Column(db.DateTime, default=utc_now)
    messages = db.relationship('Message', backref='author', lazy=True, cascade='all, delete-orphan')
    rooms = db.relationship('Room', secondary=room_members, backref=db.backref('members', lazy='dynamic'), lazy='select')
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256')
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def __repr__(self):
        return f'<User {self.username}>'

class Room(db.Model):
    __tablename__ = 'room'
    __table_args__ = (
        db.Index('idx_type_created', 'is_private', 'is_group', 'created_at'),
    )
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, index=True)
    is_private = db.Column(db.Boolean, default=False, nullable=False)  # True для личных чатов
    is_group = db.Column(db.Boolean, default=False, nullable=False)  # True для групп
    created_by = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='SET NULL'), nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now, index=True)
    messages = db.relationship('Message', backref='room', lazy=True, cascade='all, delete-orphan')
    creator = db.relationship('User', foreign_keys=[created_by])
    
    def __repr__(self):
        return f'<Room {self.name}>'

class Message(db.Model):
    __tablename__ = 'message'
    __table_args__ = (
        db.Index('idx_room_timestamp', 'room_id', 'timestamp'),
        db.Index('idx_user_timestamp', 'user_id', 'timestamp'),
    )
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(500), nullable=False)
    timestamp = db.Column(db.DateTime, default=utc_now, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False, index=True)
    room_id = db.Column(db.Integer, db.ForeignKey('room.id', ondelete='CASCADE'), nullable=False, index=True)
    reply_to_id = db.Column(db.Integer, db.ForeignKey('message.id', ondelete='SET NULL'), nullable=True)
    reactions = db.Column(db.Text, default='{}')  # JSON: {"👍": ["user1", "user2"], "❤️": ["user3"]}
    
    reply_to = db.relationship('Message', remote_side=[id], backref='replies')
    
    def __repr__(self):
        return f'<Message {self.id} by User {self.user_id}>'

# Формы
class LoginForm(FlaskForm):
    username = StringField('Имя пользователя', validators=[
        DataRequired(message='Это поле обязательно'),
        Length(min=3, max=50, message='Имя должно быть от 3 до 50 символов')
    ])
    password = PasswordField('Пароль', validators=[
        DataRequired(message='Это поле обязательно'),
        Length(min=6, message='Пароль должен быть минимум 6 символов')
    ])
    submit = SubmitField('Войти')

class RegisterForm(FlaskForm):
    username = StringField('Имя пользователя', validators=[
        DataRequired(message='Это поле обязательно'),
        Length(min=3, max=50, message='Имя должно быть от 3 до 50 символов'),
        Regexp(r'^[a-zA-Z0-9_-]+$', message='Только буквы, цифры, дефис и подчеркивание')
    ])
    password = PasswordField('Пароль', validators=[
        DataRequired(message='Это поле обязательно'),
        Length(min=6, message='Пароль должен быть минимум 6 символов')
    ])
    submit = SubmitField('Зарегистрироваться')
    
    def validate_username(self, username):
        user = User.query.filter_by(username=username.data).first()
        if user:
            raise ValidationError('Это имя пользователя уже занято.')

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

# Вспомогательные функции
def sanitize_message(text):
    """Очистка сообщения от потенциально опасного HTML"""
    return bleach.clean(text, tags=[], strip=True)

def format_timestamp(dt):
    """Форматирование времени для отображения"""
    return dt.strftime('%H:%M')

# Маршруты
@app.route('/')
@login_required
def index():
    # Оптимизированный запрос: получаем все комнаты пользователя
    from sqlalchemy.orm import joinedload
    from translations import get_all_translations
    
    # Публичные комнаты
    public_rooms = Room.query.filter_by(is_private=False, is_group=False)\
        .options(joinedload(Room.creator))\
        .all()
    
    # Комнаты пользователя (приватные и группы) с eager loading
    user_rooms = Room.query.join(room_members)\
        .filter(room_members.c.user_id == current_user.id)\
        .options(joinedload(Room.creator))\
        .all()
    
    # Объединяем и удаляем дубликаты по ID
    all_rooms = list({room.id: room for room in public_rooms + user_rooms}.values())
    all_rooms.sort(key=lambda r: r.created_at, reverse=True)
    
    # Получаем переводы для языка пользователя
    translations = get_all_translations(current_user.language)
    
    # Получаем room_id из параметров запроса для автоматического переключения
    selected_room_id = request.args.get('room', type=int)
    
    return render_template('index.html', rooms=all_rooms, translations=translations, user_lang=current_user.language, selected_room_id=selected_room_id)

@app.route('/profile')
@login_required
def profile_page():
    """Страница профиля пользователя"""
    from translations import get_all_translations
    translations = get_all_translations(current_user.language)
    return render_template('profile.html', translations=translations, user_lang=current_user.language)

@app.route('/create-group')
@login_required
def create_group_page():
    """Страница создания группы"""
    from translations import get_all_translations
    translations = get_all_translations(current_user.language)
    return render_template('create_group.html', translations=translations, user_lang=current_user.language)

@app.route('/create-chat')
@login_required
def create_chat_page():
    """Страница поиска пользователей и создания чата"""
    from translations import get_all_translations
    translations = get_all_translations(current_user.language)
    return render_template('create_chat.html', translations=translations, user_lang=current_user.language)

@app.route('/login', methods=['GET', 'POST'])
@limiter.limit("10 per minute")
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = LoginForm()
    if form.validate_on_submit():
        try:
            user = User.query.filter_by(username=form.username.data).first()
            
            # Защита от timing attacks: всегда проверяем пароль
            if user:
                password_valid = user.check_password(form.password.data)
            else:
                # Фиктивная проверка для одинакового времени ответа
                check_password_hash(
                    'pbkdf2:sha256:260000$dummy$0123456789abcdef',
                    form.password.data
                )
                password_valid = False
            
            if user and password_valid:
                login_user(user)
                logger.info(f'User {user.username} logged in from {get_remote_address()}')
                next_page = request.args.get('next')
                # Защита от open redirect
                if next_page and not next_page.startswith('/'):
                    next_page = None
                return redirect(next_page) if next_page else redirect(url_for('index'))
            else:
                flash('Неверное имя пользователя или пароль', 'error')
                logger.warning(f'Failed login attempt for username: {form.username.data} from {get_remote_address()}')
        except Exception as e:
            logger.error(f'Login error: {str(e)}')
            flash('Произошла ошибка при входе', 'error')
    
    from translations import get_all_translations
    # Определяем язык по умолчанию (можно добавить определение из браузера)
    lang = request.accept_languages.best_match(['ru', 'en']) or 'ru'
    translations = get_all_translations(lang)
    return render_template('login.html', form=form, translations=translations, user_lang=lang)

@app.route('/register', methods=['GET', 'POST'])
@limiter.limit("5 per hour")
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    form = RegisterForm()
    if form.validate_on_submit():
        try:
            user = User(username=form.username.data)
            user.set_password(form.password.data)
            db.session.add(user)
            db.session.commit()
            logger.info(f'New user registered: {user.username} from {get_remote_address()}')
            flash('Регистрация успешна! Теперь вы можете войти.', 'success')
            return redirect(url_for('login'))
        except Exception as e:
            db.session.rollback()
            logger.error(f'Registration error: {str(e)}')
            flash('Произошла ошибка при регистрации', 'error')
    
    from translations import get_all_translations
    # Определяем язык по умолчанию (можно добавить определение из браузера)
    lang = request.accept_languages.best_match(['ru', 'en']) or 'ru'
    translations = get_all_translations(lang)
    return render_template('register.html', form=form, translations=translations, user_lang=lang)

@app.route('/logout')
@login_required
def logout():
    logger.info(f'User {current_user.username} logged out')
    logout_user()
    return redirect(url_for('login'))

@app.route('/api/admin/cleanup-messages', methods=['POST'])
@login_required
def cleanup_messages_endpoint():
    """API endpoint для очистки старых сообщений (только для админов)"""
    # Простая проверка: только первый пользователь может очищать
    if current_user.id != 1:
        return jsonify({'error': 'Access denied'}), 403
    
    try:
        data = request.get_json() or {}
        days = int(data.get('days', 90))
        
        if days < 1:
            return jsonify({'error': 'Days must be at least 1'}), 400
        
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        count = Message.query.filter(Message.timestamp < cutoff_date).count()
        deleted = Message.query.filter(Message.timestamp < cutoff_date).delete()
        db.session.commit()
        
        logger.info(f'Manual cleanup by {current_user.username}: deleted {deleted} messages older than {days} days')
        
        return jsonify({
            'success': True,
            'deleted': deleted,
            'days': days
        })
        
    except Exception as e:
        db.session.rollback()
        logger.error(f'Cleanup error: {str(e)}')
        return jsonify({'error': 'Cleanup failed'}), 500

@app.route('/api/messages/<int:room_id>')
@login_required
@limiter.limit("60 per minute")
def get_messages(room_id):
    """Получение истории сообщений для комнаты"""
    try:
        from sqlalchemy.orm import joinedload
        
        room = Room.query.get_or_404(room_id)
        
        # Проверка доступа к комнате
        if room.is_private or room.is_group:
            if current_user not in room.members:
                return jsonify({'error': 'Access denied'}), 403
        
        page = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 50, type=int), 100)
        
        # Оптимизированный запрос с eager loading автора
        messages = Message.query.filter_by(room_id=room_id)\
            .options(joinedload(Message.author), joinedload(Message.reply_to).joinedload(Message.author))\
            .order_by(Message.timestamp.desc())\
            .limit(per_page)\
            .offset((page - 1) * per_page)\
            .all()
        messages.reverse()
        
        result = []
        for msg in messages:
            # Безопасная обработка reactions JSON
            try:
                reactions_data = json.loads(msg.reactions) if msg.reactions else {}
            except (json.JSONDecodeError, TypeError):
                reactions_data = {}
            
            # Безопасная обработка reply_to
            reply_data = None
            if msg.reply_to:
                reply_data = {
                    'id': msg.reply_to.id,
                    'text': msg.reply_to.text[:50],
                    'user': msg.reply_to.author.username
                }
            
            result.append({
                'id': msg.id,
                'text': msg.text,
                'user': msg.author.username,
                'user_avatar': msg.author.avatar,
                'timestamp': format_timestamp(msg.timestamp),
                'is_own': msg.user_id == current_user.id,
                'reactions': reactions_data,
                'reply_to': reply_data
            })
        
        return jsonify(result)
    except Exception as e:
        logger.error(f'Error fetching messages: {str(e)}')
        return jsonify({'error': 'Failed to fetch messages'}), 500

@app.route('/api/users/search')
@login_required
@limiter.limit("30 per minute")
def search_users():
    """Поиск пользователей по никнейму"""
    try:
        query = request.args.get('q', '').strip()
        
        if not query or len(query) < 2:
            return jsonify({'error': 'Query too short'}), 400
        
        # Санитизация поискового запроса
        query = bleach.clean(query, tags=[], strip=True)
        
        # Поиск пользователей (исключая текущего)
        search_pattern = f'%{query}%'
        users = User.query.filter(
            User.username.ilike(search_pattern),
            User.id != current_user.id
        ).limit(10).all()
        
        return jsonify([{
            'id': user.id,
            'username': user.username
        } for user in users])
    except Exception as e:
        logger.error(f'Error searching users: {str(e)}')
        return jsonify({'error': 'Search failed'}), 500

@app.route('/api/rooms/private/<int:user_id>', methods=['POST'])
@login_required
@limiter.limit("10 per minute")
def create_private_room(user_id):
    """Создание или получение личной комнаты с пользователем"""
    try:
        # Валидация user_id
        if not isinstance(user_id, int) or user_id <= 0:
            return jsonify({'error': 'Invalid user ID'}), 400
        
        other_user = User.query.get(user_id)
        if not other_user:
            return jsonify({'error': 'User not found'}), 404
        
        if other_user.id == current_user.id:
            return jsonify({'error': 'Cannot create chat with yourself'}), 400
        
        # Проверяем, существует ли уже личная комната между этими пользователями
        # Более эффективный запрос через join
        existing_room = Room.query.join(room_members).filter(
            Room.is_private == True,
            room_members.c.user_id.in_([current_user.id, other_user.id])
        ).group_by(Room.id).having(
            db.func.count(room_members.c.user_id) == 2
        ).first()
        
        if existing_room:
            return jsonify({
                'room_id': existing_room.id,
                'room_name': existing_room.name,
                'existed': True
            })
        
        # Создаем новую личную комнату
        room_name = f"{current_user.username} & {other_user.username}"
        room = Room(name=room_name, is_private=True, created_by=current_user.id)
        room.members.append(current_user)
        room.members.append(other_user)
        
        db.session.add(room)
        db.session.commit()
        
        logger.info(f'Private room created between {current_user.username} and {other_user.username}')
        
        return jsonify({
            'room_id': room.id,
            'room_name': room.name,
            'existed': False
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f'Error creating private room: {str(e)}')
        return jsonify({'error': 'Failed to create room'}), 500

@app.route('/api/rooms/group', methods=['POST'])
@login_required
@limiter.limit("5 per minute")
def create_group():
    """Создание групповой комнаты"""
    try:
        data = request.get_json()
        
        if not data or 'name' not in data:
            return jsonify({'error': 'Group name required'}), 400
        
        group_name = sanitize_message(data['name']).strip()
        
        if not group_name or len(group_name) < 3:
            return jsonify({'error': 'Group name too short'}), 400
        
        if len(group_name) > 100:
            return jsonify({'error': 'Group name too long'}), 400
        
        # Создаем группу
        room = Room(name=group_name, is_group=True, created_by=current_user.id)
        room.members.append(current_user)
        
        db.session.add(room)
        db.session.commit()
        
        logger.info(f'Group "{group_name}" created by {current_user.username}')
        
        return jsonify({
            'room_id': room.id,
            'room_name': room.name
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f'Error creating group: {str(e)}')
        return jsonify({'error': 'Failed to create group'}), 500

@app.route('/api/rooms/<int:room_id>/invite', methods=['POST'])
@login_required
@limiter.limit("20 per minute")
def invite_to_room(room_id):
    """Приглашение пользователя в группу"""
    try:
        room = Room.query.get_or_404(room_id)
        
        # Проверяем, что это группа
        if not room.is_group:
            return jsonify({'error': 'Can only invite to groups'}), 400
        
        # Проверяем, что текущий пользователь - участник группы
        if current_user not in room.members:
            return jsonify({'error': 'Access denied'}), 403
        
        data = request.get_json()
        if not data or 'user_id' not in data:
            return jsonify({'error': 'User ID required'}), 400
        
        # Валидация user_id (может быть int или строка из JSON)
        try:
            user_id = int(data['user_id'])
            if user_id <= 0:
                return jsonify({'error': 'Invalid user ID'}), 400
        except (ValueError, TypeError, KeyError):
            return jsonify({'error': 'Invalid user ID'}), 400
        
        user_to_invite = User.query.get(user_id)
        if not user_to_invite:
            return jsonify({'error': 'User not found'}), 404
        
        # Проверяем, не является ли пользователь уже участником
        if user_to_invite in room.members:
            return jsonify({'error': 'User already in group'}), 400
        
        # Проверяем лимит участников группы (максимум 100)
        if len(room.members.all()) >= 100:
            return jsonify({'error': 'Group is full (max 100 members)'}), 400
        
        # Добавляем пользователя в группу
        room.members.append(user_to_invite)
        db.session.commit()
        
        logger.info(f'{current_user.username} invited {user_to_invite.username} to group {room.name}')
        
        # Уведомляем всех в комнате
        socketio.emit('user_invited', {
            'user': user_to_invite.username,
            'invited_by': current_user.username,
            'room_id': room.id
        }, room=str(room_id))
        
        return jsonify({
            'success': True,
            'username': user_to_invite.username
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f'Error inviting user: {str(e)}')
        return jsonify({'error': 'Failed to invite user'}), 500

@app.route('/api/rooms/<int:room_id>/members')
@login_required
@limiter.limit("30 per minute")
def get_room_members(room_id):
    """Получение списка участников комнаты"""
    try:
        room = Room.query.get_or_404(room_id)
        
        # Проверка доступа для приватных комнат и групп
        if room.is_private or room.is_group:
            if current_user not in room.members:
                return jsonify({'error': 'Access denied'}), 403
        
        # Для публичных комнат members может быть пустым, но это нормально
        members = [{
            'id': member.id,
            'username': member.username,
            'avatar': member.avatar,
            'is_creator': member.id == room.created_by
        } for member in room.members]
        
        return jsonify({
            'room_id': room.id,
            'room_name': room.name,
            'is_group': room.is_group,
            'members': members
        })
    except Exception as e:
        logger.error(f'Error fetching members: {str(e)}')
        return jsonify({'error': 'Failed to fetch members'}), 500

@app.route('/api/profile', methods=['GET'])
@login_required
def get_profile():
    """Получение профиля текущего пользователя"""
    try:
        return jsonify({
            'id': current_user.id,
            'username': current_user.username,
            'avatar': current_user.avatar,
            'language': current_user.language,
            'created_at': current_user.created_at.isoformat()
        })
    except Exception as e:
        logger.error(f'Error fetching profile: {str(e)}')
        return jsonify({'error': 'Failed to fetch profile'}), 500

@app.route('/api/profile/avatar', methods=['PUT'])
@login_required
@limiter.limit("10 per minute")
def update_avatar():
    """Обновление аватара пользователя"""
    try:
        data = request.get_json()
        
        if not data or 'avatar' not in data:
            return jsonify({'error': 'Avatar required'}), 400
        
        avatar = data['avatar'].strip()
        
        # Проверка, что это один эмодзи (максимум 10 символов для поддержки составных эмодзи)
        if not avatar or len(avatar) > 10:
            return jsonify({'error': 'Invalid avatar'}), 400
        
        current_user.avatar = avatar
        db.session.commit()
        
        logger.info(f'User {current_user.username} updated avatar')
        
        return jsonify({
            'success': True,
            'avatar': current_user.avatar
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f'Error updating avatar: {str(e)}')
        return jsonify({'error': 'Failed to update avatar'}), 500

@app.route('/api/profile/username', methods=['PUT'])
@login_required
@limiter.limit("5 per minute")
def update_username():
    """Обновление имени пользователя"""
    try:
        data = request.get_json()
        
        if not data or 'username' not in data:
            return jsonify({'error': 'Username required'}), 400
        
        new_username = sanitize_message(data['username']).strip()
        
        # Валидация
        if not new_username or len(new_username) < 3 or len(new_username) > 50:
            return jsonify({'error': 'Username must be 3-50 characters'}), 400
        
        # Проверка формата (только буквы, цифры, дефис и подчеркивание)
        if not re.match(r'^[a-zA-Z0-9_-]+$', new_username):
            return jsonify({'error': 'Invalid username format'}), 400
        
        # Проверка уникальности
        existing_user = User.query.filter_by(username=new_username).first()
        if existing_user and existing_user.id != current_user.id:
            return jsonify({'error': 'Username already taken'}), 400
        
        old_username = current_user.username
        current_user.username = new_username
        db.session.commit()
        
        logger.info(f'User {old_username} changed username to {new_username}')
        
        return jsonify({
            'success': True,
            'username': current_user.username
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f'Error updating username: {str(e)}')
        return jsonify({'error': 'Failed to update username'}), 500

@app.route('/api/profile/language', methods=['PUT'])
@login_required
@limiter.limit("20 per minute")
def update_language():
    """Обновление языка интерфейса"""
    try:
        data = request.get_json()
        
        if not data or 'language' not in data:
            return jsonify({'error': 'Language required'}), 400
        
        language = data['language'].strip().lower()
        
        # Проверка поддерживаемых языков
        if language not in ['ru', 'en']:
            return jsonify({'error': 'Unsupported language'}), 400
        
        current_user.language = language
        db.session.commit()
        
        logger.info(f'User {current_user.username} changed language to {language}')
        
        return jsonify({
            'success': True,
            'language': current_user.language
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f'Error updating language: {str(e)}')
        return jsonify({'error': 'Failed to update language'}), 500

@app.route('/api/messages/<int:message_id>/react', methods=['POST'])
@login_required
@limiter.limit("60 per minute")
def react_to_message(message_id):
    """Добавление/удаление реакции на сообщение"""
    try:
        import json
        
        message = Message.query.get_or_404(message_id)
        
        # Проверка доступа к комнате
        room = Room.query.get(message.room_id)
        if (room.is_private or room.is_group) and current_user not in room.members:
            return jsonify({'error': 'Access denied'}), 403
        
        data = request.get_json()
        if not data or 'emoji' not in data:
            return jsonify({'error': 'Emoji required'}), 400
        
        emoji = data['emoji'].strip()
        if not emoji or len(emoji) > 10:
            return jsonify({'error': 'Invalid emoji'}), 400
        
        # Парсим текущие реакции с обработкой ошибок
        try:
            reactions = json.loads(message.reactions) if message.reactions else {}
        except (json.JSONDecodeError, TypeError):
            reactions = {}
        
        # Добавляем или удаляем реакцию
        if emoji not in reactions:
            reactions[emoji] = []
        
        if current_user.username in reactions[emoji]:
            reactions[emoji].remove(current_user.username)
            if not reactions[emoji]:
                del reactions[emoji]
        else:
            reactions[emoji].append(current_user.username)
        
        message.reactions = json.dumps(reactions)
        db.session.commit()
        
        # Уведомляем всех в комнате
        socketio.emit('message_reaction', {
            'message_id': message_id,
            'reactions': reactions
        }, room=str(message.room_id))
        
        return jsonify({
            'success': True,
            'reactions': reactions
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f'Error reacting to message: {str(e)}')
        return jsonify({'error': 'Failed to react'}), 500

@app.route('/api/users/online')
@login_required
@limiter.limit("30 per minute")
def get_online_users():
    """Получение списка онлайн пользователей"""
    try:
        online_users = User.query.filter_by(is_online=True).all()
        return jsonify([{
            'id': user.id,
            'username': user.username,
            'avatar': user.avatar
        } for user in online_users])
    except Exception as e:
        logger.error(f'Error fetching online users: {str(e)}')
        return jsonify({'error': 'Failed to fetch online users'}), 500

@app.route('/api/translations/<lang>')
def get_translations(lang):
    """Получение переводов для языка"""
    try:
        from translations import get_all_translations
        
        if lang not in ['ru', 'en']:
            lang = 'ru'
        
        return jsonify(get_all_translations(lang))
    except Exception as e:
        logger.error(f'Error fetching translations: {str(e)}')
        return jsonify({'error': 'Failed to fetch translations'}), 500

# WebSocket события
@socketio.on('connect')
def handle_connect(auth=None):
    if current_user.is_authenticated:
        logger.info(f'User {current_user.username} connected via WebSocket')
        
        # Обновляем статус онлайн
        current_user.is_online = True
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        
        # Уведомляем всех об онлайн статусе (broadcast заменен на to=None)
        socketio.emit('user_status', {
            'user_id': current_user.id,
            'username': current_user.username,
            'is_online': True
        }, to=None)
        
        emit('connection_status', {'status': 'connected', 'user': current_user.username})
    else:
        logger.warning('Unauthenticated connection attempt')
        return False

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        logger.info(f'User {current_user.username} disconnected')
        
        # Обновляем статус оффлайн
        current_user.is_online = False
        current_user.last_seen = datetime.now(timezone.utc)
        db.session.commit()
        
        # Уведомляем всех об оффлайн статусе (broadcast заменен на to=None)
        socketio.emit('user_status', {
            'user_id': current_user.id,
            'username': current_user.username,
            'is_online': False,
            'last_seen': format_timestamp(current_user.last_seen)
        }, to=None)

@socketio.on('join_room')
def handle_join_room(data):
    if not current_user.is_authenticated:
        return
    
    try:
        room_id = data.get('room_id')
        if not isinstance(room_id, int) or room_id <= 0:
            logger.warning(f'Invalid room_id in join_room from {current_user.username}')
            return
        
        room = Room.query.get(room_id)
        if room:
            # Проверка доступа к приватным комнатам и группам
            if (room.is_private or room.is_group) and current_user not in room.members:
                emit('error', {'message': 'Доступ запрещен'})
                return
            
            join_room(str(room_id))
            logger.info(f'User {current_user.username} joined room {room.name}')
            emit('user_joined', {
                'user': current_user.username,
                'room': room.name
            }, room=str(room_id))
    except Exception as e:
        logger.error(f'Error in join_room: {str(e)}')

@socketio.on('leave_room')
def handle_leave_room(data):
    if not current_user.is_authenticated:
        return
    
    try:
        room_id = data.get('room_id')
        if not isinstance(room_id, int) or room_id <= 0:
            logger.warning(f'Invalid room_id in leave_room from {current_user.username}')
            return
        
        room = Room.query.get(room_id)
        if room:
            leave_room(str(room_id))
            logger.info(f'User {current_user.username} left room {room.name}')
            emit('user_left', {
                'user': current_user.username,
                'room': room.name
            }, room=str(room_id))
    except Exception as e:
        logger.error(f'Error in leave_room: {str(e)}')

def check_websocket_rate_limit(user_id):
    """Проверка rate limit для WebSocket сообщений"""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=WS_TIME_WINDOW)
    
    # Очищаем старые записи
    websocket_rate_limit[user_id] = [
        timestamp for timestamp in websocket_rate_limit[user_id]
        if timestamp > cutoff
    ]
    
    # Проверяем лимит
    if len(websocket_rate_limit[user_id]) >= WS_MESSAGE_LIMIT:
        return False
    
    # Добавляем новую запись
    websocket_rate_limit[user_id].append(now)
    return True

@socketio.on('send_message')
def handle_message(data):
    if not current_user.is_authenticated:
        logger.warning('Unauthenticated message attempt')
        emit('error', {'message': 'Необходима аутентификация'})
        return
    
    # Проверка rate limit
    if not check_websocket_rate_limit(current_user.id):
        logger.warning(f'Rate limit exceeded for user {current_user.username}')
        emit('error', {'message': 'Слишком много сообщений. Подождите немного.'})
        return
    
    try:
        # Валидация данных
        if not isinstance(data, dict) or 'text' not in data or 'room_id' not in data:
            logger.warning(f'Invalid message data from {current_user.username}')
            emit('error', {'message': 'Неверный формат данных'})
            return
        
        room_id = data.get('room_id')
        if not isinstance(room_id, int) or room_id <= 0:
            logger.warning(f'Invalid room_id from {current_user.username}')
            emit('error', {'message': 'Неверный ID комнаты'})
            return
        
        room = Room.query.get(room_id)
        if not room:
            logger.warning(f'Message to non-existent room {room_id}')
            emit('error', {'message': 'Комната не найдена'})
            return
        
        # Проверка доступа к приватным комнатам и группам
        if (room.is_private or room.is_group) and current_user not in room.members:
            emit('error', {'message': 'Доступ запрещен'})
            return
        
        # Очистка и ограничение длины
        max_length = app.config.get('MAX_MESSAGE_LENGTH', 500)
        text = sanitize_message(str(data.get('text', '')))[:max_length]
        
        if not text.strip():
            emit('error', {'message': 'Сообщение не может быть пустым'})
            return
        
        # Получаем reply_to_id если есть (может быть None, int или строка)
        reply_to_id = data.get('reply_to_id')
        if reply_to_id is not None:
            try:
                reply_to_id = int(reply_to_id)
                if reply_to_id <= 0:
                    reply_to_id = None
            except (ValueError, TypeError):
                reply_to_id = None
        
        # Сохранение в базу данных
        message = Message(text=text, user_id=current_user.id, room_id=room_id, reply_to_id=reply_to_id)
        db.session.add(message)
        db.session.commit()
        
        logger.info(f'Message from {current_user.username} in room {room.name}')
        
        # Подготовка данных ответа
        reply_data = None
        if message.reply_to:
            reply_data = {
                'id': message.reply_to.id,
                'text': message.reply_to.text[:50],
                'user': message.reply_to.author.username
            }
        
        # Отправка всем в комнате
        emit('receive_message', {
            'id': message.id,
            'text': text,
            'user': current_user.username,
            'user_avatar': current_user.avatar,
            'timestamp': format_timestamp(message.timestamp),
            'is_own': False,
            'reactions': {},
            'reply_to': reply_data
        }, room=str(room_id), include_self=False)
        
        # Отправка отправителю с флагом is_own
        emit('receive_message', {
            'id': message.id,
            'text': text,
            'user': current_user.username,
            'user_avatar': current_user.avatar,
            'timestamp': format_timestamp(message.timestamp),
            'is_own': True,
            'reactions': {},
            'reply_to': reply_data
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f'Error handling message: {str(e)}')
        emit('error', {'message': 'Ошибка отправки сообщения'})

@socketio.on('typing')
def handle_typing(data):
    if not current_user.is_authenticated:
        return
    
    try:
        room_id = data.get('room_id')
        if not isinstance(room_id, int) or room_id <= 0:
            return
        
        is_typing = bool(data.get('is_typing', False))
        
        emit('user_typing', {
            'user': current_user.username,
            'is_typing': is_typing
        }, room=str(room_id), include_self=False)
    except Exception as e:
        logger.error(f'Error in typing handler: {str(e)}')

# Обработчики ошибок
@app.after_request
def set_security_headers(response):
    """Установка заголовков безопасности"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    # Content Security Policy
    csp = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "font-src 'self' data:; "
        "connect-src 'self' ws: wss:; "
        "frame-ancestors 'none';"
    )
    response.headers['Content-Security-Policy'] = csp
    
    # Кэширование статических файлов
    if request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'public, max-age=31536000'
    
    # HSTS только для продакшена
    if os.environ.get('FLASK_ENV') == 'production':
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    
    return response

@app.errorhandler(404)
def not_found_error(error):
    logger.warning(f'404 error: {request.url}')
    return render_template('base.html'), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    logger.error(f'500 error: {str(error)}')
    return render_template('base.html'), 500

@app.errorhandler(429)
def ratelimit_handler(e):
    logger.warning(f'Rate limit exceeded: {get_remote_address()}')
    return jsonify({'error': 'Слишком много запросов. Попробуйте позже.'}), 429

# Автоматическая очистка старых сообщений
def cleanup_old_messages_auto():
    """Автоматическая очистка сообщений старше заданного срока"""
    try:
        max_message_age_days = int(os.environ.get('MAX_MESSAGE_AGE_DAYS', 0))
        
        if max_message_age_days <= 0:
            return  # Очистка отключена
        
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=max_message_age_days)
        
        deleted = Message.query.filter(Message.timestamp < cutoff_date).delete()
        
        if deleted > 0:
            db.session.commit()
            logger.info(f'Auto-cleanup: deleted {deleted} messages older than {max_message_age_days} days')
        
    except (ValueError, TypeError) as e:
        logger.error(f'Auto-cleanup error: invalid MAX_MESSAGE_AGE_DAYS value - {str(e)}')
    except Exception as e:
        db.session.rollback()
        logger.error(f'Auto-cleanup error: {str(e)}')

# Инициализация базы данных
def init_db():
    with app.app_context():
        try:
            db.create_all()
            logger.info('Database initialized')
            
            # Автоматическая очистка при запуске
            cleanup_old_messages_auto()
            
        except Exception as e:
            logger.error(f'Database initialization error: {str(e)}')
            raise

if __name__ == '__main__':
    from utils import setup_logging, print_startup_banner
    
    # Настройка логирования
    setup_logging(app)
    
    # Инициализация БД
    init_db()
    
    # Параметры запуска
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'False') == 'True'
    
    # Красивый баннер запуска (только в основном процессе)
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not debug:
        print_startup_banner(app, host, port, debug)
    
    # Запуск сервера
    socketio.run(app, host=host, port=port, debug=debug, log_output=False)
