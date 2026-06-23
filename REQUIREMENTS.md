# Signage Management System Requirements

## 1. Purpose

The Signage Management System provides room-facing digital signage for classrooms, meeting rooms, and conference rooms. Each room has a kiosk-style web display that shows current availability, active events, upcoming events, booking access, facility branding, and emergency messages. Administrators use a management portal to configure facilities, campuses, buildings, rooms, users, roles, calendar integrations, themes, notifications, and safety broadcasts.

## 2. Goals

- Show clear real-time room availability for each classroom, meeting room, and conference room.
- Provide a branded kiosk display for every room.
- Allow users to book or request a room through a QR code and visible booking link.
- Synchronize room schedules from external calendar systems.
- Help administrators manage rooms, locations, users, roles, features, and display themes.
- Support conflict detection and resolution for calendar events.
- Enable notifications and emergency or safety broadcasts across selected rooms, buildings, campuses, or centers.

## 3. Users and Roles

### 3.1 Primary User Types

- Visitor: Views signage outside a room and scans a QR code to book or request a room.
- Student or Employee: Checks current and upcoming room events and books available rooms if permitted.
- Room Manager: Manages room details, schedules, conflicts, and signage settings for assigned rooms.
- Building Manager: Manages rooms, broadcasts, and notifications within assigned buildings.
- Campus Administrator: Manages buildings, users, rooms, and settings for a campus.
- Center Administrator: Manages centers, campuses, global settings, integrations, and feature access.
- System Administrator: Manages platform-wide configuration, roles, integrations, security, and audit logs.

### 3.2 Role Management Requirements

- The system must support configurable roles.
- Roles must control access to management portal modules and actions.
- Permissions should include view, create, edit, delete, approve, broadcast, and manage settings.
- Administrators must be able to assign users to one or more roles.
- Administrators must be able to scope user access by center, campus, building, or room.
- A user may belong to and receive access for multiple centers.

### 3.3 User Feature Access Grant

- The system must allow administrators to grant feature access to individual users.
- User feature access grants must support the following feature groups:
  - G1. Calendar Sync.
  - G2. Calendar Event Conflict Resolution.
  - G3. Front End Theme and Style Management.
  - G4. Notifications.
  - G5. Emergency & Safety Broadcast.
- Feature access grants must work with role permissions and location scope.
- A user must only be able to use a granted feature for the centers, campuses, buildings, or rooms assigned by role or explicit access scope.
- Administrators must be able to view which users have access to each feature.
- Administrators must be able to grant, revoke, schedule, or temporarily suspend a user's feature access when needed.
- All user feature access changes must be recorded in audit logs.

## 4. Front-End Kiosk Display Requirements

Each room must have a dedicated web page suitable for full-screen kiosk display on a tablet, TV, or browser-based signage device.

The kiosk display must support center-managed visual templates. The attached available and occupied kiosk examples establish the default style direction: a large status area, organization logo, large availability or current class title, QR booking block, right-side upcoming-event list, and bottom room/time footer. The default color states should use a soft green background for available rooms, a soft red background for busy rooms, a warning color for events near completion, and a critical style for emergency or safety broadcasts.

### 4.1 Required Display Elements

The kiosk display must show:

- Facility name.
- Building name.
- Organization, center, or facility logo.
- Room name or room number.
- Current event title when busy.
- "Available" when no current event is active.
- QR code for booking.
- Human-readable booking link.
- Class name or meeting category when available.
- Current local time.
- Upcoming events.

### 4.2 Current Event and Room Status Behavior

- If a current event is active, the display must show the event title.
- If the room is free, the display must show "Available" prominently.
- The display should show current event start and end time when available.
- The display should optionally show organizer, class name, or meeting type based on privacy settings.
- Private events must respect configured privacy rules.
- The kiosk display must support four room status states:
  - Available: no event is active at the current time.
  - Busy: an event is currently active.
  - Buffer/Warning: an active event is about to end.
  - Emergency/Safety Broadcast: an active safety or emergency broadcast is overriding the normal display.
- Buffer/Warning status must start during the final 5 minutes when the event length is 30 minutes or less.
- Buffer/Warning status must start during the final 10 minutes when the event length is more than 30 minutes.

### 4.3 Upcoming Events

