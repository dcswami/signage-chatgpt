import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "signage-test-"));
const port = 3187;
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: rootDir,
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    HOST: "127.0.0.1",
    PORT: String(port)
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
      targetRoomCodes: ["updated-integration-room"],
      confirm: true
    })
  }, 201);
  const targetRoom = await request("/api/rooms/updated-integration-room");
  const otherRoom = await request("/api/rooms/room-108-shishu");
  assert.equal(targetRoom.activeBroadcast.title, "SCOPED TEST");
  assert.equal(otherRoom.activeBroadcast, null);

  await request("/api/broadcasts/end", { method: "POST", body: "{}" });
  await request(`/api/rooms/${room.id}`, { method: "DELETE" });
  await request(`/api/buildings/${building.id}`, { method: "DELETE" });
  await request(`/api/campuses/${campus.id}`, { method: "DELETE" });
  await request(`/api/centers/${center.id}`, { method: "DELETE" });

  const adminResponse = await fetch(`${baseUrl}/admin`);
  const adminHtml = await adminResponse.text();
  assert.match(adminHtml, /Locations & Rooms/);
  assert.match(adminHtml, /Emergency Broadcast/);

  console.log("Integration checks passed");
} finally {
  child.kill("SIGTERM");
  await fs.rm(dataDir, { recursive: true, force: true });
}
