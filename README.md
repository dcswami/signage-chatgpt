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
- Transactional per-domain PostgreSQL storage with versioned migrations, first-run legacy import, indexed queries, and optimistic concurrency protection.
- Email/password authentication, password reset, authenticator-app 2FA, secure sessions, CSRF protection, rate limiting, security headers, and login auditing.
- Self-service password changes plus System Administrator password resets with session revocation and optional authenticator reset.
- Scope-filtered rooms, locations, users, calendars, themes, room-level assignments, and permanent or scheduled feature grants.
- Dashboard search, status filters, room controls, and live kiosk preview.
- Center, campus, building, and room create/edit/delete workflows.
- Room-code validation, booking URL management, timezone inheritance, and theme assignment.
- Built-in theme cloning and hierarchy deletion safeguards.
- User provisioning with status, role, center, and feature assignments.
- Campus Manager and Building Manager roles with campus/building access scopes.
- Permission and role editor with cloneable roles and server-side permission checks.
- Calendar account management for Google service accounts/OAuth, Microsoft 365 applications/OAuth, CalDAV/iCloud, and public iCalendar URLs.
- Redis/BullMQ workers for calendar jobs, notifications, conflicts, broadcast lifecycle, schedule reconciliation, and multi-instance kiosk event distribution.
- Calendar conflict dashboard with detailed review, deterministic kiosk selection, six-month decision history, and Ignore/Resolve/Cancel/Replace/Move actions for supported writable sources.
- Calendar management organized into Calendar Sync, Calendar Assignment, and Conflict Resolution working tabs.
- Per-room calendar assignment, calendar discovery/verification, private-event masking, configurable upcoming-event pagination, and sync history.
- Editable cloned-theme design tokens with selectable-room live preview, color pickers, panel opacity, draft, publish, and archive states.
- Persistent theme background image upload/removal and configurable upcoming-event tile colors.
- Scoped theme scheduling for centers, campuses, buildings, and rooms with owner tracking and two-year history.
- Encrypted SMTP settings, connection testing, invitation emails, manual notifications, and delivery history.
- Emergency and safety broadcast template creation, editing, deletion, and launch selection.
- System Administrator-only emergency and safety broadcast lifecycle history.
- Kiosk refresh recovery after tablet sleep, browser resume, reconnect, or application rebuild.
- Genuine theme-configurable booking QR codes, offline schedule/theme caching, five-minute stale indication, and an independent offline clock.
- Full room-local kiosk date and time including weekday, date, year, and seconds.
- Responsive portrait/landscape layouts plus secure kiosk pairing, online/stale/offline health monitoring, device inventory details, remote refresh/reload, room reassignment, and token revocation.
- Registered-device search and filters for room, registration state, and health state.
- Built-in themes: Classic Institutional, Event Formal, and Custom Background.
- Sample HTML/CSS theme gallery in `samples/kiosk-layout-options.html`.
- PostgreSQL schema and ordered runtime migrations in `database/schema.sql` and `database/migrations/`.
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

Before the first secure start, replace `BOOTSTRAP_ADMIN_PASSWORD` in `.env`. Sign in as `admin@example.org`, enroll authenticator-app two-factor authentication under **Configuration**, then remove the bootstrap password and recreate the app container.

Full steps are in `TEST_ENVIRONMENT_DEPLOYMENT.md`.

## Important Note

This is a working MVP for review and test deployment. Production rollout still requires real-tenant Google, Microsoft 365, and iCloud validation, supported-device browser testing, monitoring, and automated backup/restore drills.
# signage-chatgpt
