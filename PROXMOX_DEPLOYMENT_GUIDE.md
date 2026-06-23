# Proxmox Deployment Guide

This guide describes a first production deployment for the Signage Management System on one on-premise Proxmox virtual machine using Debian 12, Nginx, Docker, PostgreSQL, Redis, and Cloudflare Tunnel.

## 1. Target Route Structure

Use one public hostname with path-based routing:

- Management portal: `https://signage.bapswest.org/admin`
- Kiosk room display: `https://signage.bapswest.org/<<UNIQUE-ROOM-CODE>>`
- Room preview display: `https://signage.bapswest.org/preview/<<UNIQUE-ROOM-CODE>>`
- API routes: `https://signage.bapswest.org/api`

Cloudflare Tunnel should point `signage.bapswest.org` to local Nginx on the Debian VM.

## 2. Recommended VM Sizing

Production VM:

- 8 vCPU minimum.
- 24 GB RAM minimum, 32 GB recommended.
- 300 GB SSD/NVMe storage minimum, 500 GB recommended.
- VirtIO SCSI disk controller.
- VirtIO network adapter.
- Static internal IP address.
- Proxmox scheduled backups enabled.

Pilot VM:

- 4 vCPU.
- 12 GB RAM.
- 150 GB SSD/NVMe storage.

## 3. Create the Proxmox VM

1. Upload the Debian 12 ISO to Proxmox.
2. Create a new VM.
3. Select Debian 12 as the guest OS.
4. Assign CPU, memory, and storage based on the sizing above.
5. Use VirtIO network and disk options where available.
6. Install Debian 12.
7. Set a static internal IP address.
8. Install OpenSSH server during setup or after first boot.
9. Update the system:

```bash
sudo apt update
sudo apt upgrade -y
```

## 4. Install Base Packages

```bash
sudo apt install -y ca-certificates curl gnupg ufw nginx git unzip
```

Enable basic firewall rules:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Only expose services needed inside the local server. Do not expose PostgreSQL, Redis, Docker, Proxmox, or SSH through Cloudflare public routes.

## 5. Install Docker and Docker Compose

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Optionally allow your admin user to run Docker commands:

```bash
sudo usermod -aG docker $USER
```

Sign out and sign back in after changing Docker group membership.

## 6. Create Application Directories

```bash
sudo mkdir -p /opt/signage
sudo mkdir -p /opt/signage/data/postgres
sudo mkdir -p /opt/signage/data/redis
sudo mkdir -p /opt/signage/uploads
sudo mkdir -p /opt/signage/backups
sudo chown -R $USER:$USER /opt/signage
```

Suggested structure:

```text
/opt/signage
  docker-compose.yml
  .env
  uploads/
  backups/
  data/
    postgres/
    redis/
```

## 7. Create Environment File

Create `/opt/signage/.env`:

```bash
nano /opt/signage/.env
```

Example values:

```env
APP_ENV=production
APP_BASE_URL=https://signage.bapswest.org
DATABASE_URL=postgresql://signage_app:CHANGE_ME@postgres:5432/signage
REDIS_URL=redis://redis:6379
POSTGRES_DB=signage
POSTGRES_USER=signage_app
POSTGRES_PASSWORD=CHANGE_ME
SESSION_SECRET=CHANGE_ME_LONG_RANDOM_VALUE
TWO_FACTOR_ISSUER=BAPS Signage
UPLOAD_DIR=/app/uploads
```

Use long random values for passwords and secrets.

## 8. Create Docker Compose File

Create `/opt/signage/docker-compose.yml`.

This example uses placeholder application images. Replace `your-registry/signage-app:latest` with the real application image after the application is built.

```yaml
services:
  app:
    image: your-registry/signage-app:latest
    restart: unless-stopped
    env_file: .env
    depends_on:
      - postgres
      - redis
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - ./uploads:/app/uploads

  worker:
    image: your-registry/signage-app:latest
    restart: unless-stopped
    command: ["npm", "run", "worker"]
    env_file: .env
    depends_on:
      - postgres
      - redis
    volumes:
      - ./uploads:/app/uploads

  scheduler:
    image: your-registry/signage-app:latest
    restart: unless-stopped
    command: ["npm", "run", "scheduler"]
    env_file: .env
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 30s
      timeout: 10s
      retries: 5

  redis:
    image: redis:7
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - ./data/redis:/data
```

Start the services:

```bash
cd /opt/signage
docker compose up -d
docker compose ps
```

## 9. Configure Nginx

Create `/etc/nginx/sites-available/signage`:

```bash
sudo nano /etc/nginx/sites-available/signage
```

Use this Nginx configuration:

```nginx
server {
    listen 80;
    server_name signage.bapswest.org;

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
sudo ln -s /etc/nginx/sites-available/signage /etc/nginx/sites-enabled/signage
sudo nginx -t
sudo systemctl reload nginx
```

The application should handle these paths internally:

- `/admin`
- `/api`
- `/preview/<<UNIQUE-ROOM-CODE>>`
- `/<<UNIQUE-ROOM-CODE>>`

## 10. Install Cloudflare Tunnel

