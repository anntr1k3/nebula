# Инструкция По Деплою

[English version](deploy.md)

Эта инструкция описывает базовый production-деплой Nebula на Linux-сервер с Git, Python, MySQL, Redis, systemd и Nginx.

Команды ниже рассчитаны на Ubuntu/Debian и путь проекта `/opt/nebula`.

## 1. Установка Системных Пакетов

```bash
apt update
apt install -y git python3 python3-venv python3-pip mysql-server redis-server nginx
```

Включите сервисы:

```bash
systemctl enable --now mysql
systemctl enable --now redis-server
systemctl enable --now nginx
```

## 2. Клонирование Репозитория

```bash
cd /opt
git clone https://github.com/anntrik3/nebula.git nebula
cd /opt/nebula
```

Для обновлений после первого деплоя:

```bash
cd /opt/nebula
git pull --ff-only
```

## 3. Настройка Python

```bash
cd /opt/nebula
python3 -m venv venv
source venv/bin/activate
python -m pip install -U pip
python -m pip install -e .
python -m pip install gunicorn gevent gevent-websocket
```

`gunicorn`, `gevent` и `gevent-websocket` дают production WSGI-сервер с нативной
поддержкой WebSocket. Без воркера gevent-websocket Socket.IO откатывается на
HTTP long-polling, и в консоли браузера сыплются ошибки `wss://.../socket.io/ failed`.

При следующих обновлениях повторяйте:

```bash
source /opt/nebula/venv/bin/activate
python -m pip install -e .
```

## 4. Настройка MySQL

Откройте MySQL:

```bash
mysql
```

Создайте базу данных и пользователя:

```sql
CREATE DATABASE nebula CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'nebula'@'localhost' IDENTIFIED BY 'change-this-password';
GRANT ALL PRIVILEGES ON nebula.* TO 'nebula'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Примените схему:

```bash
mysql -u nebula -p nebula < /opt/nebula/infra/db/init.sql
```

Файл схемы создает недостающие таблицы. Для уже существующей production-базы будущие изменения структуры лучше хранить как отдельные миграционные скрипты с явными `ALTER TABLE`.

Применяйте миграции проекта после начальной схемы и после обновлений, в которых появились новые файлы в `infra/db/migrations`:

```bash
mysql -u nebula -p nebula < /opt/nebula/infra/db/migrations/001_performance_indexes.sql
```

## 5. Настройка Окружения

```bash
cd /opt/nebula
cp .env.example .env
nano .env
```

Рекомендуемые значения для production:

```env
SECRET_KEY=replace-with-a-long-random-secret
NEBULA_ENV=production
ALLOWED_ORIGINS=https://your-domain.example
NEBULA_SOCKETIO_ASYNC_MODE=gevent
REDIS_URL=redis://localhost:6379/0
ALLOW_TOKEN_IN_QUERY=false

DB_HOST=localhost
DB_PORT=3306
DB_USER=nebula
DB_PASSWORD=change-this-password
DB_NAME=nebula
DB_POOL_SIZE=10

AI_ENABLED=false
AI_API_BASE=https://api.openai.com/v1
AI_API_KEY=
AI_MODEL=gpt-4o-mini
```

Несколько разрешённых origin перечисляйте через запятую без пробелов, например
`ALLOWED_ORIGINS=https://your-domain.example,https://www.your-domain.example`.
Каждое значение должно точно совпадать с `Origin` браузера (схема + хост), иначе
рукопожатие Socket.IO отклоняется с `400 Not an accepted origin`, и сообщения не
отправляются.

Ограничьте доступ к файлу окружения:

```bash
chmod 600 /opt/nebula/.env
```

## 6. Создание systemd-Сервиса

Создайте `/etc/systemd/system/nebula.service`:

```ini
[Unit]
Description=Nebula Messenger
After=network.target mysql.service redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/nebula
Environment=NEBULA_ENV=production
ExecStart=/opt/nebula/venv/bin/gunicorn \
    --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker \
    --workers 1 --bind 127.0.0.1:5000 --pythonpath src wsgi:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Оставляйте `--workers 1`: воркер gevent-websocket обслуживает множество клиентов
параллельно через гринлеты. Для нескольких воркеров нужен `message_queue` (Redis) в
Socket.IO, чтобы события доходили до всех клиентов — здесь он не настроен.

Включите и запустите сервис:

```bash
systemctl daemon-reload
systemctl enable --now nebula
systemctl status nebula --no-pager
```

Логи приложения пишутся в `/opt/nebula/logs/messenger.log`. Логи systemd доступны через:

```bash
journalctl -u nebula -f
```

## 7. Настройка Nginx

Создайте `/etc/nginx/sites-available/nebula`:

```nginx
server {
    listen 80;
    server_name your-domain.example;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:5000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
    }
}
```

Включите сайт:

```bash
ln -s /etc/nginx/sites-available/nebula /etc/nginx/sites-enabled/nebula
nginx -t
systemctl reload nginx
```

Для HTTPS установите Certbot и выпустите сертификат:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.example
```

## 8. Обновление Приложения

Используйте эту последовательность после отправки нового кода на GitHub:

```bash
ssh root@135.106.130.149
cd /opt/nebula
git pull --ff-only
source venv/bin/activate
python -m pip install -e .
mysql -u nebula -p nebula < infra/db/migrations/001_performance_indexes.sql
systemctl restart nebula
systemctl status nebula --no-pager
```

Если изменилась структура базы данных, примените миграцию до перезапуска сервиса.

## 9. Проверка Работы

Проверьте состояние сервиса:

```bash
systemctl status nebula --no-pager
```

Следите за логами:

```bash
journalctl -u nebula -f
tail -f /opt/nebula/logs/messenger.log
```

Проверьте открытые порты:

```bash
ss -tulpn | grep -E ':80|:443|:5000'
```
