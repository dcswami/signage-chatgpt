import http from "node:http";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createStore } from "./storage.mjs";
import { encryptCredential, publicEmailSettings, sendEmail, verifySmtp } from "./email.mjs";
import { inspectCalendarAccount, syncCalendar } from "./calendar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
const assetVersion = process.env.APP_BUILD_VERSION || Date.now().toString(36);

const clients = new Map();
const permissionCatalog = [
  "dashboard.view",
  "center.manage",
  "campus.manage",
  "building.manage",
  "room.manage",
  "room.status.change",
  "user.manage",
  "role.manage",
  "calendar.manage",
  "calendar.sync",
  "theme.manage",
  "notification.manage",
  "broadcast.publish",
  "broadcast.template.manage",
  "broadcast.history.view",
  "audit.view",
  "settings.manage"
];

const defaultThemeTokens = {
  availableBg: "#9bd092",
  availableText: "#005d0d",
  busyBg: "#d48d90",
  busyText: "#6c0000",
  warningBg: "#f1c66d",
  warningText: "#654000",
  footerText: "#b6691d",
  ink: "#202020",
  panel: "rgba(255, 255, 255, 0.58)",
  headerFont: "Arial, Helvetica, sans-serif",
  footerFont: "Arial, Helvetica, sans-serif",
  eventDetailFont: "Arial, Helvetica, sans-serif",
  upcomingFont: "Arial, Helvetica, sans-serif"
};

const seedData = {
  settings: {
    appName: "Signage Management System",
    routeBase: "https://signage.bapswest.org",
    alertSound: "/assets/audio/alarm.mp3",
    email: {
      enabled: false,
      host: "",
      port: 587,
      secure: false,
      username: "",
      encryptedPassword: "",
      fromName: "Signage Management System",
      fromEmail: "",
      replyTo: ""
    }
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
    { id: "classic-institutional", name: "Classic Institutional", builtIn: true, cloneable: true, baseThemeId: "classic-institutional", published: true, cssTokens: defaultThemeTokens },
    { id: "event-formal", name: "Event Formal", builtIn: true, cloneable: true, baseThemeId: "event-formal", published: true, cssTokens: { ...defaultThemeTokens, footerFont: 'Georgia, "Times New Roman", serif', eventDetailFont: 'Georgia, "Times New Roman", serif' } },
    { id: "custom-background", name: "Custom Background", builtIn: true, cloneable: true, baseThemeId: "custom-background", published: true, cssTokens: { ...defaultThemeTokens, headerFont: 'Georgia, "Times New Roman", serif', footerFont: 'Georgia, "Times New Roman", serif', eventDetailFont: 'Georgia, "Times New Roman", serif' } }
  ],
  roles: [
    { id: "system-admin", name: "System Admin", builtIn: true, cloneable: true, active: true, permissions: permissionCatalog },
    { id: "center-admin", name: "Center Admin", builtIn: true, cloneable: true, active: true, permissions: ["dashboard.view", "center.manage", "campus.manage", "building.manage", "room.manage", "room.status.change", "user.manage", "calendar.manage", "calendar.sync", "theme.manage", "notification.manage", "broadcast.publish", "broadcast.history.view"] },
    { id: "campus-manager", name: "Campus Manager", builtIn: true, cloneable: true, active: true, permissions: ["dashboard.view", "campus.manage", "building.manage", "room.manage", "room.status.change", "calendar.sync", "broadcast.publish"] },
    { id: "building-manager", name: "Building Manager", builtIn: true, cloneable: true, active: true, permissions: ["dashboard.view", "building.manage", "room.manage", "room.status.change", "calendar.sync", "broadcast.publish"] },
    { id: "room-manager", name: "Room Manager", builtIn: true, cloneable: true, active: true, permissions: ["dashboard.view", "room.manage", "room.status.change"] }
  ],
  users: [
    {
      id: "user-admin",
      name: "System Administrator",
      email: "admin@example.org",
      roleIds: ["system-admin"],
      centerIds: ["center-la"],
      campusIds: [],
      buildingIds: [],
      features: [
        "Calendar Sync",
        "Calendar Event Conflict Resolution",
        "Front End Theme and Style Management",
        "Notifications",
        "Emergency & Safety Broadcast"
      ],
      status: "active",
      twoFactorEnabled: false,
      invitedAt: null,
      lastEmailAt: null
    }
  ],
  calendarAccounts: [],
  calendarAssignments: [],
  calendarEvents: [],
  calendarSyncHistory: [],
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
  broadcastTemplates: [
    {
      id: "broadcast-template-evacuation",
      name: "Evacuation Order",
      title: "CRITICAL EVACUATION SIREN",
      message: "URGENT: ALL INSTRUCTORS & STUDENTS IMMEDIATELY CLEAR THE PREMISES. PROCEED TO CAMPUS LAWN AREA.",
      severity: "critical",
      visualStyle: "emergency",
      audibleAlert: true,
      defaultTargetScope: "rooms",
      approvalRequired: true,
      active: true
    },
    {
      id: "broadcast-template-weather",
      name: "Severe Weather Sheltering",
      title: "IMPORTANT SYSTEM OVERRIDE",
      message: "TORNADO WARNING IN EFFECT. MOVE ALL STUDENTS TO THE LOWEST LEVEL CENTRAL HALLWAYS IMMEDIATELY.",
      severity: "urgent",
      visualStyle: "emergency",
      audibleAlert: true,
      defaultTargetScope: "rooms",
      approvalRequired: true,
      active: true
    },
    {
      id: "broadcast-template-lockdown",
      name: "Campus Lockdown",
      title: "CRITICAL EVACUATION SIREN",
      message: "SECURITY ACTION IN PROGRESS. LOCK CLASSROOM DOORS, TURN OUT LIGHTS, AND COVER ALL WINDOW GLASS.",
      severity: "critical",
      visualStyle: "emergency",
      audibleAlert: true,
      defaultTargetScope: "rooms",
      approvalRequired: true,
      active: true
    },
    {
      id: "broadcast-template-fire-drill",
      name: "Fire Drill / System Testing",
      title: "IMPORTANT SYSTEM OVERRIDE",
      message: "ADMINISTRATIVE OVERRIDE: ACTIVE ALARM DRILL RUNNING. VACATE BUILDING ACCORDING TO DRILL PROTOCOLS.",
      severity: "urgent",
      visualStyle: "emergency",
      audibleAlert: true,
      defaultTargetScope: "rooms",
      approvalRequired: true,
      active: true
    }
  ],
  emailNotifications: [],
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
      alertSound: seedData.settings.alertSound,
      email: {
        ...seedData.settings.email,
        ...data.settings?.email
      }
    }
  };
  for (const key of ["features", "centers", "campuses", "buildings", "rooms", "themes", "roles", "users", "calendarAccounts", "calendarAssignments", "calendarEvents", "calendarSyncHistory", "upcomingEvents", "broadcasts", "broadcastTemplates", "emailNotifications", "auditLogs"]) {
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
  normalized.themes = normalized.themes.map(theme => ({
    baseThemeId: theme.sourceThemeId || theme.id,
    published: true,
    archived: false,
    cssTokens: structuredClone(defaultThemeTokens),
    ...theme,
    cssTokens: { ...defaultThemeTokens, ...theme.cssTokens }
  }));
  normalized.users = normalized.users.map(user => ({
    status: "active",
    roleIds: [],
    centerIds: [],
    campusIds: [],
    buildingIds: [],
    features: [],
    twoFactorEnabled: false,
    invitedAt: null,
    lastEmailAt: null,
    ...user,
    email: String(user.email || "").toLowerCase()
  }));
  for (const role of seedData.roles) {
    const existing = normalized.roles.find(item => item.id === role.id);
    if (!existing) normalized.roles.push(structuredClone(role));
    else Object.assign(existing, { builtIn: true, active: existing.active !== false, permissions: existing.permissions?.includes("manage_all") ? permissionCatalog : existing.permissions });
  }
  normalized.roles = normalized.roles.map(role => ({
    builtIn: false,
    cloneable: true,
    active: true,
    permissions: [],
    ...role
  }));
  normalized.calendarAccounts = normalized.calendarAccounts
    .filter(account => ["google", "microsoft365", "public-url"].includes(account.provider))
    .map(account => ({
      accessLevel: "read-only",
      active: true,
      encryptedCredential: "",
      principalEmail: "",
      calendars: [],
      syncIntervalMinutes: 15,
      lastSuccessfulSyncAt: null,
      lastSyncError: "",
      lastVerifiedAt: null,
      ...account
    }));
  normalized.calendarAssignments = normalized.calendarAssignments.map(assignment => ({
    active: true,
    lastAttemptAt: null,
    lastSuccessfulSyncAt: null,
    lastSyncError: "",
    ...assignment
  }));
  normalized.broadcastTemplates = normalized.broadcastTemplates.map(template => ({
    severity: "urgent",
    visualStyle: "emergency",
    audibleAlert: true,
    defaultTargetScope: "rooms",
    approvalRequired: true,
    active: true,
    ...template,
    approvalRequired: true
  }));
  normalized.broadcasts = normalized.broadcasts.map(broadcast => ({
    endedAt: null,
    endedBy: null,
    status: broadcast.endedAt ? "ended" : "active",
    ...broadcast
  }));
  const cutoff = Date.now() - 183 * 24 * 60 * 60 * 1000;
  normalized.calendarSyncHistory = normalized.calendarSyncHistory.filter(item => new Date(item.createdAt).getTime() >= cutoff);
  normalized.auditLogs = normalized.auditLogs.filter(item => new Date(item.createdAt).getTime() >= cutoff);
  return normalized;
}

