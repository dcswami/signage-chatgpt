# Test Environment Deployment Guide

This guide deploys the Signage Management System test environment on the Debian 12 Proxmox server using Nginx, Docker Compose, PostgreSQL, Redis, and Cloudflare Tunnel.

The test environment can run on the same server as production if it uses separate folders, environment files, databases, Redis data, and Nginx routes.

## 1. Test Site

Use this dedicated test hostname:

```text
https://signage-test.bapswest.org
```

The current Node app expects root-based routes such as `/admin`, `/api`, and `/room-code`, so the test environment should use the separate hostname instead of a `/test` subpath:

```text
https://signage-test.bapswest.org/admin
https://signage-test.bapswest.org/room-108-shishu
https://signage-test.bapswest.org/preview/room-108-shishu
https://signage-test.bapswest.org/api/health
```

## 2. Prepare Server Folder

SSH into the Debian 12 VM.

```bash
sudo mkdir -p /opt/signage
sudo chown -R $USER:$USER /opt/signage
cd /opt/signage
```

## 3. Clone Repository

```bash
git clone https://github.com/dcswami/signage-chatgpt.git source
cd /opt/signage/source
```

If the repository already exists:

```bash
cd /opt/signage/source
git pull origin main
```

## 4. Create Test Environment File

```bash
cp .env.example .env
nano .env
```

Recommended test values:

```env
APP_ENV=test
APP_BASE_URL=https://signage-test.bapswest.org
HOST=0.0.0.0
PORT=3000
POSTGRES_DB=signage_test
POSTGRES_USER=signage_app
POSTGRES_PASSWORD=CHANGE_ME_TEST_PASSWORD
REDIS_URL=redis://redis:6379
SESSION_SECRET=CHANGE_ME_LONG_RANDOM_TEST_SECRET
TWO_FACTOR_ISSUER=BAPS Signage Test
```

Use strong random values for passwords and secrets.

## 5. Start Test Containers

```bash
docker compose -f docker-compose.test.yml -p signage-test up -d --build
docker compose -f docker-compose.test.yml -p signage-test ps
```

The test app listens locally on:

```text
http://127.0.0.1:3000
```

## 6. Configure Nginx for Test Hostname

Create an Nginx site:

```bash
sudo nano /etc/nginx/sites-available/signage-test
```

Use this configuration:

```nginx
server {
    listen 80;
    server_name signage-test.bapswest.org;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/signage-test /etc/nginx/sites-enabled/signage-test
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Configure Cloudflare Tunnel

Add a test hostname route to the existing Cloudflare Tunnel config:

```yaml
ingress:
  - hostname: signage-test.bapswest.org
    service: http://localhost:80
  - hostname: signage.bapswest.org
    service: http://localhost:80
  - service: http_status:404
```

Create the DNS route:

```bash
cloudflared tunnel route dns signage signage-test.bapswest.org
```

Restart the tunnel:

```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared
```

## 8. Verify Test Environment

Open:

```text
https://signage-test.bapswest.org/admin
```

Check health:

```bash
curl https://signage-test.bapswest.org/api/health
```

Check kiosk pages:

```text
https://signage-test.bapswest.org/room-108-shishu
https://signage-test.bapswest.org/room-205-gujarati
https://signage-test.bapswest.org/room-301-assembly
```

Check preview:

```text
https://signage-test.bapswest.org/preview/room-108-shishu
```

In the admin portal:

1. Change a room to Available, Busy, and Buffer/Warning.
2. Open the kiosk page in another browser tab.
3. On the real kiosk page, tap **Enable Alert Sound** once if the button is visible.
4. Confirm the kiosk updates automatically.
5. Publish a test Emergency/Safety Broadcast.
6. Confirm the kiosk switches to broadcast mode.
7. Confirm the real kiosk page plays the alert sound.
8. Confirm the admin portal preview stays silent.
9. End the broadcast.

## 9. Pull Updates Later

```bash
cd /opt/signage/source
git pull origin main
docker compose -f docker-compose.test.yml -p signage-test up -d --build
docker compose -f docker-compose.test.yml -p signage-test ps
```

## 10. Stop Test Environment

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-test down
```

To remove all test data as well:

```bash
docker compose -f docker-compose.test.yml -p signage-test down -v
```

Only use `down -v` when you intentionally want to delete the test database and Redis data.

## 11. Notes

- The current test app is a runnable MVP scaffold using local JSON persistence for fast review.
- PostgreSQL and Redis are included in the test Compose stack so the environment matches the intended production architecture.
- `database/schema.sql` contains the PostgreSQL schema for the database-backed version.
- Management login and full database persistence are the next implementation layer after this runnable scaffold.
