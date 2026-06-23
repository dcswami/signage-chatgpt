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

Use:

```bash
cp .env.example .env
docker compose -f docker-compose.test.yml -p signage-test up -d --build
```

Full steps are in `TEST_ENVIRONMENT_DEPLOYMENT.md`.

## Important Note

This is a working MVP for review and test deployment. Full production hardening still needs authentication enforcement, calendar provider integrations, production role checks, database normalization for calendar workloads, and automated backups.
# signage-chatgpt