- The display must list upcoming events for the same day by default.
- Administrators must be able to configure how many upcoming events appear.
- Upcoming events must show time range and title, unless privacy settings hide title details.
- The display should indicate when there are no more scheduled events for the day.

### 4.4 Booking QR Code and Link

- Each room display must include a QR code that opens a booking or room request URL.
- The booking link must also be shown as readable text.
- The booking destination must be configurable by room, building, campus, or center.
- The QR code should update automatically if the booking URL changes.

### 4.5 Time and Time Zone

- The kiosk display must show the current local time for the room.
- Time zone must be configured at the center level because a center is the primary physical geographic entity.
- Campuses, buildings, and rooms must inherit the center time zone by default.
- Event times must display in the center's local time zone unless an approved override is configured.

### 4.6 Kiosk Display Behavior

- The display must be optimized for full-screen use.
- The display must refresh schedule data automatically without manual reload.
- The display must recover gracefully after network interruptions.
- The display must show a clear offline or stale-data state if schedule data cannot be refreshed.
- The display must support portrait and landscape layouts.
- The display must prevent visual overlap or unreadable text on common kiosk screen sizes.

### 4.6.1 Public Route Structure

The application must support a single public domain with path-based routes.

- Management portal: `https://signage.bapswest.org/admin`
- Kiosk room display: `https://signage.bapswest.org/<<UNIQUE-ROOM-CODE>>`
- Room preview display: `https://signage.bapswest.org/preview/<<UNIQUE-ROOM-CODE>>`
- API routes: `https://signage.bapswest.org/api`

Route requirements:

- `<<UNIQUE-ROOM-CODE>>` must be non-guessable and unique per room.
- Kiosk display routes must be read-only and must not expose management functions.
- Preview routes must require authenticated management portal access.
- API routes must enforce authentication and authorization based on the requested action.
- Real-time kiosk updates, emergency broadcasts, and management-portal refresh actions must work through the same public domain.

### 4.7 Emergency and Safety Broadcast Display

- Emergency broadcasts must override normal room schedule content when active.
- Broadcasts must support severity levels such as informational, warning, urgent, and emergency.
- Broadcasts must be targetable by center, campus, building, room group, or individual room.
- Users with emergency broadcast access must be able to trigger messages only for centers, campuses, buildings, or rooms assigned by their role and access scope.
- Users must be able to select one or more eligible target entities before broadcasting a message.
- The display must clearly show broadcast title, message, and effective time.
- The kiosk display must play an alert sound during active emergency and safety broadcasts.
- The default alert sound must use `assets/audio/mixkit-classic-alarm-995.wav`.
- The alert sound must repeat continuously every 15 seconds while the Emergency/Safety Broadcast is active.
- The display must return to normal signage after the broadcast expires or is ended.
- The display must support prepared broadcast templates that can be launched immediately by authorized users.
- Broadcast templates must support title, message body, severity, visual style, audible alert setting if supported by device, default target scope, and approval requirements.

## 5. Backend and Management Portal Requirements

The management portal must provide secure administrative access to configure the system.

### 5.1 Center Management

- Create, edit, deactivate, and view centers.
- Store center name, description, logo, contact details, default time zone, and default settings.
- Assign campuses to a center.
- Configure center-level booking URL defaults.
- Configure center-level theme defaults.
- Configure center-level calendar integration settings when applicable.

### 5.2 Campus Management

- Create, edit, deactivate, and view campuses.
- Associate each campus with one center.
- Store campus name, address, time zone, contact details, and default settings.
- Assign buildings to a campus.
- Configure campus-level booking URL and theme overrides.

### 5.3 Building Management

- Create, edit, deactivate, and view buildings.
- Associate each building with one campus.
- Store building name, code, address, floor details, and default time zone.
- Assign rooms to a building.
- Configure building-level booking URL and theme overrides.
- Target notifications and safety broadcasts to a building.

### 5.4 Room Management

- Create, edit, deactivate, and view rooms.
- Associate each room with one building.
- Store room name, room number, capacity, location, floor, room type, equipment, and accessibility notes.
- Configure room-specific booking link.
- Configure room-specific calendar source.
- Configure room display URL.
- Generate room QR code.
- Preview kiosk display for a room.
- Mark a room as unavailable for maintenance or closure.
- Configure room privacy settings.

### 5.5 User Management

