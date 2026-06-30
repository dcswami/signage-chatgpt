**Remaining Development**

The current system is a strong pilot, but several MVP and production requirements remain.

**Priority 1: Security**
1. Email/password login, password reset, secure password hashing.
2. Authenticator-app two-factor authentication.
3. Session management, logout, expiration, and secure cookies.
4. Protect `/admin`, preview pages, and management APIs.
5. Remove the implicit System Admin fallback and `X-User-Id` identity mechanism in [server.mjs](/Users/dcdas/Documents/Classroom%20Signage/src/server.mjs:505).
6. Add CSRF protection, rate limiting, security headers, and login auditing.
7. Generate non-guessable kiosk/device identifiers.

**Priority 2: Authorization**
1. Filter dashboard, users, locations, calendars, and themes by user scope. `/api/state` currently returns most system data to every viewer.
2. Enforce scope on center, campus, building, room, user, and theme administration.
3. Add room-level user access assignments.
4. Enforce individual feature grants in addition to role permissions.
5. Add scheduled and temporary feature grants with start/end dates.
6. Restrict standardized status-color changes to System Admin only.

**Priority 3: Calendar Conflicts - done**
1. Detect overlapping room events.
2. Add conflict dashboard and detailed review screen.
3. Implement ignore, cancel, replace, move, and resolve actions.
4. Write changes back to writable Google/Microsoft calendars.
5. Add conflict decision audit history and six-month retention.
6. Add deterministic kiosk behavior when unresolved conflicts exist.
7. Complete recurrence-exception testing for Google, Microsoft, and ICS feeds.

**Priority 4: Kiosk Completion - done**
1. Replace the CSS QR placeholder with a genuine QR code. It is currently decorative in [kiosk.js](/Users/dcdas/Documents/Classroom%20Signage/public/kiosk.js:115).
2. Add offline/stale-data indication and local schedule caching.
3. Add explicit portrait layouts.
4. Display current event start and end time, class/category, and optionally organizer.
5. Configure upcoming-event count instead of the hard-coded four events in [server.mjs](/Users/dcdas/Documents/Classroom%20Signage/src/server.mjs:443).
6. Limit upcoming events to the configured day and show “No more events.”
7. Add management-triggered kiosk refresh.
8. Complete kiosk accessibility and device-browser testing.

**Priority 5: Location Management**
~~1. Add center description, logo, contacts, and booking defaults.~~
~~2. Add campus contact, address, booking, and theme defaults.~~
~~3. Add building address, floors, timezone overrides, booking, and theme defaults.~~
~~4. Add room number, floor, equipment, accessibility notes, maintenance status, and privacy settings.~~
~~5. Implement booking URL and theme inheritance across center, campus, building, and room.~~
~~6. Resolve whether a finished scheduled theme returns to the room theme or center default. The requirements currently specify both behaviors.~~

**Priority 6: Emergency Broadcasts**
~~1. Target centers, campuses, buildings, and room groups directly, rather than only selecting rooms.~~
~~2. Support broadcast start/end scheduling and automatic expiration.~~
~~3. Add informational and emergency severity levels.~~
~~4. Support multiple simultaneous broadcasts for separate scopes.~~
~~5. Show a clear active-broadcast dashboard.~~
~~6. Track updates in addition to creation and ending.~~
~~7. Add email/in-app broadcast notifications where configured.~~

**Priority 7: Notifications**
1. Build in-app notifications and permission-based history.
2. Automatically notify Center Admins about calendar sync failures.
3. Add conflict, system-health, and broadcast-status notifications.
4. Include severity, source, timestamp, and action links.
5. Add recipient rules by role and location.
6. Keep SMS and push notifications as future work.

**Priority 8: Device Management done**
1. Register physical kiosk devices to rooms.
2. Generate and validate registration tokens.
3. Record device name, browser, device type, IP, audio state, and last check-in.
4. Add online/offline and stale-device status.
5. Add device revocation and reassignment.

**Priority 9: Data Architecture**
1. Replace the single `application_state` JSONB record with normalized PostgreSQL tables. Current persistence is one shared document in [storage.mjs](/Users/dcdas/Documents/Classroom%20Signage/src/storage.mjs:67).
2. Add migrations and transaction handling.
3. Move calendar sync, notifications, conflict processing, and scheduling to workers.
4. Use Redis for jobs and multi-instance event distribution.
5. Add indexes, pagination, and concurrency protection.

**Priority 10: Reporting and Operations**
1. Room usage, conflict, sync-health, and broadcast reports/exports.
2. Actor-aware audit logs for every administrative action.
3. Automated six-month retention jobs.
4. Automated daily backups and tested restore procedures.
5. Production Docker Compose configuration separate from test.
6. Monitoring for app health, database, disk, tunnel, SMTP, and calendar providers.
7. Load, security, accessibility, browser, and disaster-recovery testing.

**Recommended Next Sequence**

1. Authentication and 2FA.
2. Complete authorization and feature-grant enforcement.
3. Real QR codes and kiosk offline handling.
4. Calendar conflict detection/resolution.
5. Device registration.
6. Notifications.
7. Normalized PostgreSQL and background workers.
8. Production hardening, reporting, and monitoring.