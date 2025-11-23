# -*- coding: utf-8 -*-
"""
Модуль переводов для поддержки русского и английского языков
"""

TRANSLATIONS = {
    'ru': {
        # Общие
        'app_title': 'Nebula Chat',
        'welcome': 'Добро пожаловать',
        'logout': 'Выйти',
        'save': 'Сохранить',
        'cancel': 'Отмена',
        'close': 'Закрыть',
        'delete': 'Удалить',
        'edit': 'Редактировать',
        'search': 'Поиск',
        'loading': 'Загрузка...',
        'error': 'Ошибка',
        'success': 'Успешно',
        
        # Авторизация
        'login': 'Войти',
        'register': 'Зарегистрироваться',
        'username': 'Имя пользователя',
        'password': 'Пароль',
        'login_title': 'Вход',
        'register_title': 'Регистрация',
        'no_account': 'Нет аккаунта?',
        'have_account': 'Уже есть аккаунт?',
        'login_error': 'Неверное имя пользователя или пароль',
        'register_success': 'Регистрация успешна! Теперь вы можете войти.',
        
        # Чат
        'rooms': 'Комнаты',
        'messages': 'Сообщения',
        'type_message': 'Введите сообщение...',
        'send': 'Отправить',
        'typing': 'печатает...',
        'connected': 'Подключено',
        'disconnected': 'Отключено',
        'user_joined': 'присоединился к чату',
        'user_left': 'покинул чат',
        
        # Действия
        'find_users': 'Найти пользователя',
        'create_group': 'Создать группу',
        'invite': 'Пригласить',
        'members': 'Участники',
        'settings': 'Настройки',
        'profile': 'Профиль',
        'change_theme': 'Сменить тему',
        'change_language': 'Сменить язык',
        
        # Поиск и группы
        'search_users': 'Поиск пользователя',
        'search_placeholder': 'Введите никнейм...',
        'create_group_title': 'Создать группу',
        'group_name': 'Название группы',
        'group_name_placeholder': 'Название группы...',
        'invite_to_group': 'Пригласить в группу',
        'members_list': 'Участники',
        'creator': 'Создатель',
        'write': 'Написать',
        'no_results': 'Пользователи не найдены',
        'min_chars': 'Введите минимум 2 символа',
        
        # Профиль
        'edit_profile': 'Редактировать профиль',
        'change_avatar': 'Изменить аватар',
        'change_username': 'Изменить никнейм',
        'current_username': 'Текущий никнейм',
        'new_username': 'Новый никнейм',
        'avatar': 'Аватар',
        'choose_avatar': 'Выберите аватар',
        'profile_updated': 'Профиль обновлен',
        'username_taken': 'Это имя пользователя уже занято',
        'username_invalid': 'Неверный формат имени пользователя',
        
        # Ошибки
        'error_occurred': 'Произошла ошибка',
        'access_denied': 'Доступ запрещен',
        'not_found': 'Не найдено',
        'too_many_requests': 'Слишком много запросов. Попробуйте позже.',
        'message_too_long': 'Сообщение слишком длинное',
        'empty_message': 'Сообщение не может быть пустым',
        
        # Новые функции
        'reply': 'Ответить',
        'reply_to': 'Ответ на',
        'react': 'Реакция',
        'online': 'Онлайн',
        'offline': 'Оффлайн',
        'last_seen': 'Был(а) в сети',
        'back': 'Назад',
        'current_avatar': 'Текущий аватар',
    },
    'en': {
        # General
        'app_title': 'Nebula Chat',
        'welcome': 'Welcome',
        'logout': 'Logout',
        'save': 'Save',
        'cancel': 'Cancel',
        'close': 'Close',
        'delete': 'Delete',
        'edit': 'Edit',
        'search': 'Search',
        'loading': 'Loading...',
        'error': 'Error',
        'success': 'Success',
        
        # Authentication
        'login': 'Login',
        'register': 'Register',
        'username': 'Username',
        'password': 'Password',
        'login_title': 'Login',
        'register_title': 'Registration',
        'no_account': "Don't have an account?",
        'have_account': 'Already have an account?',
        'login_error': 'Invalid username or password',
        'register_success': 'Registration successful! You can now login.',
        
        # Chat
        'rooms': 'Rooms',
        'messages': 'Messages',
        'type_message': 'Type a message...',
        'send': 'Send',
        'typing': 'is typing...',
        'connected': 'Connected',
        'disconnected': 'Disconnected',
        'user_joined': 'joined the chat',
        'user_left': 'left the chat',
        
        # Actions
        'find_users': 'Find User',
        'create_group': 'Create Group',
        'invite': 'Invite',
        'members': 'Members',
        'settings': 'Settings',
        'profile': 'Profile',
        'change_theme': 'Change Theme',
        'change_language': 'Change Language',
        
        # Search and groups
        'search_users': 'Search User',
        'search_placeholder': 'Enter username...',
        'create_group_title': 'Create Group',
        'group_name': 'Group Name',
        'group_name_placeholder': 'Group name...',
        'invite_to_group': 'Invite to Group',
        'members_list': 'Members',
        'creator': 'Creator',
        'write': 'Write',
        'no_results': 'No users found',
        'min_chars': 'Enter at least 2 characters',
        
        # Profile
        'edit_profile': 'Edit Profile',
        'change_avatar': 'Change Avatar',
        'change_username': 'Change Username',
        'current_username': 'Current Username',
        'new_username': 'New Username',
        'avatar': 'Avatar',
        'choose_avatar': 'Choose Avatar',
        'profile_updated': 'Profile updated',
        'username_taken': 'This username is already taken',
        'username_invalid': 'Invalid username format',
        
        # Errors
        'error_occurred': 'An error occurred',
        'access_denied': 'Access denied',
        'not_found': 'Not found',
        'too_many_requests': 'Too many requests. Please try again later.',
        'message_too_long': 'Message is too long',
        'empty_message': 'Message cannot be empty',
        
        # New features
        'reply': 'Reply',
        'reply_to': 'Reply to',
        'react': 'React',
        'online': 'Online',
        'offline': 'Offline',
        'last_seen': 'Last seen',
        'back': 'Back',
        'current_avatar': 'Current Avatar',
    }
}

def get_translation(lang, key):
    """Получить перевод для ключа"""
    return TRANSLATIONS.get(lang, TRANSLATIONS['ru']).get(key, key)

def get_all_translations(lang):
    """Получить все переводы для языка"""
    return TRANSLATIONS.get(lang, TRANSLATIONS['ru'])