- Create, edit, deactivate, and view users.
- Support invitation or account provisioning workflows.
- Assign users to roles.
- Scope user access by center, campus, building, or room.
- Track user status such as active, invited, suspended, or deactivated.
- Support email address as username.
- Store passwords securely using encrypted or hashed password storage.
- Support two-factor authentication using an authenticator app.
- Allow users to be assigned to multiple centers when authorized.
- External identity provider support should be planned for a future version.

### 5.6 Role Management

- Create, edit, deactivate, and view roles.
- Configure permissions by module and action.
- Support default system roles.
- Allow System Administrators to clone roles.
- Allow System Administrators to modify cloned or custom role permissions.
- Support flexible role definitions instead of hard-coded role permissions.
- Prevent deletion of roles currently required by active users unless reassigned.
- Record role changes in audit logs.

### 5.7 Feature Management

- Enable or disable system features by center, campus, building, room, or role.
- Grant or revoke feature access for individual users.
- Support feature flags for calendar sync, conflict resolution, theme management, notifications, and emergency broadcasts.
- Show enabled and disabled status clearly in the management portal.
- Restrict feature configuration to authorized administrators.
- Support scheduled activation and expiration for feature access when needed.

## 6. Feature Requirements

### 6.1 Calendar Sync

- The system must support external calendar synchronization for room schedules.
- Calendar sync must support Google Calendar and Microsoft 365.
- Calendar sync should support public calendar URLs where provided by calendar services.
- Public calendar URL feeds should be treated as read-only and should be expected to update approximately every 15 minutes depending on provider behavior.
- Additional calendar providers may be added in future releases.
- The system must support a hybrid calendar-account model with multiple connected calendar accounts.
- Each connected calendar account may provide access to multiple calendars.
- System Administrators must be able to assign a specific calendar from any connected calendar account to a room.
- Each room must be able to map to a calendar resource or calendar feed.
- The system must import event title, start time, end time, organizer, location, description, and privacy status when available.
- The system must import recurring events and recurrence exceptions from connected calendars.
- Sync frequency must be configurable.
- The system must support manual refresh by authorized users.
- The system must show sync status, last successful sync time, and sync errors.
- The system must avoid exposing private calendar details on kiosk displays unless explicitly allowed.
- Private events must display as "Private Event" on kiosk displays.
- Rental events must display as "Private Event" on kiosk displays.
- The system should identify private or rental events by privacy status when available, or by the phrases "Private Event" or "Rental Event" in the event description.

### 6.2 Calendar Event Conflict Resolution

- The system must detect overlapping events for the same room.
- Conflicts must be visible in the management portal.
- Authorized users must be able to review conflict details.
- The system should support conflict resolution actions such as ignore, cancel, replace, move, or mark as resolved.
- Conflict resolution must not require a separate approval step before applying the selected resolution.
- If the system has writable access to the source calendar, conflict resolution actions may update calendar events.
- If the system has read-only access, such as a public calendar URL, users must resolve conflicts outside the system and then refresh or wait for the next sync.
- The system should preserve an audit trail of conflict decisions.
- The kiosk display must use configured conflict handling rules to decide which event appears.

### 6.3 Front-End Theme and Style Management

- Administrators must be able to configure kiosk display branding.
- Theme settings should include logo, colors, typography, background, layout style, and display density.
- Each center must have a standard default kiosk template.
- Each center must have its own default theme.
- The system must include three built-in kiosk themes: Classic Institutional, Event Formal, and Custom Background.
- System Administrators must be able to clone each built-in theme and customize the cloned theme.
- All center default themes must use the mandatory default logo image at `assets/branding/aksharderi-small2.png`.
- The default logo must be rendered as an image asset, not as text, CSS artwork, icon font, or recreated vector art.
- Center name, building name, room name, current time, room status, QR code, and upcoming-event structure must remain constant across center default themes.
- Themes and templates may be assigned at center, campus, building, or room level.
- Lower-level themes should be able to inherit or override higher-level defaults.
- Event-based templates may use a different logo image when authorized through feature G3.
- Administrators must be able to preview themes before publishing.
- Published theme changes must update kiosk displays without redeploying application code.
- The system must allow authorized users to create, update, clone, publish, archive, and restore kiosk templates through feature G3.
- Administrators must be able to clone kiosk templates.
- Google Fonts may be used by kiosk templates when the selected font is approved and available to the kiosk display.
- Colors, fonts, spacing rules, and accessibility contrast requirements must be configurable by template.
- Available, Busy, Buffer/Warning, and Emergency/Safety Broadcast status colors must be standardized across all centers.
- Status colors may only be changed by a System Administrator.
- Each built-in theme and each cloned theme must support Available, Busy, and Buffer/Warning display states.
- Kiosk theme header and footer areas should each use 10% of the screen height.
- Template changes may be scheduled from the management interface.
- Scheduled template changes must support start date/time, end date/time, target scope, and priority.
- Scheduled templates may be applied for special events by campus, building, or room while preserving the center default template.
- When a scheduled template ends, the kiosk display must automatically return to the center's default template.
- If multiple scheduled templates overlap, the system must apply a clear precedence order: room override, building override, campus override, center default.
- The default attached-screen style must be available as a configurable CSS template in `templates/kiosk-default.css`.
- The previously provided Available and Busy signage images should be treated as approved baseline layout references.