const store = await createStore({ rootDir, seedData, normalize: normalizeData });
let db = store.state;

async function saveData(nextDb = db) {
  await store.save(nextDb);
}

function send(res, status, body, type = "text/html; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0"
  });
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

function publicRoom(room, themeOverrideId = "") {
  const center = db.centers.find(item => item.id === room.centerId);
  const campus = db.campuses.find(item => item.id === room.campusId);
  const building = db.buildings.find(item => item.id === room.buildingId);
  const requestedThemeId = themeOverrideId || room.themeId;
  const theme = db.themes.find(item => item.id === requestedThemeId && (themeOverrideId || (item.published !== false && item.archived !== true)))
    || db.themes.find(item => item.id === room.themeId)
    || db.themes[0];
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
    themeBaseId: theme?.baseThemeId || theme?.sourceThemeId || theme?.id || "classic-institutional",
    themeCssTokens: theme?.cssTokens || defaultThemeTokens,
    buildVersion: assetVersion,
    upcomingEvents: events,
    activeBroadcast: db.activeBroadcast?.targetRoomCodes?.includes(room.code) ? db.activeBroadcast : null
  };
}

function publicCalendarAccount(account) {
  return {
    id: account.id,
    provider: account.provider,
    accountName: account.accountName,
    accessLevel: account.accessLevel,
    active: account.active,
    tenantId: account.tenantId || "",
    clientId: account.clientId || "",
    mailbox: account.mailbox || "",
    principalEmail: account.principalEmail || "",
    hasCredential: Boolean(account.encryptedCredential),
    calendars: account.calendars || [],
    syncIntervalMinutes: account.syncIntervalMinutes || 15,
    lastSuccessfulSyncAt: account.lastSuccessfulSyncAt || null,
    lastSyncError: account.lastSyncError || "",
    lastVerifiedAt: account.lastVerifiedAt || null
  };
}

function publicBroadcast(broadcast) {
  const createdBy = db.users.find(user => user.id === broadcast.createdBy);
  const endedBy = db.users.find(user => user.id === broadcast.endedBy);
  return {
    ...broadcast,
    createdByName: createdBy?.name || "System",
    endedByName: broadcast.endedAt ? endedBy?.name || "System" : ""
  };
}

function currentViewer(req) {
  const requestedId = String(req.headers["x-user-id"] || "");
  if (requestedId) return db.users.find(user => user.id === requestedId) || null;
  return db.users.find(user => user.roleIds.includes("system-admin")) || db.users[0] || null;
}

function viewerPermissions(user) {
  const permissions = new Set();
  for (const roleId of user?.roleIds || []) {
    const role = db.roles.find(item => item.id === roleId && item.active !== false);
    for (const permission of role?.permissions || []) permissions.add(permission);
  }
  return permissions;
}

function viewerIsSystemAdmin(user) {
  return Boolean(user?.roleIds?.includes("system-admin"));
}

function viewerHasPermission(req, permission) {
  const viewer = currentViewer(req);
  return viewerIsSystemAdmin(viewer) || viewerPermissions(viewer).has(permission);
}

function viewerCanAccessRoom(user, room) {
  if (viewerIsSystemAdmin(user)) return true;
  return Boolean(
    user?.centerIds?.includes(room.centerId)
    || user?.campusIds?.includes(room.campusId)
    || user?.buildingIds?.includes(room.buildingId)
  );
}

function requirePermission(req, res, permission) {
  if (viewerHasPermission(req, permission)) return true;
  json(res, 403, { error: `Permission required: ${permission}` });
  return false;
}

function publicViewer(user) {
  return {
    id: user?.id || "",
    name: user?.name || "",
    isSystemAdmin: viewerIsSystemAdmin(user),
    permissions: [...viewerPermissions(user)]
  };
}

function calendarDetailLine(event, timezone) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(start);
  const time = value => new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(value);
  return `${day}, ${time(start)} - ${time(end)}`;
}

function refreshRoomEvents(roomId) {
  const room = db.rooms.find(item => item.id === roomId);
  if (!room) return;
  const center = db.centers.find(item => item.id === room.centerId);
  const timezone = center?.timezone || "UTC";
  const now = new Date();
  const events = db.calendarEvents
    .filter(item => item.roomId === roomId && new Date(item.endsAt) >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  db.upcomingEvents = db.upcomingEvents.filter(item => item.roomId !== roomId);
  db.upcomingEvents.push(...events.slice(0, 4).map(event => ({
    roomId,
    title: event.title,
    detail: calendarDetailLine(event, timezone)
  })));
  const current = events.find(event => new Date(event.startsAt) <= now && new Date(event.endsAt) > now);
  if (current) {
    const remainingMinutes = Math.max(0, Math.ceil((new Date(current.endsAt) - now) / 60000));
    room.currentEventTitle = current.title;
    room.currentEventUntil = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(current.endsAt));
    room.status = remainingMinutes <= (new Date(current.endsAt) - new Date(current.startsAt) > 30 * 60000 ? 10 : 5) ? "warning" : "busy";
  } else {
    room.status = "available";
    room.currentEventTitle = "";
    room.currentEventUntil = events[0]
      ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(events[0].startsAt))
      : "";
  }
}

