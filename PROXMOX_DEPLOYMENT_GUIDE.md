# Proxmox Deployment Guide

This guide deploys the Signage Management System on two on-premises Proxmox servers using Debian 12, Docker Compose, Nginx, and Cloudflare Tunnels.

The deployment has two separate server environments:

- Test server: `signage-test.bapswest.org`
- Production server: `signage.bapswest.org`

The current application includes the admin portal, kiosk pages, preview pages, live kiosk refresh, emergency broadcast display, location and room management, dashboard controls, sample themes, and deployment files. PostgreSQL is the primary application data store. Redis is included for future multi-instance broadcast fan-out and background jobs.

## 1. Route Structure

Use separate public hostnames for test and production.

Test environment:

```text
Management portal: https://signage-test.bapswest.org/admin
Kiosk page:        https://signage-test.bapswest.org/<<UNIQUE-ROOM-CODE>>
Preview page:      https://signage-test.bapswest.org/preview/<<UNIQUE-ROOM-CODE>>
API routes:        https://signage-test.bapswest.org/api
Health check:      https://signage-test.bapswest.org/api/health
```

Production environment:

```text
Management portal: https://signage.bapswest.org/admin
Kiosk page:        https://signage.bapswest.org/<<UNIQUE-ROOM-CODE>>
Preview page:      https://signage.bapswest.org/preview/<<UNIQUE-ROOM-CODE>>
API routes:        https://signage.bapswest.org/api
Health check:      https://signage.bapswest.org/api/health
```

Example test room route included in the seed data:

```text
https://signage-test.bapswest.org/room-108-shishu
```

Example production room routes included in the seed data:

```text
https://signage.bapswest.org/room-108-shishu
https://signage.bapswest.org/room-205-gujarati
https://signage.bapswest.org/room-301-assembly
```

Use separate Cloudflare Tunnels for test and production. Each tunnel runs on its matching server and sends traffic to local Nginx on that server.

## 2. Recommended VM Sizing

Pilot or test VM:

- 4 vCPU.
- 8 to 12 GB RAM.
- 100 to 150 GB SSD/NVMe storage.
- VirtIO SCSI disk controller.
- VirtIO network adapter.
- Static internal IP address.
- Proxmox scheduled backups enabled.

Production VM for 10 to 12 centers:

- 8 vCPU minimum.
- 24 GB RAM minimum, 32 GB recommended.
- 300 GB SSD/NVMe storage minimum, 500 GB recommended.
- VirtIO SCSI disk controller.
- VirtIO network adapter.
- Static internal IP address.
- Proxmox scheduled backups enabled.

## 3. Create the Proxmox Servers

1. Upload the Debian 12 ISO to Proxmox.
2. Create one VM for the test server.
3. Create one VM for the production server.
4. Select Debian 12 as the guest OS.
5. Assign CPU, memory, and storage based on the sizing above.
6. Use VirtIO network and disk options where available.
7. Install Debian 12.
8. Set a static internal IP address.
9. Install OpenSSH server during setup or after first boot.
10. Update Debian:

```bash
sudo apt update
sudo apt upgrade -y
sudo reboot
```

After reboot, SSH back into each server.

### Fix Debian DVD/CD-ROM Apt Source Error

If `sudo apt update` shows an error like this:

```text
E: The repository 'cdrom://[Debian GNU/Linux 12.x.x _Bookworm_ ...] bookworm Release' does not have a Release file.
```

Debian still has the installer DVD/CD-ROM listed as a package source. Disable that source and use the normal online Debian repositories.

Open the apt source list:

```bash
sudo nano /etc/apt/sources.list
```

Find the line that starts with `deb cdrom:` and comment it out by adding `#` at the beginning:

```text
# deb cdrom:[Debian GNU/Linux 12.x.x _Bookworm_ ...] bookworm main non-free-firmware
```

Make sure these Debian 12 repositories exist in the same file:

```text
deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
```

Save the file, then run:

```bash
sudo apt update
sudo apt upgrade -y
```

