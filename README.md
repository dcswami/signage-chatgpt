# Signage Management System

This repository contains the first runnable scaffold for the classroom, meeting room, and conference room signage management system.

## Current Application

The scaffold includes:

- Management portal at `/admin`.
- Kiosk room pages at `/<<UNIQUE-ROOM-CODE>>`.
- Preview pages at `/preview/<<UNIQUE-ROOM-CODE>>`.
- API health check at `/api/health`.
- Room state API for Available, Busy, and Buffer/Warning.
- Emergency/Safety Broadcast API with confirmation requirement.
- Live kiosk refresh using Server-Sent Events.
- PostgreSQL-backed operational state with first-run import from the previous JSON data file.
- Dashboard search, status filters, room controls, and live kiosk preview.
- Center, campus, building, and room create/edit/delete workflows.
- Room-code validation, booking URL management, timezone inheritance, and theme assignment.
- Built-in theme cloning and hierarchy deletion safeguards.
- User provisioning with status, role, center, and feature assignments.
- Campus Manager and Building Manager roles with campus/building access scopes.
- Permission and role editor with cloneable roles and server-side permission checks.
- Calendar account management for Google service accounts/OAuth, Microsoft 365 applications/OAuth, CalDAV/iCloud, and public iCalendar URLs.
- Redis/BullMQ calendar jobs with webhook acceleration, polling fallback, 30-day past/future synchronization, deletion handling, recurring events, conflict display selection, and failure notifications.
- Per-room calendar assignment, calendar discovery/verification, private-event masking, configurable upcoming-event pagination, and sync history.
- Editable cloned-theme design tokens with selectable-room live preview, color pickers, panel opacity, draft, publish, and archive states.
- Persistent theme background image upload/removal and configurable upcoming-event tile colors.
- Scoped theme scheduling for centers, campuses, buildings, and rooms with owner tracking and two-year history.
- Encrypted SMTP settings, connection testing, invitation emails, manual notifications, and delivery history.
- Emergency and safety broadcast template creation, editing, deletion, and launch selection.
- System Administrator-only emergency and safety broadcast lifecycle history.
- Kiosk refresh recovery after tablet sleep, browser resume, reconnect, or application rebuild.
- Genuine theme-configurable booking QR codes, offline schedule/theme caching, five-minute stale indication, and an independent offline clock.
- Responsive portrait/landscape layouts plus optional kiosk pairing, health monitoring, and remote data-refresh/full-reload controls.
- Built-in themes: Classic Institutional, Event Formal, and Custom Background.
- Sample HTML/CSS theme gallery in `samples/kiosk-layout-options.html`.
- PostgreSQL schema in `database/schema.sql`.
- Docker test deployment setup in `docker-compose.test.yml`.

## Test Routes

Example local routes:

```text
http://localhost:3000/admin
http://localhost:3000/room-108-shishu
http://localhost:3000/room-205-gujarati
http://localhost:3000/room-301-assembly
http://localhost:3000/preview/room-108-shishu
http://localhost:3000/api/health
```

## Run on Debian Test Server

Test site:

```text
https://signage-test.bapswest.org
```

Install the host deployment utilities on Debian:

```bash
sudo apt update
sudo apt install -y git npm
```

The application runs in Docker. Host npm is available for diagnostics, while the Docker image installs application dependencies during the build.

Use:

```bash
cp .env.example .env
docker compose -f docker-compose.test.yml -p signage-test up -d --build
```

Full steps are in `TEST_ENVIRONMENT_DEPLOYMENT.md`.

## Important Note

This is a working MVP for review and test deployment. Production rollout still requires real-tenant Google, Microsoft 365, and iCloud validation, supported-device browser testing, normalized PostgreSQL runtime storage for high-volume calendar workloads, monitoring, and automated backup/restore drills.
# signage-chatgpt
