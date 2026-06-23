import http from "node:http";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createStore } from "./storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
const assetVersion = process.env.APP_BUILD_VERSION || Date.now().toString(36);

const clients = new Map();

const seedData = {
  settings: {
    appName: "Signage Management System",
    routeBase: "https://signage.bapswest.org",
    alertSound: "/assets/audio/alarm.mp3"
  },
  features: [
    "Calendar Sync",
    "Calendar Event Conflict Resolution",
    "Front End Theme and Style Management",
    "Notifications",
    "Emergency & Safety Broadcast"
  ],
  centers: [
    { id: "center-la", name: "BAPS LA Center", timezone: "America/Los_Angeles", defaultThemeId: "classic-institutional" }
  ],
  campuses: [
    { id: "campus-la-main", centerId: "center-la", name: "Los Angeles Mandir Campus" }
  ],
  buildings: [
    { id: "building-shishu", campusId: "campus-la-main", name: "Shishu Building" }
  ],
  rooms: [
    {
      id: "room-108",
      code: "room-108-shishu",
      name: "Room 108 (Shishu Room)",
      centerId: "center-la",
      campusId: "campus-la-main",
      buildingId: "building-shishu",
      bookingUrl: "https://lamandir.site/erf",
      themeId: "classic-institutional",
      status: "available",
      currentEventTitle: "",
      currentEventUntil: "4:00 PM",
      currentTime: "8:05 AM"
    },
    {
      id: "room-205",
      code: "room-205-gujarati",
      name: "Room 205 (Gujarati Room)",
      centerId: "center-la",
      campusId: "campus-la-main",
      buildingId: "building-shishu",
      bookingUrl: "https://lamandir.site/erf",
      themeId: "event-formal",
      status: "busy",
      currentEventTitle: "Gujarati Class - I",
      currentEventUntil: "2:00 PM",
      currentTime: "8:05 AM"
    },
    {
      id: "room-301",
      code: "room-301-assembly",
      name: "Room 301 (Assembly Room)",
      centerId: "center-la",
      campusId: "campus-la-main",
      buildingId: "building-shishu",
      bookingUrl: "https://lamandir.site/erf",
      themeId: "custom-background",
      status: "warning",
      currentEventTitle: "Satsang Sabha Prep",
      currentEventUntil: "10 min",
      currentTime: "1:50 PM"
    }
  ],
  themes: [
    { id: "classic-institutional", name: "Classic Institutional", builtIn: true, cloneable: true },
    { id: "event-formal", name: "Event Formal", builtIn: true, cloneable: true },
    { id: "custom-background", name: "Custom Background", builtIn: true, cloneable: true }
  ],
  roles: [
    { id: "system-admin", name: "System Admin", cloneable: true, permissions: ["manage_all"] },
    { id: "center-admin", name: "Center Admin", cloneable: true, permissions: ["manage_center", "broadcast", "view_dashboard"] },
    { id: "room-manager", name: "Room Manager", cloneable: true, permissions: ["manage_rooms", "view_dashboard"] }
  ],
  users: [
    {
      id: "user-admin",
      name: "System Administrator",
      email: "admin@example.org",
      roleIds: ["system-admin"],
      centerIds: ["center-la"],
      features: [
        "Calendar Sync",
        "Calendar Event Conflict Resolution",
        "Front End Theme and Style Management",
        "Notifications",
        "Emergency & Safety Broadcast"
      ]
    }
  ],
  calendarAccounts: [
    {
      id: "calendar-google-main",
      provider: "Google Calendar",
      accountName: "LA Center Google Calendar",
      accessLevel: "writable",
      calendars: ["Room 108", "Room 205", "Room 301"]
    },
    {
      id: "calendar-public-feed",
      provider: "Public URL",
      accountName: "Public Room Feed",
      accessLevel: "read-only",
      calendars: ["Public Events"]
    }
  ],
  upcomingEvents: [
    { roomId: "room-108", title: "iB Parent's Meeting", detail: "Mon, Jun 22, 4:00 PM - 5:00 PM" },
    { roomId: "room-108", title: "Karyakar Meeting", detail: "Mon, Jun 22, 5:00 PM - 5:30 PM" },
    { roomId: "room-108", title: "iB Practice Session", detail: "Mon, Jun 22, 5:30 PM - 7:00 PM" },
    { roomId: "room-205", title: "iB Parent's Meeting", detail: "Mon, Jun 22, 4:00 PM - 5:00 PM" },
    { roomId: "room-205", title: "Karyakar Meeting", detail: "Mon, Jun 22, 5:00 PM - 5:30 PM" },
    { roomId: "room-205", title: "iB Practice Session", detail: "Mon, Jun 22, 5:30 PM - 7:00 PM" },
    { roomId: "room-301", title: "iB Parent's Meeting", detail: "Mon, Jun 22, 4:00 PM - 5:00 PM" },
    { roomId: "room-301", title: "Karyakar Meeting", detail: "Mon, Jun 22, 5:00 PM - 5:30 PM" }
  ],
  broadcasts: [],
  activeBroadcast: null,
  auditLogs: []
};

