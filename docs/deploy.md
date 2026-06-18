# Deployment Guide

This guide describes a basic production deployment for Nebula on a Linux server with Git, Python, MySQL, Redis, systemd, and Nginx.

Commands below assume Ubuntu/Debian and the project path `/opt/nebula`.

## 1. Install System Packages

```bash
apt update
apt install -y git python3 python3-venv python3-pip mysql-server redis-server nginx
```

Enable services:

```bash
systemctl enable --now mysql
systemctl enable --now redis-server
systemctl enable --now nginx
```

## 2. Clone the Repository

```bash
cd /opt
git clone https://github.com/anntrik3/nebula.git nebula
cd /opt/nebula
```

For updates after the first deployment:

```bash
cd /opt/nebula
git pull --ff-only
```

## 3. Configure Python

```bash
cd /opt/nebula
python3 -m venv venv
source venv/bin/activate
python -m pip install -U pip
python -m pip install -e .
```

For later updates, rerun:

```bash
source /opt/nebula/venv/bin/activate
python -m pip install -e .
```

## 4. Configure MySQL

Open MySQL:

```bash
mysql
```

Create the database and user:

```sql
CREATE DATABASE nebula CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'nebula'@'localhost' IDENTIFIED BY 'change-this-password';
GRANT ALL PRIVILEGES ON nebula.* TO 'nebula'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Apply the schema:

```bash
mysql -u nebula -p nebula < /opt/nebula/infra/db/init.sql
```

The schema file creates missing tables. For existing production databases, keep future schema changes as explicit `ALTER TABLE` migration scripts.

## 5. Configure Environment

```bash
cd /opt/nebula
cp .env.example .env
nano .env
```

Recommended production values:

```env
SECRET_KEY=replace-with-a-long-random-secret
NEBULA_ENV=production
ALLOWED_ORIGINS=https://your-domain.example
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

Protect the environment file:

```bash
chmod 600 /opt/nebula/.env
```

## 6. Create a systemd Service

Create `/etc/systemd/system/nebula.service`:

```ini
[Unit]
Description=Nebula Messenger
After=network.target mysql.service redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/nebula
Environment=NEBULA_ENV=production
ExecStart=/opt/nebula/venv/bin/python /opt/nebula/src/run.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
systemctl daemon-reload
systemctl enable --now nebula
systemctl status nebula --no-pager
```

Application logs are written to `/opt/nebula/logs/messenger.log`. systemd logs are available through:

```bash
journalctl -u nebula -f
```

## 7. Configure Nginx

Create `/etc/nginx/sites-available/nebula`:

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
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:5000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

Enable the site:

```bash
ln -s /etc/nginx/sites-available/nebula /etc/nginx/sites-enabled/nebula
nginx -t
systemctl reload nginx
```

For HTTPS, install Certbot and issue a certificate:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.example
```

## 8. Update the Application

Use this sequence after pushing new code to GitHub:

```bash
ssh root@135.106.130.149
cd /opt/nebula
git pull --ff-only
source venv/bin/activate
python -m pip install -e .
systemctl restart nebula
systemctl status nebula --no-pager
```

If database structure changed, apply the migration before restarting the service.

## 9. Health Checks

Check service state:

```bash
systemctl status nebula --no-pager
```

Follow logs:

```bash
journalctl -u nebula -f
tail -f /opt/nebula/logs/messenger.log
```

Check open ports:

```bash
ss -tulpn | grep -E ':80|:443|:5000'
```
