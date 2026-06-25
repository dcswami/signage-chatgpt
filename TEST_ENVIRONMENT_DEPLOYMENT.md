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
BOOTSTRAP_ADMIN_PASSWORD=CHANGE_ME_STRONG_INITIAL_ADMIN_PASSWORD
POSTGRES_POOL_SIZE=15
BACKGROUND_WORKER_CONCURRENCY=5
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

On first startup, the application runs the ordered migrations in `database/migrations`, creates per-domain PostgreSQL tables, and transactionally imports the legacy `application_state` record or `data/app-data.json`. Room codes, entity IDs, and kiosk URLs remain unchanged. Runtime writes then use the normalized tables. The JSON compatibility mirror is disabled by default so password hashes and two-factor secrets are not copied to disk.

`BOOTSTRAP_ADMIN_PASSWORD` is used only when the first System Administrator does not yet have a password hash. Set a strong temporary value before the first secure startup, sign in as `admin@example.org`, enroll two-factor authentication, and then remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env`.

The health response should report `"storage": "postgresql-normalized"`, `"calendarQueue": "redis"`, `"backgroundQueue": "redis"`, and `"authentication": "ready"`.

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

Authentication readiness:

1. Open `https://signage-test.bapswest.org/admin` and confirm it redirects to `/login`.
2. Sign in as `admin@example.org` using the temporary `BOOTSTRAP_ADMIN_PASSWORD`.
3. Open **Configuration**, enroll an authenticator app, log out, and confirm the next login requires its six-digit code.
4. Remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env` and recreate the app container.
5. Change the signed-in administrator password under **Configuration**, then confirm the new password works.
6. As System Administrator, set a temporary user's password and confirm the user's older sessions are revoked.

Functional readiness in the admin portal:

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
18. Open **Calendars** and confirm the Calendar Sync, Calendar Assignment, and Conflict Resolution tabs show their expected sections.
19. Open **Kiosk Devices** and filter registered devices by search, room, registration state, and health state.
20. Open **Email Notifications**, save the SMTP settings, and send a test message.
21. Send administrative emails using a specific user, role, and center target, and confirm delivery appears in Email History without duplicate recipients.
22. Confirm the SMTP password is never displayed after saving.
23. Confirm **Campus Manager** and **Building Manager** appear in the role list.
24. Assign a test user to multiple campuses and buildings and confirm the access scope persists.
25. Create, edit, and delete a Broadcast Template.
26. Launch a broadcast from a prepared template and confirm the final publish confirmation is still required.
27. Open **Configuration**, create a temporary role, select permissions, edit it, clone it, and delete both copies.
28. Confirm a non-System Admin user cannot open Emergency/Safety Broadcast History.
29. Open **Calendars > Calendar Sync**, add a public iCalendar URL account, select **Verify**, assign one calendar to a temporary room, and select **Assign & Sync**.
30. Confirm the sync imports events inside the previous 30 days and next 30 days and that deleted source events disappear after another sync.
31. Confirm the room kiosk shows synchronized events and that private or rental events display as **Private Event** without a description.
32. Create overlapping events and confirm the conflict dashboard shows one overlap group while the kiosk displays only one deterministic event.
33. Open detailed conflict review. Test **Ignore** and **Resolve Display** on a read-only source, then confirm **Cancel**, **Replace Others**, and **Move Selected** are disabled.
34. Repeat with writable Google and Microsoft test calendars. Confirm Cancel deletes the selected source event, Replace keeps the selected event and deletes the other overlap, and Move writes the room-timezone start/end values back correctly.
35. Confirm Conflict Decision History records user, action, source-change status, selection, and move time, and that Calendar Sync History records the resulting sync.
36. Remove the room assignment before deleting the account.
37. For Google, test service-account discovery and OAuth authorization URL generation. Confirm the connected account has access to each required calendar.
38. For Microsoft 365, test application credentials and OAuth authorization URL generation using the tenant/client configuration.
39. Add an iCloud CalDAV account using an app-specific password and verify calendar discovery.
40. Confirm `/api/health` reports `"calendarQueue": "redis"`.
41. Stop Redis briefly and confirm the app remains healthy with `"calendarQueue": "in-process"`, then restart Redis, trigger a calendar sync, and confirm the health response returns to `"calendarQueue": "redis"`.
42. Open a kiosk and scan its generated booking QR code.
43. Disconnect the kiosk network for more than five minutes and confirm cached signage continues, the clock advances, and offline/stale status is visible.
44. Test the kiosk in landscape and portrait orientation.
45. Pair a kiosk with its six-digit code, approve it as System Admin or the responsible Center Admin, and test remote data refresh and full reload.
46. Confirm the device record shows its detected device type, browser, viewport, IP address, audio state, last contact, and online health.
47. Stop the kiosk heartbeat and confirm it becomes stale after two minutes and offline after ten minutes.
48. Reassign the kiosk to another permitted room and confirm the open device automatically navigates to the new room URL.
49. Revoke the kiosk and confirm its heartbeat is rejected and the device displays a revoked-registration message.
50. Remove the revoked record, reload the kiosk, and confirm it receives a new pairing code and can be paired again.
51. Open **Theme Editor**, clone a built-in theme, modify colors and the four font groups, and confirm the live preview updates.
52. Publish the cloned theme, assign it to a room, and confirm the kiosk updates without rebuilding the container.
53. Publish and end a test safety broadcast, then confirm the System Admin-only history records its start, targets, status, and end time.
54. In **Theme Editor**, switch the Preview Room dropdown and confirm the iframe changes rooms without closing the editor.
55. Change each status color with its color picker and adjust Event Panel transparency; confirm the preview updates before saving.
56. Leave a tablet kiosk asleep or backgrounded, change its assigned theme, then wake the device and confirm it refreshes within 10 seconds without manually reloading.
57. Clone a theme, upload a PNG, JPEG, or WebP background image, save the theme, and confirm the image appears in all three preview states.
58. Rebuild the application container and confirm the uploaded background still loads from the persistent `./data/theme-assets` volume.
59. Change the upcoming-event tile background, title, and detail colors and confirm the preview updates.
60. Open **Theme Scheduler**, schedule a published theme for one or more eligible targets, and confirm the owner name appears.
61. Confirm the scheduled theme overrides Room Management during the active window and automatically returns to the room theme afterward.
62. Confirm completed schedules appear under **Past Schedules** and records older than two years are not displayed.

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
- Uploaded theme background images are retained in `data/theme-assets`; include this directory in backups.
- Redis runs BullMQ calendar synchronization jobs and remains available for future multi-instance broadcast fan-out.
- Real Google, Microsoft 365, and iCloud credentials must be validated in the test environment before production use.