Install `cloudflared`:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared
```

Authenticate Cloudflare Tunnel:

```bash
cloudflared tunnel login
```

Create the tunnel:

```bash
cloudflared tunnel create signage
```

Find the generated credentials file:

```bash
ls ~/.cloudflared
```

Copy the tunnel credentials file into `/etc/cloudflared`. Replace `TUNNEL_ID.json` with the actual file name:

```bash
sudo cp ~/.cloudflared/TUNNEL_ID.json /etc/cloudflared/TUNNEL_ID.json
sudo chmod 600 /etc/cloudflared/TUNNEL_ID.json
```

Create `/etc/cloudflared/config.yml`:

```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

Example configuration:

```yaml
tunnel: signage
credentials-file: /etc/cloudflared/TUNNEL_ID.json

ingress:
  - hostname: signage.bapswest.org
    service: http://localhost:80
  - service: http_status:404
```

Replace `TUNNEL_ID.json` with the actual credentials file created by Cloudflare.

Create the DNS route:

```bash
cloudflared tunnel route dns signage signage.bapswest.org
```

Install and start the tunnel service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

## 11. Cloudflare Access Recommendations

Protect management routes:

- `https://signage.bapswest.org/admin`
- `https://signage.bapswest.org/preview/*`

Keep kiosk room routes available without Cloudflare login, but use non-guessable room codes.

Do not expose these publicly:

- Proxmox web UI
- SSH
- PostgreSQL
- Redis
- Docker API
- Internal monitoring dashboards unless separately protected

## 12. Real-Time Safety Broadcast Requirements

Instant safety broadcast can work through this setup.

The kiosk page should maintain a live connection to the application using WebSocket or Server-Sent Events. Nginx and Cloudflare Tunnel must allow long-lived connections.

Recommended behavior:

- Use WebSocket or Server-Sent Events for instant broadcast delivery.
- Use kiosk polling every 5 to 10 seconds as fallback.
- Save every broadcast to PostgreSQL before pushing it to kiosks.
- Use Redis to fan out broadcast messages to app instances and connected kiosks.
- Kiosks must switch to Emergency/Safety Broadcast mode immediately after receiving the event.
- Kiosk devices must allow audio autoplay for `https://signage.bapswest.org` so alert sound can play.

## 13. Backups

Create a PostgreSQL backup script at `/opt/signage/backup.sh`:

```bash
nano /opt/signage/backup.sh
```

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd /opt/signage
set -a
source .env
set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p backups

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backups/postgres-$STAMP.sql.gz"
tar -czf "backups/uploads-$STAMP.tar.gz" uploads

find backups -type f -mtime +14 -delete
```

Make it executable:

```bash
chmod +x /opt/signage/backup.sh
```

Add a daily cron job:

```bash
crontab -e
```

Example:

```cron
15 2 * * * /opt/signage/backup.sh >> /opt/signage/backups/backup.log 2>&1
```

Also configure Proxmox VM backups and keep an offsite backup copy.

## 14. Production and Staging on One Server

Production and staging/test can run on the same Proxmox VM if they are isolated carefully.

Recommended route structure:

- Production: `https://signage.bapswest.org`
- Staging: `https://signage.bapswest.org/staging` or a separate hostname such as `https://staging-signage.bapswest.org`

Recommended isolation:

- Separate Docker Compose project names.
- Separate environment files.
- Separate PostgreSQL databases.
- Separate Redis instances or Redis key prefixes.
- Separate upload folders.
- Separate Nginx routes.
- Separate backup folders.

Example folder layout:

```text
/opt/signage
  production/
    docker-compose.yml
    .env
    uploads/
    backups/
  staging/
    docker-compose.yml
    .env
    uploads/
    backups/
```

Example startup commands:

```bash
cd /opt/signage/production
docker compose -p signage-prod up -d

cd /opt/signage/staging
docker compose -p signage-staging up -d
```

Staging should never share the production database. Test emergency broadcasts in staging before deploying related changes to production.

## 15. Updates

Git upload and server pull instructions are documented in `GIT_WORKFLOW_GUIDE.md`.

Update application containers:

```bash
cd /opt/signage
docker compose pull
docker compose up -d
docker compose ps
```

Check logs:

```bash
docker compose logs -f app
docker compose logs -f worker
docker compose logs -f scheduler
```

## 16. Health Checks

Verify after deployment:

- `https://signage.bapswest.org/admin` loads the management portal.
- `https://signage.bapswest.org/api/health` returns healthy status.
- `https://signage.bapswest.org/preview/<<UNIQUE-ROOM-CODE>>` loads after login.
- `https://signage.bapswest.org/<<UNIQUE-ROOM-CODE>>` loads the kiosk display.
- Calendar sync worker is running.
- Scheduler is running.
- Emergency/Safety Broadcast reaches a test kiosk.
- Alert sound plays on the test kiosk device.
- Daily database backup is created.
- Proxmox VM backup completes successfully.

## 17. Recovery Checklist

If the VM must be rebuilt:

1. Create a new Debian 12 VM.
2. Install Docker, Nginx, and Cloudflare Tunnel.
3. Restore `/opt/signage`.
4. Restore PostgreSQL data from the latest backup if needed.
5. Restore uploads and branding assets.
6. Restore Nginx and Cloudflare Tunnel configuration.
7. Start Docker Compose services.
8. Verify public routes and emergency broadcast delivery.
