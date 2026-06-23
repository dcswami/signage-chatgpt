import http from "node:http";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dataFile = path.join(dataDir, "app-data.json");
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

let db = await loadData();

async function loadData() {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    return normalizeData(JSON.parse(raw));
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
    await saveData(seedData);
    return structuredClone(seedData);
  }
}

function normalizeData(data) {
  data.settings = {
    ...seedData.settings,
    ...data.settings,
    alertSound: seedData.settings.alertSound
  };
  return data;
}

async function saveData(nextDb = db) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, `${JSON.stringify(nextDb, null, 2)}\n`);
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
  const building = db.buildings.find(item => item.id === room.buildingId);
  const theme = db.themes.find(item => item.id === room.themeId);
  const events = db.upcomingEvents.filter(item => item.roomId === room.id).slice(0, 4);
  return {
    ...room,
    centerName: center?.name || "Center",
    buildingName: building?.name || "Building",
    themeName: theme?.name || "Theme",
    upcomingEvents: events,
    activeBroadcast: db.activeBroadcast
  };
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
    <link rel="stylesheet" href="/static/admin.css" />
  </head>
  <body>
    <main class="admin-shell">
      <header class="admin-header">
        <div>
          <p>Signage Management System</p>
          <h1>Management Portal</h1>
        </div>
        <a href="/room-108-shishu" target="_blank">Open Kiosk</a>
      </header>
      <section class="admin-grid">
        <section class="panel span-2">
          <h2>Dashboard</h2>
          <div id="roomCards" class="room-grid"></div>
        </section>
        <section class="panel">
          <h2>Emergency & Safety Broadcast</h2>
          <form id="broadcastForm">
            <label>Title <input name="title" value="IMPORTANT SYSTEM OVERRIDE" /></label>
            <label>Message <textarea name="message">ADMINISTRATIVE OVERRIDE: ACTIVE ALARM DRILL RUNNING. VACATE BUILDING ACCORDING TO DRILL PROTOCOLS.</textarea></label>
            <label>Target Rooms <select name="targetRoomCodes" multiple id="targetRooms"></select></label>
            <button type="submit">Confirm & Publish</button>
            <button type="button" id="endBroadcast">End Broadcast</button>
          </form>
        </section>
        <section class="panel">
          <h2>Built-In Themes</h2>
          <div id="themeList"></div>
        </section>
        <section class="panel">
          <h2>Users & Roles</h2>
          <div id="userRoleList"></div>
        </section>
        <section class="panel">
          <h2>Calendar Accounts</h2>
          <div id="calendarList"></div>
        </section>
        <section class="panel span-2">
          <h2>Live Preview</h2>
          <iframe id="previewFrame" title="Room preview" src="/preview/room-108-shishu"></iframe>
        </section>
      </section>
    </main>
    <script src="/static/admin.js"></script>
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
    return json(res, 200, { status: "healthy", app: "signage", time: new Date().toISOString() });
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    return json(res, 200, {
      settings: db.settings,
      rooms: db.rooms.map(publicRoom),
      themes: db.themes,
      roles: db.roles,
      users: db.users,
      calendarAccounts: db.calendarAccounts,
      activeBroadcast: db.activeBroadcast,
      auditLogs: db.auditLogs.slice(0, 20)
    });
  }
  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (req.method === "GET" && roomMatch) {
    const room = db.rooms.find(item => item.code === roomMatch[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    return json(res, 200, publicRoom(room));
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