### 6.3.1 Suggested Theme Directions

The following theme directions are proposed options for future review. Final theme choices should be selected by the product owner.

- Classic Institutional: Uses the mandatory logo, high-contrast status colors, large sans-serif type, generous spacing, and a layout close to the provided Available and Busy examples.
- Modern Minimal: Uses the mandatory logo, cleaner whitespace, Google Fonts such as Inter or Roboto, lighter event cards, and a calm visual hierarchy for repeated daily use.
- High Visibility: Uses the mandatory logo, larger status type, stronger contrast, larger QR code, and fewer decorative elements for long-distance readability.
- Event Formal: Uses the mandatory logo or authorized event logo, refined typography such as Noto Sans or Source Sans 3, balanced spacing, and a polished look for conferences or special programs.
- Custom Background: Uses the mandatory logo, the approved background image, prominent status content, and event cards over the background artwork.
- Compact Operations: Uses the mandatory logo, denser upcoming-event list, smaller footer, and tighter spacing for screens that need to show more schedule detail.

Sample HTML/CSS previews for the refined Classic Institutional, Event Formal, and Custom Background layouts, with Available, Busy, and Buffer/Warning states, are available in `samples/kiosk-layout-options.html`.

### 6.4 Notifications

- The system must support administrative notifications for schedule sync issues, room conflicts, broadcast status, and system health events.
- Notifications should support in-app delivery.
- Email notification support should be configurable if enabled.
- SMS and push notifications are future enhancements.
- Administrators must be able to define notification recipients by role and location scope.
- System health and calendar sync failure email notifications must go to Center Administrators or users assigned to the whole affected center.
- Notifications must include timestamp, severity, source, and action link when applicable.
- Users must be able to view notification history based on permission.

### 6.5 Emergency and Safety Broadcast

- Authorized users must be able to create emergency or safety broadcasts.
- Broadcasts must include title, message, severity, start time, end time, and target scope.
- Broadcasts must be targetable by center, campus, building, room group, or specific room.
- Broadcast target choices must be limited to entities assigned to the user's role and access scope.
- Users must be able to select one or more eligible centers, campuses, buildings, and rooms for a broadcast.
- Emergency and safety broadcasts must require confirmation before publishing.
- No emergency or safety broadcast template may bypass confirmation.
- Active emergency broadcasts must override normal kiosk signage content.
- Active emergency and safety broadcasts must play an alert sound on the kiosk display.
- The default alert sound must use `assets/audio/mixkit-classic-alarm-995.wav`.
- The alert sound must repeat every 15 seconds until the broadcast ends or is revoked.
- Broadcasts must be revocable by authorized users.
- The system must track who created, updated, started, and ended each broadcast.
- The management portal must clearly show active broadcasts.
- The system must provide ready-to-use broadcast message templates that authorized users can launch at any moment.
- Broadcast templates must be editable only by authorized administrators.
- Broadcast template examples must include:
  - Evacuation Order:
    - Title: "CRITICAL EVACUATION SIREN"
    - Message: "URGENT: ALL INSTRUCTORS & STUDENTS IMMEDIATELY CLEAR THE PREMISES. PROCEED TO CAMPUS LAWN AREA."
  - Severe Weather Sheltering:
    - Title: "IMPORTANT SYSTEM OVERRIDE"
    - Message: "TORNADO WARNING IN EFFECT. MOVE ALL STUDENTS TO THE LOWEST LEVEL CENTRAL HALLWAYS IMMEDIATELY."
  - Campus Lockdown:
    - Title: "CRITICAL EVACUATION SIREN"
    - Message: "SECURITY ACTION IN PROGRESS. LOCK CLASSROOM DOORS, TURN OUT LIGHTS, AND COVER ALL WINDOW GLASS."
  - Fire Drill or System Testing:
    - Title: "IMPORTANT SYSTEM OVERRIDE"
    - Message: "ADMINISTRATIVE OVERRIDE: ACTIVE ALARM DRILL RUNNING. VACATE BUILDING ACCORDING TO DRILL PROTOCOLS."