function normalizeData(data) {
  const normalized = {
    ...structuredClone(seedData),
    ...data,
    settings: {
    ...seedData.settings,
    ...data.settings,
    alertSound: seedData.settings.alertSound
    }
  };
  for (const key of ["features", "centers", "campuses", "buildings", "rooms", "themes", "roles", "users", "calendarAccounts", "upcomingEvents", "broadcasts", "auditLogs"]) {
    if (!Array.isArray(normalized[key])) normalized[key] = structuredClone(seedData[key] || []);
  }
  normalized.centers = normalized.centers.map(center => ({ active: true, ...center }));
  normalized.campuses = normalized.campuses.map(campus => ({ active: true, address: "", ...campus }));
  normalized.buildings = normalized.buildings.map(building => ({ active: true, code: "", ...building }));
  normalized.rooms = normalized.rooms.map(room => ({
    active: true,
    roomType: "Classroom",
    capacity: null,
    ...room
  }));
  return normalized;
}

const store = await createStore({ rootDir, seedData, normalize: normalizeData });
let db = store.state;

async function saveData(nextDb = db) {
  await store.save(nextDb);
}

function send(res, status, body, type = "text/html; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function json(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function publicRoom(room) {
  const center = db.centers.find(item => item.id === room.centerId);
  const campus = db.campuses.find(item => item.id === room.campusId);
  const building = db.buildings.find(item => item.id === room.buildingId);
  const theme = db.themes.find(item => item.id === room.themeId);
  const events = db.upcomingEvents.filter(item => item.roomId === room.id).slice(0, 4);
  return {
    ...room,
    centerName: center?.name || "Center",
    campusName: campus?.name || "Campus",
    buildingName: building?.name || "Building",
    timezone: center?.timezone || "UTC",
    currentTime: new Intl.DateTimeFormat("en-US", {
      timeZone: center?.timezone || "UTC",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date()),
    themeName: theme?.name || "Theme",
    upcomingEvents: events,
    activeBroadcast: db.activeBroadcast?.targetRoomCodes?.includes(room.code) ? db.activeBroadcast : null
  };
}

function cleanText(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function entityId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validationError(res, message) {
  return json(res, 400, { error: message });
}

function findHierarchy(body) {
  const center = db.centers.find(item => item.id === body.centerId);
  const campus = db.campuses.find(item => item.id === body.campusId);
  const building = db.buildings.find(item => item.id === body.buildingId);
  if (!center) return { error: "Select a valid center." };
  if (!campus || campus.centerId !== center.id) return { error: "Select a campus belonging to the selected center." };
  if (!building || building.campusId !== campus.id) return { error: "Select a building belonging to the selected campus." };
  return { center, campus, building };
}

function notifyChangedRooms(roomCodes = []) {
  for (const code of new Set(roomCodes)) notifyRoom(code);
}

function notifyRoom(roomCode) {
  const set = clients.get(roomCode);
  if (!set) return;
  for (const res of set) {
    res.write(`event: refresh\ndata: ${JSON.stringify({ roomCode, at: new Date().toISOString() })}\n\n`);
  }
}

function notifyAllRooms() {
  for (const room of db.rooms) notifyRoom(room.code);
}

function addAudit(action, details) {
  db.auditLogs.unshift({
    id: crypto.randomUUID(),
    action,
    details,
    createdAt: new Date().toISOString()
  });
  db.auditLogs = db.auditLogs.slice(0, 200);
}

function adminPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Signage Admin</title>
    <link rel="stylesheet" href="/static/admin.css?v=${assetVersion}" />
  </head>
  <body>
    <main class="admin-shell">
      <header class="admin-header">
        <div>
          <p>Signage Management System</p>
          <h1>Management Portal</h1>
        </div>
        <div class="header-actions">
          <span id="storageBadge" class="storage-badge"></span>
          <a href="/room-108-shishu" target="_blank">Open Kiosk</a>
        </div>
      </header>
      <nav class="admin-tabs" aria-label="Management sections">
        <button type="button" class="active" data-tab="dashboard">Dashboard</button>
        <button type="button" data-tab="locations">Locations & Rooms</button>
        <button type="button" data-tab="broadcast">Emergency Broadcast</button>
        <button type="button" data-tab="configuration">Configuration</button>
      </nav>

      <section class="tab-panel active" data-panel="dashboard">
        <section id="summaryCards" class="summary-grid"></section>
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>Rooms</h2>
              <p>Live operational status across all managed locations.</p>
            </div>
            <button type="button" id="refreshDashboard">Refresh</button>
          </div>
          <div class="filters">
            <label>Search <input id="roomSearch" type="search" placeholder="Room, building, campus, or center" /></label>
            <label>Center <select id="dashboardCenterFilter"></select></label>
            <label>Status <select id="dashboardStatusFilter">
              <option value="">All statuses</option>
              <option value="available">Available</option>
              <option value="busy">Busy</option>
              <option value="warning">Buffer/Warning</option>
            </select></label>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Room</th><th>Location</th><th>Status</th><th>Theme</th><th>Actions</th></tr></thead>
              <tbody id="roomRows"></tbody>
            </table>
          </div>
        </section>
        <section class="panel preview-panel">
          <div class="panel-heading">
            <div><h2>Live Preview</h2><p id="previewTitle">Select a room to inspect its signage.</p></div>
            <a id="openPreview" href="/preview/room-108-shishu" target="_blank">Open Full Preview</a>
          </div>
          <iframe id="previewFrame" title="Room preview" src="/preview/room-108-shishu"></iframe>
        </section>
      </section>

      <section class="tab-panel" data-panel="locations">
        <section class="management-grid">
          <section class="panel">
            <div class="panel-heading"><div><h2>Centers</h2><p>Timezone and default theme are inherited by rooms.</p></div><button type="button" data-new="center">New</button></div>
            <div id="centerList" class="entity-list"></div>
          </section>
          <section class="panel">
            <div class="panel-heading"><div><h2>Campuses</h2><p>Campuses belong to one center.</p></div><button type="button" data-new="campus">New</button></div>
            <div id="campusList" class="entity-list"></div>
          </section>
          <section class="panel">
            <div class="panel-heading"><div><h2>Buildings</h2><p>Buildings contain room signage endpoints.</p></div><button type="button" data-new="building">New</button></div>
            <div id="buildingList" class="entity-list"></div>
          </section>
          <section class="panel">
            <div class="panel-heading"><div><h2>Rooms</h2><p>Manage kiosk code, booking link, and assigned theme.</p></div><button type="button" data-new="room">New</button></div>
            <div id="roomList" class="entity-list"></div>
          </section>
        </section>
      </section>

      <section class="tab-panel" data-panel="broadcast">
        <section class="panel broadcast-panel">
          <h2>Emergency & Safety Broadcast</h2>
          <form id="broadcastForm">
            <label>Title <input name="title" value="IMPORTANT SYSTEM OVERRIDE" /></label>
            <label>Message <textarea name="message">ADMINISTRATIVE OVERRIDE: ACTIVE ALARM DRILL RUNNING. VACATE BUILDING ACCORDING TO DRILL PROTOCOLS.</textarea></label>
            <label>Target Rooms <select name="targetRoomCodes" multiple id="targetRooms"></select></label>
            <button type="submit">Confirm & Publish</button>
            <button type="button" id="endBroadcast">End Broadcast</button>
          </form>
        </section>
      </section>

      <section class="tab-panel" data-panel="configuration">
        <section class="admin-grid">
          <section class="panel"><h2>Themes</h2><div id="themeList"></div></section>
          <section class="panel"><h2>Users & Roles</h2><div id="userRoleList"></div></section>
          <section class="panel"><h2>Calendar Accounts</h2><div id="calendarList"></div></section>
          <section class="panel"><h2>Recent Audit Activity</h2><div id="auditList"></div></section>
        </section>
      </section>
    </main>

    <dialog id="entityDialog">
      <form id="entityForm" method="dialog">
        <div class="dialog-heading"><h2 id="entityDialogTitle">Manage Entity</h2><button type="button" class="icon-button" id="closeDialog" aria-label="Close">&times;</button></div>
        <input type="hidden" name="entityType" />
        <input type="hidden" name="entityId" />
        <div id="entityFields"></div>
        <p id="formError" class="form-error" role="alert"></p>
        <div class="dialog-actions"><button type="button" class="secondary" id="cancelDialog">Cancel</button><button type="submit">Save</button></div>
      </form>
    </dialog>

    <script src="/static/admin.js?v=${assetVersion}"></script>
  </body>
</html>`;
}

function kioskPage(roomCode, preview = false) {
  const room = db.rooms.find(item => item.code === roomCode);
  if (!room) return null;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(room.name)}</title>
    <link rel="stylesheet" href="/static/kiosk.css?v=${assetVersion}" />
  </head>
  <body>
    <main id="kiosk" class="kiosk-frame" data-room-code="${escapeHtml(room.code)}" data-preview="${preview ? "true" : "false"}">
      <section class="loading">Loading room signage...</section>
    </main>
    <section id="soundGate" class="sound-gate" ${preview ? "hidden" : ""}>
      <div>
        <p>Audio Setup</p>
        <h1>Tap to Enable Emergency Alert Sound</h1>
        <button id="enableSoundButton" type="button">Enable Sound</button>
      </div>
    </section>
    <audio id="alertSound" preload="auto">
      <source src="/assets/audio/alarm.mp3" type="audio/mpeg" />
    </audio>
    <script src="/static/kiosk.js?v=${assetVersion}"></script>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".mp3": "audio/mpeg",
    ".html": "text/html; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
}

async function serveFile(req, res, basePath, prefix) {
  const url = new URL(req.url, baseUrl);
  const rel = decodeURIComponent(url.pathname.replace(prefix, ""));
  const target = path.resolve(basePath, rel.replace(/^\/+/, ""));
  if (!target.startsWith(basePath)) return send(res, 403, "Forbidden");
  try {
    await fs.access(target);
    res.writeHead(200, { "Content-Type": contentType(target), "Cache-Control": "public, max-age=60" });
    createReadStream(target).pipe(res);
  } catch {
    send(res, 404, "Not found");
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { status: "healthy", app: "signage", storage: store.type, time: new Date().toISOString() });
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    return json(res, 200, {
      settings: db.settings,
      storageType: store.type,
      centers: db.centers,
      campuses: db.campuses,
      buildings: db.buildings,
      rooms: db.rooms.map(publicRoom),
      themes: db.themes,
      roles: db.roles,
      users: db.users,
      calendarAccounts: db.calendarAccounts,
      activeBroadcast: db.activeBroadcast,
      auditLogs: db.auditLogs.slice(0, 20)
    });
  }
  if (req.method === "POST" && url.pathname === "/api/centers") {
    const body = await readBody(req);
    const name = cleanText(body.name);
    const timezone = cleanText(body.timezone, 80);
    if (!name) return validationError(res, "Center name is required.");
    if (!validTimezone(timezone)) return validationError(res, "Enter a valid IANA timezone, such as America/Chicago.");
    if (body.defaultThemeId && !db.themes.some(theme => theme.id === body.defaultThemeId)) {
      return validationError(res, "Select a valid default theme.");
    }
    const center = {
      id: entityId("center"),
      name,
      timezone,
      defaultThemeId: body.defaultThemeId || db.themes[0]?.id || "",
      active: body.active !== false
    };
    db.centers.push(center);
    addAudit("center.create", { centerId: center.id, name: center.name });
    await saveData();
    return json(res, 201, center);
  }
  const centerMatch = url.pathname.match(/^\/api\/centers\/([^/]+)$/);
  if (req.method === "PUT" && centerMatch) {
    const center = db.centers.find(item => item.id === centerMatch[1]);
    if (!center) return json(res, 404, { error: "Center not found" });
    const body = await readBody(req);
    const name = cleanText(body.name);
    const timezone = cleanText(body.timezone, 80);
    if (!name) return validationError(res, "Center name is required.");
    if (!validTimezone(timezone)) return validationError(res, "Enter a valid IANA timezone.");
    if (body.defaultThemeId && !db.themes.some(theme => theme.id === body.defaultThemeId)) {
      return validationError(res, "Select a valid default theme.");
    }
    Object.assign(center, { name, timezone, defaultThemeId: body.defaultThemeId || center.defaultThemeId, active: body.active !== false });
    addAudit("center.update", { centerId: center.id, name: center.name });
    await saveData();
    notifyChangedRooms(db.rooms.filter(room => room.centerId === center.id).map(room => room.code));
    return json(res, 200, center);
  }
  if (req.method === "DELETE" && centerMatch) {
    const center = db.centers.find(item => item.id === centerMatch[1]);
    if (!center) return json(res, 404, { error: "Center not found" });
    if (db.campuses.some(item => item.centerId === center.id) || db.rooms.some(item => item.centerId === center.id)) {
      return json(res, 409, { error: "Remove this center's campuses and rooms before deleting it." });
    }
    db.centers = db.centers.filter(item => item.id !== center.id);
    addAudit("center.delete", { centerId: center.id, name: center.name });
    await saveData();
    return json(res, 200, { deleted: true });
  }

  if (req.method === "POST" && url.pathname === "/api/campuses") {
    const body = await readBody(req);
    const name = cleanText(body.name);
    if (!name) return validationError(res, "Campus name is required.");
    if (!db.centers.some(center => center.id === body.centerId)) return validationError(res, "Select a valid center.");
    const campus = {
      id: entityId("campus"),
      centerId: body.centerId,
      name,
      address: cleanText(body.address, 300),
      active: body.active !== false
    };
    db.campuses.push(campus);
    addAudit("campus.create", { campusId: campus.id, name: campus.name });
    await saveData();
    return json(res, 201, campus);
  }
  const campusMatch = url.pathname.match(/^\/api\/campuses\/([^/]+)$/);
  if (req.method === "PUT" && campusMatch) {
    const campus = db.campuses.find(item => item.id === campusMatch[1]);
    if (!campus) return json(res, 404, { error: "Campus not found" });
    const body = await readBody(req);
    const name = cleanText(body.name);
    if (!name) return validationError(res, "Campus name is required.");
    if (!db.centers.some(center => center.id === body.centerId)) return validationError(res, "Select a valid center.");
    if (db.buildings.some(building => building.campusId === campus.id) && body.centerId !== campus.centerId) {
      return json(res, 409, { error: "A campus with buildings cannot be moved to another center." });
    }
    Object.assign(campus, { centerId: body.centerId, name, address: cleanText(body.address, 300), active: body.active !== false });
    addAudit("campus.update", { campusId: campus.id, name: campus.name });
    await saveData();
    notifyChangedRooms(db.rooms.filter(room => room.campusId === campus.id).map(room => room.code));
    return json(res, 200, campus);
  }
  if (req.method === "DELETE" && campusMatch) {
    const campus = db.campuses.find(item => item.id === campusMatch[1]);
    if (!campus) return json(res, 404, { error: "Campus not found" });
    if (db.buildings.some(item => item.campusId === campus.id) || db.rooms.some(item => item.campusId === campus.id)) {
      return json(res, 409, { error: "Remove this campus's buildings and rooms before deleting it." });
    }
    db.campuses = db.campuses.filter(item => item.id !== campus.id);
    addAudit("campus.delete", { campusId: campus.id, name: campus.name });
    await saveData();
    return json(res, 200, { deleted: true });
  }

  if (req.method === "POST" && url.pathname === "/api/buildings") {
    const body = await readBody(req);
    const name = cleanText(body.name);
    if (!name) return validationError(res, "Building name is required.");
    if (!db.campuses.some(campus => campus.id === body.campusId)) return validationError(res, "Select a valid campus.");
    const building = {
      id: entityId("building"),
      campusId: body.campusId,
      name,
      code: cleanText(body.code, 40),
      active: body.active !== false
    };
    db.buildings.push(building);
    addAudit("building.create", { buildingId: building.id, name: building.name });
    await saveData();
    return json(res, 201, building);
  }
  const buildingMatch = url.pathname.match(/^\/api\/buildings\/([^/]+)$/);
  if (req.method === "PUT" && buildingMatch) {
    const building = db.buildings.find(item => item.id === buildingMatch[1]);
    if (!building) return json(res, 404, { error: "Building not found" });
    const body = await readBody(req);
    const name = cleanText(body.name);
    if (!name) return validationError(res, "Building name is required.");
    if (!db.campuses.some(campus => campus.id === body.campusId)) return validationError(res, "Select a valid campus.");
    if (db.rooms.some(room => room.buildingId === building.id) && body.campusId !== building.campusId) {
      return json(res, 409, { error: "A building with rooms cannot be moved to another campus." });
    }
    Object.assign(building, { campusId: body.campusId, name, code: cleanText(body.code, 40), active: body.active !== false });
    addAudit("building.update", { buildingId: building.id, name: building.name });
    await saveData();
    notifyChangedRooms(db.rooms.filter(room => room.buildingId === building.id).map(room => room.code));
    return json(res, 200, building);
  }
  if (req.method === "DELETE" && buildingMatch) {
    const building = db.buildings.find(item => item.id === buildingMatch[1]);
    if (!building) return json(res, 404, { error: "Building not found" });
    if (db.rooms.some(item => item.buildingId === building.id)) {
      return json(res, 409, { error: "Remove this building's rooms before deleting it." });
    }
    db.buildings = db.buildings.filter(item => item.id !== building.id);
    addAudit("building.delete", { buildingId: building.id, name: building.name });
    await saveData();
    return json(res, 200, { deleted: true });
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const name = cleanText(body.name);
    const code = cleanText(body.code, 80).toLowerCase();
    const bookingUrl = cleanText(body.bookingUrl, 500);
    const hierarchy = findHierarchy(body);
    if (!name) return validationError(res, "Room name is required.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) return validationError(res, "Room code must use lowercase letters, numbers, and single hyphens.");
    if (db.rooms.some(room => room.code === code)) return json(res, 409, { error: "That room code is already in use." });
    if (!validUrl(bookingUrl)) return validationError(res, "Enter a valid HTTP or HTTPS booking URL.");
    if (hierarchy.error) return validationError(res, hierarchy.error);
    if (!db.themes.some(theme => theme.id === body.themeId)) return validationError(res, "Select a valid theme.");
    const room = {
      id: entityId("room"),
      code,
      name,
      centerId: body.centerId,
      campusId: body.campusId,
      buildingId: body.buildingId,
      bookingUrl,
      themeId: body.themeId,
      roomType: cleanText(body.roomType, 80) || "Classroom",
      capacity: Number.isFinite(Number(body.capacity)) && Number(body.capacity) > 0 ? Number(body.capacity) : null,
      active: body.active !== false,
      status: "available",
      currentEventTitle: "",
      currentEventUntil: "",
      currentTime: ""
    };
    db.rooms.push(room);
    addAudit("room.create", { roomId: room.id, roomCode: room.code, name: room.name });
    await saveData();
    notifyRoom(room.code);
    return json(res, 201, publicRoom(room));
  }
  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (req.method === "GET" && roomMatch) {
    const room = db.rooms.find(item => item.code === roomMatch[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    return json(res, 200, publicRoom(room));
  }
  if (req.method === "PUT" && roomMatch) {
    const room = db.rooms.find(item => item.id === roomMatch[1] || item.code === roomMatch[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    const body = await readBody(req);
    const name = cleanText(body.name);
    const code = cleanText(body.code, 80).toLowerCase();
    const bookingUrl = cleanText(body.bookingUrl, 500);
    const hierarchy = findHierarchy(body);
    if (!name) return validationError(res, "Room name is required.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) return validationError(res, "Room code must use lowercase letters, numbers, and single hyphens.");
    if (db.rooms.some(item => item.id !== room.id && item.code === code)) return json(res, 409, { error: "That room code is already in use." });
    if (!validUrl(bookingUrl)) return validationError(res, "Enter a valid HTTP or HTTPS booking URL.");
    if (hierarchy.error) return validationError(res, hierarchy.error);
    if (!db.themes.some(theme => theme.id === body.themeId)) return validationError(res, "Select a valid theme.");
    const previousCode = room.code;
    Object.assign(room, {
      code,
      name,
      centerId: body.centerId,
      campusId: body.campusId,
      buildingId: body.buildingId,
      bookingUrl,
      themeId: body.themeId,
      roomType: cleanText(body.roomType, 80) || "Classroom",
      capacity: Number.isFinite(Number(body.capacity)) && Number(body.capacity) > 0 ? Number(body.capacity) : null,
      active: body.active !== false
    });
    addAudit("room.update", { roomId: room.id, roomCode: room.code, previousCode });
    await saveData();
    notifyChangedRooms([previousCode, room.code]);
    return json(res, 200, publicRoom(room));
  }
  if (req.method === "DELETE" && roomMatch) {
    const room = db.rooms.find(item => item.id === roomMatch[1] || item.code === roomMatch[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    db.rooms = db.rooms.filter(item => item.id !== room.id);
    db.upcomingEvents = db.upcomingEvents.filter(item => item.roomId !== room.id);
    addAudit("room.delete", { roomId: room.id, roomCode: room.code, name: room.name });
    await saveData();
    notifyRoom(room.code);
    return json(res, 200, { deleted: true });
  }
  const statusMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/status$/);
  if (req.method === "POST" && statusMatch) {
    const room = db.rooms.find(item => item.code === statusMatch[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    const body = await readBody(req);
    const allowed = new Set(["available", "busy", "warning"]);
    if (!allowed.has(body.status)) return json(res, 400, { error: "Invalid status" });
    room.status = body.status;
    if (body.currentEventTitle !== undefined) room.currentEventTitle = String(body.currentEventTitle);
    if (body.currentEventUntil !== undefined) room.currentEventUntil = String(body.currentEventUntil);
    addAudit("room.status.update", { roomCode: room.code, status: room.status });
    await saveData();
    notifyRoom(room.code);
    return json(res, 200, publicRoom(room));
  }
  const eventsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
  if (req.method === "GET" && eventsMatch) {
    const roomCode = eventsMatch[1];
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ roomCode })}\n\n`);
    if (!clients.has(roomCode)) clients.set(roomCode, new Set());
    clients.get(roomCode).add(res);
    req.on("close", () => clients.get(roomCode)?.delete(res));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/broadcasts") {
    const body = await readBody(req);
    if (!body.confirm) return json(res, 400, { error: "Broadcast confirmation is required" });
    const broadcast = {
      id: crypto.randomUUID(),
      title: String(body.title || "IMPORTANT SYSTEM OVERRIDE"),
      message: String(body.message || ""),
      severity: String(body.severity || "urgent"),
      targetRoomCodes: Array.isArray(body.targetRoomCodes) ? body.targetRoomCodes : db.rooms.map(room => room.code),
      createdAt: new Date().toISOString()
    };
    db.broadcasts.unshift(broadcast);
    db.activeBroadcast = broadcast;
    addAudit("broadcast.publish", { title: broadcast.title, targetRoomCodes: broadcast.targetRoomCodes });
    await saveData();
    notifyAllRooms();
    return json(res, 201, broadcast);
  }
  if (req.method === "POST" && url.pathname === "/api/broadcasts/end") {
    const ended = db.activeBroadcast;
    db.activeBroadcast = null;
    addAudit("broadcast.end", { id: ended?.id || null });
    await saveData();
    notifyAllRooms();
    return json(res, 200, { ended: Boolean(ended) });
  }
  const themeCloneMatch = url.pathname.match(/^\/api\/themes\/([^/]+)\/clone$/);
  if (req.method === "POST" && themeCloneMatch) {
    const source = db.themes.find(theme => theme.id === themeCloneMatch[1]);
    if (!source) return json(res, 404, { error: "Theme not found" });
    if (!source.cloneable) return json(res, 409, { error: "This theme cannot be cloned." });
    const body = await readBody(req);
    const name = cleanText(body.name) || `${source.name} Copy`;
    const clone = {
      ...structuredClone(source),
      id: entityId("theme"),
      name,
      builtIn: false,
      cloneable: true,
      sourceThemeId: source.id
    };
    db.themes.push(clone);
    addAudit("theme.clone", { sourceThemeId: source.id, themeId: clone.id, name: clone.name });
    await saveData();
    return json(res, 201, clone);
  }
  return json(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, baseUrl);
    if (url.pathname.startsWith("/static/")) return serveFile(req, res, path.join(rootDir, "public"), "/static/");
    if (url.pathname.startsWith("/assets/")) return serveFile(req, res, path.join(rootDir, "assets"), "/assets/");
    if (url.pathname.startsWith("/samples/")) return serveFile(req, res, path.join(rootDir, "samples"), "/samples/");
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    if (url.pathname === "/" || url.pathname === "/admin") return send(res, 200, adminPage());
    const previewMatch = url.pathname.match(/^\/preview\/([^/]+)$/);
    if (previewMatch) {
      const page = kioskPage(previewMatch[1], true);
      return page ? send(res, 200, page) : send(res, 404, "Room not found");
    }
    const roomCode = url.pathname.slice(1);
    if (roomCode && !roomCode.includes("/")) {
      const page = kioskPage(roomCode, false);
      return page ? send(res, 200, page) : send(res, 404, "Room not found");
    }
    return send(res, 404, "Not found");
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Signage app running at http://${host}:${port}`);
});