## 4. Install Base Packages

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg ufw nginx git unzip nano
```

Enable firewall rules:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

### UFW Troubleshooting

If `systemctl status ufw` shows `inactive` or `dead`, first check UFW itself:

```bash
sudo ufw status verbose
```

On Debian, `ufw.service` can appear as stopped after it loads firewall rules because it is not a long-running background service. The important result is the `sudo ufw status verbose` output.

If UFW is inactive, allow SSH before enabling it so you do not lock yourself out:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status verbose
```

If the package install output ends with `bash: E: command not found`, the install usually completed and an error line was accidentally pasted into the shell. Confirm the packages are installed:

```bash
dpkg -l ca-certificates curl gnupg ufw nginx git unzip nano
```

Each package should show `ii` in the first column.

Do not expose PostgreSQL, Redis, Docker, Proxmox, or SSH through public Cloudflare routes.

## 5. Install Docker and Docker Compose

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Allow your admin user to run Docker commands:

```bash
sudo usermod -aG docker $USER
```

Sign out and sign back in after changing Docker group membership.

Verify Docker:

```bash
docker --version
docker compose version
```

## 6. Create Application Folder

Run this section on both the test server and the production server.

```bash
sudo mkdir -p /opt/signage
sudo chown -R $USER:$USER /opt/signage
cd /opt/signage
```

Clone the project:

```bash
git clone https://github.com/dcswami/signage-chatgpt.git source
cd /opt/signage/source
```

If the folder already exists, update it instead:

```bash
cd /opt/signage/source
git pull origin main
```

## 7. Configure Environment

Create the app environment file on each server:

```bash
cd /opt/signage/source
cp .env.example .env
nano .env
```

Use these values on the test server:

```env
APP_ENV=test
APP_BASE_URL=https://signage-test.bapswest.org
HOST=0.0.0.0
PORT=3000
POSTGRES_DB=signage_test
POSTGRES_USER=signage_app
POSTGRES_PASSWORD=CHANGE_ME_STRONG_TEST_DATABASE_PASSWORD
REDIS_URL=redis://redis:6379
SESSION_SECRET=CHANGE_ME_LONG_RANDOM_TEST_SESSION_SECRET
TWO_FACTOR_ISSUER=BAPS Signage Test
```

Use these values on the production server:

```env
APP_ENV=production
APP_BASE_URL=https://signage.bapswest.org
HOST=0.0.0.0
PORT=3000
POSTGRES_DB=signage
POSTGRES_USER=signage_app
POSTGRES_PASSWORD=CHANGE_ME_STRONG_DATABASE_PASSWORD
REDIS_URL=redis://redis:6379
SESSION_SECRET=CHANGE_ME_LONG_RANDOM_SESSION_SECRET
TWO_FACTOR_ISSUER=BAPS Signage
```

Use strong random values for `POSTGRES_PASSWORD` and `SESSION_SECRET`.

## 8. Start the Application

The current repository includes `docker-compose.test.yml`. Use one of the following command sets depending on which server you are deploying.

Each server publishes the app on its own local `127.0.0.1:3000`, so the same port is acceptable because test and production run on separate servers.

On the test server:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-test up -d --build
docker compose -f docker-compose.test.yml -p signage-test ps
```

On the production server:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-prod up -d --build
docker compose -f docker-compose.test.yml -p signage-prod ps
```

The app listens on:

```text
http://127.0.0.1:3000
```

The compose file mounts app data at:

```text
/opt/signage/source/data
```

Important current behavior:

- The app container serves the admin portal, kiosk pages, previews, and APIs.
- Live kiosk updates use Server-Sent Events.
- PostgreSQL stores the primary application state.
- `/opt/signage/source/data/app-data.json` is maintained as a compatibility mirror and first-run migration source.
- On the first database-backed startup, existing JSON state is imported automatically without changing room codes.
- Redis is available for future production broadcast fan-out and job processing.

Check local health:

```bash
curl http://127.0.0.1:3000/api/health
```

## 9. Configure Nginx

