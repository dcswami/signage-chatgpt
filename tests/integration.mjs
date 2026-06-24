import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "signage-test-"));
const port = 3187;
const smtpPort = 3188;
const baseUrl = `http://127.0.0.1:${port}`;
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
await new Promise(resolve => smtpServer.listen(smtpPort, "127.0.0.1", resolve));
const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: rootDir,
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    HOST: "127.0.0.1",
    PORT: String(port),
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
      timezone: "America/Chicago",
      defaultThemeId: "classic-institutional"
    })
  }, 201);
  const campus = await request("/api/campuses", {
    method: "POST",
    body: JSON.stringify({ name: "Integration Campus", centerId: center.id })
  }, 201);
  const building = await request("/api/buildings", {
    method: "POST",
    body: JSON.stringify({ name: "Integration Building", campusId: campus.id, code: "IB" })
  }, 201);
  const room = await request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      name: "Integration Room",
      code: "integration-room",
      centerId: center.id,
      campusId: campus.id,
      buildingId: building.id,
      bookingUrl: "https://example.org/book",
      themeId: "classic-institutional",
      capacity: 25
    })
  }, 201);

  assert.equal(room.timezone, "America/Chicago");
  assert.equal(room.buildingName, "Integration Building");
  await request(`/api/centers/${center.id}`, { method: "DELETE" }, 409);

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

  const clone = await request("/api/themes/classic-institutional/clone", {
    method: "POST",
    body: JSON.stringify({ name: "Integration Theme" })
  }, 201);
  assert.equal(clone.builtIn, false);

  await request("/api/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      title: "SCOPED TEST",
      message: "Integration test",
      templateId: broadcastTemplate.id,
      targetRoomCodes: ["updated-integration-room"],
      confirm: true
    })
  }, 201);
  const targetRoom = await request("/api/rooms/updated-integration-room");
  const otherRoom = await request("/api/rooms/room-108-shishu");
  assert.equal(targetRoom.activeBroadcast.title, "SCOPED TEST");
  assert.equal(targetRoom.activeBroadcast.templateId, broadcastTemplate.id);
  assert.equal(otherRoom.activeBroadcast, null);

  await request("/api/broadcasts/end", { method: "POST", body: "{}" });
  await request(`/api/broadcast-templates/${broadcastTemplate.id}`, { method: "DELETE" });
  const stateAfterTemplateDelete = await request("/api/state");
  assert.equal(stateAfterTemplateDelete.broadcastTemplates.some(item => item.id === broadcastTemplate.id), false);
  await request(`/api/rooms/${room.id}`, { method: "DELETE" });
  await request(`/api/buildings/${building.id}`, { method: "DELETE" });
  await request(`/api/campuses/${campus.id}`, { method: "DELETE" });
  await request(`/api/centers/${center.id}`, { method: "DELETE" });

  const adminResponse = await fetch(`${baseUrl}/admin`);
  const adminHtml = await adminResponse.text();
  assert.match(adminHtml, /Locations & Rooms/);
  assert.match(adminHtml, /User Management/);
  assert.match(adminHtml, /SMTP Settings/);
  assert.match(adminHtml, /Emergency Broadcast/);
  assert.equal(smtpMessages.length >= 3, true);

  const finalState = await request("/api/state");
  assert.equal(finalState.settings.email.hasPassword, true);
  assert.equal(JSON.stringify(finalState).includes("smtp-password"), false);
  assert.equal(finalState.emailNotifications.length >= 3, true);

  console.log("Integration checks passed");
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => smtpServer.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
}