## 7. Data Requirements

### 7.1 Core Entities

- Center
- Campus
- Building
- Room
- User
- Role
- Permission
- Calendar Account
- Calendar Integration
- Calendar Event
- Event Conflict
- Theme
- Kiosk Template
- Kiosk Template Schedule
- Kiosk Device
- Notification
- Emergency Broadcast
- Broadcast Template
- User Feature Access Grant
- Audit Log

### 7.2 Room Data Fields

- Room ID
- Room name
- Room number
- Room type
- Capacity
- Building
- Campus
- Center
- Floor
- Inherited center time zone
- Booking URL
- Manual room booking URL
- Calendar source
- Display URL
- QR code value
- Theme assignment
- Active status
- Maintenance status

### 7.3 Event Data Fields

- Event ID
- External calendar ID
- Room ID
- Title
- Class name
- Organizer
- Start time
- End time
- Center display time zone
- Privacy status
- Source system
- Sync status
- Last updated time

### 7.4 Calendar Account Data Fields

- Calendar account ID
- Provider such as Google Calendar, Microsoft 365, or public URL
- Account name
- Authentication type
- Access level such as read-only or writable
- Connected calendars
- Active status
- Last successful sync time
- Last sync error
- Created by
- Last updated by

### 7.5 Kiosk Template Data Fields

- Template ID
- Template name
- Center ID
- CSS template source or managed style token values
- Logo assignment
- Mandatory default logo image path
- Available state colors
- Busy state colors
- Buffer/Warning state colors
- Emergency/Safety Broadcast state colors
- Typography settings
- Google Font selection
- Layout settings
- Publication status
- Created by
- Last updated by
- Last published time

### 7.6 Kiosk Template Schedule Data Fields

- Schedule ID
- Template ID
- Target scope type such as center, campus, building, or room
- Target entity IDs
- Start time
- End time
- Priority
- Status
- Created by
- Last updated by

### 7.7 Kiosk Device Data Fields

- Device ID
- Room ID
- Device name
- Device type
- Browser
- Registered room URL
- Registration token
- Last check-in time
- Last IP address
- Audio autoplay enabled status
- Active status
- Created by
- Last updated by

### 7.8 Broadcast Template Data Fields

- Broadcast template ID
- Template name
- Broadcast title
- Broadcast message
- Severity
- Default visual style
- Default target scope
- Approval requirement
- Active status
- Created by
- Last updated by

### 7.9 User Feature Access Grant Data Fields

- Grant ID
- User ID
- Feature code
- Access scope type such as center, campus, building, room, or global
- Access scope entity IDs
- Grant status
- Effective start time
- Effective end time
- Granted by
- Last updated by

## 8. Security Requirements

- All management portal access must require authentication.
- Administrative actions must require role-based authorization.
- User permissions must respect location scope.
- Sensitive calendar event details must be protected.
- Private events must not expose title, organizer, or description unless allowed by policy.
- All create, update, delete, login, role assignment, broadcast, and conflict resolution actions must be logged.
- Kiosk display URLs should use non-guessable identifiers or another approved access control method.
- The system must protect against unauthorized broadcast creation.

## 9. Audit and Reporting Requirements

- Maintain audit logs for administrative changes.
- Retain audit logs for no more than 6 months.
- Track calendar sync success and failure history.
- Retain calendar sync history for no more than 6 months.
- Track conflict detection and resolution history.
- Retain conflict history for no more than 6 months unless a shorter operational retention policy is configured.
- Track emergency broadcast lifecycle.
- Provide reports or exports for room usage, conflicts, sync health, and broadcast history.

## 10. Non-Functional Requirements

### 10.1 Availability and Reliability