Create the matching Nginx site on each server. Both examples proxy to local `127.0.0.1:3000` on that server.

### Test Environment Nginx Site

On the test server, create the test Nginx site:

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

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}
```

Enable the test site:

```bash
sudo ln -s /etc/nginx/sites-available/signage-test /etc/nginx/sites-enabled/signage-test
sudo nginx -t
sudo systemctl reload nginx
```

Check the test site through Nginx:

```bash
curl -H "Host: signage-test.bapswest.org" http://localhost/api/health
```

### Production Environment Nginx Site

On the production server, create the production Nginx site:

```bash
sudo nano /etc/nginx/sites-available/signage
```

Use this configuration:

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

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}
```

Enable the production site:

```bash
sudo ln -s /etc/nginx/sites-available/signage /etc/nginx/sites-enabled/signage
sudo nginx -t
sudo systemctl reload nginx
```

Check the production site through Nginx:

```bash
curl -H "Host: signage.bapswest.org" http://localhost/api/health
```

## 10. Install Cloudflare Tunnels

Install `cloudflared` on both servers:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared
```

Authenticate Cloudflare Tunnels on both servers:

```bash
cloudflared tunnel login
```

### Test Server Tunnel

Run this section on the test server.

Create the test tunnel:

```bash
cloudflared tunnel create signage-test
```

List the generated credential file:

```bash
ls ~/.cloudflared
```

Copy the test tunnel credential file into `/etc/cloudflared`. Replace `TEST_TUNNEL_ID.json` with the real file name shown by `ls ~/.cloudflared`:

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/TEST_TUNNEL_ID.json /etc/cloudflared/signage-test.json
sudo chmod 600 /etc/cloudflared/signage-test.json
```

Create the test tunnel config:

```bash
sudo nano /etc/cloudflared/signage-test.yml
```

Test tunnel configuration:

```yaml
tunnel: signage-test
credentials-file: /etc/cloudflared/signage-test.json

ingress:
  - hostname: signage-test.bapswest.org
    service: http://localhost:80
  - service: http_status:404
```

Create the test DNS route:

```bash
cloudflared tunnel route dns signage-test signage-test.bapswest.org
```

Create a systemd service for the test tunnel:

```bash
sudo nano /etc/systemd/system/cloudflared-signage-test.service
```

Use this service definition:

```ini
[Unit]
Description=Cloudflare Tunnel for Signage Test
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/bin/cloudflared --no-autoupdate --config /etc/cloudflared/signage-test.yml tunnel run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Enable and start the test tunnel service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-signage-test
sudo systemctl status cloudflared-signage-test --no-pager
```

### Production Server Tunnel

Run this section on the production server.

Create the production tunnel:

```bash
cloudflared tunnel create signage-prod
```

List the generated credential file:

```bash
ls ~/.cloudflared
```

Copy the production tunnel credential file into `/etc/cloudflared`. Replace `PROD_TUNNEL_ID.json` with the real file name shown by `ls ~/.cloudflared`:

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/PROD_TUNNEL_ID.json /etc/cloudflared/signage-prod.json
sudo chmod 600 /etc/cloudflared/signage-prod.json
```

Create the production tunnel config:

```bash
sudo nano /etc/cloudflared/signage-prod.yml
```

Production tunnel configuration:

```yaml
tunnel: signage-prod
credentials-file: /etc/cloudflared/signage-prod.json

ingress:
  - hostname: signage.bapswest.org
    service: http://localhost:80
  - service: http_status:404
