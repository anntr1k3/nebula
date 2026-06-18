# Nebula Messenger

[Русская версия](README.ru.md)

Nebula is a web messenger built with Flask, Flask-SocketIO, MySQL, Redis, and a static HTML/CSS/JavaScript frontend.

The project includes user authentication, private and group chats, message reactions, pinned messages, read state, drafts, scheduled messages, profile settings, media uploads, moderation tools, and optional AI-assisted message editing.

## Stack

- Python 3.10+
- Flask
- Flask-SocketIO
- MySQL
- Redis
- HTML, CSS, JavaScript

## Repository Structure

```text
src/                  Flask application, routes, socket handlers, services
static/               Frontend assets
infra/db/init.sql     MySQL schema
scripts/start.bat     Windows development startup script
scripts/clean.bat     Local cleanup helper
docs/deploy.md        Server deployment guide
```

## Local Development

### Windows

1. Install Python 3.10 or newer.
2. Install and start MySQL.
3. Install and start Redis if you want shared token/rate-limit storage.
4. Create the database and schema:

```sql
CREATE DATABASE nebula CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE nebula;
SOURCE infra/db/init.sql;
```

5. Copy the environment example:

```powershell
copy .env.example .env
```

6. Edit `.env` and set database credentials, `SECRET_KEY`, and optional AI settings.
7. Start the app:

```powershell
scripts\start.bat
```

The development server opens at `http://127.0.0.1:5000`.

### Manual Start

```powershell
python -m venv venv
venv\Scripts\activate
python -m pip install -U pip
python -m pip install -e .
python src\run.py
```

## Environment Variables

The app reads settings from `.env` and environment variables. Use `.env.example` as the template.

Important variables:

- `SECRET_KEY` - Flask secret key. Set a strong unique value in production.
- `NEBULA_ENV` - `development` or `production`.
- `ALLOWED_ORIGINS` - allowed CORS origins.
- `REDIS_URL` - Redis connection URL, for example `redis://localhost:6379/0`.
- `ALLOW_TOKEN_IN_QUERY` - disabled by default in production unless explicitly enabled.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - MySQL settings.
- `AI_ENABLED`, `AI_API_BASE`, `AI_API_KEY`, `AI_MODEL` - optional AI assistant settings.

Do not commit `.env`. It can contain passwords and API keys.

## Database

The initial MySQL schema is stored in:

```text
infra/db/init.sql
```

The script uses `CREATE TABLE IF NOT EXISTS`, so it can create missing tables. Structural updates for an existing production database should be applied with explicit migration scripts.

## Code Quality

Install development dependencies:

```powershell
python -m pip install -e ".[dev]"
```

Run checks:

```powershell
ruff check src
mypy src
```

The same checks run in GitHub Actions.

## Deployment

See [docs/deploy.md](docs/deploy.md) for a server deployment guide using Git, virtualenv, MySQL, Redis, systemd, and Nginx.

## Screenshots

Screenshots will be added later.

## License

License information has not been selected yet.
