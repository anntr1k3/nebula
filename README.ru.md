# Nebula Messenger

[English version](README.md)

Nebula - веб-мессенджер на Flask, Flask-SocketIO, MySQL, Redis и статическом frontend на HTML/CSS/JavaScript.

Проект включает регистрацию и авторизацию пользователей, личные и групповые чаты, реакции на сообщения, закрепленные сообщения, статусы прочтения, черновики, отложенные сообщения, настройки профиля, загрузку медиафайлов, инструменты модерации и опциональное AI-редактирование сообщений.

## Стек

- Python 3.10+
- Flask
- Flask-SocketIO
- MySQL
- Redis
- HTML, CSS, JavaScript

## Структура Репозитория

```text
src/                  Flask-приложение, маршруты, Socket.IO-обработчики, сервисы
static/               Frontend-ресурсы
infra/db/init.sql     MySQL-схема
scripts/start.bat     Скрипт запуска для разработки на Windows
scripts/clean.bat     Локальный скрипт очистки
docs/deploy.md        Инструкция по деплою на сервер
```

## Локальная Разработка

### Windows

1. Установите Python 3.10 или новее.
2. Установите и запустите MySQL.
3. Установите и запустите Redis, если нужно общее хранилище токенов и лимитов.
4. Создайте базу данных и примените схему:

```sql
CREATE DATABASE nebula CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE nebula;
SOURCE infra/db/init.sql;
```

5. Скопируйте пример окружения:

```powershell
copy .env.example .env
```

6. Отредактируйте `.env`: укажите доступы к базе данных, `SECRET_KEY` и опциональные AI-настройки.
7. Запустите приложение:

```powershell
scripts\start.bat
```

Сервер разработки откроется по адресу `http://127.0.0.1:5000`.

### Ручной Запуск

```powershell
python -m venv venv
venv\Scripts\activate
python -m pip install -U pip
python -m pip install -e .
python src\run.py
```

## Переменные Окружения

Приложение читает настройки из `.env` и переменных окружения. Используйте `.env.example` как шаблон.

Важные переменные:

- `SECRET_KEY` - секретный ключ Flask. В production укажите надежное уникальное значение.
- `NEBULA_ENV` - `development` или `production`.
- `ALLOWED_ORIGINS` - разрешенные CORS origin.
- `REDIS_URL` - URL подключения к Redis, например `redis://localhost:6379/0`.
- `ALLOW_TOKEN_IN_QUERY` - в production отключено по умолчанию, если явно не включить.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - настройки MySQL.
- `AI_ENABLED`, `AI_API_BASE`, `AI_API_KEY`, `AI_MODEL` - опциональные настройки AI-ассистента.

Не коммитьте `.env`. В нем могут быть пароли и API-ключи.

## База Данных

Начальная MySQL-схема находится здесь:

```text
infra/db/init.sql
```

Скрипт использует `CREATE TABLE IF NOT EXISTS`, поэтому может создать недостающие таблицы. Для изменения структуры уже существующей production-базы лучше использовать отдельные миграционные скрипты с явными `ALTER TABLE`.

Обновления производительности и структуры для существующих баз данных хранятся здесь:

```text
infra/db/migrations/
```

## Качество Кода

Установите зависимости для разработки:

```powershell
python -m pip install -e ".[dev]"
```

Запустите проверки:

```powershell
ruff check src
mypy src
```

Эти же проверки запускаются в GitHub Actions.

## Деплой

См. [docs/deploy.ru.md](docs/deploy.ru.md) - инструкцию по деплою на сервер с Git, virtualenv, MySQL, Redis, systemd и Nginx.

## Скриншоты

Скриншоты будут добавлены позже.

## Лицензия

Лицензия пока не выбрана.
