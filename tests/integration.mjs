import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "signage-test-"));
const port = 3187;
const smtpPort = 3188;
const calendarPort = 3189;
const baseUrl = `http://127.0.0.1:${port}`;
const icalDate = date => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const listen = (server, listenPort) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(listenPort, "127.0.0.1", resolve);
});
const calendarStart = new Date(Date.now() + 60 * 60 * 1000);
const calendarEvents = Array.from({ length: 7 }, (_, index) => {
  const startsAt = new Date(calendarStart.getTime() + index * 60 * 60 * 1000);
  if (index === 1) startsAt.setTime(calendarStart.getTime() + 15 * 60 * 1000);
  return {
    uid: `calendar-event-${index + 1}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
    title: index === 0 ? "Rental Planning Meeting" : `Integration Event ${index + 1}`,
    description: index === 0 ? "Rental Event" : `Description ${index + 1}`,
    privacy: index === 0
  };
});
const calendarServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/calendar" });
  res.end([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Signage Test//EN",
    ...calendarEvents.flatMap(event => [
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTART:${icalDate(event.startsAt)}`,
      `DTEND:${icalDate(event.endsAt)}`,
      `SUMMARY:${event.title}`,
      `DESCRIPTION:${event.description}`,
      event.privacy ? "CLASS:PRIVATE" : "CLASS:PUBLIC",
      "END:VEVENT"
    ]),
    "END:VCALENDAR"
  ].join("\r\n"));
});
await listen(calendarServer, calendarPort);
const smtpMessages = [];
const smtpServer = net.createServer(socket => {
  let dataMode = false;
  let message = "";
  socket.write("220 localhost test smtp\r\n");
  socket.on("data", chunk => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (dataMode) {
        if (line === ".") {
          smtpMessages.push(message);
          message = "";
          dataMode = false;
          socket.write("250 message accepted\r\n");
        } else {
          message += `${line}\n`;
        }
        continue;
      }
      if (/^(EHLO|HELO)/i.test(line)) socket.write("250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 PIPELINING\r\n");
      else if (/^AUTH PLAIN/i.test(line)) socket.write("235 authenticated\r\n");
      else if (/^DATA/i.test(line)) {
        dataMode = true;
        socket.write("354 end with dot\r\n");
      } else if (/^QUIT/i.test(line)) socket.end("221 goodbye\r\n");
      else if (line) socket.write("250 ok\r\n");
    }
  });
});
await listen(smtpServer, smtpPort);
const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: rootDir,
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    HOST: "127.0.0.1",
    PORT: String(port),
    THEME_ASSETS_DIR: path.join(dataDir, "theme-assets"),
    CREDENTIAL_ENCRYPTION_KEY: "integration-test-credential-key-123456789"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

async function request(route, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, expectedStatus, `${route}: ${JSON.stringify(body)}`);
  return body;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await request("/api/health");
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error("Test server did not become healthy");
}