```

Create the production DNS route:

```bash
cloudflared tunnel route dns signage-prod signage.bapswest.org
```

Create a systemd service for the production tunnel:

```bash
sudo nano /etc/systemd/system/cloudflared-signage-prod.service
```

Use this service definition:

```ini
[Unit]
Description=Cloudflare Tunnel for Signage Production
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/bin/cloudflared --no-autoupdate --config /etc/cloudflared/signage-prod.yml tunnel run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Enable and start the production tunnel service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-signage-prod
sudo systemctl status cloudflared-signage-prod --no-pager
```

## 11. Verify Public Routes

Open these URLs:

Test:

```text
https://signage-test.bapswest.org/admin
https://signage-test.bapswest.org/api/health
https://signage-test.bapswest.org/assets/audio/alarm.mp3
https://signage-test.bapswest.org/room-108-shishu
https://signage-test.bapswest.org/preview/room-108-shishu
```

Production:

```text
https://signage.bapswest.org/admin
https://signage.bapswest.org/api/health
https://signage.bapswest.org/assets/audio/alarm.mp3
https://signage.bapswest.org/room-108-shishu
https://signage.bapswest.org/preview/room-108-shishu
```

If the public URLs do not load, check each layer from inside the matching Debian server.

Run on either server:

```bash
curl http://127.0.0.1:3000/api/health
curl http://localhost/api/health
sudo systemctl status nginx --no-pager
```

Run on the test server:

```bash
sudo systemctl status cloudflared-signage-test --no-pager
sudo journalctl -u cloudflared-signage-test -n 80 --no-pager
cloudflared tunnel info signage-test
```

Run on the production server:

```bash
sudo systemctl status cloudflared-signage-prod --no-pager
sudo journalctl -u cloudflared-signage-prod -n 80 --no-pager
cloudflared tunnel info signage-prod
```

Expected results:

- `curl http://127.0.0.1:3000/api/health` confirms the app container is responding.
- `curl http://localhost/api/health` confirms Nginx is forwarding to the app.
- The matching `systemctl status cloudflared-signage-*` command should show the tunnel service running.
- The matching `journalctl -u cloudflared-signage-*` command should show the tunnel connected without repeated errors.
- The matching `cloudflared tunnel info ...` command should show the tunnel and route.

If local Nginx works but the public URL does not, verify the matching tunnel config file points to local Nginx.

Test config:

```yaml
tunnel: signage-test
credentials-file: /etc/cloudflared/signage-test.json

ingress:
  - hostname: signage-test.bapswest.org
    service: http://127.0.0.1:80
  - service: http_status:404
```

Production config:

```yaml
tunnel: signage-prod
credentials-file: /etc/cloudflared/signage-prod.json

ingress:
  - hostname: signage.bapswest.org
    service: http://127.0.0.1:80
  - service: http_status:404
```

After editing the test tunnel config, restart the test service:

```bash
sudo systemctl restart cloudflared-signage-test
sudo systemctl status cloudflared-signage-test --no-pager
```

After editing the production tunnel config, restart the production service:

```bash
sudo systemctl restart cloudflared-signage-prod
sudo systemctl status cloudflared-signage-prod --no-pager
```

In the admin portal:

1. Change a room status to Available.
2. Open the room kiosk page in another browser tab.
3. Change the room status to Busy.
4. Confirm the kiosk refreshes automatically.
5. Change the room status to Buffer/Warning.
6. Publish a test Emergency/Safety Broadcast.
7. Confirm the kiosk switches to broadcast mode.
8. End the broadcast.

For kiosk devices, open the real kiosk page and complete the **Enable Sound** setup screen. For managed kiosk devices, allow audio playback for both `https://signage-test.bapswest.org` and `https://signage.bapswest.org`.

## 12. Cloudflare Access Recommendations

Protect these routes with Cloudflare Access:

```text
https://signage-test.bapswest.org/admin
https://signage-test.bapswest.org/preview/*
https://signage.bapswest.org/admin
https://signage.bapswest.org/preview/*
```

Keep kiosk room routes available without Cloudflare login if they are used on room signage devices, but use non-guessable room codes before production use.

Do not expose these publicly:

- Proxmox web UI.
- SSH.
- PostgreSQL.
- Redis.
- Docker API.
- Internal monitoring dashboards unless separately protected.

## 13. Real-Time Broadcast Notes

Instant safety messages work with this server pattern because the kiosk page keeps a live Server-Sent Events connection to the app.

Required server behavior:

- Nginx keeps long-lived connections open.
- Cloudflare Tunnels forward traffic to Nginx.
- Kiosk pages remain open on the room signage device.
- Kiosk devices allow audio autoplay.
- iPhone and iPad Safari may require one tap on the real kiosk page before sound can play; use the kiosk page's **Enable Sound** setup screen during device setup.
- Emergency alert sound repeats every 15 seconds while the broadcast is active.

Recommended production upgrade:

- Save every broadcast to PostgreSQL before publishing.
- Use Redis to fan out broadcast events if multiple app containers are added.
- Keep kiosk polling as a fallback if the live connection is interrupted.

## 14. Backups

Back up the current MVP data file, PostgreSQL data, and branding/uploads folder.

Create `/opt/signage/backup.sh`:

```bash
nano /opt/signage/backup.sh
```

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/signage/source"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/opt/signage/backups"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-signage-test}"

mkdir -p "$BACKUP_DIR"

cd "$APP_DIR"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

if [ -f data/app-data.json ]; then
  cp data/app-data.json "$BACKUP_DIR/app-data-$STAMP.json"
fi

docker compose -f docker-compose.test.yml -p "$COMPOSE_PROJECT" exec -T postgres pg_dump -U "${POSTGRES_USER:-signage_app}" "${POSTGRES_DB:-signage}" | gzip > "$BACKUP_DIR/postgres-$STAMP.sql.gz"

find "$BACKUP_DIR" -type f -mtime +14 -delete
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

For production, set `COMPOSE_PROJECT=signage-prod` in the production server's cron command or backup script.

Also configure Proxmox VM backups and keep an offsite backup copy.

## 15. Two Server Layout

Production and test are separate server environments.

Recommended route structure:

```text
Production: https://signage.bapswest.org
Test:       https://signage-test.bapswest.org
```

Use the same application path on each server:

```text
Test server:       /opt/signage/source
Production server: /opt/signage/source
```

Keep these values separate between the two servers:

- Docker Compose project name.
- `.env` file.
- PostgreSQL database.
- Redis data.
- App data folder.
- Nginx site.
- Cloudflare hostname.
- Cloudflare Tunnel.
- Backup folder.

Production server command:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-prod up -d --build
```

Test server command:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-test up -d --build
```

Test should never share production data.

## 16. Pull Updates From GitHub

Use this whenever new code has been pushed to GitHub:

For the test environment:

```bash
cd /opt/signage/source
git pull origin main
docker compose -f docker-compose.test.yml -p signage-test up -d --build
docker compose -f docker-compose.test.yml -p signage-test ps
```

For the production environment:

```bash
cd /opt/signage/source
git pull origin main
docker compose -f docker-compose.test.yml -p signage-prod up -d --build
docker compose -f docker-compose.test.yml -p signage-prod ps
```

Check logs:

Test:

```bash
docker compose -f docker-compose.test.yml -p signage-test logs -f app
```

Production:

```bash
docker compose -f docker-compose.test.yml -p signage-prod logs -f app
```

Verify after update:

Test server:

```bash
curl http://127.0.0.1:3000/api/health
curl https://signage-test.bapswest.org/api/health
```

Production server:

```bash
curl http://127.0.0.1:3000/api/health
curl https://signage.bapswest.org/api/health
```

## 17. Restart and Stop

Restart test:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-test restart
```

Restart production:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-prod restart
```

Stop test:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-test down
```

Stop production:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-prod down
```

Do not use `down -v` on production unless you intentionally want to remove container volumes and test data.

## 18. Recovery Checklist

If either server must be rebuilt:

1. Create a new Debian 12 VM for the affected server.
2. Install Docker, Nginx, Git, and Cloudflare Tunnels.
3. Clone `https://github.com/dcswami/signage-chatgpt.git`.
4. Restore `.env`.
5. Restore `data/app-data.json`.
6. Restore PostgreSQL backup if production database persistence is enabled.
7. Restore Nginx and Cloudflare Tunnel configurations.
8. Start Docker Compose services.
9. Verify `/admin`, `/api/health`, kiosk pages, preview pages, live refresh, and emergency broadcast audio.