- Kiosk displays should remain readable even if backend connectivity is temporarily unavailable.
- The system should cache the latest known room schedule.
- The system should automatically retry failed schedule refreshes.
- Emergency broadcasts should propagate to targeted displays as quickly as possible.

### 10.2 Performance

- Kiosk pages should load quickly on standard signage devices.
- Schedule updates should appear without requiring manual refresh.
- Authorized users must be able to refresh a kiosk page from the management portal.
- Management-portal-triggered refreshes should update schedule, status, template, and broadcast content without requiring physical access to the kiosk device.
- Management portal list views should support search, filtering, and pagination.
- The system should support multiple campuses, buildings, and rooms without major performance degradation.

### 10.3 Accessibility

- Kiosk displays should use readable contrast and large type.
- Management portal controls should support keyboard navigation.
- Status indicators should not rely on color alone.
- Emergency messages should be visually prominent and readable from a distance.

### 10.4 Device and Browser Support

- Kiosk display must support modern browsers.
- Kiosk display must support common tablets, signage browsers, and large displays.
- Management portal must support modern desktop browsers.
- Responsive layouts must support common desktop, tablet, and kiosk resolutions.
- Recommended kiosk device categories are ChromeOS devices in kiosk mode, Windows mini PCs or signage players running Microsoft Edge or Google Chrome in kiosk mode, Android tablets or Android signage players with a managed kiosk browser, and Raspberry Pi or Linux signage devices running Chromium in kiosk mode.
- Recommended kiosk browsers are Google Chrome, Microsoft Edge, or Chromium-based kiosk browsers.
- Kiosk devices must be configured to allow audio autoplay for `https://signage.bapswest.org`.
- Kiosk pages should require device registration in addition to the unique room URL for production use.
- Device registration should bind a physical kiosk device to a room, record device name, device type, last check-in time, browser, IP address, and active status.
- The unique room URL may be sufficient for early testing and pilot use.

### 10.5 Server Hardware Requirements

The first production deployment may run on one on-premise Proxmox virtual machine because the expected scale is approximately 10 to 12 centers, 1 to 2 campuses per center, and 10 to 30 rooms per center.

Recommended production VM:

- CPU: 8 virtual CPUs minimum.
- Memory: 24 GB minimum, 32 GB recommended.
- Storage: 300 GB minimum SSD/NVMe-backed storage, 500 GB recommended.
- Network: reliable wired network connection with outbound internet access for Cloudflare Tunnel, Google Calendar, Microsoft 365, public calendar feeds, and email delivery.
- Backup storage: Proxmox backup target plus separate offsite backup copy.
- UPS or equivalent power protection recommended for the Proxmox host and network equipment.

Minimum smaller pilot VM:

- CPU: 4 virtual CPUs.
- Memory: 12 GB.
- Storage: 150 GB SSD/NVMe-backed storage.

### 10.6 Server Software Requirements

Recommended software stack:

- Virtualization: Proxmox VE.
- Operating system: Debian 12.
- Reverse proxy: Nginx.
- Application runtime: Node.js application deployed through Docker containers.
- Deployment: Docker and Docker Compose.
- Database: PostgreSQL.
- Queue/cache/live-message support: Redis.
- Background processing: worker and scheduler containers.
- Public access: Cloudflare Tunnel pointing to local Nginx.
- File storage: local mounted storage for first release, with future option for S3-compatible object storage or MinIO.
- TLS: handled through Cloudflare public access, with Nginx serving the local application behind the tunnel.
- Monitoring: system health, application logs, database backups, disk usage, and tunnel status monitoring.
- Source repository: `https://github.com/dcswami/signage-chatgpt`.
- Production and staging/test environments may run on the same Proxmox VM using separate Docker Compose projects, separate databases, separate Redis namespaces or instances, separate environment files, and separate Nginx routes.

Required application services:

- Web/API service for management portal, kiosk pages, preview pages, and API routes.
- Worker service for calendar sync, conflict detection, notifications, and broadcast processing.
- Scheduler service for recurring jobs, template schedules, broadcast expiration, and periodic calendar refresh.
- PostgreSQL database service.
- Redis service.
- Nginx reverse proxy.
- Cloudflare Tunnel service.

The deployment must support WebSocket or Server-Sent Events for instant kiosk refresh and Emergency/Safety Broadcast updates. A polling fallback should also be supported for kiosk reliability.

