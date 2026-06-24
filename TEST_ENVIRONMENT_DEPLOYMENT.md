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

Install the required host utilities:

```bash
sudo apt update
sudo apt install -y git npm
node --version
npm --version
```

Host npm is used for diagnostics and optional checks. The deployed application runs in Docker, where the image installs dependencies separately.

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
cp data/app-data.json "data/app-data-before-room-management-$(date +%Y%m%d-%H%M%S).json"
git pull origin main
```

The backup command preserves the current test rooms and broadcast history before the first PostgreSQL migration. If the file does not exist, skip that command.

Before rebuilding, verify the checked-out revision and Dockerfile:

```bash
git log --oneline -1
sed -n '1,10p' Dockerfile
```

The Dockerfile must show:

```dockerfile
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
```

Do not run the Dockerfile `RUN` line directly in Bash. The `docker compose build` command executes it inside the image.

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
POSTGRES_DB=signage
POSTGRES_USER=signage_app
POSTGRES_PASSWORD=CHANGE_ME_TEST_PASSWORD
POSTGRES_HOST=postgres
REDIS_URL=redis://redis:6379
SESSION_SECRET=CHANGE_ME_LONG_RANDOM_TEST_SECRET
CREDENTIAL_ENCRYPTION_KEY=CHANGE_ME_SEPARATE_LONG_RANDOM_CREDENTIAL_KEY
TWO_FACTOR_ISSUER=BAPS Signage Test
```

Use strong random values for passwords and secrets.

If the PostgreSQL volume already exists, keep the database name that is already present. The current test server uses `signage`; changing only the `.env` value does not rename an initialized PostgreSQL database.

Generate the credential encryption key with:

```bash
openssl rand -base64 48
```

Store this key in the server password manager or another protected backup. Do not change or lose it after SMTP credentials are saved, because existing encrypted credentials cannot be decrypted without the same key.

## 5. Start Test Containers

```bash
docker compose -f docker-compose.test.yml -p signage-test build --no-cache app
docker compose -f docker-compose.test.yml -p signage-test up -d --force-recreate
docker compose -f docker-compose.test.yml -p signage-test ps
```

On first startup, the application creates its PostgreSQL state table and imports the existing `data/app-data.json`. Room codes and kiosk URLs remain unchanged. PostgreSQL becomes the primary data store, and the JSON file remains an automatically updated compatibility mirror.

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

The response must include:

```json
{
  "status": "healthy",
  "storage": "postgresql"
}
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

Check alert audio directly from the kiosk device:

```text
https://signage-test.bapswest.org/assets/audio/alarm.mp3
```

In the admin portal:

1. Confirm the Dashboard lists all three existing test rooms.
2. Open **Locations & Rooms** and confirm the center, campus, building, and rooms were imported.
3. Create a temporary center, campus, building, and room.
4. Edit the temporary room code, booking URL, and theme.
5. Confirm its kiosk and preview links work.
6. Try deleting the center before its children and confirm the system blocks the deletion.
7. Delete the temporary room, building, campus, and center in that order.
8. Clone one built-in theme and confirm the copy is available in the room theme selector.
9. Change a room to Available, Busy, and Buffer/Warning.
10. Open the kiosk page in another browser tab.
11. On the real kiosk page, tap **Enable Sound** once if the setup screen is visible.
12. Publish a test Emergency/Safety Broadcast to one selected room.
13. Confirm only that room switches to broadcast mode and plays the alert sound.
14. Confirm the admin portal preview stays silent.
15. End the broadcast.
16. Open **Users**, create a temporary invited user, and assign a role, center, and feature grants.
17. Edit the user and confirm status, role, center, and feature changes persist.
18. Open **Email Notifications**, save the SMTP settings, and send a test message.
19. Send administrative emails using a specific user, role, and center target, and confirm delivery appears in Email History without duplicate recipients.
20. Confirm the SMTP password is never displayed after saving.
21. Confirm **Campus Manager** and **Building Manager** appear in the role list.
22. Assign a test user to multiple campuses and buildings and confirm the access scope persists.
23. Create, edit, and delete a Broadcast Template.
24. Launch a broadcast from a prepared template and confirm the final publish confirmation is still required.
25. Open **Configuration**, create a temporary role, select permissions, edit it, clone it, and delete both copies.
26. Confirm a non-System Admin user cannot open Emergency/Safety Broadcast History.
27. Open **Calendar Sync**, add a public iCalendar URL account, select **Verify**, assign one calendar to a temporary room, and select **Assign & Sync**.
28. Confirm the room kiosk shows the synchronized events and that private or rental events display as **Private Event**.
29. Confirm Calendar Sync History records the result, then remove the room assignment before deleting the account.
30. For Google, enter service-account JSON, save the account, and select **Discover / Verify**. Confirm the displayed service-account email has been granted access to each required Google calendar.
31. For Microsoft 365, enter the tenant ID, application client ID, client secret, calendar ID, and mailbox.
32. Open **Theme Editor**, clone a built-in theme, modify colors and the four font groups, and confirm the live preview updates.
33. Publish the cloned theme, assign it to a room, and confirm the kiosk updates without rebuilding the container.
34. Publish and end a test safety broadcast, then confirm the System Admin-only history records its start, targets, status, and end time.
35. In **Theme Editor**, switch the Preview Room dropdown and confirm the iframe changes rooms without closing the editor.
36. Change each status color with its color picker and adjust Event Panel transparency; confirm the preview updates before saving.
37. Leave a tablet kiosk asleep or backgrounded, change its assigned theme, then wake the device and confirm it refreshes within 10 seconds without manually reloading.

## 9. Configure SMTP Email

Obtain these values from the email provider:

```text
SMTP host
SMTP port
TLS mode
SMTP username
SMTP password or app password
From name
From email
Reply-To email, if required
```

In the management portal:

1. Open **Email Notifications**.
2. Enter the SMTP settings.
3. Enable email delivery.
4. Save the settings.
5. Enter a test recipient.
6. Select **Test Connection & Send**.
7. Confirm the message arrives and Email History shows `sent`.

Use port `465` with implicit TLS enabled when required by the provider. Port `587` normally uses STARTTLS and should leave implicit TLS disabled.

## 10. Pull Updates Later

```bash
cd /opt/signage/source
git pull origin main
docker compose -f docker-compose.test.yml -p signage-test build app
docker compose -f docker-compose.test.yml -p signage-test up -d --force-recreate
docker compose -f docker-compose.test.yml -p signage-test ps
```

## 11. Stop Test Environment

```bash
cd /opt/signage/source
docker compose -f docker-compose.test.yml -p signage-test down
```

To remove all test data as well:

```bash
docker compose -f docker-compose.test.yml -p signage-test down -v
```

Only use `down -v` when you intentionally want to delete the test database and Redis data.

## 12. Notes

- PostgreSQL is the primary application data store.
- `data/app-data.json` is retained as an automatically updated compatibility mirror and migration source.
- Redis is included for future multi-instance broadcast fan-out and background jobs.
- Authentication and production role enforcement remain future implementation layers.