try {
  const health = await waitForServer();
  assert.equal(health.storage, "json");

  const initialState = await request("/api/state");
  assert.equal(initialState.rooms.length, 3);
  assert.equal(initialState.settings.email.hasPassword, false);
  assert.equal(initialState.roles.some(role => role.id === "campus-manager"), true);
  assert.equal(initialState.roles.some(role => role.id === "building-manager"), true);
  assert.equal(initialState.broadcastTemplates.length >= 4, true);
  assert.equal(initialState.permissionCatalog.includes("calendar.manage"), true);

  const customRole = await request("/api/roles", {
    method: "POST",
    body: JSON.stringify({ name: "Integration Calendar Viewer", permissions: ["dashboard.view", "calendar.sync"], active: true })
  }, 201);
  const clonedRole = await request(`/api/roles/${customRole.id}/clone`, {
    method: "POST",
    body: JSON.stringify({ name: "Integration Calendar Viewer Copy" })
  }, 201);
  assert.deepEqual(customRole.permissions, ["dashboard.view", "calendar.sync"]);
  assert.equal(clonedRole.builtIn, false);

  const emailSettings = await request("/api/settings/email", {
    method: "PUT",
    body: JSON.stringify({
      enabled: true,
      host: "127.0.0.1",
      port: smtpPort,
      secure: false,
      username: "smtp-user",
      password: "smtp-password",
      fromName: "Signage Test",
      fromEmail: "signage@example.org",
      replyTo: "support@example.org"
    })
  });
  assert.equal(emailSettings.enabled, true);
  assert.equal(emailSettings.hasPassword, true);
  assert.equal("encryptedPassword" in emailSettings, false);

  const smtpTest = await request("/api/settings/email/test", {
    method: "POST",
    body: JSON.stringify({ recipient: "test-recipient@example.org" })
  });
  assert.equal(smtpTest.emailSent, true);

  const center = await request("/api/centers", {
    method: "POST",
    body: JSON.stringify({
      name: "Integration Center",
      description: "Integration location",
      logoUrl: "/assets/branding/aksharderi-small2.png",
      contactName: "Center Contact",
      contactEmail: "center@example.org",
      contactPhone: "555-0100",
      bookingUrl: "https://example.org/center-booking",
      timezone: "America/Chicago",
      defaultThemeId: "classic-institutional",
      upcomingEventCount: 3,
      showEventDescription: true
    })
  }, 201);
  const campus = await request("/api/campuses", {
    method: "POST",
    body: JSON.stringify({
      name: "Integration Campus",
      centerId: center.id,
      address: "100 Campus Way",
      contactName: "Campus Contact",
      contactEmail: "campus@example.org",
      bookingUrl: "https://example.org/campus-booking",
      defaultThemeId: "event-formal"
    })
  }, 201);
  const building = await request("/api/buildings", {
    method: "POST",
    body: JSON.stringify({
      name: "Integration Building",
      campusId: campus.id,
      code: "IB",
      address: "100 Campus Way",
      floors: "1, 2",
      timezone: "America/Denver",
      bookingUrl: "https://example.org/building-booking",
      defaultThemeId: "custom-background"
    })
  }, 201);
  const room = await request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      name: "Integration Room",
      code: "integration-room",
      centerId: center.id,
      campusId: campus.id,
      buildingId: building.id,
      bookingUrl: "",
      themeId: "",
      roomNumber: "A-101",
      floor: "1",
      capacity: 25,
      equipment: "Projector, microphone",
      accessibilityNotes: "Step-free entrance",
      maintenanceStatus: "available",
      privacyMode: "private-title"
    })
  }, 201);

  assert.equal(room.timezone, "America/Denver");
  assert.equal(room.buildingName, "Integration Building");
  assert.equal(room.bookingUrl, "https://example.org/building-booking");
  assert.equal(room.themeName, "Custom Background");
  assert.equal(room.roomNumber, "A-101");
  await request(`/api/centers/${center.id}`, { method: "DELETE" }, 409);

  const calendarAccount = await request("/api/calendar-accounts", {
    method: "POST",
    body: JSON.stringify({
      accountName: "Integration Public Calendar",
      provider: "public-url",
      accessLevel: "read-only",
      syncIntervalMinutes: 15,
      active: true,
      calendars: [{ name: "Integration Events", externalId: `http://127.0.0.1:${calendarPort}/calendar.ics` }]
    })
  }, 201);
  const calendarInspection = await request(`/api/calendar-accounts/${calendarAccount.id}/discover`, {
    method: "POST",
    body: "{}"
  });
  assert.equal(calendarInspection.configured[0].status, "available");
  const calendarAssignment = await request("/api/calendar-assignments", {
    method: "POST",
    body: JSON.stringify({ roomId: room.id, accountId: calendarAccount.id, calendarId: calendarAccount.calendars[0].id })
  }, 201);
  const syncResult = await request(`/api/calendar-assignments/${calendarAssignment.id}/sync`, { method: "POST", body: "{}" });
  assert.equal(syncResult.eventCount, 7);
  const syncedRoom = await request("/api/rooms/integration-room");
  assert.equal(syncedRoom.upcomingEvents[0].title, "Private Event");
  assert.equal(syncedRoom.upcomingEvents[0].description, "");
  assert.equal(syncedRoom.upcomingEvents[1].description, "Description 2");
  assert.equal(syncedRoom.upcomingEventPageSize, 3);
  assert.equal(syncedRoom.upcomingEvents.length, 7);
  assert.equal(Boolean(syncedRoom.buildVersion), true);
  const conflictState = await request("/api/state");
  const calendarConflict = conflictState.calendarConflicts.find(item => item.roomId === room.id);
  assert.equal(Boolean(calendarConflict), true);
  const selectedConflict = await request(`/api/calendar-conflicts/${calendarConflict.id}/select`, {
    method: "POST",
    body: JSON.stringify({ externalEventId: calendarConflict.externalEventIds[1] })
  });
  assert.equal(selectedConflict.status, "display-selected");

  const qrResponse = await fetch(`${baseUrl}/api/rooms/integration-room/qr.svg`);
  assert.equal(qrResponse.status, 200);
  assert.match(qrResponse.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(await qrResponse.text(), /<svg/);

  const googleOauthAccount = await request("/api/calendar-accounts", {
    method: "POST",
    body: JSON.stringify({
      accountName: "Integration Google OAuth",
      provider: "google",
      authMode: "oauth",
      accessLevel: "read-only",
      clientId: "integration-google-client.apps.googleusercontent.com",
      credential: "integration-google-secret",
      active: true,
      calendars: []
    })
  }, 201);
  const oauthStart = await request(`/api/calendar-accounts/${googleOauthAccount.id}/oauth/start`);
  assert.match(oauthStart.authorizationUrl, /^https:\/\/accounts\.google\.com\//);

  const caldavAccount = await request("/api/calendar-accounts", {
    method: "POST",
    body: JSON.stringify({
      accountName: "Integration iCloud",
      provider: "caldav",
      authMode: "app-password",
      accessLevel: "writable",
      serverUrl: "https://caldav.icloud.com/",
      username: "calendar@example.org",
      credential: "app-specific-password",
      active: true,
      calendars: []
    })
  }, 201);
  assert.equal(caldavAccount.provider, "caldav");
  assert.equal(caldavAccount.hasCredential, true);

  const user = await request("/api/users", {
    method: "POST",
    body: JSON.stringify({
      name: "Integration User",
      email: "integration.user@example.org",
      status: "invited",
      roleIds: ["campus-manager", "building-manager"],
      centerIds: [center.id],
      campusIds: [campus.id],
      buildingIds: [building.id],
      features: ["Notifications"],
      sendInvitation: true
    })
  }, 201);
  assert.equal(user.status, "invited");
  assert.deepEqual(user.roleIds, ["campus-manager", "building-manager"]);
  assert.deepEqual(user.campusIds, [campus.id]);
  assert.deepEqual(user.buildingIds, [building.id]);
  assert.deepEqual(user.features, ["Notifications"]);
  assert.equal(user.invitedAt !== null, true);
  await request("/api/broadcasts/history", {
    headers: { "Content-Type": "application/json", "X-User-Id": user.id }
  }, 403);

  const updatedUser = await request(`/api/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...user,
      name: "Updated Integration User",
      status: "suspended",
      roleIds: ["building-manager"],
      centerIds: [center.id],
      campusIds: [],
      buildingIds: [building.id],
      features: ["Notifications", "Emergency & Safety Broadcast"]
    })
  });
  assert.equal(updatedUser.status, "suspended");
  assert.deepEqual(updatedUser.roleIds, ["building-manager"]);
  assert.deepEqual(updatedUser.buildingIds, [building.id]);
  await request("/api/centers", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": user.id },
    body: JSON.stringify({ name: "Unauthorized Center", timezone: "America/Chicago" })
  }, 403);
  await request("/api/broadcasts", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": user.id },
    body: JSON.stringify({
      title: "OUTSIDE SCOPE",
      message: "This must be rejected.",
      targetRoomCodes: ["room-108-shishu"],
      confirm: true
    })
  }, 403);

  const manualEmail = await request("/api/email/send", {
    method: "POST",
    body: JSON.stringify({
      userIds: [],
      roleIds: ["building-manager"],
      centerIds: [],
      subject: "Integration notification",
      message: "This is an integration notification."
    })
  });
  assert.equal(manualEmail.results[0].status, "sent");

  const broadcastTemplate = await request("/api/broadcast-templates", {
    method: "POST",
    body: JSON.stringify({
      name: "Integration Safety Template",
      title: "INTEGRATION ALERT",
      message: "This is a managed integration template.",
      severity: "critical",
      visualStyle: "emergency",
      audibleAlert: true,
      defaultTargetScope: "buildings",
      active: true
    })
  }, 201);
  assert.equal(broadcastTemplate.approvalRequired, true);

  const updatedBroadcastTemplate = await request(`/api/broadcast-templates/${broadcastTemplate.id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...broadcastTemplate,
      name: "Updated Integration Safety Template",
      severity: "warning",
      audibleAlert: false
    })
  });
  assert.equal(updatedBroadcastTemplate.name, "Updated Integration Safety Template");
  assert.equal(updatedBroadcastTemplate.approvalRequired, true);

  const updatedRoom = await request(`/api/rooms/${room.id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...room,
      name: "Updated Integration Room",
      code: "updated-integration-room",
      bookingUrl: "https://example.org/new-booking",
      themeId: "event-formal",
      capacity: 30
    })
  });
  assert.equal(updatedRoom.themeName, "Event Formal");
  assert.equal(updatedRoom.capacity, 30);
  assert.equal(updatedRoom.configuredBookingUrl, "https://example.org/new-booking");

  const kioskRegistration = await request("/api/kiosk-devices/register", {
    method: "POST",
    body: JSON.stringify({
      roomCode: updatedRoom.code,
      clientDeviceId: "integration-kiosk-device",
      name: "Integration iPad",
      browser: "Safari integration test",
      platform: "iPadOS",
      viewport: "1024x1366",
      orientation: "portrait",
      audioEnabled: true
    })
  }, 202);
  assert.equal(kioskRegistration.status, "pending");
  assert.equal(Boolean(kioskRegistration.pairingCode), true);
  assert.equal(Boolean(kioskRegistration.deviceToken), true);
  const approvedKiosk = await request(`/api/kiosk-devices/${kioskRegistration.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ pairingCode: kioskRegistration.pairingCode })
  });
  assert.equal(approvedKiosk.status, "active");
  await request(`/api/kiosk-devices/${kioskRegistration.id}/command`, {
    method: "POST",
    body: JSON.stringify({ command: "reload" })
  });
  const kioskHeartbeat = await request("/api/kiosk-devices/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      roomCode: updatedRoom.code,
      clientDeviceId: "integration-kiosk-device",
      deviceToken: kioskRegistration.deviceToken,
      browser: "Safari integration test",
      platform: "iPadOS",
      viewport: "1024x1366",
      orientation: "portrait",
      audioEnabled: true,
      lastDataAt: new Date().toISOString()
    })
  });
  assert.equal(kioskHeartbeat.status, "active");
  assert.equal(kioskHeartbeat.pendingCommand, "reload");
  const refreshResult = await request("/api/kiosks/refresh", {
    method: "POST",
    body: JSON.stringify({ centerIds: [center.id], command: "data-refresh" })
  });
  assert.equal(refreshResult.sent, 1);

  const clone = await request("/api/themes/classic-institutional/clone", {
    method: "POST",
    body: JSON.stringify({ name: "Integration Theme" })
  }, 201);
  assert.equal(clone.builtIn, false);
  const updatedTheme = await request(`/api/themes/${clone.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: "Updated Integration Theme",
      published: true,
      cssTokens: {
        ...clone.cssTokens,
        availableBg: "#d8f3dc",
        upcomingTileBg: "rgba(12, 34, 56, 0.65)",
        upcomingTitleText: "#ffffff",
        headerFont: "Georgia, serif"
      }
    })
  });
  assert.equal(updatedTheme.published, true);
  assert.equal(updatedTheme.cssTokens.availableBg, "#d8f3dc");
  assert.equal(updatedTheme.cssTokens.upcomingTileBg, "rgba(12, 34, 56, 0.65)");
  const backgroundTheme = await request(`/api/themes/${clone.id}/background`, {
    method: "POST",
    body: JSON.stringify({
      filename: "integration.png",
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    })
  });
  assert.match(backgroundTheme.cssTokens.backgroundImage, /^\/assets\/uploads\/themes\//);
  const uploadedBackgroundResponse = await fetch(`${baseUrl}${backgroundTheme.cssTokens.backgroundImage}`);
  assert.equal(uploadedBackgroundResponse.status, 200);
  assert.equal(uploadedBackgroundResponse.headers.get("content-type"), "image/png");
  const themedRoom = await request(`/api/rooms/room-108-shishu?theme=${clone.id}`);
  assert.equal(themedRoom.themeName, "Updated Integration Theme");
  assert.equal(themedRoom.themeCssTokens.headerFont, "Georgia, serif");
  const warningPreview = await request(`/api/rooms/room-108-shishu?theme=${clone.id}&state=warning`);
  assert.equal(warningPreview.status, "warning");
  assert.equal(warningPreview.currentEventTitle, "Sample Event Near Completion");

  const activeSchedule = await request("/api/theme-schedules", {
    method: "POST",
    body: JSON.stringify({
      themeId: clone.id,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      centerIds: [],
      campusIds: [],
      buildingIds: [],
      roomIds: [room.id]
    })
  }, 201);
  assert.equal(activeSchedule.ownerName, "System Administrator");
  const updatedSchedule = await request(`/api/theme-schedules/${activeSchedule.id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...activeSchedule,
      endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    })
  });
  assert.equal(updatedSchedule.updatedByName, "System Administrator");
  const scheduledRoom = await request("/api/rooms/updated-integration-room");
  assert.equal(scheduledRoom.themeName, "Updated Integration Theme");
  assert.equal(scheduledRoom.activeThemeScheduleId, activeSchedule.id);

  const pastSchedule = await request("/api/theme-schedules", {
    method: "POST",
    body: JSON.stringify({
      themeId: clone.id,
      startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      centerIds: [],
      campusIds: [],
      buildingIds: [building.id],
      roomIds: []
    })
  }, 201);
  const oldSchedule = await request("/api/theme-schedules", {
    method: "POST",
    body: JSON.stringify({
      themeId: clone.id,
      startsAt: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
      centerIds: [],
      campusIds: [],
      buildingIds: [],
      roomIds: [room.id]
    })
  }, 201);
  const scheduleState = await request("/api/state");
  assert.equal(scheduleState.themeSchedules.some(item => item.id === pastSchedule.id && item.ownerName === "System Administrator"), true);
  assert.equal(scheduleState.themeSchedules.some(item => item.id === oldSchedule.id), false);

  const roomGroup = await request("/api/room-groups", {
    method: "POST",
    body: JSON.stringify({
      name: "Integration Safety Group",
      description: "One-room test group",
      roomIds: [room.id],
      active: true
    })
  }, 201);
  assert.deepEqual(roomGroup.roomIds, [room.id]);

  const broadcast = await request("/api/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      title: "SCOPED TEST",
      message: "Integration test",
      templateId: broadcastTemplate.id,
      roomGroupIds: [roomGroup.id],
      confirm: true
    })
  }, 201);
  const simultaneousBroadcast = await request("/api/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      title: "SECOND SCOPE",
      message: "Separate room alert",
      severity: "emergency",
      roomIds: ["room-108"],
      confirm: true
    })
  }, 201);
  const targetRoom = await request("/api/rooms/updated-integration-room");
  const otherRoom = await request("/api/rooms/room-108-shishu");
  assert.equal(targetRoom.activeBroadcast.title, "SCOPED TEST");
  assert.equal(targetRoom.activeBroadcast.templateId, broadcastTemplate.id);
  assert.equal(otherRoom.activeBroadcast.title, "SECOND SCOPE");

  const updatedBroadcast = await request(`/api/broadcasts/${broadcast.id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...broadcast,
      title: "UPDATED SCOPED TEST",
      roomGroupIds: [roomGroup.id],
      roomIds: [],
      centerIds: [],
      campusIds: [],
      buildingIds: []
    })
  });
  assert.equal(updatedBroadcast.updatedByName, "System Administrator");
  assert.equal(updatedBroadcast.title, "UPDATED SCOPED TEST");

  const scheduledBroadcast = await request("/api/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      title: "FUTURE TEST",
      message: "Scheduled integration test",
      severity: "informational",
      audibleAlert: false,
      startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      buildingIds: [building.id],
      confirm: true
    })
  }, 201);
  assert.equal(scheduledBroadcast.status, "scheduled");
  await request(`/api/broadcasts/${scheduledBroadcast.id}/cancel`, { method: "POST", body: "{}" });

  await request(`/api/broadcasts/${broadcast.id}/end`, { method: "POST", body: "{}" });
  await request(`/api/broadcasts/${simultaneousBroadcast.id}/end`, { method: "POST", body: "{}" });

  const expiringBroadcast = await request("/api/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      title: "EXPIRING TEST",
      message: "This alert expires automatically.",
      severity: "warning",
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 250).toISOString(),
      roomIds: [room.id],
      confirm: true
    })
  }, 201);
  await new Promise(resolve => setTimeout(resolve, 400));
  const lifecycleState = await request("/api/state");
  assert.equal(lifecycleState.broadcastHistory.find(item => item.id === expiringBroadcast.id).status, "ended");
  assert.equal(lifecycleState.notifications.some(item => item.sourceId === broadcast.id), true);

  const broadcastHistory = await request("/api/broadcasts/history");
  const completedBroadcast = broadcastHistory.find(item => item.id === broadcast.id);
  assert.equal(completedBroadcast.status, "ended");
  assert.equal(Boolean(completedBroadcast.endedAt), true);
  assert.equal(completedBroadcast.createdByName, "System Administrator");
  await request(`/api/broadcast-templates/${broadcastTemplate.id}`, { method: "DELETE" });
  const stateAfterTemplateDelete = await request("/api/state");
  assert.equal(stateAfterTemplateDelete.broadcastTemplates.some(item => item.id === broadcastTemplate.id), false);
  await request(`/api/calendar-assignments/${calendarAssignment.id}`, { method: "DELETE" });
  await request(`/api/calendar-accounts/${calendarAccount.id}`, { method: "DELETE" });
  await request(`/api/calendar-accounts/${googleOauthAccount.id}`, { method: "DELETE" });
  await request(`/api/calendar-accounts/${caldavAccount.id}`, { method: "DELETE" });
  await request(`/api/kiosk-devices/${kioskRegistration.id}`, { method: "DELETE" });
  await request(`/api/theme-schedules/${activeSchedule.id}`, { method: "DELETE" });
  await request(`/api/theme-schedules/${pastSchedule.id}`, { method: "DELETE" });
  await request(`/api/theme-schedules/${oldSchedule.id}`, { method: "DELETE" });
  await request(`/api/themes/${clone.id}/background`, { method: "DELETE" });
  await request(`/api/room-groups/${roomGroup.id}`, { method: "DELETE" });
  await request(`/api/rooms/${room.id}`, { method: "DELETE" });
  await request(`/api/buildings/${building.id}`, { method: "DELETE" });
  await request(`/api/campuses/${campus.id}`, { method: "DELETE" });
  await request(`/api/centers/${center.id}`, { method: "DELETE" });
  await request(`/api/roles/${clonedRole.id}`, { method: "DELETE" });
  await request(`/api/roles/${customRole.id}`, { method: "DELETE" });

  const adminResponse = await fetch(`${baseUrl}/admin`);
  const adminHtml = await adminResponse.text();
  assert.match(adminHtml, /Locations & Rooms/);
  assert.match(adminHtml, /User Management/);
  assert.match(adminHtml, /SMTP Settings/);
  assert.match(adminHtml, /Emergency Broadcast/);
  assert.match(adminHtml, /Permission & Role Editor/);
  assert.match(adminHtml, /Calendar Accounts/);
  assert.match(adminHtml, /Live Theme Preview/);
  assert.match(adminHtml, /themePreviewRoom/);
  assert.match(adminHtml, /Theme Scheduler/);
  assert.match(adminHtml, /Upcoming Schedule/);
  assert.match(adminHtml, /Broadcast History/);
  assert.match(adminHtml, /Active Broadcasts/);
  assert.match(adminHtml, /Room Groups/);
  assert.match(adminHtml, /In-App Notifications/);
  assert.match(adminHtml, /Kiosk Devices/);
  const serviceWorkerResponse = await fetch(`${baseUrl}/static/kiosk-sw.js`);
  assert.equal(serviceWorkerResponse.status, 200);
  assert.match(await serviceWorkerResponse.text(), /signage-kiosk-runtime/);
  assert.equal(smtpMessages.length >= 3, true);

  const finalState = await request("/api/state");
  assert.equal(finalState.settings.email.hasPassword, true);
  assert.equal(JSON.stringify(finalState).includes("smtp-password"), false);
  assert.equal(finalState.emailNotifications.length >= 3, true);

  console.log("Integration checks passed");
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => smtpServer.close(resolve));
  await new Promise(resolve => calendarServer.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
}