Deployment steps for the recommended Proxmox setup are documented in `PROXMOX_DEPLOYMENT_GUIDE.md`.
Git upload and server pull steps are documented in `GIT_WORKFLOW_GUIDE.md`.
Test environment deployment steps are documented in `TEST_ENVIRONMENT_DEPLOYMENT.md`.

### 10.7 Backup and Recovery Requirements

- PostgreSQL backups must run automatically at least daily.
- Uploaded assets, branding files, and theme assets must be included in backups.
- Docker Compose configuration, environment files, and Nginx configuration must be backed up securely.
- Backups must include an offsite copy outside the Proxmox host.
- Restore steps must be documented and tested before production launch.
- The system should support restoring service on a replacement VM if the primary VM fails.
- Staging and production backups must be clearly separated.

## 11. Management Portal User Experience Requirements

- Provide dashboard summary of active rooms, sync health, conflicts, notifications, and active broadcasts.
- Provide search and filters for centers, campuses, buildings, rooms, users, roles, events, and notifications.
- Provide clear status indicators for active, inactive, offline, conflict, maintenance, and broadcast states.
- Provide preview capability for room signage pages.
- Provide confirmation steps for destructive or high-impact actions.
- Provide clear success and error messages after administrative actions.

### 11.1 Dashboard

- The dashboard must show a list of all rooms available to the user's role and access scope.
- The dashboard must show each room's current status: Available, Busy, Buffer/Warning, or Emergency/Safety Broadcast.
- The dashboard must show live preview of each room's signage display.
- The dashboard must allow authorized users to refresh a room's kiosk display from the management portal.
- Live previews must help administrators investigate display, schedule, template, and broadcast issues without visiting the physical room.

## 12. Initial MVP Scope

The initial release should include:

- Center, campus, building, and room management.
- User and role management with basic permissions.
- Email username and password authentication.
- Two-factor authentication using an authenticator app.
- Dedicated kiosk display page per room.
- Facility name, building name, logo, room name, current event or room status, current time, booking QR code, booking link, class name, and upcoming events.
- Calendar sync for Google Calendar and Microsoft 365.
- Read-only calendar sync through public calendar URLs.
- Basic event conflict detection.
- Basic theme management with the default center kiosk template.
- Scheduled kiosk template changes by campus, building, or room.
- Basic notifications for sync failures and conflicts.
- Emergency broadcast creation, prepared broadcast templates, scoped target selection, and display override.
- Production and staging/test environments on the same Proxmox server.
- Device registration for production kiosk devices.

## 13. Future Enhancements

- Multi-provider calendar sync.
- External identity provider authentication.
- SMS and push notifications.
- Different signage devices for the same room using different templates.
- Advanced device management policies beyond room-level device registration.
- Room check-in and auto-release.
- Touchscreen booking from kiosk display.
- Digital wayfinding.
- Room utilization analytics.
- Occupancy sensor integration.
- Mobile app support.
- Approval workflows for booking requests.
- Advanced recurrence and exception handling.
- Multi-language kiosk displays.

## 14. Confirmed Product Decisions

