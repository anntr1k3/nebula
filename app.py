import os
import logging
from datetime import datetime
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
from dotenv import load_dotenv
from config import config

# Загрузка переменных окружения
load_dotenv()

logger = logging.getLogger(__name__)

# Инициализация приложения
app = Flask(__name__)

# Загрузка конфигурации
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
login_manager.login_message = 'Пожалуйста, войдите для доступа к этой странице.'

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
from datetime import datetime, timedelta

websocket_rate_limit = defaultdict(list)
WS_MESSAGE_LIMIT = 30  # сообщений
WS_TIME_WINDOW = 60  # секунд

# Таблица связи многие-ко-многим для участников групп
room_members = db.Table('room_members',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
    db.Column('room_id', db.Integer, db.ForeignKey('room.id', ondelete='CASCADE'), primary_key=True),
    db.Column('joined_at', db.DateTime, default=datetime.utcnow)
)

# Модели базы данных
class User(UserMixin, db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
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
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False, index=True)
    room_id = db.Column(db.Integer, db.ForeignKey('room.id', ondelete='CASCADE'), nullable=False, index=True)
    
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
    
    return render_template('index.html', rooms=all_rooms)

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
    
    return render_template('login.html', form=form)

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
    
    return render_template('register.html', form=form)

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
        
        from datetime import timedelta, datetime
        cutoff_date = datetime.now(datetime.UTC) - timedelta(days=days)
        
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
            .options(joinedload(Message.author))\
            .order_by(Message.timestamp.desc())\
            .limit(per_page)\
            .offset((page - 1) * per_page)\
            .all()
        messages.reverse()
        
        return jsonify([{
            'id': msg.id,
            'text': msg.text,
            'user': msg.author.username,
            'timestamp': format_timestamp(msg.timestamp),
            'is_own': msg.user_id == current_user.id
        } for msg in messages])
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
        existing_room = Room.query.filter(
            Room.is_private,
            Room.members.any(User.id == current_user.id),
            Room.members.any(User.id == other_user.id)
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
        
        # Валидация user_id
        user_id = data['user_id']
        if not isinstance(user_id, int) or user_id <= 0:
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
        
        # Проверка доступа
        if (room.is_private or room.is_group) and current_user not in room.members:
            return jsonify({'error': 'Access denied'}), 403
        
        members = [{
            'id': member.id,
            'username': member.username,
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

# WebSocket события
@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        logger.info(f'User {current_user.username} connected via WebSocket')
        emit('connection_status', {'status': 'connected', 'user': current_user.username})
    else:
        logger.warning('Unauthenticated connection attempt')
        return False

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        logger.info(f'User {current_user.username} disconnected')

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
    now = datetime.now(datetime.UTC)
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
        max_length = app.config.get('MAX_MESSAGE_LENGTH', 1000)  # значение по умолчанию 1000
        text = sanitize_message(str(data.get('text', '')))[:max_length]
        
        if not text.strip():
            emit('error', {'message': 'Сообщение не может быть пустым'})
            return
        
        # Сохранение в базу данных
        message = Message(text=text, user_id=current_user.id, room_id=room_id)
        db.session.add(message)
        db.session.commit()
        
        logger.info(f'Message from {current_user.username} in room {room.name}')
        
        # Отправка всем в комнате
        emit('receive_message', {
            'id': message.id,
            'text': text,
            'user': current_user.username,
            'timestamp': format_timestamp(message.timestamp),
            'is_own': False
        }, room=str(room_id), include_self=False)
        
        # Отправка отправителю с флагом is_own
        emit('receive_message', {
            'id': message.id,
            'text': text,
            'user': current_user.username,
            'timestamp': format_timestamp(message.timestamp),
            'is_own': True
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
        
        from datetime import timedelta, datetime
        cutoff_date = datetime.now(datetime.UTC) - timedelta(days=max_message_age_days)
        
        deleted = Message.query.filter(Message.timestamp < cutoff_date).delete()
        
        if deleted > 0:
            db.session.commit()
            logger.info(f'Auto-cleanup: deleted {deleted} messages older than {max_message_age_days} days')
        
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
    from utils import setup_logging
    
    # Настройка логирования
    setup_logging(app)
    
    # Инициализация БД
    init_db()
    
    # Параметры запуска
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'False') == 'True'
    
    logger.info(f'Starting Nebula Chat on {host}:{port}')
    logger.info(f'Debug mode: {debug}')
    socketio.run(app, host=host, port=port, debug=debug)
