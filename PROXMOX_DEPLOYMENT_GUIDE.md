# Proxmox Deployment Guide

This guide deploys the Signage Management System on one on-premises Proxmox virtual machine using Debian 12, Docker Compose, Nginx, and Cloudflare Tunnel.

The current application is a runnable MVP scaffold. It includes the admin portal, kiosk pages, preview pages, live kiosk refresh, emergency broadcast display, sample themes, and deployment files. PostgreSQL and Redis are included in the stack so the server layout is ready for the production database-backed version, but the current MVP stores live app data in `data/app-data.json`.

## 1. Route Structure

Use one public hostname with path-based app routes:

```text
Management portal: https://signage.bapswest.org/admin
Kiosk page:        https://signage.bapswest.org/<<UNIQUE-ROOM-CODE>>
Preview page:      https://signage.bapswest.org/preview/<<UNIQUE-ROOM-CODE>>
API routes:        https://signage.bapswest.org/api
Health check:      https://signage.bapswest.org/api/health
```

Example room routes included in the seed data:

```text
https://signage.bapswest.org/room-108-shishu
https://signage.bapswest.org/room-205-gujarati
https://signage.bapswest.org/room-301-assembly
```

Cloudflare Tunnel should send `signage.bapswest.org` traffic to local Nginx on the Debian VM.

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

## 3. Create the Proxmox VM

1. Upload the Debian 12 ISO to Proxmox.
2. Create a new VM.
3. Select Debian 12 as the guest OS.
4. Assign CPU, memory, and storage based on the sizing above.
5. Use VirtIO network and disk options where available.
6. Install Debian 12.
7. Set a static internal IP address.
8. Install OpenSSH server during setup or after first boot.
9. Update Debian:

```bash
sudo apt update
sudo apt upgrade -y
sudo reboot
```

After reboot, SSH back into the VM.

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

Create the app environment file:

```bash
cd /opt/signage/source
cp .env.example .env
nano .env
```

Recommended values:

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

The current repository includes `docker-compose.test.yml`. For this MVP deployment, use it to build and run the app, PostgreSQL, and Redis:

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
- Current MVP app state is saved in `/opt/signage/source/data/app-data.json`.
- PostgreSQL is initialized with `database/schema.sql` and is ready for the production database implementation.
- Redis is available for future production broadcast fan-out and job processing.

Check local health:

```bash
curl http://127.0.0.1:3000/api/health
```

## 9. Configure Nginx

Create the Nginx site:

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

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/signage /etc/nginx/sites-enabled/signage
sudo nginx -t
sudo systemctl reload nginx
```

Check through Nginx:

```bash
curl http://localhost/api/health
```

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

Copy the generated tunnel credentials file into `/etc/cloudflared` and replace `TUNNEL_ID.json` in the config with the real file name:

```bash
ls ~/.cloudflared
sudo cp ~/.cloudflared/TUNNEL_ID.json /etc/cloudflared/TUNNEL_ID.json
sudo chmod 600 /etc/cloudflared/TUNNEL_ID.json
```

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

## 11. Verify Public Routes

Open these URLs:

```text
https://signage.bapswest.org/admin
https://signage.bapswest.org/api/health
https://signage.bapswest.org/room-108-shishu
https://signage.bapswest.org/preview/room-108-shishu
```

If the public URLs do not load, check each layer from inside the Debian VM:

```bash
curl http://127.0.0.1:3000/api/health
curl http://localhost/api/health
sudo systemctl status nginx --no-pager
sudo systemctl status cloudflared --no-pager
sudo journalctl -u cloudflared -n 80 --no-pager
cloudflared tunnel info signage
```

Expected results:

- `curl http://127.0.0.1:3000/api/health` confirms the app container is responding.
- `curl http://localhost/api/health` confirms Nginx is forwarding to the app.
- `systemctl status cloudflared` should show the tunnel service running.
- `journalctl -u cloudflared` should show the tunnel connected without repeated errors.
- `cloudflared tunnel info signage` should show the tunnel and its route.

If local Nginx works but the public URL does not, verify `/etc/cloudflared/config.yml` uses the real tunnel credentials file name and points to local Nginx:

```yaml
tunnel: signage
credentials-file: /etc/cloudflared/TUNNEL_ID.json

ingress:
  - hostname: signage.bapswest.org
    service: http://127.0.0.1:80
  - service: http_status:404
```

After editing the tunnel config, restart it:

```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager
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

For kiosk devices, allow audio autoplay for `https://signage.bapswest.org` so emergency alert sound can play.

## 12. Cloudflare Access Recommendations

Protect these routes with Cloudflare Access:

```text
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
- Cloudflare Tunnel forwards traffic to Nginx.
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

docker compose -f docker-compose.test.yml -p signage-prod exec -T postgres pg_dump -U "${POSTGRES_USER:-signage_app}" "${POSTGRES_DB:-signage}" | gzip > "$BACKUP_DIR/postgres-$STAMP.sql.gz"

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

Also configure Proxmox VM backups and keep an offsite backup copy.

## 15. Production and Test on One Server

Production and test can run on the same Proxmox VM if they are isolated.

Recommended route structure:

```text
Production: https://signage.bapswest.org
Test:       https://signage-test.bapswest.org
```

Current test deployment folder:

```text
/opt/signage/source
```

Recommended folder layout when production and test both run on the same server:

```text
/opt/signage-prod/source
/opt/signage-test/source
```

Use separate values for:

- Docker Compose project name.
- `.env` file.
- App port.
- PostgreSQL database.
- Redis data.
- App data folder.
- Nginx site.
- Cloudflare hostname.
- Backup folder.

Example production command:

```bash
cd /opt/signage-prod/source
docker compose -f docker-compose.test.yml -p signage-prod up -d --build
```

Example test command:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-test up -d --build
```

If production is added to the same server later, move production and test into separate folders and update one environment to use a different host port, such as `127.0.0.1:3001:3000`.

Staging/test should never share production data.

## 16. Pull Updates From GitHub

Use this whenever new code has been pushed to GitHub:

```bash
cd /opt/signage/source
git pull origin main
docker compose -f docker-compose.test.yml -p signage-prod up -d --build
docker compose -f docker-compose.test.yml -p signage-prod ps
```

Check logs:

```bash
docker compose -f docker-compose.test.yml -p signage-prod logs -f app
```

Verify after update:

```bash
curl http://127.0.0.1:3000/api/health
curl https://signage.bapswest.org/api/health
```

## 17. Restart and Stop

Restart:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-prod restart
```

Stop:

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-prod down
```

Do not use `down -v` on production unless you intentionally want to remove container volumes and test data.

## 18. Recovery Checklist

If the VM must be rebuilt:

1. Create a new Debian 12 VM.
2. Install Docker, Nginx, Git, and Cloudflare Tunnel.
3. Clone `https://github.com/dcswami/signage-chatgpt.git`.
4. Restore `.env`.
5. Restore `data/app-data.json`.
6. Restore PostgreSQL backup if production database persistence is enabled.
7. Restore Nginx and Cloudflare Tunnel configuration.
8. Start Docker Compose services.
9. Verify `/admin`, `/api/health`, kiosk pages, preview pages, live refresh, and emergency broadcast audio.