async function syncAssignment(assignment) {
  const account = db.calendarAccounts.find(item => item.id === assignment.accountId);
  const calendar = account?.calendars?.find(item => item.id === assignment.calendarId);
  const room = db.rooms.find(item => item.id === assignment.roomId);
  if (!account || !calendar || !room) throw new Error("Calendar assignment is incomplete.");
  const startedAt = new Date();
  assignment.lastAttemptAt = startedAt.toISOString();
  try {
    const events = await syncCalendar(account, calendar, new Date(startedAt.getTime() - 24 * 60 * 60 * 1000), new Date(startedAt.getTime() + 90 * 24 * 60 * 60 * 1000));
    db.calendarEvents = db.calendarEvents.filter(item => item.roomId !== room.id || item.assignmentId !== assignment.id);
    db.calendarEvents.push(...events.map(event => ({ ...event, id: entityId("calendar-event"), assignmentId: assignment.id, roomId: room.id, provider: account.provider })));
    assignment.lastSuccessfulSyncAt = new Date().toISOString();
    assignment.lastSyncError = "";
    account.lastSuccessfulSyncAt = assignment.lastSuccessfulSyncAt;
    account.lastSyncError = "";
    db.calendarSyncHistory.unshift({
      id: entityId("calendar-sync"),
      assignmentId: assignment.id,
      roomId: room.id,
      accountId: account.id,
      status: "success",
      eventCount: events.length,
      createdAt: new Date().toISOString()
    });
    refreshRoomEvents(room.id);
    notifyRoom(room.code);
    return { eventCount: events.length };
  } catch (error) {
    assignment.lastSyncError = cleanText(error.message, 500);
    account.lastSyncError = assignment.lastSyncError;
    db.calendarSyncHistory.unshift({
      id: entityId("calendar-sync"),
      assignmentId: assignment.id,
      roomId: room.id,
      accountId: account.id,
      status: "failed",
      error: assignment.lastSyncError,
      createdAt: new Date().toISOString()
    });
    throw error;
  } finally {
    db.calendarSyncHistory = db.calendarSyncHistory.slice(0, 500);
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    roleIds: user.roleIds,
    centerIds: user.centerIds,
    campusIds: user.campusIds,
    buildingIds: user.buildingIds,
    features: user.features,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    invitedAt: user.invitedAt || null,
    lastEmailAt: user.lastEmailAt || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null
  };
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validIds(values, collection) {
  const allowed = new Set(collection.map(item => item.id));
  return Array.isArray(values) && values.every(value => allowed.has(value));
}

function recordEmail({ to, subject, type, status, error = "", userId = null, source = "administrative" }) {
  const notification = {
    id: crypto.randomUUID(),
    to,
    subject,
    type,
    status,
    error,
    userId,
    source,
    createdAt: new Date().toISOString()
  };
  db.emailNotifications.unshift(notification);
  db.emailNotifications = db.emailNotifications.slice(0, 500);
  return notification;
}

async function deliverTrackedEmail({ to, subject, text, html, type, userId = null, source }) {
  try {
    const result = await sendEmail(db.settings.email, { to, subject, text, html });
    const notification = recordEmail({ to, subject, type, status: "sent", userId, source });
    return { notification, messageId: result.messageId };
  } catch (error) {
    recordEmail({ to, subject, type, status: "failed", error: error.message, userId, source });
    throw error;
  }
}

function invitationMessage(user) {
  const portalUrl = `${baseUrl.replace(/\/+$/, "")}/admin`;
  return {
    subject: "Your Signage Management System account",
    text: `Hello ${user.name},\n\nAn account has been provisioned for ${user.email} in the Signage Management System.\n\nManagement portal: ${portalUrl}\n\nYour administrator will provide login activation instructions when authentication enrollment is enabled.\n`,
    html: `<p>Hello ${escapeHtml(user.name)},</p><p>An account has been provisioned for <strong>${escapeHtml(user.email)}</strong> in the Signage Management System.</p><p><a href="${escapeHtml(portalUrl)}">Open management portal</a></p><p>Your administrator will provide login activation instructions when authentication enrollment is enabled.</p>`
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
        <button type="button" data-tab="users">Users</button>
        <button type="button" data-tab="calendars">Calendar Sync</button>
        <button type="button" data-tab="themes">Theme Editor</button>
        <button type="button" data-tab="notifications">Email Notifications</button>
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

      <section class="tab-panel" data-panel="users">
        <section class="panel">
          <div class="panel-heading">
            <div><h2>User Management</h2><p>Provision accounts, assign roles and centers, and grant system features.</p></div>
            <button type="button" data-new="user">New User</button>
          </div>
          <div class="filters user-filters">
            <label>Search <input id="userSearch" type="search" placeholder="Name or email" /></label>
            <label>Status <select id="userStatusFilter">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="suspended">Suspended</option>
              <option value="deactivated">Deactivated</option>
            </select></label>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Status</th><th>Roles</th><th>Access Scope</th><th>Features</th><th>Actions</th></tr></thead>
              <tbody id="userRows"></tbody>
            </table>
          </div>
        </section>
      </section>

      <section class="tab-panel" data-panel="calendars">
        <section class="management-grid">
          <section class="panel">
            <div class="panel-heading">
              <div><h2>Calendar Accounts</h2><p>Google service accounts, Microsoft 365 applications, and public calendar URLs.</p></div>
              <button type="button" data-new="calendarAccount">New Account</button>
            </div>
            <div id="calendarAccountList" class="entity-list"></div>
          </section>
          <section class="panel">
            <div class="panel-heading"><div><h2>Room Calendar Assignment</h2><p>Each room maps to one calendar source in this release.</p></div></div>
            <form id="calendarAssignmentForm">
              <label>Room <select name="roomId" id="calendarAssignmentRoom" required></select></label>
              <label>Account <select name="accountId" id="calendarAssignmentAccount" required></select></label>
              <label>Calendar <select name="calendarId" id="calendarAssignmentCalendar" required></select></label>
              <button type="submit">Assign & Sync</button>
            </form>
            <div id="calendarAssignmentList" class="entity-list assignment-list"></div>
          </section>
        </section>
        <section class="panel">
          <div class="panel-heading"><div><h2>Sync History</h2><p>Manual and scheduled synchronization results retained for up to six months.</p></div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Time</th><th>Room</th><th>Account</th><th>Status</th><th>Events</th></tr></thead>
            <tbody id="calendarSyncRows"></tbody>
          </table></div>
        </section>
      </section>

      <section class="tab-panel" data-panel="themes">
        <section class="management-grid theme-editor-grid">
          <section class="panel">
            <div class="panel-heading"><div><h2>Themes</h2><p>Clone built-in themes, then edit and publish the custom copy.</p></div></div>
            <div id="themeManagerList" class="entity-list"></div>
          </section>
          <section class="panel">
            <div class="panel-heading"><div><h2>Live Theme Preview</h2><p id="themePreviewTitle">Select a cloned theme to edit.</p></div></div>
            <label>Preview Room <select id="themePreviewRoom"></select></label>
            <form id="themeEditorForm" hidden>
              <input type="hidden" name="themeId" />
              <label>Theme Name <input name="name" required /></label>
              <div id="themeTokenFields" class="form-grid"></div>
              <label class="check-label"><input name="published" type="checkbox" /> Published</label>
              <label class="check-label"><input name="archived" type="checkbox" /> Archived</label>
              <button type="submit">Save Theme</button>
            </form>
            <iframe id="themePreviewFrame" class="theme-preview-frame" title="Theme preview" src="/preview/room-108-shishu"></iframe>
          </section>
        </section>
      </section>

      <section class="tab-panel" data-panel="notifications">
        <section class="management-grid email-grid">
          <section class="panel">
            <div class="panel-heading"><div><h2>SMTP Settings</h2><p>Credentials are encrypted before storage and are never displayed again.</p></div></div>
            <form id="smtpForm">
              <label class="check-label"><input name="enabled" type="checkbox" /> Enable email delivery</label>
              <div class="form-grid">
                <label>SMTP Host <input name="host" required placeholder="smtp.example.org" /></label>
                <label>Port <input name="port" type="number" min="1" max="65535" required value="587" /></label>
                <label>Username <input name="username" autocomplete="off" /></label>
                <label>Password <input name="password" type="password" autocomplete="new-password" placeholder="Leave blank to keep stored password" /></label>
                <label>From Name <input name="fromName" required /></label>
                <label>From Email <input name="fromEmail" type="email" required /></label>
                <label>Reply-To <input name="replyTo" type="email" /></label>
                <label class="check-label"><input name="secure" type="checkbox" /> Use implicit TLS (usually port 465)</label>
              </div>
              <p id="smtpPasswordStatus" class="help-text"></p>
              <p id="smtpStatus" class="form-status" role="status"></p>
              <div class="button-row"><button type="submit">Save Settings</button></div>
            </form>
            <form id="smtpTestForm" class="subform">
              <label>Test Recipient <input name="recipient" type="email" placeholder="admin@example.org" /></label>
              <button type="submit" class="secondary">Test Connection & Send</button>
            </form>
          </section>
          <section class="panel">
            <div class="panel-heading"><div><h2>Send Email</h2><p>Send an administrative notification to one or more managed users.</p></div></div>
            <form id="emailForm">
              <div class="form-grid">
                <label>Specific Users <select name="userIds" id="emailRecipients" multiple></select></label>
                <label>Users With Roles <select name="roleIds" id="emailRecipientRoles" multiple></select></label>
                <label>Users Assigned To Centers <select name="centerIds" id="emailRecipientCenters" multiple></select></label>
              </div>
              <label>Subject <input name="subject" required maxlength="200" /></label>
              <label>Message <textarea name="message" required maxlength="10000"></textarea></label>
              <p id="emailSendStatus" class="form-status" role="status"></p>
              <button type="submit">Send Email</button>
            </form>
          </section>
        </section>
        <section class="panel">
          <div class="panel-heading"><div><h2>Email History</h2><p>Recent delivery attempts, without message content or credentials.</p></div></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Recipient</th><th>Subject</th><th>Type</th><th>Status</th></tr></thead>
              <tbody id="emailHistoryRows"></tbody>
            </table>
          </div>
        </section>
      </section>

      <section class="tab-panel" data-panel="broadcast">
        <section class="panel broadcast-panel">
          <div class="panel-heading">
            <div><h2>Emergency & Safety Broadcast</h2><p>Prepared templates still require confirmation before publishing.</p></div>
          </div>
          <form id="broadcastForm">
            <label>Prepared Template <select name="templateId" id="broadcastTemplateSelect"><option value="">Custom message</option></select></label>
            <label>Title <input name="title" value="IMPORTANT SYSTEM OVERRIDE" /></label>
            <label>Message <textarea name="message">ADMINISTRATIVE OVERRIDE: ACTIVE ALARM DRILL RUNNING. VACATE BUILDING ACCORDING TO DRILL PROTOCOLS.</textarea></label>
            <label>Severity <select name="severity">
              <option value="urgent">Urgent</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
            </select></label>
            <label>Target Rooms <select name="targetRoomCodes" multiple id="targetRooms"></select></label>
            <button type="submit">Confirm & Publish</button>
            <button type="button" id="endBroadcast">End Broadcast</button>
          </form>
        </section>
        <section class="panel">
          <div class="panel-heading">
            <div><h2>Broadcast Templates</h2><p>System Administrators can maintain ready-to-launch safety messages.</p></div>
            <button type="button" data-new="broadcastTemplate">New Template</button>
          </div>
          <div id="broadcastTemplateList" class="entity-list"></div>
        </section>
        <section class="panel" id="broadcastHistoryPanel" hidden>
          <div class="panel-heading"><div><h2>Broadcast History</h2><p>System Administrator view of broadcast lifecycle and targets.</p></div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Started</th><th>Published By</th><th>Title</th><th>Severity</th><th>Targets</th><th>Status</th><th>Ended</th></tr></thead>
            <tbody id="broadcastHistoryRows"></tbody>
          </table></div>
        </section>
      </section>

      <section class="tab-panel" data-panel="configuration">
        <section class="admin-grid">
          <section class="panel span-2">
            <div class="panel-heading"><div><h2>Permission & Role Editor</h2><p>Configure module and action permissions, clone roles, and protect assignments.</p></div><button type="button" data-new="role">New Role</button></div>
            <div id="roleManagerList" class="entity-list"></div>
          </section>
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

function kioskPage(roomCode, preview = false, themeOverrideId = "") {
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
    <main id="kiosk" class="kiosk-frame" data-room-code="${escapeHtml(room.code)}" data-preview="${preview ? "true" : "false"}" data-theme-override="${escapeHtml(themeOverrideId)}" data-build-version="${escapeHtml(assetVersion)}">
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
    const viewer = currentViewer(req);
    return json(res, 200, {
      settings: {
        ...db.settings,
        email: publicEmailSettings(db.settings.email)
      },
      storageType: store.type,
      centers: db.centers,
      campuses: db.campuses,
      buildings: db.buildings,
      rooms: db.rooms.map(publicRoom),
      themes: db.themes,
      features: db.features,
      permissionCatalog,
      roles: db.roles,
      users: db.users.map(publicUser),
      broadcastTemplates: db.broadcastTemplates,
      calendarAccounts: db.calendarAccounts.map(publicCalendarAccount),
      calendarAssignments: db.calendarAssignments,
      calendarSyncHistory: db.calendarSyncHistory.slice(0, 50),
      activeBroadcast: db.activeBroadcast,
      broadcastHistory: viewerIsSystemAdmin(viewer) ? db.broadcasts.slice(0, 100).map(publicBroadcast) : [],
      emailNotifications: db.emailNotifications.slice(0, 50),
      auditLogs: viewerIsSystemAdmin(viewer) ? db.auditLogs.slice(0, 20) : [],
      viewer: publicViewer(viewer)
    });
  }
  if (req.method === "GET" && url.pathname === "/api/broadcasts/history") {
    const viewer = currentViewer(req);
    if (!viewerIsSystemAdmin(viewer)) return json(res, 403, { error: "System Administrator access is required." });
    return json(res, 200, db.broadcasts.slice(0, 500).map(publicBroadcast));
  }
  if (req.method === "POST" && url.pathname === "/api/roles") {
    if (!requirePermission(req, res, "role.manage")) return;
    const body = await readBody(req);
    const name = cleanText(body.name);
    const permissions = Array.isArray(body.permissions) ? [...new Set(body.permissions)].filter(item => permissionCatalog.includes(item)) : [];
    if (!name) return validationError(res, "Role name is required.");
    const role = { id: entityId("role"), name, builtIn: false, cloneable: true, active: body.active !== false, permissions };
    db.roles.push(role);
    addAudit("role.create", { roleId: role.id, name });
    await saveData();
    return json(res, 201, role);
  }
  const roleMatch = url.pathname.match(/^\/api\/roles\/([^/]+)$/);
  if (req.method === "PUT" && roleMatch) {
    if (!requirePermission(req, res, "role.manage")) return;
    const role = db.roles.find(item => item.id === roleMatch[1]);
    if (!role) return json(res, 404, { error: "Role not found" });
    const body = await readBody(req);
    const name = cleanText(body.name);
    const permissions = Array.isArray(body.permissions) ? [...new Set(body.permissions)].filter(item => permissionCatalog.includes(item)) : [];
    if (!name) return validationError(res, "Role name is required.");
    Object.assign(role, { name, permissions, active: body.active !== false });
    addAudit("role.update", { roleId: role.id, name });
    await saveData();
    return json(res, 200, role);
  }
  if (req.method === "DELETE" && roleMatch) {
    if (!requirePermission(req, res, "role.manage")) return;
    const role = db.roles.find(item => item.id === roleMatch[1]);
    if (!role) return json(res, 404, { error: "Role not found" });
    if (role.builtIn) return json(res, 409, { error: "Built-in roles cannot be deleted." });
    if (db.users.some(user => user.roleIds.includes(role.id) && user.status !== "deactivated")) {
      return json(res, 409, { error: "Reassign active users before deleting this role." });
    }
    db.roles = db.roles.filter(item => item.id !== role.id);
    addAudit("role.delete", { roleId: role.id, name: role.name });
    await saveData();
    return json(res, 200, { deleted: true });
  }
  const roleCloneMatch = url.pathname.match(/^\/api\/roles\/([^/]+)\/clone$/);
  if (req.method === "POST" && roleCloneMatch) {
    if (!requirePermission(req, res, "role.manage")) return;
    const source = db.roles.find(item => item.id === roleCloneMatch[1]);
    if (!source) return json(res, 404, { error: "Role not found" });
    const body = await readBody(req);
    const role = {
      ...structuredClone(source),
      id: entityId("role"),
      name: cleanText(body.name) || `${source.name} Copy`,
      builtIn: false,
      active: true,
      sourceRoleId: source.id
    };
    db.roles.push(role);
    addAudit("role.clone", { sourceRoleId: source.id, roleId: role.id });
    await saveData();
    return json(res, 201, role);
  }
  if (req.method === "POST" && url.pathname === "/api/calendar-accounts") {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const body = await readBody(req);
    const provider = cleanText(body.provider, 30);
    const accountName = cleanText(body.accountName);
    if (!["google", "microsoft365", "public-url"].includes(provider)) return validationError(res, "Select a valid calendar provider.");
    if (!accountName) return validationError(res, "Calendar account name is required.");
    let encryptedCredential = "";
    let principalEmail = "";
    if (provider === "google") {
      try {
        const credential = JSON.parse(String(body.credential || ""));
        if (!credential.client_email || !credential.private_key) throw new Error("Missing service-account fields");
        principalEmail = cleanText(credential.client_email, 255);
        encryptedCredential = encryptCredential(String(body.credential));
      } catch {
        return validationError(res, "Enter Google service-account JSON containing client_email and private_key.");
      }
    } else if (provider === "microsoft365") {
      if (!cleanText(body.tenantId, 255) || !cleanText(body.clientId, 255)) {
        return validationError(res, "Microsoft Tenant ID and Client ID are required.");
      }
      if (!body.credential) return validationError(res, "Microsoft client secret is required.");
      encryptedCredential = encryptCredential(String(body.credential));
    }
    const calendars = Array.isArray(body.calendars) ? body.calendars.map(item => ({
      id: item.id || entityId("calendar"),
      name: cleanText(item.name),
      externalId: cleanText(item.externalId, 1000),
      mailbox: cleanText(item.mailbox, 255)
    })).filter(item => item.name && item.externalId) : [];
    if (provider === "public-url" && !calendars.length) return validationError(res, "Add at least one public calendar URL.");
    if (provider === "public-url" && calendars.some(item => {
      try {
        return !["http:", "https:"].includes(new URL(item.externalId).protocol);
      } catch {
        return true;
      }
    })) return validationError(res, "Public calendars require a valid HTTP or HTTPS URL.");
    const account = {
      id: entityId("calendar-account"),
      provider,
      accountName,
      accessLevel: provider === "public-url" ? "read-only" : (body.accessLevel === "writable" ? "writable" : "read-only"),
      tenantId: cleanText(body.tenantId, 255),
      clientId: cleanText(body.clientId, 255),
      mailbox: cleanText(body.mailbox, 255),
      principalEmail,
      encryptedCredential,
      calendars,
      syncIntervalMinutes: Math.max(5, Number(body.syncIntervalMinutes || 15)),
      active: body.active !== false,
      lastSuccessfulSyncAt: null,
      lastSyncError: "",
      lastVerifiedAt: null
    };
    db.calendarAccounts.push(account);
    addAudit("calendar.account.create", { accountId: account.id, provider, accountName });
    await saveData();
    return json(res, 201, publicCalendarAccount(account));
  }
  const calendarAccountMatch = url.pathname.match(/^\/api\/calendar-accounts\/([^/]+)$/);
  if (req.method === "PUT" && calendarAccountMatch) {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const account = db.calendarAccounts.find(item => item.id === calendarAccountMatch[1]);
    if (!account) return json(res, 404, { error: "Calendar account not found" });
    const body = await readBody(req);
    const provider = cleanText(body.provider, 30);
    const providerChanged = provider !== account.provider;
    if (!["google", "microsoft365", "public-url"].includes(provider)) return validationError(res, "Select a valid calendar provider.");
    const accountName = cleanText(body.accountName);
    if (!accountName) return validationError(res, "Calendar account name is required.");
    const calendars = Array.isArray(body.calendars) ? body.calendars.map(item => ({
      id: item.id || entityId("calendar"),
      name: cleanText(item.name),
      externalId: cleanText(item.externalId, 1000),
      mailbox: cleanText(item.mailbox, 255)
    })).filter(item => item.name && item.externalId) : [];
    if (provider === "public-url" && !calendars.length) return validationError(res, "Add at least one public calendar URL.");
    if (provider === "public-url" && calendars.some(item => {
      try {
        return !["http:", "https:"].includes(new URL(item.externalId).protocol);
      } catch {
        return true;
      }
    })) return validationError(res, "Public calendars require a valid HTTP or HTTPS URL.");
    if (provider === "microsoft365" && (!cleanText(body.tenantId, 255) || !cleanText(body.clientId, 255))) {
      return validationError(res, "Microsoft Tenant ID and Client ID are required.");
    }
    let encryptedCredential = account.encryptedCredential;
    let principalEmail = account.principalEmail || "";
    if (body.credential) {
      if (provider === "google") {
        try {
          const credential = JSON.parse(String(body.credential));
          if (!credential.client_email || !credential.private_key) throw new Error("Missing service-account fields");
          principalEmail = cleanText(credential.client_email, 255);
        } catch {
          return validationError(res, "Enter Google service-account JSON containing client_email and private_key.");
        }
      }
      encryptedCredential = encryptCredential(String(body.credential));
    }
    if (provider !== "public-url" && (!encryptedCredential || (providerChanged && !body.credential))) {
      return validationError(res, "Enter a new credential when changing calendar providers.");
    }
    Object.assign(account, {
      provider,
      accountName,
      accessLevel: provider === "public-url" ? "read-only" : (body.accessLevel === "writable" ? "writable" : "read-only"),
      tenantId: cleanText(body.tenantId, 255),
      clientId: cleanText(body.clientId, 255),
      mailbox: cleanText(body.mailbox, 255),
      principalEmail: provider === "google" ? principalEmail : "",
      encryptedCredential,
      calendars,
      syncIntervalMinutes: Math.max(5, Number(body.syncIntervalMinutes || 15)),
      active: body.active !== false
    });
    addAudit("calendar.account.update", { accountId: account.id, provider });
    await saveData();
    return json(res, 200, publicCalendarAccount(account));
  }
  const calendarDiscoverMatch = url.pathname.match(/^\/api\/calendar-accounts\/([^/]+)\/discover$/);
  if (req.method === "POST" && calendarDiscoverMatch) {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const account = db.calendarAccounts.find(item => item.id === calendarDiscoverMatch[1]);
    if (!account) return json(res, 404, { error: "Calendar account not found" });
    try {
      const result = await inspectCalendarAccount(account);
      account.principalEmail = result.principalEmail || account.principalEmail || "";
      for (const discovered of result.discovered || []) {
        const existing = account.calendars.find(calendar => calendar.externalId === discovered.externalId);
        if (existing) {
          existing.name = discovered.name || existing.name;
          existing.mailbox = discovered.mailbox || existing.mailbox || "";
          existing.accessRole = discovered.accessRole || existing.accessRole || "";
        } else {
          account.calendars.push({
            id: entityId("calendar"),
            name: cleanText(discovered.name),
            externalId: cleanText(discovered.externalId, 1000),
            mailbox: cleanText(discovered.mailbox, 255),
            accessRole: cleanText(discovered.accessRole, 40)
          });
        }
      }
      account.lastVerifiedAt = new Date().toISOString();
      account.lastSyncError = "";
      addAudit("calendar.account.verify", {
        accountId: account.id,
        discoveredCount: result.discovered?.length || 0,
        errorCount: result.configured?.filter(item => item.status === "error").length || 0
      });
      await saveData();
      return json(res, 200, {
        account: publicCalendarAccount(account),
        discoveredCount: result.discovered?.length || 0,
        configured: result.configured || []
      });
    } catch (error) {
      account.lastSyncError = cleanText(error.message, 500);
      addAudit("calendar.account.verify", { accountId: account.id, status: "failed", error: account.lastSyncError });
      await saveData();
      return json(res, 502, { error: error.message });
    }
  }
  if (req.method === "DELETE" && calendarAccountMatch) {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const account = db.calendarAccounts.find(item => item.id === calendarAccountMatch[1]);
    if (!account) return json(res, 404, { error: "Calendar account not found" });
    if (db.calendarAssignments.some(item => item.accountId === account.id)) return json(res, 409, { error: "Remove room assignments before deleting this account." });
    db.calendarAccounts = db.calendarAccounts.filter(item => item.id !== account.id);
    addAudit("calendar.account.delete", { accountId: account.id });
    await saveData();
    return json(res, 200, { deleted: true });
  }
  if (req.method === "POST" && url.pathname === "/api/calendar-assignments") {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const body = await readBody(req);
    const room = db.rooms.find(item => item.id === body.roomId);
    const account = db.calendarAccounts.find(item => item.id === body.accountId);
    const calendar = account?.calendars?.find(item => item.id === body.calendarId);
    if (!room || !account || !calendar) return validationError(res, "Select a valid room and calendar.");
    if (!viewerCanAccessRoom(currentViewer(req), room)) return json(res, 403, { error: "This room is outside your assigned scope." });
    db.calendarAssignments = db.calendarAssignments.filter(item => item.roomId !== room.id);
    const assignment = {
      id: entityId("calendar-assignment"),
      roomId: room.id,
      accountId: account.id,
      calendarId: calendar.id,
      active: true,
      lastAttemptAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncError: ""
    };
    db.calendarAssignments.push(assignment);
    addAudit("calendar.assignment.update", { roomId: room.id, accountId: account.id, calendarId: calendar.id });
    await saveData();
    return json(res, 201, assignment);
  }
  const calendarAssignmentMatch = url.pathname.match(/^\/api\/calendar-assignments\/([^/]+)$/);
  if (req.method === "DELETE" && calendarAssignmentMatch) {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const assignment = db.calendarAssignments.find(item => item.id === calendarAssignmentMatch[1]);
    if (!assignment) return json(res, 404, { error: "Calendar assignment not found" });
    const room = db.rooms.find(item => item.id === assignment.roomId);
    if (!room || !viewerCanAccessRoom(currentViewer(req), room)) return json(res, 403, { error: "This room is outside your assigned scope." });
    db.calendarAssignments = db.calendarAssignments.filter(item => item.id !== assignment.id);
    db.calendarEvents = db.calendarEvents.filter(item => item.assignmentId !== assignment.id);
    refreshRoomEvents(assignment.roomId);
    addAudit("calendar.assignment.delete", { assignmentId: assignment.id });
    await saveData();
    return json(res, 200, { deleted: true });
  }
  const calendarSyncMatch = url.pathname.match(/^\/api\/calendar-assignments\/([^/]+)\/sync$/);
  if (req.method === "POST" && calendarSyncMatch) {
    if (!requirePermission(req, res, "calendar.sync")) return;
    const assignment = db.calendarAssignments.find(item => item.id === calendarSyncMatch[1]);
    if (!assignment) return json(res, 404, { error: "Calendar assignment not found" });
    const room = db.rooms.find(item => item.id === assignment.roomId);
    if (!room || !viewerCanAccessRoom(currentViewer(req), room)) return json(res, 403, { error: "This room is outside your assigned scope." });
    try {
      const result = await syncAssignment(assignment);
      addAudit("calendar.sync", { assignmentId: assignment.id, status: "success", eventCount: result.eventCount });
      await saveData();
      return json(res, 200, result);
    } catch (error) {
      addAudit("calendar.sync", { assignmentId: assignment.id, status: "failed", error: cleanText(error.message, 300) });
      await saveData();
      return json(res, 502, { error: error.message });
    }
  }
  if (req.method === "PUT" && url.pathname === "/api/settings/email") {
    if (!requirePermission(req, res, "settings.manage")) return;
    const body = await readBody(req);
    const host = cleanText(body.host, 255);
    const username = cleanText(body.username, 255);
    const fromName = cleanText(body.fromName, 160);
    const fromEmail = cleanText(body.fromEmail, 255).toLowerCase();
    const replyTo = cleanText(body.replyTo, 255).toLowerCase();
    const portValue = Number(body.port);
    if (!host) return validationError(res, "SMTP host is required.");
    if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
      return validationError(res, "SMTP port must be between 1 and 65535.");
    }
    if (!validEmail(fromEmail)) return validationError(res, "Enter a valid From email address.");
    if (replyTo && !validEmail(replyTo)) return validationError(res, "Enter a valid Reply-To email address.");
    let encryptedPassword = db.settings.email.encryptedPassword || "";
    if (body.password) {
      try {
        encryptedPassword = encryptCredential(String(body.password));
      } catch (error) {
        return json(res, 500, { error: error.message });
      }
    }
    if (username && !encryptedPassword) return validationError(res, "SMTP password is required for authenticated SMTP.");
    db.settings.email = {
      ...db.settings.email,
      enabled: body.enabled === true,
      host,
      port: portValue,
      secure: body.secure === true,
      username,
      encryptedPassword,
      fromName: fromName || "Signage Management System",
      fromEmail,
      replyTo
    };
    addAudit("email.settings.update", {
      host,
      port: portValue,
      secure: body.secure === true,
      username,
      enabled: body.enabled === true
    });
    await saveData();
    return json(res, 200, publicEmailSettings(db.settings.email));
  }
  if (req.method === "POST" && url.pathname === "/api/settings/email/test") {
    if (!requirePermission(req, res, "settings.manage")) return;
    const body = await readBody(req);
    const recipient = cleanText(body.recipient, 255).toLowerCase();
    if (recipient && !validEmail(recipient)) return validationError(res, "Enter a valid test recipient.");
    try {
      await verifySmtp(db.settings.email);
      if (recipient) {
        try {
          await sendEmail(
            { ...db.settings.email, enabled: true },
            {
              to: recipient,
              subject: "Signage SMTP test successful",
              text: "The Signage Management System successfully connected to SMTP and delivered this test message.",
              html: "<p>The Signage Management System successfully connected to SMTP and delivered this test message.</p>"
            }
          );
          recordEmail({
            to: recipient,
            subject: "Signage SMTP test successful",
            type: "smtp-test",
            status: "sent",
            source: "email-settings"
          });
        } catch (error) {
          recordEmail({
            to: recipient,
            subject: "Signage SMTP test successful",
            type: "smtp-test",
            status: "failed",
            error: error.message,
            source: "email-settings"
          });
          throw error;
        }
      }
      db.settings.email.lastTestAt = new Date().toISOString();
      db.settings.email.lastTestStatus = "success";
      db.settings.email.lastTestError = "";
      addAudit("email.settings.test", { status: "success", recipient: recipient || null });
      await saveData();
      return json(res, 200, { verified: true, emailSent: Boolean(recipient) });
    } catch (error) {
      db.settings.email.lastTestAt = new Date().toISOString();
      db.settings.email.lastTestStatus = "failed";
      db.settings.email.lastTestError = cleanText(error.message, 300);
      addAudit("email.settings.test", { status: "failed", error: cleanText(error.message, 300) });
      await saveData();
      return json(res, 502, { error: `SMTP test failed: ${error.message}` });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/email/send") {
    if (!requirePermission(req, res, "notification.manage")) return;
    const body = await readBody(req);
    const subject = cleanText(body.subject, 200);
    const message = cleanText(body.message, 10000);
    const userIds = Array.isArray(body.userIds) ? [...new Set(body.userIds)] : [];
    const roleIds = Array.isArray(body.roleIds) ? [...new Set(body.roleIds)] : [];
    const centerIds = Array.isArray(body.centerIds) ? [...new Set(body.centerIds)] : [];
    if (!subject) return validationError(res, "Email subject is required.");
    if (!message) return validationError(res, "Email message is required.");
    if (!userIds.length && !roleIds.length && !centerIds.length) {
      return validationError(res, "Select at least one user, role, or center.");
    }
    if (!validIds(userIds, db.users)) return validationError(res, "One or more selected users are invalid.");
    if (!validIds(roleIds, db.roles)) return validationError(res, "One or more selected roles are invalid.");
    if (!validIds(centerIds, db.centers)) return validationError(res, "One or more selected centers are invalid.");
    const selectedUsers = new Set(userIds);
    for (const user of db.users) {
      if (user.roleIds.some(id => roleIds.includes(id)) || user.centerIds.some(id => centerIds.includes(id))) {
        selectedUsers.add(user.id);
      }
    }
    const recipients = db.users.filter(user => selectedUsers.has(user.id) && user.status !== "deactivated");
    if (!recipients.length) return validationError(res, "No active recipients match the selected targets.");
    const results = [];
    for (const user of recipients) {
      try {
        await deliverTrackedEmail({
          to: user.email,
          subject,
          text: message,
          html: `<p>${escapeHtml(message).replaceAll("\n", "<br />")}</p>`,
          type: "administrative",
          userId: user.id,
          source: "manual-notification"
        });
        user.lastEmailAt = new Date().toISOString();
        results.push({ userId: user.id, status: "sent" });
      } catch (error) {
        results.push({ userId: user.id, status: "failed", error: cleanText(error.message, 300) });
      }
    }
    addAudit("email.notification.send", {
      subject,
      roleIds,
      centerIds,
      recipientCount: recipients.length,
      sentCount: results.filter(result => result.status === "sent").length
    });
    await saveData();
    const failed = results.filter(result => result.status === "failed");
    return json(res, failed.length ? 207 : 200, { results });
  }
  if (req.method === "POST" && url.pathname === "/api/users") {
    if (!requirePermission(req, res, "user.manage")) return;
    const body = await readBody(req);
    const name = cleanText(body.name);
    const email = cleanText(body.email, 255).toLowerCase();
    const status = cleanText(body.status, 30) || "invited";
    const allowedStatuses = new Set(["active", "invited", "suspended", "deactivated"]);
    if (!name) return validationError(res, "User name is required.");
    if (!validEmail(email)) return validationError(res, "Enter a valid email address.");
    if (db.users.some(user => user.email === email)) return json(res, 409, { error: "That email address is already assigned to a user." });
    if (!allowedStatuses.has(status)) return validationError(res, "Select a valid user status.");
    if (!validIds(body.roleIds || [], db.roles)) return validationError(res, "One or more roles are invalid.");
    if (!validIds(body.centerIds || [], db.centers)) return validationError(res, "One or more centers are invalid.");
    if (!validIds(body.campusIds || [], db.campuses)) return validationError(res, "One or more campuses are invalid.");
    if (!validIds(body.buildingIds || [], db.buildings)) return validationError(res, "One or more buildings are invalid.");
    const features = Array.isArray(body.features) ? body.features.filter(feature => db.features.includes(feature)) : [];
    const now = new Date().toISOString();
    const user = {
      id: entityId("user"),
      name,
      email,
      status,
      roleIds: body.roleIds || [],
      centerIds: body.centerIds || [],
      campusIds: body.campusIds || [],
      buildingIds: body.buildingIds || [],
      features,
      twoFactorEnabled: false,
      invitedAt: null,
      lastEmailAt: null,
      createdAt: now,
      updatedAt: now
    };
    db.users.push(user);
    addAudit("user.create", { userId: user.id, email: user.email, status: user.status });
    let invitationError = "";
    if (body.sendInvitation === true) {
      const message = invitationMessage(user);
      try {
        await deliverTrackedEmail({
          to: user.email,
          ...message,
          type: "user-invitation",
          userId: user.id,
          source: "user-management"
        });
        user.status = "invited";
        user.invitedAt = now;
        user.lastEmailAt = now;
      } catch (error) {
        invitationError = cleanText(error.message, 300);
      }
    }
    await saveData();
    return json(res, 201, { ...publicUser(user), invitationError });
  }
  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (req.method === "PUT" && userMatch) {
    if (!requirePermission(req, res, "user.manage")) return;
    const user = db.users.find(item => item.id === userMatch[1]);
    if (!user) return json(res, 404, { error: "User not found" });
    const body = await readBody(req);
    const name = cleanText(body.name);
    const email = cleanText(body.email, 255).toLowerCase();
    const status = cleanText(body.status, 30);
    const allowedStatuses = new Set(["active", "invited", "suspended", "deactivated"]);
    if (!name) return validationError(res, "User name is required.");
    if (!validEmail(email)) return validationError(res, "Enter a valid email address.");
    if (db.users.some(item => item.id !== user.id && item.email === email)) return json(res, 409, { error: "That email address is already assigned to a user." });
    if (!allowedStatuses.has(status)) return validationError(res, "Select a valid user status.");
    if (!validIds(body.roleIds || [], db.roles)) return validationError(res, "One or more roles are invalid.");
    if (!validIds(body.centerIds || [], db.centers)) return validationError(res, "One or more centers are invalid.");
    if (!validIds(body.campusIds || [], db.campuses)) return validationError(res, "One or more campuses are invalid.");
    if (!validIds(body.buildingIds || [], db.buildings)) return validationError(res, "One or more buildings are invalid.");
    const features = Array.isArray(body.features) ? body.features.filter(feature => db.features.includes(feature)) : [];
    Object.assign(user, {
      name,
      email,
      status,
      roleIds: body.roleIds || [],
      centerIds: body.centerIds || [],
      campusIds: body.campusIds || [],
      buildingIds: body.buildingIds || [],
      features,
      updatedAt: new Date().toISOString()
    });
    addAudit("user.update", { userId: user.id, email: user.email, status: user.status });
    await saveData();
    return json(res, 200, publicUser(user));
  }
  const userInviteMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/invite$/);
  if (req.method === "POST" && userInviteMatch) {
    if (!requirePermission(req, res, "user.manage")) return;
    const user = db.users.find(item => item.id === userInviteMatch[1]);
    if (!user) return json(res, 404, { error: "User not found" });
    const message = invitationMessage(user);
    try {
      await deliverTrackedEmail({
        to: user.email,
        ...message,
        type: "user-invitation",
        userId: user.id,
        source: "user-management"
      });
      user.status = "invited";
      user.invitedAt = new Date().toISOString();
      user.lastEmailAt = user.invitedAt;
      addAudit("user.invitation.send", { userId: user.id, email: user.email });
      await saveData();
      return json(res, 200, publicUser(user));
    } catch (error) {
      await saveData();
      return json(res, 502, { error: `Invitation email failed: ${error.message}` });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/broadcast-templates") {
    if (!viewerIsSystemAdmin(currentViewer(req))) return json(res, 403, { error: "System Administrator access is required." });
    const body = await readBody(req);
    const name = cleanText(body.name);
    const title = cleanText(body.title, 200);
    const message = cleanText(body.message, 5000);
    const severity = cleanText(body.severity, 30) || "urgent";
    const allowedSeverities = new Set(["warning", "urgent", "critical"]);
    if (!name) return validationError(res, "Template name is required.");
    if (!title) return validationError(res, "Broadcast title is required.");
    if (!message) return validationError(res, "Broadcast message is required.");
    if (!allowedSeverities.has(severity)) return validationError(res, "Select a valid severity.");
    const now = new Date().toISOString();
    const template = {
      id: entityId("broadcast-template"),
      name,
      title,
      message,
      severity,
      visualStyle: cleanText(body.visualStyle, 60) || "emergency",
      audibleAlert: body.audibleAlert !== false,
      defaultTargetScope: cleanText(body.defaultTargetScope, 40) || "rooms",
      approvalRequired: true,
      active: body.active !== false,
      createdAt: now,
      updatedAt: now
    };
    db.broadcastTemplates.push(template);
    addAudit("broadcast.template.create", { templateId: template.id, name: template.name });
    await saveData();
    return json(res, 201, template);
  }
  const broadcastTemplateMatch = url.pathname.match(/^\/api\/broadcast-templates\/([^/]+)$/);
  if (req.method === "PUT" && broadcastTemplateMatch) {
    if (!viewerIsSystemAdmin(currentViewer(req))) return json(res, 403, { error: "System Administrator access is required." });
    const template = db.broadcastTemplates.find(item => item.id === broadcastTemplateMatch[1]);
    if (!template) return json(res, 404, { error: "Broadcast template not found" });
    const body = await readBody(req);
    const name = cleanText(body.name);
    const title = cleanText(body.title, 200);
    const message = cleanText(body.message, 5000);
    const severity = cleanText(body.severity, 30);
    const allowedSeverities = new Set(["warning", "urgent", "critical"]);
    if (!name) return validationError(res, "Template name is required.");
    if (!title) return validationError(res, "Broadcast title is required.");
    if (!message) return validationError(res, "Broadcast message is required.");
    if (!allowedSeverities.has(severity)) return validationError(res, "Select a valid severity.");
    Object.assign(template, {
      name,
      title,
      message,
      severity,
      visualStyle: cleanText(body.visualStyle, 60) || "emergency",
      audibleAlert: body.audibleAlert !== false,
      defaultTargetScope: cleanText(body.defaultTargetScope, 40) || "rooms",
      approvalRequired: true,
      active: body.active !== false,
      updatedAt: new Date().toISOString()
    });
    addAudit("broadcast.template.update", { templateId: template.id, name: template.name });
    await saveData();
    return json(res, 200, template);
  }
  if (req.method === "DELETE" && broadcastTemplateMatch) {
    if (!viewerIsSystemAdmin(currentViewer(req))) return json(res, 403, { error: "System Administrator access is required." });
    const template = db.broadcastTemplates.find(item => item.id === broadcastTemplateMatch[1]);
    if (!template) return json(res, 404, { error: "Broadcast template not found" });
    db.broadcastTemplates = db.broadcastTemplates.filter(item => item.id !== template.id);
    addAudit("broadcast.template.delete", { templateId: template.id, name: template.name });
    await saveData();
    return json(res, 200, { deleted: true });
  }
  if (req.method === "POST" && url.pathname === "/api/centers") {
    if (!requirePermission(req, res, "center.manage")) return;
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
    if (!requirePermission(req, res, "center.manage")) return;
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
    if (!requirePermission(req, res, "center.manage")) return;
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
    if (!requirePermission(req, res, "campus.manage")) return;
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
    if (!requirePermission(req, res, "campus.manage")) return;
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
    if (!requirePermission(req, res, "campus.manage")) return;
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
    if (!requirePermission(req, res, "building.manage")) return;
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
    if (!requirePermission(req, res, "building.manage")) return;
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
    if (!requirePermission(req, res, "building.manage")) return;
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
    if (!requirePermission(req, res, "room.manage")) return;
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
    return json(res, 200, publicRoom(room, cleanText(url.searchParams.get("theme"), 120)));
  }
  if (req.method === "PUT" && roomMatch) {
    if (!requirePermission(req, res, "room.manage")) return;
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
    if (!requirePermission(req, res, "room.manage")) return;
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
    if (!requirePermission(req, res, "room.status.change")) return;
    const room = db.rooms.find(item => item.code === statusMatch[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    if (!viewerCanAccessRoom(currentViewer(req), room)) return json(res, 403, { error: "This room is outside your assigned scope." });
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
    if (!requirePermission(req, res, "broadcast.publish")) return;
    const body = await readBody(req);
    if (!body.confirm) return json(res, 400, { error: "Broadcast confirmation is required" });
    const template = body.templateId
      ? db.broadcastTemplates.find(item => item.id === body.templateId && item.active)
      : null;
    if (body.templateId && !template) return validationError(res, "Select an active broadcast template.");
    const targetRoomCodes = Array.isArray(body.targetRoomCodes) ? [...new Set(body.targetRoomCodes)] : db.rooms.map(room => room.code);
    const targetRooms = targetRoomCodes.map(code => db.rooms.find(room => room.code === code)).filter(Boolean);
    if (!targetRooms.length || targetRooms.length !== targetRoomCodes.length) return validationError(res, "Select valid target rooms.");
    const viewer = currentViewer(req);
    if (targetRooms.some(room => !viewerCanAccessRoom(viewer, room))) {
      return json(res, 403, { error: "One or more target rooms are outside your assigned scope." });
    }
    const broadcast = {
      id: crypto.randomUUID(),
      templateId: template?.id || null,
      title: cleanText(body.title || template?.title || "IMPORTANT SYSTEM OVERRIDE", 200),
      message: cleanText(body.message || template?.message || "", 5000),
      severity: cleanText(body.severity || template?.severity || "urgent", 30),
      targetRoomCodes,
      createdBy: viewer?.id || null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      endedBy: null,
      status: "active",
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
    if (!requirePermission(req, res, "broadcast.publish")) return;
    const ended = db.activeBroadcast;
    const viewer = currentViewer(req);
    if (ended && !viewerIsSystemAdmin(viewer)) {
      const outsideScope = ended.targetRoomCodes
        .map(code => db.rooms.find(room => room.code === code))
        .filter(Boolean)
        .some(room => !viewerCanAccessRoom(viewer, room));
      if (outsideScope) return json(res, 403, { error: "This broadcast includes rooms outside your assigned scope." });
    }
    if (ended) {
      ended.endedAt = new Date().toISOString();
      ended.endedBy = viewer?.id || null;
      ended.status = "ended";
    }
    db.activeBroadcast = null;
    addAudit("broadcast.end", { id: ended?.id || null });
    await saveData();
    notifyAllRooms();
    return json(res, 200, { ended: Boolean(ended) });
  }
  const themeCloneMatch = url.pathname.match(/^\/api\/themes\/([^/]+)\/clone$/);
  if (req.method === "POST" && themeCloneMatch) {
    if (!requirePermission(req, res, "theme.manage")) return;
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
      sourceThemeId: source.id,
      baseThemeId: source.baseThemeId || source.id,
      cssTokens: structuredClone(source.cssTokens || defaultThemeTokens),
      published: false,
      archived: false,
      updatedAt: new Date().toISOString()
    };
    db.themes.push(clone);
    addAudit("theme.clone", { sourceThemeId: source.id, themeId: clone.id, name: clone.name });
    await saveData();
    return json(res, 201, clone);
  }
  const themeMatch = url.pathname.match(/^\/api\/themes\/([^/]+)$/);
  if (req.method === "PUT" && themeMatch) {
    if (!requirePermission(req, res, "theme.manage")) return;
    const theme = db.themes.find(item => item.id === themeMatch[1]);
    if (!theme) return json(res, 404, { error: "Theme not found" });
    if (theme.builtIn) return json(res, 409, { error: "Clone a built-in theme before editing it." });
    const body = await readBody(req);
    const allowedTokens = new Set(Object.keys(defaultThemeTokens));
    const cssTokens = {};
    for (const [key, value] of Object.entries(body.cssTokens || {})) {
      if (allowedTokens.has(key)) cssTokens[key] = cleanText(value, 200);
    }
    Object.assign(theme, {
      name: cleanText(body.name) || theme.name,
      cssTokens: { ...defaultThemeTokens, ...theme.cssTokens, ...cssTokens },
      published: body.published === true,
      archived: body.archived === true,
      updatedAt: new Date().toISOString(),
      lastPublishedAt: body.published === true ? new Date().toISOString() : theme.lastPublishedAt || null
    });
    addAudit("theme.update", { themeId: theme.id, published: theme.published, archived: theme.archived });
    await saveData();
    notifyChangedRooms(db.rooms.filter(room => room.themeId === theme.id).map(room => room.code));
    return json(res, 200, theme);
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
      const page = kioskPage(previewMatch[1], true, cleanText(url.searchParams.get("theme"), 120));
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

let scheduledSyncRunning = false;
async function runScheduledCalendarSync() {
  if (scheduledSyncRunning) return;
  scheduledSyncRunning = true;
  try {
    for (const assignment of db.calendarAssignments.filter(item => item.active !== false)) {
      const account = db.calendarAccounts.find(item => item.id === assignment.accountId && item.active !== false);
      if (!account) continue;
      const lastAttempt = assignment.lastAttemptAt ? new Date(assignment.lastAttemptAt).getTime() : 0;
      if (Date.now() - lastAttempt < (account.syncIntervalMinutes || 15) * 60000) continue;
      try {
        await syncAssignment(assignment);
      } catch (error) {
        console.error(`Calendar sync failed for ${assignment.id}:`, error.message);
      }
    }
    await saveData();
  } finally {
    scheduledSyncRunning = false;
  }
}

server.listen(port, host, () => {
  console.log(`Signage app running at http://${host}:${port}`);
});

const calendarSyncTimer = setInterval(runScheduledCalendarSync, 60000);
calendarSyncTimer.unref();