- Google Calendar and Microsoft 365 are required calendar providers for the first release.
- Public calendar URLs should be supported as read-only calendar feeds where possible.
- Booking from signage must happen only through the QR code and booking link, not through direct kiosk interaction.
- Booking URLs are managed manually per room.
- QR codes do not need to be downloadable or printable from the management portal in the first release.
- The system uses a hybrid calendar-account model with multiple connected calendar accounts.
- Each connected calendar account may provide access to multiple calendars.
- System Administrators assign calendars to rooms.
- Recurring events and recurrence exceptions must be loaded from the source calendar.
- If writable calendar access is available, the system may update events during conflict resolution.
- If only read-only calendar access is available, users must resolve conflicts separately in the source calendar system.
- Conflict resolution does not require a separate approval step.
- Private and rental events must display as "Private Event" on kiosk displays.
- Rental and private events may be identified by the phrases "Rental Event" or "Private Event" in the event description.
- Emergency broadcast ability is granted by System Admin through feature access and limited by the user's assigned role and scope.
- Emergency and safety broadcasts require confirmation before publishing.
- Emergency and safety broadcast templates may not bypass confirmation.
- Emergency and safety broadcast alert sound uses `assets/audio/mixkit-classic-alarm-995.wav` and repeats every 15 seconds until the broadcast ends.
- Role permissions are flexible and may be modified or cloned by System Administrators.
- A user may belong to multiple centers.
- Audit logs, calendar sync history, and conflict history are retained for no more than 6 months.
- System health and sync failure email notifications go to Center Administrators or users assigned to the whole center.
- Staging/test and production environments may run on one Proxmox server if they are isolated by separate Docker Compose projects, databases, Redis instances or namespaces, environment files, and Nginx routes.
- SMS and push notifications are not required in the first release.
- Multiple physical signage devices may show the same room kiosk page in the first release.
- Different signage devices for the same room with different templates are a future enhancement.
- The first production deployment may use one on-premise Proxmox VM with Debian 12, Nginx, Docker, PostgreSQL, Redis, and Cloudflare Tunnel.
- Public access uses `signage.bapswest.org` with path-based routes for admin, kiosk, preview, and API access.
- Initial authentication uses email as username, encrypted or hashed password storage, and authenticator-app two-factor authentication.
- External identity provider support is a future enhancement.
- The mandatory default logo for all center default themes is `assets/branding/aksharderi-small2.png`.
- The logo must be rendered from an image asset.
- Each center has its own default theme.
- Classic Institutional, Event Formal, and Custom Background are built-in system themes.
- Classic Institutional and Modern Minimal are approved default theme directions.
- Event Formal is the approved event-template theme direction.
- System Administrators can clone each built-in theme and customize the cloned copy.
- System Administrators can set and modify the default theme for each center.
- Center name, building name, room name, current time, room status, QR code, and upcoming-event structure remain constant across center default themes.
- Event-based templates may use a different authorized logo image.
- Available, Busy, Buffer/Warning, and Emergency/Safety Broadcast colors are standardized across centers and may only be changed by a System Administrator.
- Expected scale is approximately 10 to 12 centers.
- Each center is expected to have 1 to 2 campuses.
- Each center is expected to have approximately 10 to 30 rooms.

## 15. Acceptance Criteria

- An administrator can create a center, campus, building, and room.
- An administrator can configure a logo and default theme.
- An administrator can assign the default kiosk template to a center.
- An administrator can clone an existing kiosk template.
- A System Administrator can clone Classic Institutional, Event Formal, and Custom Background themes.
- Each built-in theme supports Available, Busy, and Buffer/Warning states.
- An authorized user can schedule a temporary kiosk template change for a campus, building, or room.
- A room has a unique kiosk display URL.
- The kiosk display shows room availability and current event information.
- The kiosk display supports Available, Busy, Buffer/Warning, and Emergency/Safety Broadcast statuses.
- The kiosk display shows current time in the center's local time zone.
- The kiosk display shows a booking QR code and readable booking link.
- Booking URLs can be managed manually per room.
- The kiosk display shows upcoming events.
- Calendar events sync into the system from Google Calendar and Microsoft 365 for configured rooms.
- Calendar events can sync from supported public calendar URLs as read-only feeds.
- System Administrators can connect multiple calendar accounts and assign calendars to rooms.
- Recurring events and recurrence exceptions load from connected calendars.
- Private and rental events display as "Private Event" on kiosk displays.
- Conflicting events are detected and visible to authorized users.
- Conflict resolution can be applied without a separate approval step.
- An administrator can grant and revoke a user's access to Calendar Sync, Calendar Event Conflict Resolution, Front End Theme and Style Management, Notifications, and Emergency & Safety Broadcast.
- A System Administrator can clone and modify roles.
- A user can belong to multiple centers.
- An authorized user can create an emergency broadcast.
- An authorized user can select eligible center, campus, building, or room targets before sending a broadcast.
- An authorized user can launch a prepared emergency broadcast template.
- Emergency and safety broadcasts require confirmation before publishing.
- Active emergency and safety broadcasts play an alert sound on kiosk displays.
- Active emergency and safety broadcast audio repeats every 15 seconds.
- Active emergency broadcasts override normal room signage.
- The dashboard shows all rooms available to the user's role and displays each room's current status.
- The dashboard provides live signage previews for rooms available to the user's role.
- Production kiosk devices can be registered to rooms.
- Audit logs and calendar sync history are retained for no more than 6 months.
- Users can be assigned roles and permissions.
- Administrative changes are recorded in audit logs.
