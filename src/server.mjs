import http from "node:http";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { createStore } from "./storage.mjs";
import { decryptCredential, encryptCredential, publicEmailSettings, sendEmail, verifySmtp } from "./email.mjs";
import {
  calendarAuthorizationUrl,
  deleteCalendarEvent,
  exchangeCalendarAuthorizationCode,
  inspectCalendarAccount,
  registerCalendarWebhook,
  syncCalendar,
  writeCalendarEvent
} from "./calendar.mjs";
import { createCalendarQueue } from "./calendar-queue.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
const assetVersion = process.env.APP_BUILD_VERSION || Date.now().toString(36);
const themeAssetsDir = process.env.THEME_ASSETS_DIR || path.join(rootDir, "assets", "uploads", "themes");

const clients = new Map();
const oauthStates = new Map();
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
  upcomingTileBg: "rgba(255, 255, 255, 0.58)",
  upcomingTitleText: "#202020",
  upcomingDetailText: "rgba(32, 32, 32, 0.68)",
  qrForeground: "#000000",
  qrBackground: "#ffffff",
  qrTransparent: "false",
  qrSize: "132",
  qrBorder: "0",
  qrMargin: "2",
  backgroundImage: "",
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
    {
      id: "center-la",
      name: "BAPS LA Center",
      description: "",
      logoUrl: "/assets/branding/aksharderi-small2.png",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      bookingUrl: "https://lamandir.site/erf",
      upcomingEventCount: 5,
      showEventDescription: false,
      timezone: "America/Los_Angeles",
      defaultThemeId: "classic-institutional"
    }
  ],
  campuses: [
    {
      id: "campus-la-main",
      centerId: "center-la",
      name: "Los Angeles Mandir Campus",
      address: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      bookingUrl: "",
      defaultThemeId: ""
    }
  ],
  buildings: [
    {
      id: "building-shishu",
      campusId: "campus-la-main",
      name: "Shishu Building",
      code: "",
      address: "",
      floors: "",
      timezone: "",
      bookingUrl: "",
      defaultThemeId: ""
    }
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
      roomNumber: "108",
      floor: "",
      equipment: "",
      accessibilityNotes: "",
      maintenanceStatus: "available",
      privacyMode: "standard",
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
      roomNumber: "205",
      floor: "",
      equipment: "",
      accessibilityNotes: "",
      maintenanceStatus: "available",
      privacyMode: "standard",
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
      roomNumber: "301",
      floor: "",
      equipment: "",
      accessibilityNotes: "",
      maintenanceStatus: "available",
      privacyMode: "standard",
      status: "warning",
      currentEventTitle: "Satsang Sabha Prep",
      currentEventUntil: "10 min",
      currentTime: "1:50 PM"
    }
  ],
  themes: [
    { id: "classic-institutional", name: "Classic Institutional", builtIn: true, cloneable: true, baseThemeId: "classic-institutional", published: true, orientationMode: "both", cssTokens: defaultThemeTokens },
    { id: "event-formal", name: "Event Formal", builtIn: true, cloneable: true, baseThemeId: "event-formal", published: true, orientationMode: "both", cssTokens: { ...defaultThemeTokens, footerFont: 'Georgia, "Times New Roman", serif', eventDetailFont: 'Georgia, "Times New Roman", serif' } },
    { id: "custom-background", name: "Custom Background", builtIn: true, cloneable: true, baseThemeId: "custom-background", published: true, orientationMode: "both", cssTokens: { ...defaultThemeTokens, backgroundImage: "/assets/backgrounds/background.png", upcomingTileBg: "rgba(255, 244, 219, 0.62)", upcomingTitleText: "#261407", upcomingDetailText: "rgba(38, 20, 7, 0.72)", headerFont: 'Georgia, "Times New Roman", serif', footerFont: 'Georgia, "Times New Roman", serif', eventDetailFont: 'Georgia, "Times New Roman", serif' } }
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
  calendarConflicts: [],
  calendarSyncHistory: [],
  themeSchedules: [],
  roomGroups: [],
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
  notifications: [],
  kioskDevices: [],
  kioskPairingCodes: [],
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
  for (const key of ["features", "centers", "campuses", "buildings", "rooms", "themes", "roles", "users", "calendarAccounts", "calendarAssignments", "calendarEvents", "calendarConflicts", "calendarSyncHistory", "themeSchedules", "roomGroups", "upcomingEvents", "broadcasts", "broadcastTemplates", "emailNotifications", "notifications", "kioskDevices", "kioskPairingCodes", "auditLogs"]) {
    if (!Array.isArray(normalized[key])) normalized[key] = structuredClone(seedData[key] || []);
  }
  normalized.centers = normalized.centers.map(center => ({
    active: true,
    description: "",
    logoUrl: "/assets/branding/aksharderi-small2.png",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    bookingUrl: "",
    upcomingEventCount: 5,
    showEventDescription: false,
    ...center
  }));
  normalized.campuses = normalized.campuses.map(campus => ({
    active: true,
    address: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    bookingUrl: "",
    defaultThemeId: "",
    upcomingEventCount: null,
    showEventDescription: null,
    ...campus
  }));
  normalized.buildings = normalized.buildings.map(building => ({
    active: true,
    code: "",
    address: "",
    floors: "",
    timezone: "",
    bookingUrl: "",
    defaultThemeId: "",
    upcomingEventCount: null,
    showEventDescription: null,
    ...building
  }));
  normalized.rooms = normalized.rooms.map(room => ({
    active: true,
    roomType: "Classroom",
    capacity: null,
    roomNumber: "",
    floor: "",
    equipment: "",
    accessibilityNotes: "",
    maintenanceStatus: "available",
    privacyMode: "standard",
    bookingUrl: "",
    themeId: "",
    upcomingEventCount: null,
    showEventDescription: null,
    ...room
  }));
  normalized.themes = normalized.themes.map(theme => ({
    baseThemeId: theme.sourceThemeId || theme.id,
    published: true,
    archived: false,
    orientationMode: "both",
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
    .filter(account => ["google", "microsoft365", "caldav", "public-url"].includes(account.provider))
    .map(account => ({
      accessLevel: "read-only",
      authMode: account.provider === "google" ? "service-account" : account.provider === "microsoft365" ? "application" : account.provider === "caldav" ? "app-password" : "public-url",
      active: true,
      encryptedCredential: "",
      clientId: "",
      tenantId: "",
      serverUrl: "",
      username: "",
      principalEmail: "",
      calendars: [],
      syncIntervalMinutes: 15,
      ownerUserId: null,
      webhookStatus: "not-configured",
      webhookLastAt: null,
      webhookError: "",
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
  normalized.calendarConflicts = normalized.calendarConflicts.map(conflict => ({
    status: "unresolved",
    selectedEventId: null,
    resolvedBy: null,
    resolvedAt: null,
    ...conflict
  }));
  normalized.kioskDevices = normalized.kioskDevices.map(device => ({
    status: "pending",
    approvedBy: null,
    approvedAt: null,
    lastSeenAt: null,
    lastDataAt: null,
    audioEnabled: false,
    pendingCommand: null,
    ...device
  }));
  normalized.themeSchedules = normalized.themeSchedules.map(schedule => ({
    centerIds: [],
    campusIds: [],
    buildingIds: [],
    roomIds: [],
    createdBy: null,
    updatedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...schedule
  }));
  normalized.roomGroups = normalized.roomGroups.map(group => ({
    description: "",
    roomIds: [],
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...group
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
  if (normalized.activeBroadcast && !normalized.broadcasts.some(item => item.id === normalized.activeBroadcast.id)) {
    normalized.broadcasts.unshift(normalized.activeBroadcast);
  }
  normalized.broadcasts = normalized.broadcasts.map(broadcast => {
    const startsAt = broadcast.startsAt || broadcast.startedAt || broadcast.createdAt || new Date().toISOString();
    const endsAt = broadcast.endsAt || null;
    const targetRoomCodes = cleanIdArray(broadcast.targetRoomCodes);
    return {
      templateId: null,
      title: "IMPORTANT SYSTEM OVERRIDE",
      message: "",
      severity: "urgent",
      centerIds: [],
      campusIds: [],
      buildingIds: [],
      roomGroupIds: [],
      roomIds: targetRoomCodes.map(code => normalized.rooms.find(room => room.code === code)?.id).filter(Boolean),
      targetRoomCodes,
      startsAt,
      endsAt,
      startedAt: broadcast.startedAt || startsAt,
      endedAt: null,
      endedBy: null,
      updatedAt: null,
      updatedBy: null,
      status: broadcast.endedAt ? "ended" : "active",
      activationNotifiedAt: null,
      endingNotifiedAt: null,
      ...broadcast,
      startsAt,
      endsAt
    };
  });
  normalized.activeBroadcast = null;
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
      if (body.length > 8_000_000) req.destroy();
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

function scheduleTargetRooms(schedule) {
  return db.rooms.filter(room =>
    schedule.roomIds?.includes(room.id)
    || schedule.buildingIds?.includes(room.buildingId)
    || schedule.campusIds?.includes(room.campusId)
    || schedule.centerIds?.includes(room.centerId)
  );
}

function roomLocation(room) {
  const center = db.centers.find(item => item.id === room.centerId);
  const campus = db.campuses.find(item => item.id === room.campusId);
  const building = db.buildings.find(item => item.id === room.buildingId);
  return { center, campus, building };
}

function effectiveRoomSettings(room) {
  const { center, campus, building } = roomLocation(room);
  const inheritedNumber = (roomValue, buildingValue, campusValue, centerValue, fallback) => {
    for (const value of [roomValue, buildingValue, campusValue, centerValue]) {
      if (value !== null && value !== undefined && value !== "") return Number(value);
    }
    return fallback;
  };
  const inheritedBoolean = (roomValue, buildingValue, campusValue, centerValue, fallback) => {
    for (const value of [roomValue, buildingValue, campusValue, centerValue]) {
      if (typeof value === "boolean") return value;
    }
    return fallback;
  };
  return {
    bookingUrl: room.bookingUrl || building?.bookingUrl || campus?.bookingUrl || center?.bookingUrl || "",
    themeId: room.themeId || building?.defaultThemeId || campus?.defaultThemeId || center?.defaultThemeId || db.themes[0]?.id || "",
    timezone: building?.timezone || center?.timezone || "UTC",
    logoUrl: center?.logoUrl || "/assets/branding/aksharderi-small2.png",
    upcomingEventCount: Math.max(1, Math.min(10, inheritedNumber(
      room.upcomingEventCount,
      building?.upcomingEventCount,
      campus?.upcomingEventCount,
      center?.upcomingEventCount,
      5
    ))),
    showEventDescription: inheritedBoolean(
      room.showEventDescription,
      building?.showEventDescription,
      campus?.showEventDescription,
      center?.showEventDescription,
      false
    )
  };
}

function broadcastTargetRooms(broadcast) {
  const directCodes = new Set(broadcast.targetRoomCodes || []);
  const groupRoomIds = new Set(
    db.roomGroups
      .filter(group => group.active !== false && broadcast.roomGroupIds?.includes(group.id))
      .flatMap(group => group.roomIds || [])
  );
  return db.rooms.filter(room =>
    directCodes.has(room.code)
    || broadcast.roomIds?.includes(room.id)
    || groupRoomIds.has(room.id)
    || broadcast.buildingIds?.includes(room.buildingId)
    || broadcast.campusIds?.includes(room.campusId)
    || broadcast.centerIds?.includes(room.centerId)
  );
}

function broadcastStatusAt(broadcast, at = new Date()) {
  if (["ended", "cancelled"].includes(broadcast.status) || broadcast.endedAt) return broadcast.status || "ended";
  const timestamp = at.getTime();
  const startsAt = new Date(broadcast.startsAt || broadcast.startedAt || broadcast.createdAt).getTime();
  const endsAt = broadcast.endsAt ? new Date(broadcast.endsAt).getTime() : Number.POSITIVE_INFINITY;
  if (timestamp < startsAt) return "scheduled";
  if (timestamp >= endsAt) return "ended";
  return "active";
}

function activeBroadcastsForRoom(room, at = new Date()) {
  const priority = { emergency: 5, critical: 4, urgent: 3, warning: 2, informational: 1 };
  return db.broadcasts
    .filter(broadcast => broadcastStatusAt(broadcast, at) === "active")
    .filter(broadcast => broadcastTargetRooms(broadcast).some(target => target.id === room.id))
    .sort((a, b) =>
      (priority[b.severity] || 0) - (priority[a.severity] || 0)
      || String(b.startsAt).localeCompare(String(a.startsAt))
    );
}

function activeThemeSchedule(room, at = new Date()) {
  const timestamp = at.getTime();
  return db.themeSchedules
    .filter(schedule =>
      new Date(schedule.startsAt).getTime() <= timestamp
      && new Date(schedule.endsAt).getTime() > timestamp
      && scheduleTargetRooms(schedule).some(target => target.id === room.id)
    )
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt) || b.createdAt.localeCompare(a.createdAt))[0] || null;
}

function publicThemeSchedule(schedule) {
  const owner = db.users.find(user => user.id === schedule.createdBy);
  const updatedBy = db.users.find(user => user.id === schedule.updatedBy);
  const theme = db.themes.find(item => item.id === schedule.themeId);
  const roomIds = scheduleTargetRooms(schedule).map(room => room.id);
  return {
    ...schedule,
    themeName: theme?.name || "Unknown theme",
    ownerName: owner?.name || "System",
    updatedByName: schedule.updatedAt ? updatedBy?.name || owner?.name || "System" : "",
    resolvedRoomIds: roomIds,
    resolvedRoomCount: roomIds.length
  };
}

function publicRoom(room, themeOverrideId = "", stateOverride = "") {
  const { center, campus, building } = roomLocation(room);
  const effective = effectiveRoomSettings(room);
  const scheduledTheme = themeOverrideId ? null : activeThemeSchedule(room);
  const requestedThemeId = themeOverrideId || scheduledTheme?.themeId || effective.themeId;
  const theme = db.themes.find(item => item.id === requestedThemeId && (themeOverrideId || (item.published !== false && item.archived !== true)))
    || db.themes.find(item => item.id === effective.themeId)
    || db.themes[0];
  const events = db.upcomingEvents
    .filter(item => item.roomId === room.id)
    .slice(0, 100)
    .map(event => room.privacyMode === "hide-details"
      ? { ...event, title: "Private Event", detail: "" }
      : room.privacyMode === "private-title"
        ? { ...event, title: "Private Event" }
        : event);
  const previewState = ["available", "busy", "warning"].includes(stateOverride) ? stateOverride : "";
  const previewValues = previewState === "available"
    ? { status: "available", currentEventTitle: "", currentEventUntil: "4:00 PM" }
    : previewState === "warning"
      ? { status: "warning", currentEventTitle: "Sample Event Near Completion", currentEventUntil: "5 min" }
      : previewState === "busy"
        ? { status: "busy", currentEventTitle: "Sample Current Event", currentEventUntil: "2:00 PM" }
        : {};
  const activeBroadcasts = activeBroadcastsForRoom(room).map(publicBroadcast);
  return {
    ...room,
    ...previewValues,
    centerName: center?.name || "Center",
    campusName: campus?.name || "Campus",
    buildingName: building?.name || "Building",
    bookingUrl: effective.bookingUrl,
    configuredBookingUrl: room.bookingUrl || "",
    configuredThemeId: room.themeId || "",
    timezone: effective.timezone,
    logoUrl: effective.logoUrl,
    currentTime: new Intl.DateTimeFormat("en-US", {
      timeZone: effective.timezone,
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date()),
    themeName: theme?.name || "Theme",
    themeBaseId: theme?.baseThemeId || theme?.sourceThemeId || theme?.id || "classic-institutional",
    themeCssTokens: theme?.cssTokens || defaultThemeTokens,
    scheduledThemeId: scheduledTheme?.themeId || null,
    activeThemeScheduleId: scheduledTheme?.id || null,
    themeOrientationMode: theme?.orientationMode || "both",
    buildVersion: assetVersion,
    upcomingEventPageSize: effective.upcomingEventCount,
    upcomingEventPageSeconds: 10,
    showEventDescription: effective.showEventDescription,
    upcomingEvents: events,
    activeBroadcasts,
    activeBroadcast: activeBroadcasts[0] || null
  };
}

function publicCalendarAccount(account) {
  return {
    id: account.id,
    provider: account.provider,
    authMode: account.authMode,
    accountName: account.accountName,
    accessLevel: account.accessLevel,
    active: account.active,
    tenantId: account.tenantId || "",
    clientId: account.clientId || "",
    mailbox: account.mailbox || "",
    serverUrl: account.serverUrl || "",
    username: account.username || "",
    principalEmail: account.principalEmail || "",
    hasCredential: Boolean(account.encryptedCredential),
    calendars: (account.calendars || []).map(calendar => ({
      id: calendar.id,
      name: calendar.name,
      externalId: calendar.externalId,
      mailbox: calendar.mailbox || "",
      accessRole: calendar.accessRole || "",
      webhookStatus: calendar.webhookStatus || "not-configured",
      webhookExpiration: calendar.webhookExpiration || null
    })),
    syncIntervalMinutes: account.syncIntervalMinutes || 15,
    ownerUserId: account.ownerUserId || null,
    webhookStatus: account.webhookStatus || "not-configured",
    webhookLastAt: account.webhookLastAt || null,
    webhookExpiration: account.webhookExpiration || null,
    webhookError: account.webhookError || "",
    lastSuccessfulSyncAt: account.lastSuccessfulSyncAt || null,
    lastSyncError: account.lastSyncError || "",
    lastVerifiedAt: account.lastVerifiedAt || null
  };
}

function publicBroadcast(broadcast) {
  const createdBy = db.users.find(user => user.id === broadcast.createdBy);
  const updatedBy = db.users.find(user => user.id === broadcast.updatedBy);
  const endedBy = db.users.find(user => user.id === broadcast.endedBy);
  const targetRooms = broadcastTargetRooms(broadcast);
  return {
    ...broadcast,
    status: broadcastStatusAt(broadcast),
    createdByName: createdBy?.name || "System",
    updatedByName: broadcast.updatedAt ? updatedBy?.name || "System" : "",
    resolvedRoomIds: targetRooms.map(room => room.id),
    resolvedRoomCodes: targetRooms.map(room => room.code),
    resolvedRoomCount: targetRooms.length,
    endedByName: broadcast.endedAt ? endedBy?.name || "System" : ""
  };
}

function publicKioskDevice(device, includePairingCode = false) {
  const room = db.rooms.find(item => item.id === device.roomId);
  return {
    id: device.id,
    clientDeviceId: device.clientDeviceId,
    roomId: device.roomId,
    roomCode: room?.code || "",
    roomName: room?.name || "Unknown room",
    name: device.name || "",
    status: device.status,
    pairingCode: includePairingCode && device.status === "pending" ? device.pairingCode : "",
    browser: device.browser || "",
    platform: device.platform || "",
    viewport: device.viewport || "",
    orientation: device.orientation || "",
    audioEnabled: Boolean(device.audioEnabled),
    lastSeenAt: device.lastSeenAt || null,
    lastDataAt: device.lastDataAt || null,
    approvedAt: device.approvedAt || null,
    pendingCommand: device.pendingCommand || null
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

function viewerCanPairRoom(user, room) {
  return viewerIsSystemAdmin(user)
    || (user?.roleIds?.includes("center-admin") && user?.centerIds?.includes(room.centerId));
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
    permissions: [...viewerPermissions(user)],
    accessibleRoomIds: db.rooms.filter(room => viewerCanAccessRoom(user, room)).map(room => room.id)
  };
}

function calendarDetailLine(event, timezone) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(start);
  const time = value => new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(value);
  return `${day}, ${time(start)} - ${time(end)}`;
}

function eventDisplayTitle(event) {
  return event.privacy === "private" || /(?:private|rental) events?/i.test(event.description || "")
    ? "Private Event"
    : event.originalTitle || event.title || "Untitled Event";
}

function detectRoomConflicts(roomId, events) {
  const previous = new Map(db.calendarConflicts.filter(item => item.roomId === roomId).map(item => [item.id, item]));
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const clusters = [];
  let cluster = [];
  let clusterEnd = 0;
  for (const event of sorted) {
    const startsAt = new Date(event.startsAt).getTime();
    const endsAt = new Date(event.endsAt).getTime();
    if (cluster.length && startsAt >= clusterEnd) {
      if (cluster.length > 1) clusters.push(cluster);
      cluster = [];
      clusterEnd = 0;
    }
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, endsAt);
  }
  if (cluster.length > 1) clusters.push(cluster);
  const conflicts = clusters.map(items => {
    const externalIds = items.map(item => item.externalEventId).sort();
    const id = `calendar-conflict-${crypto.createHash("sha256").update(`${roomId}:${externalIds.join("|")}`).digest("hex").slice(0, 24)}`;
    return {
      id,
      roomId,
      eventIds: items.map(item => item.id),
      externalEventIds: externalIds,
      startsAt: items.map(item => item.startsAt).sort()[0],
      endsAt: items.map(item => item.endsAt).sort().at(-1),
      status: previous.get(id)?.status || "unresolved",
      selectedExternalEventId: previous.get(id)?.selectedExternalEventId || null,
      resolvedBy: previous.get(id)?.resolvedBy || null,
      resolvedAt: previous.get(id)?.resolvedAt || null,
      updatedAt: new Date().toISOString()
    };
  });
  db.calendarConflicts = [
    ...db.calendarConflicts.filter(item => item.roomId !== roomId),
    ...conflicts
  ];
  return conflicts;
}

function refreshRoomEvents(roomId) {
  const room = db.rooms.find(item => item.id === roomId);
  if (!room) return;
  const effective = effectiveRoomSettings(room);
  const timezone = effective.timezone;
  const now = new Date();
  const futureLimit = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const events = db.calendarEvents
    .filter(item => item.roomId === roomId && new Date(item.endsAt) >= now && new Date(item.startsAt) <= futureLimit)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const conflicts = detectRoomConflicts(roomId, events);
  db.upcomingEvents = db.upcomingEvents.filter(item => item.roomId !== roomId);
  db.upcomingEvents.push(...events.filter(event => new Date(event.startsAt) > now).slice(0, 100).map(event => ({
    roomId,
    eventId: event.id,
    title: eventDisplayTitle(event),
    detail: calendarDetailLine(event, timezone),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    description: effective.showEventDescription && eventDisplayTitle(event) !== "Private Event" ? event.description || "" : ""
  })));
  const currentEvents = events.filter(event => new Date(event.startsAt) <= now && new Date(event.endsAt) > now);
  const currentConflict = conflicts.find(conflict =>
    new Date(conflict.startsAt) <= now
    && new Date(conflict.endsAt) > now
  );
  const current = currentConflict?.selectedExternalEventId
    ? currentEvents.find(event => event.externalEventId === currentConflict.selectedExternalEventId) || currentEvents[0]
    : currentEvents[0];
  if (current) {
    const remainingMinutes = Math.max(0, Math.ceil((new Date(current.endsAt) - now) / 60000));
    room.currentEventTitle = eventDisplayTitle(current);
    room.currentEventStartsAt = current.startsAt;
    room.currentEventEndsAt = current.endsAt;
    room.currentEventTime = calendarDetailLine(current, timezone);
    room.currentEventDescription = effective.showEventDescription && room.currentEventTitle !== "Private Event" ? current.description || "" : "";
    room.currentEventUntil = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(current.endsAt));
    room.status = remainingMinutes <= (new Date(current.endsAt) - new Date(current.startsAt) > 30 * 60000 ? 10 : 5) ? "warning" : "busy";
  } else {
    room.status = "available";
    room.currentEventTitle = "";
    room.currentEventStartsAt = null;
    room.currentEventEndsAt = null;
    room.currentEventTime = "";
    room.currentEventDescription = "";
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
    const events = await syncCalendar(
      account,
      calendar,
      new Date(startedAt.getTime() - 30 * 24 * 60 * 60 * 1000),
      new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
    );
    db.calendarEvents = db.calendarEvents.filter(item => item.roomId !== room.id || item.assignmentId !== assignment.id);
    db.calendarEvents.push(...events.map(event => ({ ...event, id: entityId("calendar-event"), assignmentId: assignment.id, roomId: room.id, provider: account.provider })));
    assignment.lastSuccessfulSyncAt = new Date().toISOString();
    assignment.lastSyncError = "";
    account.lastSuccessfulSyncAt = assignment.lastSuccessfulSyncAt;
    account.lastSyncError = "";
    account.webhookStatus = account.webhookStatus === "failed" ? "polling-fallback" : account.webhookStatus;
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
    await notifyCalendarSyncFailure(account, room, assignment.lastSyncError);
    throw error;
  } finally {
    db.calendarSyncHistory = db.calendarSyncHistory.slice(0, 500);
  }
}

async function processCalendarAssignment(assignmentId) {
  const assignment = db.calendarAssignments.find(item => item.id === assignmentId && item.active !== false);
  if (!assignment) return { skipped: true };
  const result = await syncAssignment(assignment);
  await saveData();
  return result;
}

let calendarQueue;
try {
  calendarQueue = await createCalendarQueue({
    redisUrl: process.env.REDIS_URL || "",
    processAssignment: processCalendarAssignment
  });
} catch (error) {
  console.warn(`Redis calendar queue unavailable; using in-process polling: ${error.message}`);
  calendarQueue = {
    enabled: false,
    enqueue: processCalendarAssignment,
    async close() {}
  };
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

function validCalendarAuthMode(provider, authMode) {
  return {
    google: ["service-account", "oauth"],
    microsoft365: ["application", "oauth"],
    caldav: ["app-password"],
    "public-url": ["public-url"]
  }[provider]?.includes(authMode);
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

async function notifyCalendarSyncFailure(account, room, error) {
  const recipients = db.users.filter(user =>
    user.status === "active"
    && (
      user.id === account.ownerUserId
      || viewerIsSystemAdmin(user)
      || (user.roleIds?.includes("center-admin") && user.centerIds?.includes(room.centerId))
    )
  );
  const title = `Calendar sync failed: ${room.name}`;
  const message = `${account.accountName}: ${error}`;
  const createdAt = new Date().toISOString();
  for (const user of recipients) {
    db.notifications.unshift({
      id: entityId("notification"),
      userId: user.id,
      title,
      message,
      severity: "warning",
      source: "calendar-sync",
      sourceId: account.id,
      actionUrl: "/admin#calendars",
      readAt: null,
      createdAt
    });
  }
  db.notifications = db.notifications.slice(0, 1000);
  if (!db.settings.email.enabled) return;
  await Promise.allSettled(recipients
    .filter(user => validEmail(user.email))
    .map(user => deliverTrackedEmail({
      to: user.email,
      subject: title,
      text: message,
      html: `<p>${escapeHtml(message)}</p>`,
      type: "calendar-sync-failure",
      userId: user.id,
      source: "calendar-sync"
    })));
}

function broadcastRecipientUsers(broadcast) {
  const roomIds = new Set(broadcastTargetRooms(broadcast).map(room => room.id));
  return db.users.filter(user =>
    user.status === "active"
    && (viewerIsSystemAdmin(user) || user.features?.includes("Notifications") || user.features?.includes("Emergency & Safety Broadcast"))
    && (viewerIsSystemAdmin(user) || db.rooms.some(room => roomIds.has(room.id) && viewerCanAccessRoom(user, room)))
  );
}

async function notifyBroadcastEvent(broadcast, eventType) {
  const labels = {
    activated: "Broadcast active",
    updated: "Broadcast updated",
    ended: "Broadcast ended",
    cancelled: "Broadcast cancelled"
  };
  const title = `${labels[eventType] || "Broadcast notice"}: ${broadcast.title}`;
  const targetCount = broadcastTargetRooms(broadcast).length;
  const message = `${broadcast.message}\n\nSeverity: ${broadcast.severity}. Target rooms: ${targetCount}.`;
  const recipients = broadcastRecipientUsers(broadcast);
  const createdAt = new Date().toISOString();
  for (const user of recipients) {
    db.notifications.unshift({
      id: entityId("notification"),
      userId: user.id,
      title,
      message,
      severity: broadcast.severity,
      source: "broadcast",
      sourceId: broadcast.id,
      actionUrl: "/admin#broadcast",
      readAt: null,
      createdAt
    });
  }
  db.notifications = db.notifications.slice(0, 1000);
  if (!db.settings.email.enabled) return;
  await Promise.allSettled(recipients
    .filter(user => validEmail(user.email))
    .map(user => deliverTrackedEmail({
      to: user.email,
      subject: title,
      text: message,
      html: `<p>${escapeHtml(broadcast.message)}</p><p><strong>Severity:</strong> ${escapeHtml(broadcast.severity)}<br /><strong>Target rooms:</strong> ${targetCount}</p>`,
      type: `broadcast-${eventType}`,
      userId: user.id,
      source: "broadcast"
    })));
}

let broadcastLifecycleRunning = false;

async function runBroadcastLifecycle() {
  if (broadcastLifecycleRunning) return;
  broadcastLifecycleRunning = true;
  try {
    const changedRoomCodes = new Set();
    const notificationJobs = [];
    let changed = false;
    for (const broadcast of db.broadcasts) {
      const nextStatus = broadcastStatusAt(broadcast);
      if (nextStatus === broadcast.status) continue;
      const previousStatus = broadcast.status;
      broadcast.status = nextStatus;
      if (nextStatus === "active") {
        broadcast.startedAt ||= new Date().toISOString();
        if (!broadcast.activationNotifiedAt) {
          broadcast.activationNotifiedAt = new Date().toISOString();
          notificationJobs.push(notifyBroadcastEvent(broadcast, "activated"));
        }
      } else if (nextStatus === "ended" && previousStatus !== "ended") {
        broadcast.endedAt ||= broadcast.endsAt || new Date().toISOString();
        if (!broadcast.endingNotifiedAt) {
          broadcast.endingNotifiedAt = new Date().toISOString();
          notificationJobs.push(notifyBroadcastEvent(broadcast, "ended"));
        }
      }
      for (const room of broadcastTargetRooms(broadcast)) changedRoomCodes.add(room.code);
      changed = true;
    }
    if (changed) {
      await saveData();
      notifyChangedRooms([...changedRoomCodes]);
      await Promise.allSettled(notificationJobs);
      await saveData();
    }
  } finally {
    broadcastLifecycleRunning = false;
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

function qrColor(value, fallback) {
  return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(String(value || "")) ? String(value) : fallback;
}

function colorLuminance(hex) {
  const channels = hex.slice(1, 7).match(/.{2}/g).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const values = [colorLuminance(foreground), colorLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function secureTokenEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(String(left || "")).digest();
  const rightHash = crypto.createHash("sha256").update(String(right || "")).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function calendarWebhookToken(calendar) {
  if (calendar.encryptedWebhookToken) {
    try {
      return decryptCredential(calendar.encryptedWebhookToken);
    } catch {
      return "";
    }
  }
  return calendar.webhookToken || "";
}

function cleanIdArray(value) {
  return Array.isArray(value) ? [...new Set(value.map(item => cleanText(item, 160)).filter(Boolean))] : [];
}

function nullableInteger(value, minimum = 1, maximum = 10) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function nullableBoolean(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function scheduleFromBody(body, existing = {}) {
  return {
    ...existing,
    themeId: cleanText(body.themeId, 160),
    startsAt: cleanText(body.startsAt, 80),
    endsAt: cleanText(body.endsAt, 80),
    centerIds: cleanIdArray(body.centerIds),
    campusIds: cleanIdArray(body.campusIds),
    buildingIds: cleanIdArray(body.buildingIds),
    roomIds: cleanIdArray(body.roomIds)
  };
}

function broadcastFromBody(body, existing = {}) {
  return {
    ...existing,
    templateId: cleanText(body.templateId, 160) || null,
    title: cleanText(body.title, 200),
    message: cleanText(body.message, 5000),
    severity: cleanText(body.severity, 30) || "emergency",
    audibleAlert: body.audibleAlert !== false,
    startsAt: cleanText(body.startsAt, 80),
    endsAt: cleanText(body.endsAt, 80) || null,
    centerIds: cleanIdArray(body.centerIds),
    campusIds: cleanIdArray(body.campusIds),
    buildingIds: cleanIdArray(body.buildingIds),
    roomGroupIds: cleanIdArray(body.roomGroupIds),
    roomIds: cleanIdArray(body.roomIds),
    targetRoomCodes: cleanIdArray(body.targetRoomCodes)
  };
}

function validateBroadcast(broadcast, viewer) {
  if (!broadcast.title) return "Broadcast title is required.";
  if (!broadcast.message) return "Broadcast message is required.";
  if (!["informational", "warning", "urgent", "critical", "emergency"].includes(broadcast.severity)) {
    return "Select a valid severity.";
  }
  const startsAt = new Date(broadcast.startsAt);
  if (!Number.isFinite(startsAt.getTime())) return "Enter a valid broadcast start time.";
  if (broadcast.endsAt) {
    const endsAt = new Date(broadcast.endsAt);
    if (!Number.isFinite(endsAt.getTime())) return "Enter a valid broadcast end time.";
    if (endsAt <= startsAt) return "Broadcast end time must be after its start time.";
  }
  if (broadcast.centerIds.some(id => !db.centers.some(item => item.id === id))) return "One or more selected centers are invalid.";
  if (broadcast.campusIds.some(id => !db.campuses.some(item => item.id === id))) return "One or more selected campuses are invalid.";
  if (broadcast.buildingIds.some(id => !db.buildings.some(item => item.id === id))) return "One or more selected buildings are invalid.";
  if (broadcast.roomGroupIds.some(id => !db.roomGroups.some(item => item.id === id && item.active !== false))) return "One or more selected room groups are invalid.";
  if (broadcast.roomIds.some(id => !db.rooms.some(item => item.id === id))) return "One or more selected rooms are invalid.";
  if (broadcast.targetRoomCodes.some(code => !db.rooms.some(item => item.code === code))) return "One or more selected room codes are invalid.";
  const targetRooms = broadcastTargetRooms(broadcast);
  if (!targetRooms.length) return "Select at least one center, campus, building, room group, or room.";
  if (targetRooms.some(room => !viewerCanAccessRoom(viewer, room))) return "One or more selected targets include rooms outside your assigned scope.";
  return "";
}

function validateThemeSchedule(schedule, viewer) {
  const theme = db.themes.find(item => item.id === schedule.themeId && item.published !== false && item.archived !== true);
  if (!theme) return "Select an available published theme.";
  if (!Number.isFinite(new Date(schedule.startsAt).getTime()) || !Number.isFinite(new Date(schedule.endsAt).getTime())) {
    return "Enter valid schedule start and end times.";
  }
  if (new Date(schedule.endsAt) <= new Date(schedule.startsAt)) return "Schedule end time must be after its start time.";
  const targetIds = [...schedule.centerIds, ...schedule.campusIds, ...schedule.buildingIds, ...schedule.roomIds];
  if (!targetIds.length) return "Select at least one center, campus, building, or room.";
  if (schedule.centerIds.some(id => !db.centers.some(item => item.id === id))) return "One or more selected centers are invalid.";
  if (schedule.campusIds.some(id => !db.campuses.some(item => item.id === id))) return "One or more selected campuses are invalid.";
  if (schedule.buildingIds.some(id => !db.buildings.some(item => item.id === id))) return "One or more selected buildings are invalid.";
  if (schedule.roomIds.some(id => !db.rooms.some(item => item.id === id))) return "One or more selected rooms are invalid.";
  const rooms = scheduleTargetRooms(schedule);
  if (!rooms.length) return "The selected targets do not contain any rooms.";
  if (rooms.some(room => !viewerCanAccessRoom(viewer, room))) return "One or more selected targets include rooms outside your assigned scope.";
  return "";
}

function uploadedThemeAssetPath(assetUrl) {
  const prefix = "/assets/uploads/themes/";
  if (!assetUrl?.startsWith(prefix)) return "";
  const filename = path.basename(assetUrl.slice(prefix.length));
  return path.join(themeAssetsDir, filename);
}

function validImageSignature(buffer, mimeType) {
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  return false;
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

function notifyRoom(roomCode, command = "data-refresh", deviceId = "") {
  const set = clients.get(roomCode);
  if (!set) return;
  for (const client of set) {
    const entry = client?.res ? client : { res: client, deviceId: "" };
    if (deviceId && entry.deviceId !== deviceId) continue;
    entry.res.write(`event: refresh\ndata: ${JSON.stringify({ roomCode, command, at: new Date().toISOString() })}\n\n`);
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
        <button type="button" data-tab="devices">Kiosk Devices</button>
        <button type="button" data-tab="themes">Theme Editor</button>
        <button type="button" data-tab="theme-scheduler">Theme Scheduler</button>
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
          <section class="panel span-2">
            <div class="panel-heading"><div><h2>Room Groups</h2><p>Create reusable groups for broadcast targeting.</p></div><button type="button" data-new="roomGroup">New Group</button></div>
            <div id="roomGroupList" class="entity-list"></div>
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
        <section class="panel">
          <div class="panel-heading"><div><h2>Event Conflicts</h2><p>Select which external event appears on signage without modifying either source event.</p></div></div>
          <div id="calendarConflictList" class="entity-list"></div>
        </section>
      </section>

      <section class="tab-panel" data-panel="devices">
        <section class="panel">
          <div class="panel-heading"><div><h2>Scoped Kiosk Refresh</h2><p>Refresh schedule data or fully reload kiosk application assets.</p></div></div>
          <form id="kioskRefreshForm">
            <div class="scheduler-target-grid">
              <label>Centers <select name="centerIds" id="kioskRefreshCenters" multiple></select></label>
              <label>Campuses <select name="campusIds" id="kioskRefreshCampuses" multiple></select></label>
              <label>Buildings <select name="buildingIds" id="kioskRefreshBuildings" multiple></select></label>
              <label>Room Groups <select name="roomGroupIds" id="kioskRefreshRoomGroups" multiple></select></label>
              <label>Rooms <select name="roomIds" id="kioskRefreshRooms" multiple></select></label>
            </div>
            <label>Refresh Mode <select name="command">
              <option value="data-refresh">Refresh data only</option>
              <option value="reload">Reload page, assets, and data</option>
            </select></label>
            <button type="submit">Send Refresh</button>
            <p id="kioskRefreshStatus" class="form-status" role="status"></p>
          </form>
        </section>
        <section class="panel">
          <div class="panel-heading"><div><h2>Registered Kiosk Devices</h2><p>System Admins and Center Admins approve pairing. Unregistered room URLs continue to work.</p></div></div>
          <div id="kioskDeviceList" class="entity-list"></div>
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
            <div class="form-grid">
              <label>Preview Room <select id="themePreviewRoom"></select></label>
              <label>Preview State <select id="themePreviewState">
                <option value="available">Available</option>
                <option value="busy">Busy</option>
                <option value="warning">Buffer / Warning</option>
              </select></label>
            </div>
            <form id="themeEditorForm" hidden>
              <input type="hidden" name="themeId" />
              <label>Theme Name <input name="name" required /></label>
              <label>Supported Orientation <select name="orientationMode">
                <option value="both">Landscape and portrait</option>
                <option value="landscape">Landscape primary</option>
                <option value="portrait">Portrait primary</option>
              </select></label>
              <fieldset class="theme-background-field">
                <legend>Background Image</legend>
                <img id="themeBackgroundPreview" alt="Theme background preview" hidden />
                <label>Upload PNG, JPEG, or WebP
                  <input name="backgroundImageFile" type="file" accept="image/png,image/jpeg,image/webp" />
                </label>
                <div class="button-row">
                  <button type="button" class="secondary" id="uploadThemeBackground">Upload / Replace</button>
                  <button type="button" class="danger-text" id="deleteThemeBackground">Remove Background</button>
                </div>
                <p id="themeBackgroundStatus" class="form-status" role="status"></p>
              </fieldset>
              <div id="themeTokenFields" class="form-grid"></div>
              <label class="check-label"><input name="published" type="checkbox" /> Published</label>
              <label class="check-label"><input name="archived" type="checkbox" /> Archived</label>
              <button type="submit">Save Theme</button>
            </form>
            <iframe id="themePreviewFrame" class="theme-preview-frame" title="Theme preview" src="/preview/room-108-shishu"></iframe>
          </section>
        </section>
      </section>

      <section class="tab-panel" data-panel="theme-scheduler">
        <section class="panel">
          <div class="panel-heading"><div><h2>Schedule Theme Override</h2><p>Scheduled themes temporarily override each room's default theme.</p></div></div>
          <form id="themeScheduleForm">
            <input type="hidden" name="scheduleId" />
            <div class="form-grid">
              <label>Theme <select name="themeId" id="scheduleTheme" required></select></label>
              <label>Start <input name="startsAt" type="datetime-local" required /></label>
              <label>End <input name="endsAt" type="datetime-local" required /></label>
            </div>
            <div class="scheduler-target-grid">
              <label>Centers <select name="centerIds" id="scheduleCenters" multiple></select></label>
              <label>Campuses <select name="campusIds" id="scheduleCampuses" multiple></select></label>
              <label>Buildings <select name="buildingIds" id="scheduleBuildings" multiple></select></label>
              <label>Rooms <select name="roomIds" id="scheduleRooms" multiple></select></label>
            </div>
            <p class="help-text">Select one or more centers, campuses, buildings, or rooms. Only rooms in your assigned scope are included.</p>
            <div class="button-row">
              <button type="submit">Save Schedule</button>
              <button type="button" class="secondary" id="cancelThemeSchedule" hidden>Cancel Edit</button>
            </div>
            <p id="themeScheduleStatus" class="form-status" role="status"></p>
          </form>
        </section>
        <section class="management-grid">
          <section class="panel">
            <div class="panel-heading"><div><h2>Upcoming Schedule</h2><p>Active and future theme overrides.</p></div></div>
            <div id="upcomingThemeSchedules" class="entity-list"></div>
          </section>
          <section class="panel">
            <div class="panel-heading"><div><h2>Past Schedules</h2><p>Completed overrides from the last two years.</p></div></div>
            <div id="pastThemeSchedules" class="entity-list"></div>
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
        <section class="panel">
          <div class="panel-heading"><div><h2>In-App Notifications</h2><p>Broadcast and operational notifications for the signed-in user.</p></div></div>
          <div id="inAppNotificationList" class="entity-list"></div>
        </section>
      </section>

      <section class="tab-panel" data-panel="broadcast">
        <section class="panel broadcast-panel">
          <div class="panel-heading">
            <div><h2>Emergency & Safety Broadcast</h2><p>Prepared templates still require confirmation before publishing.</p></div>
          </div>
          <form id="broadcastForm">
            <input type="hidden" name="broadcastId" />
            <label>Prepared Template <select name="templateId" id="broadcastTemplateSelect"><option value="">Custom message</option></select></label>
            <label>Title <input name="title" value="IMPORTANT SYSTEM OVERRIDE" /></label>
            <label>Message <textarea name="message">ADMINISTRATIVE OVERRIDE: ACTIVE ALARM DRILL RUNNING. VACATE BUILDING ACCORDING TO DRILL PROTOCOLS.</textarea></label>
            <div class="form-grid">
              <label>Severity <select name="severity">
                <option value="informational">Informational</option>
                <option value="warning">Warning</option>
                <option value="urgent">Urgent</option>
                <option value="critical">Critical</option>
                <option value="emergency" selected>Emergency</option>
              </select></label>
              <label class="check-label"><input name="audibleAlert" type="checkbox" checked /> Play kiosk alert sound</label>
              <label>Start <input name="startsAt" type="datetime-local" required /></label>
              <label>End <input name="endsAt" type="datetime-local" /></label>
            </div>
            <div class="scheduler-target-grid broadcast-target-grid">
              <label>Centers <select name="centerIds" id="broadcastCenters" multiple></select></label>
              <label>Campuses <select name="campusIds" id="broadcastCampuses" multiple></select></label>
              <label>Buildings <select name="buildingIds" id="broadcastBuildings" multiple></select></label>
              <label>Room Groups <select name="roomGroupIds" id="broadcastRoomGroups" multiple></select></label>
              <label>Rooms <select name="roomIds" multiple id="targetRooms"></select></label>
            </div>
            <p class="help-text">Select one or more scopes. The resolved room list is captured when the broadcast is saved.</p>
            <div class="button-row">
              <button type="submit" id="saveBroadcast">Confirm & Publish</button>
              <button type="button" class="secondary" id="cancelBroadcastEdit" hidden>Cancel Edit</button>
            </div>
            <p id="broadcastFormStatus" class="form-status" role="status"></p>
          </form>
        </section>
        <section class="management-grid">
          <section class="panel">
            <div class="panel-heading"><div><h2>Active Broadcasts</h2><p>Alerts currently overriding signage.</p></div></div>
            <div id="activeBroadcastList" class="entity-list"></div>
          </section>
          <section class="panel">
            <div class="panel-heading"><div><h2>Scheduled Broadcasts</h2><p>Future alerts awaiting automatic activation.</p></div></div>
            <div id="scheduledBroadcastList" class="entity-list"></div>
          </section>
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
            <thead><tr><th>Effective Time</th><th>Owner / Update</th><th>Title</th><th>Severity</th><th>Targets</th><th>Status</th><th>Ended</th></tr></thead>
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

function kioskPage(roomCode, preview = false, themeOverrideId = "", stateOverride = "") {
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
    <div id="connectionStatus" class="connection-status" role="status" aria-live="polite" hidden></div>
    <div id="deviceStatus" class="device-status" role="status" aria-live="polite" ${preview ? "hidden" : ""}></div>
    <main id="kiosk" class="kiosk-frame" data-room-code="${escapeHtml(room.code)}" data-preview="${preview ? "true" : "false"}" data-theme-override="${escapeHtml(themeOverrideId)}" data-state-override="${escapeHtml(stateOverride)}" data-build-version="${escapeHtml(assetVersion)}">
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
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
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
    return json(res, 200, { status: "healthy", app: "signage", storage: store.type, calendarQueue: calendarQueue.enabled ? "redis" : "in-process", time: new Date().toISOString() });
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    await runBroadcastLifecycle();
    const viewer = currentViewer(req);
    const accessibleBroadcasts = db.broadcasts
      .filter(broadcast => broadcastTargetRooms(broadcast).some(room => viewerCanAccessRoom(viewer, room)))
      .map(publicBroadcast);
    return json(res, 200, {
      settings: {
        ...db.settings,
        email: publicEmailSettings(db.settings.email)
      },
      storageType: store.type,
      calendarQueueEnabled: calendarQueue.enabled,
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
      calendarEvents: db.calendarEvents.filter(event => {
        const room = db.rooms.find(item => item.id === event.roomId);
        return room && viewerCanAccessRoom(viewer, room);
      }),
      calendarConflicts: db.calendarConflicts.filter(conflict => {
        const room = db.rooms.find(item => item.id === conflict.roomId);
        return room && viewerCanAccessRoom(viewer, room);
      }),
      calendarSyncHistory: db.calendarSyncHistory.slice(0, 50),
      kioskDevices: db.kioskDevices.filter(device => {
        const room = db.rooms.find(item => item.id === device.roomId);
        return room && viewerCanAccessRoom(viewer, room);
      }).map(device => publicKioskDevice(device, viewerCanPairRoom(viewer, db.rooms.find(item => item.id === device.roomId)))),
      roomGroups: db.roomGroups.filter(group =>
        group.roomIds.length > 0 && group.roomIds.every(roomId => {
          const room = db.rooms.find(item => item.id === roomId);
          return room && viewerCanAccessRoom(viewer, room);
        })
      ),
      themeSchedules: db.themeSchedules
        .filter(schedule => new Date(schedule.endsAt).getTime() >= Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
        .filter(schedule => scheduleTargetRooms(schedule).some(room => viewerCanAccessRoom(viewer, room)))
        .map(publicThemeSchedule),
      activeBroadcasts: accessibleBroadcasts.filter(broadcast => broadcast.status === "active"),
      scheduledBroadcasts: accessibleBroadcasts.filter(broadcast => broadcast.status === "scheduled"),
      broadcastHistory: viewerHasPermission(req, "broadcast.history.view") ? accessibleBroadcasts.slice(0, 200) : [],
      emailNotifications: db.emailNotifications.slice(0, 50),
      notifications: db.notifications.filter(item => item.userId === viewer?.id).slice(0, 100),
      auditLogs: viewerIsSystemAdmin(viewer) ? db.auditLogs.slice(0, 20) : [],
      viewer: publicViewer(viewer)
    });
  }
  if (req.method === "GET" && url.pathname === "/api/broadcasts/history") {
    const viewer = currentViewer(req);
    if (!viewerHasPermission(req, "broadcast.history.view")) return json(res, 403, { error: "Broadcast history permission is required." });
    return json(res, 200, db.broadcasts
      .filter(broadcast => broadcastTargetRooms(broadcast).some(room => viewerCanAccessRoom(viewer, room)))
      .slice(0, 500)
      .map(publicBroadcast));
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
    const authMode = cleanText(body.authMode, 40)
      || (provider === "google" ? "service-account" : provider === "microsoft365" ? "application" : provider === "caldav" ? "app-password" : "public-url");
    const accountName = cleanText(body.accountName);
    if (!["google", "microsoft365", "caldav", "public-url"].includes(provider)) return validationError(res, "Select a valid calendar provider.");
    if (!validCalendarAuthMode(provider, authMode)) return validationError(res, "Select a connection method supported by this calendar provider.");
    if (!accountName) return validationError(res, "Calendar account name is required.");
    let encryptedCredential = "";
    let principalEmail = "";
    if (provider === "google" && authMode === "service-account") {
      try {
        const credential = JSON.parse(String(body.credential || ""));
        if (!credential.client_email || !credential.private_key) throw new Error("Missing service-account fields");
        principalEmail = cleanText(credential.client_email, 255);
        encryptedCredential = encryptCredential(String(body.credential));
      } catch {
        return validationError(res, "Enter Google service-account JSON containing client_email and private_key.");
      }
    } else if (provider === "google" && authMode === "oauth") {
      if (!cleanText(body.clientId, 255) || !body.credential) return validationError(res, "Google OAuth Client ID and client secret are required.");
      encryptedCredential = encryptCredential(JSON.stringify({ clientSecret: String(body.credential), tokens: null }));
    } else if (provider === "microsoft365" && authMode === "application") {
      if (!cleanText(body.tenantId, 255) || !cleanText(body.clientId, 255)) {
        return validationError(res, "Microsoft Tenant ID and Client ID are required.");
      }
      if (!body.credential) return validationError(res, "Microsoft client secret is required.");
      encryptedCredential = encryptCredential(String(body.credential));
    } else if (provider === "microsoft365" && authMode === "oauth") {
      if (!cleanText(body.clientId, 255) || !body.credential) return validationError(res, "Microsoft OAuth Client ID and client secret are required.");
      encryptedCredential = encryptCredential(JSON.stringify({ clientSecret: String(body.credential), tokens: null }));
    } else if (provider === "caldav") {
      if (!cleanText(body.serverUrl, 1000) || !cleanText(body.username, 255) || !body.credential) {
        return validationError(res, "CalDAV server URL, username, and app password are required.");
      }
      if (!validUrl(body.serverUrl)) return validationError(res, "Enter a valid CalDAV server URL.");
      encryptedCredential = encryptCredential(JSON.stringify({ password: String(body.credential) }));
      principalEmail = cleanText(body.username, 255);
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
      authMode,
      accountName,
      accessLevel: provider === "public-url" ? "read-only" : (body.accessLevel === "writable" ? "writable" : "read-only"),
      tenantId: cleanText(body.tenantId, 255),
      clientId: cleanText(body.clientId, 255),
      mailbox: cleanText(body.mailbox, 255),
      serverUrl: cleanText(body.serverUrl, 1000),
      username: cleanText(body.username, 255),
      principalEmail,
      encryptedCredential,
      calendars,
      syncIntervalMinutes: Math.max(5, Math.min(1440, Number(body.syncIntervalMinutes) || 15)),
      ownerUserId: currentViewer(req)?.id || null,
      webhookStatus: ["google", "microsoft365"].includes(provider) ? "not-configured" : "polling",
      webhookLastAt: null,
      webhookError: "",
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
    const authMode = cleanText(body.authMode, 40)
      || (provider === "google" ? "service-account" : provider === "microsoft365" ? "application" : provider === "caldav" ? "app-password" : "public-url");
    const providerChanged = provider !== account.provider || authMode !== account.authMode;
    if (!["google", "microsoft365", "caldav", "public-url"].includes(provider)) return validationError(res, "Select a valid calendar provider.");
    if (!validCalendarAuthMode(provider, authMode)) return validationError(res, "Select a connection method supported by this calendar provider.");
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
    if (provider === "microsoft365" && (
      !cleanText(body.clientId, 255)
      || (authMode === "application" && !cleanText(body.tenantId, 255))
    )) {
      return validationError(res, authMode === "application"
        ? "Microsoft Tenant ID and Client ID are required."
        : "Microsoft OAuth Client ID is required.");
    }
    if (provider === "caldav" && (!validUrl(cleanText(body.serverUrl, 1000)) || !cleanText(body.username, 255))) {
      return validationError(res, "CalDAV server URL and username are required.");
    }
    let encryptedCredential = account.encryptedCredential;
    let principalEmail = account.principalEmail || "";
    if (body.credential) {
      if (provider === "google" && authMode === "service-account") {
        try {
          const credential = JSON.parse(String(body.credential));
          if (!credential.client_email || !credential.private_key) throw new Error("Missing service-account fields");
          principalEmail = cleanText(credential.client_email, 255);
        } catch {
          return validationError(res, "Enter Google service-account JSON containing client_email and private_key.");
        }
        encryptedCredential = encryptCredential(String(body.credential));
      } else if ((provider === "google" || provider === "microsoft365") && authMode === "oauth") {
        encryptedCredential = encryptCredential(JSON.stringify({ clientSecret: String(body.credential), tokens: null }));
        principalEmail = "";
      } else if (provider === "caldav") {
        encryptedCredential = encryptCredential(JSON.stringify({ password: String(body.credential) }));
        principalEmail = cleanText(body.username, 255);
      } else {
        encryptedCredential = encryptCredential(String(body.credential));
      }
    }
    if (provider !== "public-url" && (!encryptedCredential || (providerChanged && !body.credential))) {
      return validationError(res, "Enter a new credential when changing calendar providers.");
    }
    Object.assign(account, {
      provider,
      authMode,
      accountName,
      accessLevel: provider === "public-url" ? "read-only" : (body.accessLevel === "writable" ? "writable" : "read-only"),
      tenantId: cleanText(body.tenantId, 255),
      clientId: cleanText(body.clientId, 255),
      mailbox: cleanText(body.mailbox, 255),
      serverUrl: cleanText(body.serverUrl, 1000),
      username: cleanText(body.username, 255),
      principalEmail,
      encryptedCredential,
      calendars,
      syncIntervalMinutes: Math.max(5, Math.min(1440, Number(body.syncIntervalMinutes) || 15)),
      active: body.active !== false
    });
    addAudit("calendar.account.update", { accountId: account.id, provider });
    await saveData();
    return json(res, 200, publicCalendarAccount(account));
  }
  const calendarOauthStartMatch = url.pathname.match(/^\/api\/calendar-accounts\/([^/]+)\/oauth\/start$/);
  if (req.method === "GET" && calendarOauthStartMatch) {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const account = db.calendarAccounts.find(item => item.id === calendarOauthStartMatch[1]);
    if (!account) return json(res, 404, { error: "Calendar account not found" });
    if (account.authMode !== "oauth" || !["google", "microsoft365"].includes(account.provider)) {
      return validationError(res, "This calendar account is not configured for interactive OAuth.");
    }
    const state = crypto.randomBytes(32).toString("hex");
    oauthStates.set(state, { accountId: account.id, provider: account.provider, expiresAt: Date.now() + 10 * 60 * 1000 });
    return json(res, 200, {
      authorizationUrl: calendarAuthorizationUrl(account, account.provider, baseUrl, state)
    });
  }
  const calendarOauthCallbackMatch = url.pathname.match(/^\/api\/calendar-oauth\/(google|microsoft365)\/callback$/);
  if (req.method === "GET" && calendarOauthCallbackMatch) {
    const provider = calendarOauthCallbackMatch[1];
    const state = cleanText(url.searchParams.get("state"), 200);
    const code = cleanText(url.searchParams.get("code"), 4000);
    const pending = oauthStates.get(state);
    oauthStates.delete(state);
    if (!pending || pending.provider !== provider || pending.expiresAt < Date.now()) return send(res, 400, "OAuth state expired or invalid.");
    const account = db.calendarAccounts.find(item => item.id === pending.accountId);
    if (!account || !code) return send(res, 400, "OAuth authorization code was not provided.");
    try {
      await exchangeCalendarAuthorizationCode(account, provider, baseUrl, code);
      account.lastVerifiedAt = new Date().toISOString();
      account.lastSyncError = "";
      const inspection = await inspectCalendarAccount(account);
      account.principalEmail = inspection.principalEmail || account.principalEmail;
      for (const discovered of inspection.discovered || []) {
        if (!account.calendars.some(calendar => calendar.externalId === discovered.externalId)) {
          account.calendars.push({
            id: entityId("calendar"),
            name: cleanText(discovered.name),
            externalId: cleanText(discovered.externalId, 1000),
            mailbox: cleanText(discovered.mailbox, 255)
          });
        }
      }
      addAudit("calendar.oauth.connect", { accountId: account.id, provider });
      await saveData();
      return redirect(res, "/admin?calendarOAuth=connected#calendars");
    } catch (error) {
      account.lastSyncError = cleanText(error.message, 500);
      await saveData();
      return redirect(res, `/admin?calendarOAuth=${encodeURIComponent(account.lastSyncError)}#calendars`);
    }
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
  const calendarWebhookRegisterMatch = url.pathname.match(/^\/api\/calendar-accounts\/([^/]+)\/calendars\/([^/]+)\/webhook$/);
  if (req.method === "POST" && calendarWebhookRegisterMatch) {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const account = db.calendarAccounts.find(item => item.id === calendarWebhookRegisterMatch[1]);
    const calendar = account?.calendars?.find(item => item.id === calendarWebhookRegisterMatch[2]);
    if (!account || !calendar) return json(res, 404, { error: "Calendar connection not found" });
    try {
      const providerPath = account.provider === "google" ? "google" : "microsoft";
      const result = await registerCalendarWebhook(
        account,
        calendar,
        `${baseUrl.replace(/\/+$/, "")}/api/calendar-webhooks/${providerPath}`
      );
      Object.assign(calendar, {
        webhookStatus: "active",
        webhookChannelId: result.channelId || "",
        encryptedWebhookToken: result.channelToken ? encryptCredential(result.channelToken) : "",
        webhookResourceId: result.resourceId || "",
        webhookSubscriptionId: result.subscriptionId || "",
        webhookClientState: result.clientState || "",
        webhookExpiration: result.expiration || null
      });
      delete calendar.webhookToken;
      account.webhookStatus = "active";
      account.webhookError = "";
      account.webhookExpiration = result.expiration || null;
      addAudit("calendar.webhook.register", { accountId: account.id, calendarId: calendar.id, provider: account.provider });
      await saveData();
      return json(res, 200, {
        account: publicCalendarAccount(account),
        calendar: publicCalendarAccount(account).calendars.find(item => item.id === calendar.id)
      });
    } catch (error) {
      account.webhookStatus = "polling-fallback";
      account.webhookError = cleanText(error.message, 500);
      await saveData();
      return json(res, 502, { error: `${error.message} Polling remains active.` });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/calendar-webhooks/google") {
    const channelId = String(req.headers["x-goog-channel-id"] || "");
    const channelToken = String(req.headers["x-goog-channel-token"] || "");
    const calendarAccount = db.calendarAccounts.find(account =>
      account.calendars.some(calendar =>
        calendar.webhookChannelId === channelId
        && Boolean(calendarWebhookToken(calendar))
        && secureTokenEqual(calendarWebhookToken(calendar), channelToken)
      )
    );
    if (calendarAccount) {
      calendarAccount.webhookStatus = "active";
      calendarAccount.webhookLastAt = new Date().toISOString();
      for (const assignment of db.calendarAssignments.filter(item => item.accountId === calendarAccount.id && item.active !== false)) {
        await calendarQueue.enqueue(assignment.id, "google-webhook");
      }
      await saveData();
    }
    return send(res, 204, "");
  }
  if (url.pathname === "/api/calendar-webhooks/microsoft" && url.searchParams.get("validationToken")) {
    return send(res, 200, url.searchParams.get("validationToken"), "text/plain; charset=utf-8");
  }
  if (req.method === "POST" && url.pathname === "/api/calendar-webhooks/microsoft") {
    const body = await readBody(req);
    for (const notification of body.value || []) {
      const account = db.calendarAccounts.find(item =>
        item.calendars.some(calendar =>
          calendar.webhookSubscriptionId === notification.subscriptionId
          && calendar.webhookClientState === notification.clientState
        )
      );
      if (!account) continue;
      account.webhookStatus = "active";
      account.webhookLastAt = new Date().toISOString();
      for (const assignment of db.calendarAssignments.filter(item => item.accountId === account.id && item.active !== false)) {
        await calendarQueue.enqueue(assignment.id, "microsoft-webhook");
      }
    }
    await saveData();
    return send(res, 202, "");
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
  const calendarEventCollectionMatch = url.pathname.match(/^\/api\/calendar-assignments\/([^/]+)\/events$/);
  if (req.method === "POST" && calendarEventCollectionMatch) {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const assignment = db.calendarAssignments.find(item => item.id === calendarEventCollectionMatch[1]);
    const account = db.calendarAccounts.find(item => item.id === assignment?.accountId);
    const calendar = account?.calendars.find(item => item.id === assignment?.calendarId);
    const room = db.rooms.find(item => item.id === assignment?.roomId);
    if (!assignment || !account || !calendar || !room) return json(res, 404, { error: "Calendar assignment not found" });
    if (!viewerCanAccessRoom(currentViewer(req), room)) return json(res, 403, { error: "This room is outside your assigned scope." });
    const body = await readBody(req);
    if (!cleanText(body.title) || !Number.isFinite(new Date(body.startsAt).getTime()) || !Number.isFinite(new Date(body.endsAt).getTime())) {
      return validationError(res, "Title, start time, and end time are required.");
    }
    if (new Date(body.endsAt) <= new Date(body.startsAt)) return validationError(res, "Event end time must be after start time.");
    await writeCalendarEvent(account, calendar, body);
    const result = await processCalendarAssignment(assignment.id);
    addAudit("calendar.event.create", { assignmentId: assignment.id, roomId: room.id, title: cleanText(body.title) });
    return json(res, 201, result);
  }
  const calendarEventMatch = url.pathname.match(/^\/api\/calendar-assignments\/([^/]+)\/events\/([^/]+)$/);
  if ((req.method === "PUT" || req.method === "DELETE") && calendarEventMatch) {
    if (!requirePermission(req, res, "calendar.manage")) return;
    const assignment = db.calendarAssignments.find(item => item.id === calendarEventMatch[1]);
    const account = db.calendarAccounts.find(item => item.id === assignment?.accountId);
    const calendar = account?.calendars.find(item => item.id === assignment?.calendarId);
    const room = db.rooms.find(item => item.id === assignment?.roomId);
    const event = db.calendarEvents.find(item => item.id === calendarEventMatch[2] && item.assignmentId === assignment?.id);
    if (!assignment || !account || !calendar || !room || !event) return json(res, 404, { error: "Calendar event not found" });
    if (!viewerCanAccessRoom(currentViewer(req), room)) return json(res, 403, { error: "This room is outside your assigned scope." });
    if (req.method === "DELETE") {
      await deleteCalendarEvent(account, calendar, event);
      addAudit("calendar.event.delete", { assignmentId: assignment.id, eventId: event.id });
    } else {
      const body = await readBody(req);
      if (!cleanText(body.title) || !Number.isFinite(new Date(body.startsAt).getTime()) || !Number.isFinite(new Date(body.endsAt).getTime())) {
        return validationError(res, "Title, start time, and end time are required.");
      }
      await writeCalendarEvent(account, calendar, body, event);
      addAudit("calendar.event.update", { assignmentId: assignment.id, eventId: event.id });
    }
    const result = await processCalendarAssignment(assignment.id);
    return json(res, 200, result);
  }
  const calendarConflictMatch = url.pathname.match(/^\/api\/calendar-conflicts\/([^/]+)\/select$/);
  if (req.method === "POST" && calendarConflictMatch) {
    if (!requirePermission(req, res, "calendar.sync")) return;
    const conflict = db.calendarConflicts.find(item => item.id === calendarConflictMatch[1]);
    const room = db.rooms.find(item => item.id === conflict?.roomId);
    if (!conflict || !room) return json(res, 404, { error: "Calendar conflict not found" });
    if (!viewerCanAccessRoom(currentViewer(req), room)) return json(res, 403, { error: "This room is outside your assigned scope." });
    const body = await readBody(req);
    const selected = cleanText(body.externalEventId, 1000);
    if (!conflict.externalEventIds.includes(selected)) return validationError(res, "Select an event included in this conflict.");
    conflict.selectedExternalEventId = selected;
    conflict.status = "display-selected";
    conflict.resolvedBy = currentViewer(req)?.id || null;
    conflict.resolvedAt = new Date().toISOString();
    refreshRoomEvents(room.id);
    addAudit("calendar.conflict.display-select", { conflictId: conflict.id, externalEventId: selected });
    await saveData();
    notifyRoom(room.code);
    return json(res, 200, conflict);
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
    const allowedSeverities = new Set(["informational", "warning", "urgent", "critical", "emergency"]);
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
    const allowedSeverities = new Set(["informational", "warning", "urgent", "critical", "emergency"]);
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
    const bookingUrl = cleanText(body.bookingUrl, 500);
    const contactEmail = cleanText(body.contactEmail, 255).toLowerCase();
    const logoUrl = cleanText(body.logoUrl, 500) || "/assets/branding/aksharderi-small2.png";
    if (bookingUrl && !validUrl(bookingUrl)) return validationError(res, "Enter a valid center booking URL.");
    if (contactEmail && !validEmail(contactEmail)) return validationError(res, "Enter a valid center contact email.");
    if (logoUrl && !validUrl(logoUrl) && !logoUrl.startsWith("/assets/")) return validationError(res, "Enter a valid logo URL or asset path.");
    if (body.defaultThemeId && !db.themes.some(theme => theme.id === body.defaultThemeId)) {
      return validationError(res, "Select a valid default theme.");
    }
    const center = {
      id: entityId("center"),
      name,
      description: cleanText(body.description, 2000),
      logoUrl,
      contactName: cleanText(body.contactName, 160),
      contactEmail,
      contactPhone: cleanText(body.contactPhone, 80),
      bookingUrl,
      upcomingEventCount: nullableInteger(body.upcomingEventCount) || 5,
      showEventDescription: body.showEventDescription === true || body.showEventDescription === "true",
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
    const bookingUrl = cleanText(body.bookingUrl, 500);
    const contactEmail = cleanText(body.contactEmail, 255).toLowerCase();
    const logoUrl = cleanText(body.logoUrl, 500) || "/assets/branding/aksharderi-small2.png";
    if (bookingUrl && !validUrl(bookingUrl)) return validationError(res, "Enter a valid center booking URL.");
    if (contactEmail && !validEmail(contactEmail)) return validationError(res, "Enter a valid center contact email.");
    if (logoUrl && !validUrl(logoUrl) && !logoUrl.startsWith("/assets/")) return validationError(res, "Enter a valid logo URL or asset path.");
    if (body.defaultThemeId && !db.themes.some(theme => theme.id === body.defaultThemeId)) {
      return validationError(res, "Select a valid default theme.");
    }
    Object.assign(center, {
      name,
      description: cleanText(body.description, 2000),
      logoUrl,
      contactName: cleanText(body.contactName, 160),
      contactEmail,
      contactPhone: cleanText(body.contactPhone, 80),
      bookingUrl,
      upcomingEventCount: nullableInteger(body.upcomingEventCount) || 5,
      showEventDescription: body.showEventDescription === true || body.showEventDescription === "true",
      timezone,
      defaultThemeId: body.defaultThemeId || center.defaultThemeId,
      active: body.active !== false
    });
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
    const bookingUrl = cleanText(body.bookingUrl, 500);
    const contactEmail = cleanText(body.contactEmail, 255).toLowerCase();
    if (bookingUrl && !validUrl(bookingUrl)) return validationError(res, "Enter a valid campus booking URL.");
    if (contactEmail && !validEmail(contactEmail)) return validationError(res, "Enter a valid campus contact email.");
    if (body.defaultThemeId && !db.themes.some(theme => theme.id === body.defaultThemeId)) return validationError(res, "Select a valid campus theme.");
    const campus = {
      id: entityId("campus"),
      centerId: body.centerId,
      name,
      address: cleanText(body.address, 300),
      contactName: cleanText(body.contactName, 160),
      contactEmail,
      contactPhone: cleanText(body.contactPhone, 80),
      bookingUrl,
      defaultThemeId: cleanText(body.defaultThemeId, 160),
      upcomingEventCount: nullableInteger(body.upcomingEventCount),
      showEventDescription: nullableBoolean(body.showEventDescription),
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
    const bookingUrl = cleanText(body.bookingUrl, 500);
    const contactEmail = cleanText(body.contactEmail, 255).toLowerCase();
    if (bookingUrl && !validUrl(bookingUrl)) return validationError(res, "Enter a valid campus booking URL.");
    if (contactEmail && !validEmail(contactEmail)) return validationError(res, "Enter a valid campus contact email.");
    if (body.defaultThemeId && !db.themes.some(theme => theme.id === body.defaultThemeId)) return validationError(res, "Select a valid campus theme.");
    if (db.buildings.some(building => building.campusId === campus.id) && body.centerId !== campus.centerId) {
      return json(res, 409, { error: "A campus with buildings cannot be moved to another center." });
    }
    Object.assign(campus, {
      centerId: body.centerId,
      name,
      address: cleanText(body.address, 300),
      contactName: cleanText(body.contactName, 160),
      contactEmail,
      contactPhone: cleanText(body.contactPhone, 80),
      bookingUrl,
      defaultThemeId: cleanText(body.defaultThemeId, 160),
      upcomingEventCount: nullableInteger(body.upcomingEventCount),
      showEventDescription: nullableBoolean(body.showEventDescription),
      active: body.active !== false
    });
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
    const timezone = cleanText(body.timezone, 80);
    const bookingUrl = cleanText(body.bookingUrl, 500);
    if (timezone && !validTimezone(timezone)) return validationError(res, "Enter a valid building timezone override.");
    if (bookingUrl && !validUrl(bookingUrl)) return validationError(res, "Enter a valid building booking URL.");
    if (body.defaultThemeId && !db.themes.some(theme => theme.id === body.defaultThemeId)) return validationError(res, "Select a valid building theme.");
    const building = {
      id: entityId("building"),
      campusId: body.campusId,
      name,
      code: cleanText(body.code, 40),
      address: cleanText(body.address, 300),
      floors: cleanText(body.floors, 300),
      timezone,
      bookingUrl,
      defaultThemeId: cleanText(body.defaultThemeId, 160),
      upcomingEventCount: nullableInteger(body.upcomingEventCount),
      showEventDescription: nullableBoolean(body.showEventDescription),
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
    const timezone = cleanText(body.timezone, 80);
    const bookingUrl = cleanText(body.bookingUrl, 500);
    if (timezone && !validTimezone(timezone)) return validationError(res, "Enter a valid building timezone override.");
    if (bookingUrl && !validUrl(bookingUrl)) return validationError(res, "Enter a valid building booking URL.");
    if (body.defaultThemeId && !db.themes.some(theme => theme.id === body.defaultThemeId)) return validationError(res, "Select a valid building theme.");
    if (db.rooms.some(room => room.buildingId === building.id) && body.campusId !== building.campusId) {
      return json(res, 409, { error: "A building with rooms cannot be moved to another campus." });
    }
    Object.assign(building, {
      campusId: body.campusId,
      name,
      code: cleanText(body.code, 40),
      address: cleanText(body.address, 300),
      floors: cleanText(body.floors, 300),
      timezone,
      bookingUrl,
      defaultThemeId: cleanText(body.defaultThemeId, 160),
      upcomingEventCount: nullableInteger(body.upcomingEventCount),
      showEventDescription: nullableBoolean(body.showEventDescription),
      active: body.active !== false
    });
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
    const themeId = cleanText(body.themeId, 160);
    const hierarchy = findHierarchy(body);
    if (!name) return validationError(res, "Room name is required.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) return validationError(res, "Room code must use lowercase letters, numbers, and single hyphens.");
    if (db.rooms.some(room => room.code === code)) return json(res, 409, { error: "That room code is already in use." });
    if (bookingUrl && !validUrl(bookingUrl)) return validationError(res, "Enter a valid HTTP or HTTPS booking URL.");
    if (hierarchy.error) return validationError(res, hierarchy.error);
    if (themeId && !db.themes.some(theme => theme.id === themeId)) return validationError(res, "Select a valid theme.");
    if (!["available", "maintenance", "closed"].includes(body.maintenanceStatus || "available")) return validationError(res, "Select a valid maintenance status.");
    if (!["standard", "private-title", "hide-details"].includes(body.privacyMode || "standard")) return validationError(res, "Select a valid privacy setting.");
    const room = {
      id: entityId("room"),
      code,
      name,
      centerId: body.centerId,
      campusId: body.campusId,
      buildingId: body.buildingId,
      bookingUrl,
      themeId,
      roomNumber: cleanText(body.roomNumber, 80),
      floor: cleanText(body.floor, 80),
      roomType: cleanText(body.roomType, 80) || "Classroom",
      capacity: Number.isFinite(Number(body.capacity)) && Number(body.capacity) > 0 ? Number(body.capacity) : null,
      equipment: cleanText(body.equipment, 2000),
      accessibilityNotes: cleanText(body.accessibilityNotes, 2000),
      maintenanceStatus: body.maintenanceStatus || "available",
      privacyMode: body.privacyMode || "standard",
      upcomingEventCount: nullableInteger(body.upcomingEventCount),
      showEventDescription: nullableBoolean(body.showEventDescription),
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
  const roomQrMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/qr\.svg$/);
  if (req.method === "GET" && roomQrMatch) {
    const room = db.rooms.find(item => item.code === roomQrMatch[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    const publicData = publicRoom(room);
    if (!publicData.bookingUrl) return send(res, 404, "Booking URL is not configured.");
    const tokens = publicData.themeCssTokens || {};
    let foreground = qrColor(tokens.qrForeground, "#000000");
    let background = qrColor(tokens.qrBackground, "#ffffff");
    const transparent = String(tokens.qrTransparent) === "true";
    if (transparent && colorLuminance(foreground) > 0.35) foreground = "#000000";
    if (!transparent && contrastRatio(foreground, background) < 4.5) {
      foreground = "#000000";
      background = "#ffffff";
    }
    if (transparent) background = "#00000000";
    const svg = await QRCode.toString(publicData.bookingUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: Math.max(1, Math.min(8, Number(tokens.qrMargin || 2))),
      width: Math.max(96, Math.min(512, Number(tokens.qrSize || 132))),
      color: { dark: foreground, light: background }
    });
    return send(res, 200, svg, "image/svg+xml; charset=utf-8");
  }
  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (req.method === "GET" && roomMatch) {
    const room = db.rooms.find(item => item.code === roomMatch[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    return json(res, 200, publicRoom(
      room,
      cleanText(url.searchParams.get("theme"), 120),
      cleanText(url.searchParams.get("state"), 20)
    ));
  }
  if (req.method === "PUT" && roomMatch) {
    if (!requirePermission(req, res, "room.manage")) return;
    const room = db.rooms.find(item => item.id === roomMatch[1] || item.code === roomMatch[1]);
    if (!room) return json(res, 404, { error: "Room not found" });
    const body = await readBody(req);
    const name = cleanText(body.name);
    const code = cleanText(body.code, 80).toLowerCase();
    const bookingUrl = cleanText(body.bookingUrl, 500);
    const themeId = cleanText(body.themeId, 160);
    const hierarchy = findHierarchy(body);
    if (!name) return validationError(res, "Room name is required.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) return validationError(res, "Room code must use lowercase letters, numbers, and single hyphens.");
    if (db.rooms.some(item => item.id !== room.id && item.code === code)) return json(res, 409, { error: "That room code is already in use." });
    if (bookingUrl && !validUrl(bookingUrl)) return validationError(res, "Enter a valid HTTP or HTTPS booking URL.");
    if (hierarchy.error) return validationError(res, hierarchy.error);
    if (themeId && !db.themes.some(theme => theme.id === themeId)) return validationError(res, "Select a valid theme.");
    if (!["available", "maintenance", "closed"].includes(body.maintenanceStatus || "available")) return validationError(res, "Select a valid maintenance status.");
    if (!["standard", "private-title", "hide-details"].includes(body.privacyMode || "standard")) return validationError(res, "Select a valid privacy setting.");
    const previousCode = room.code;
    Object.assign(room, {
      code,
      name,
      centerId: body.centerId,
      campusId: body.campusId,
      buildingId: body.buildingId,
      bookingUrl,
      themeId,
      roomNumber: cleanText(body.roomNumber, 80),
      floor: cleanText(body.floor, 80),
      roomType: cleanText(body.roomType, 80) || "Classroom",
      capacity: Number.isFinite(Number(body.capacity)) && Number(body.capacity) > 0 ? Number(body.capacity) : null,
      equipment: cleanText(body.equipment, 2000),
      accessibilityNotes: cleanText(body.accessibilityNotes, 2000),
      maintenanceStatus: body.maintenanceStatus || "available",
      privacyMode: body.privacyMode || "standard",
      upcomingEventCount: nullableInteger(body.upcomingEventCount),
      showEventDescription: nullableBoolean(body.showEventDescription),
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
    for (const group of db.roomGroups) group.roomIds = group.roomIds.filter(id => id !== room.id);
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
    const deviceId = cleanText(url.searchParams.get("deviceId"), 160);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ roomCode })}\n\n`);
    if (!clients.has(roomCode)) clients.set(roomCode, new Set());
    const client = { res, deviceId };
    clients.get(roomCode).add(client);
    req.on("close", () => clients.get(roomCode)?.delete(client));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/kiosk-devices/register") {
    const body = await readBody(req);
    const room = db.rooms.find(item => item.code === body.roomCode);
    const clientDeviceId = cleanText(body.clientDeviceId, 160);
    if (!room || !clientDeviceId) return validationError(res, "Room code and device ID are required.");
    let device = db.kioskDevices.find(item => item.clientDeviceId === clientDeviceId);
    if (!device) {
      device = {
        id: entityId("kiosk-device"),
        clientDeviceId,
        deviceToken: crypto.randomBytes(32).toString("hex"),
        pairingCode: String(crypto.randomInt(100000, 999999)),
        roomId: room.id,
        name: cleanText(body.name, 160) || `${room.name} Display`,
        status: "pending",
        browser: cleanText(body.browser, 300),
        platform: cleanText(body.platform, 160),
        viewport: cleanText(body.viewport, 80),
        orientation: cleanText(body.orientation, 30),
        audioEnabled: body.audioEnabled === true,
        createdAt: new Date().toISOString(),
        approvedBy: null,
        approvedAt: null,
        lastSeenAt: new Date().toISOString(),
        lastDataAt: null,
        pendingCommand: null
      };
      db.kioskDevices.push(device);
      addAudit("kiosk.device.register", { deviceId: device.id, roomId: room.id });
    } else {
      Object.assign(device, {
        roomId: room.id,
        browser: cleanText(body.browser, 300),
        platform: cleanText(body.platform, 160),
        viewport: cleanText(body.viewport, 80),
        orientation: cleanText(body.orientation, 30),
        audioEnabled: body.audioEnabled === true,
        lastSeenAt: new Date().toISOString()
      });
    }
    await saveData();
    return json(res, device.status === "pending" ? 202 : 200, {
      ...publicKioskDevice(device, true),
      deviceToken: device.deviceToken
    });
  }
  if (req.method === "POST" && url.pathname === "/api/kiosk-devices/heartbeat") {
    const body = await readBody(req);
    const device = db.kioskDevices.find(item =>
      item.clientDeviceId === body.clientDeviceId
      && secureTokenEqual(item.deviceToken, body.deviceToken)
    );
    if (!device) return json(res, 401, { error: "Device registration is not recognized." });
    Object.assign(device, {
      browser: cleanText(body.browser, 300),
      platform: cleanText(body.platform, 160),
      viewport: cleanText(body.viewport, 80),
      orientation: cleanText(body.orientation, 30),
      audioEnabled: body.audioEnabled === true,
      lastDataAt: body.lastDataAt ? cleanText(body.lastDataAt, 80) : device.lastDataAt,
      lastSeenAt: new Date().toISOString()
    });
    const pendingCommand = device.pendingCommand;
    device.pendingCommand = null;
    await saveData();
    return json(res, 200, { status: device.status, pendingCommand });
  }
  const kioskApproveMatch = url.pathname.match(/^\/api\/kiosk-devices\/([^/]+)\/approve$/);
  if (req.method === "POST" && kioskApproveMatch) {
    const device = db.kioskDevices.find(item => item.id === kioskApproveMatch[1]);
    const room = db.rooms.find(item => item.id === device?.roomId);
    const viewer = currentViewer(req);
    if (!device || !room) return json(res, 404, { error: "Kiosk device not found" });
    if (!viewerCanPairRoom(viewer, room)) return json(res, 403, { error: "System Admin or the room's Center Admin is required." });
    const body = await readBody(req);
    if (cleanText(body.pairingCode, 20) !== device.pairingCode) return validationError(res, "Pairing code does not match.");
    device.status = "active";
    device.approvedBy = viewer?.id || null;
    device.approvedAt = new Date().toISOString();
    addAudit("kiosk.device.approve", { deviceId: device.id, roomId: room.id });
    await saveData();
    notifyRoom(room.code, "data-refresh", device.clientDeviceId);
    return json(res, 200, publicKioskDevice(device));
  }
  const kioskCommandMatch = url.pathname.match(/^\/api\/kiosk-devices\/([^/]+)\/command$/);
  if (req.method === "POST" && kioskCommandMatch) {
    if (!requirePermission(req, res, "room.manage")) return;
    const device = db.kioskDevices.find(item => item.id === kioskCommandMatch[1]);
    const room = db.rooms.find(item => item.id === device?.roomId);
    if (!device || !room) return json(res, 404, { error: "Kiosk device not found" });
    if (!viewerCanAccessRoom(currentViewer(req), room)) return json(res, 403, { error: "This device is outside your assigned scope." });
    const body = await readBody(req);
    const command = body.command === "reload" ? "reload" : "data-refresh";
    device.pendingCommand = command;
    notifyRoom(room.code, command, device.clientDeviceId);
    addAudit("kiosk.device.command", { deviceId: device.id, command });
    await saveData();
    return json(res, 200, { sent: true, command });
  }
  const kioskDeviceMatch = url.pathname.match(/^\/api\/kiosk-devices\/([^/]+)$/);
  if (req.method === "DELETE" && kioskDeviceMatch) {
    if (!requirePermission(req, res, "room.manage")) return;
    const device = db.kioskDevices.find(item => item.id === kioskDeviceMatch[1]);
    const room = db.rooms.find(item => item.id === device?.roomId);
    if (!device || !room) return json(res, 404, { error: "Kiosk device not found" });
    if (!viewerCanAccessRoom(currentViewer(req), room)) return json(res, 403, { error: "This device is outside your assigned scope." });
    db.kioskDevices = db.kioskDevices.filter(item => item.id !== device.id);
    addAudit("kiosk.device.delete", { deviceId: device.id, roomId: room.id });
    await saveData();
    return json(res, 200, { deleted: true });
  }
  if (req.method === "POST" && url.pathname === "/api/kiosks/refresh") {
    if (!requirePermission(req, res, "room.manage")) return;
    const body = await readBody(req);
    const target = {
      centerIds: cleanIdArray(body.centerIds),
      campusIds: cleanIdArray(body.campusIds),
      buildingIds: cleanIdArray(body.buildingIds),
      roomGroupIds: cleanIdArray(body.roomGroupIds),
      roomIds: cleanIdArray(body.roomIds),
      targetRoomCodes: []
    };
    const rooms = broadcastTargetRooms(target);
    const viewer = currentViewer(req);
    if (!rooms.length) return validationError(res, "Select at least one kiosk target.");
    if (rooms.some(room => !viewerCanAccessRoom(viewer, room))) return json(res, 403, { error: "One or more kiosk targets are outside your scope." });
    const command = body.command === "reload" ? "reload" : "data-refresh";
    for (const room of rooms) notifyRoom(room.code, command);
    addAudit("kiosk.refresh.scope", { command, roomIds: rooms.map(room => room.id) });
    return json(res, 200, { sent: rooms.length, command });
  }
  if (req.method === "POST" && url.pathname === "/api/room-groups") {
    if (!requirePermission(req, res, "room.manage")) return;
    const body = await readBody(req);
    const viewer = currentViewer(req);
    const name = cleanText(body.name);
    const roomIds = cleanIdArray(body.roomIds);
    const rooms = roomIds.map(id => db.rooms.find(room => room.id === id)).filter(Boolean);
    if (!name) return validationError(res, "Room group name is required.");
    if (!rooms.length || rooms.length !== roomIds.length) return validationError(res, "Select at least one valid room.");
    if (rooms.some(room => !viewerCanAccessRoom(viewer, room))) return json(res, 403, { error: "One or more rooms are outside your assigned scope." });
    const now = new Date().toISOString();
    const group = {
      id: entityId("room-group"),
      name,
      description: cleanText(body.description, 1000),
      roomIds,
      active: body.active !== false,
      createdBy: viewer?.id || null,
      createdAt: now,
      updatedAt: null,
      updatedBy: null
    };
    db.roomGroups.push(group);
    addAudit("room-group.create", { groupId: group.id, name, roomCount: roomIds.length });
    await saveData();
    return json(res, 201, group);
  }
  const roomGroupMatch = url.pathname.match(/^\/api\/room-groups\/([^/]+)$/);
  if (req.method === "PUT" && roomGroupMatch) {
    if (!requirePermission(req, res, "room.manage")) return;
    const group = db.roomGroups.find(item => item.id === roomGroupMatch[1]);
    if (!group) return json(res, 404, { error: "Room group not found" });
    const body = await readBody(req);
    const viewer = currentViewer(req);
    const name = cleanText(body.name);
    const roomIds = cleanIdArray(body.roomIds);
    const rooms = roomIds.map(id => db.rooms.find(room => room.id === id)).filter(Boolean);
    if (!name) return validationError(res, "Room group name is required.");
    if (!rooms.length || rooms.length !== roomIds.length) return validationError(res, "Select at least one valid room.");
    if (rooms.some(room => !viewerCanAccessRoom(viewer, room))) return json(res, 403, { error: "One or more rooms are outside your assigned scope." });
    Object.assign(group, {
      name,
      description: cleanText(body.description, 1000),
      roomIds,
      active: body.active !== false,
      updatedAt: new Date().toISOString(),
      updatedBy: viewer?.id || null
    });
    addAudit("room-group.update", { groupId: group.id, name, roomCount: roomIds.length });
    await saveData();
    return json(res, 200, group);
  }
  if (req.method === "DELETE" && roomGroupMatch) {
    if (!requirePermission(req, res, "room.manage")) return;
    const group = db.roomGroups.find(item => item.id === roomGroupMatch[1]);
    if (!group) return json(res, 404, { error: "Room group not found" });
    const viewer = currentViewer(req);
    const rooms = group.roomIds.map(id => db.rooms.find(room => room.id === id)).filter(Boolean);
    if (rooms.some(room => !viewerCanAccessRoom(viewer, room))) return json(res, 403, { error: "This group includes rooms outside your assigned scope." });
    db.roomGroups = db.roomGroups.filter(item => item.id !== group.id);
    addAudit("room-group.delete", { groupId: group.id, name: group.name });
    await saveData();
    return json(res, 200, { deleted: true });
  }
  if (req.method === "POST" && url.pathname === "/api/broadcasts") {
    if (!requirePermission(req, res, "broadcast.publish")) return;
    const body = await readBody(req);
    if (!body.confirm) return json(res, 400, { error: "Broadcast confirmation is required" });
    const template = body.templateId
      ? db.broadcastTemplates.find(item => item.id === body.templateId && item.active)
      : null;
    if (body.templateId && !template) return validationError(res, "Select an active broadcast template.");
    const viewer = currentViewer(req);
    const now = new Date();
    const broadcast = broadcastFromBody({
      ...body,
      title: body.title || template?.title || "IMPORTANT SYSTEM OVERRIDE",
      message: body.message || template?.message || "",
      severity: body.severity || template?.severity || "emergency",
      audibleAlert: body.audibleAlert ?? template?.audibleAlert ?? true,
      startsAt: body.startsAt || now.toISOString()
    }, {
      id: crypto.randomUUID(),
      createdBy: viewer?.id || null,
      updatedBy: null,
      startedAt: null,
      endedAt: null,
      endedBy: null,
      status: "scheduled",
      activationNotifiedAt: null,
      endingNotifiedAt: null,
      createdAt: now.toISOString(),
      updatedAt: null
    });
    broadcast.templateId = template?.id || broadcast.templateId;
    const error = validateBroadcast(broadcast, viewer);
    if (error?.includes("outside your assigned scope")) return json(res, 403, { error });
    if (error) return validationError(res, error);
    broadcast.startsAt = new Date(broadcast.startsAt).toISOString();
    broadcast.endsAt = broadcast.endsAt ? new Date(broadcast.endsAt).toISOString() : null;
    broadcast.targetRoomCodes = broadcastTargetRooms(broadcast).map(room => room.code);
    broadcast.status = broadcastStatusAt(broadcast, now);
    if (broadcast.status === "active") {
      broadcast.startedAt = now.toISOString();
      broadcast.activationNotifiedAt = now.toISOString();
    }
    db.broadcasts.unshift(broadcast);
    addAudit(broadcast.status === "active" ? "broadcast.publish" : "broadcast.schedule", {
      id: broadcast.id,
      title: broadcast.title,
      targetRoomCodes: broadcast.targetRoomCodes,
      startsAt: broadcast.startsAt,
      endsAt: broadcast.endsAt
    });
    await saveData();
    notifyChangedRooms(broadcast.targetRoomCodes);
    if (broadcast.status === "active") {
      await notifyBroadcastEvent(broadcast, "activated");
      await saveData();
    }
    return json(res, 201, publicBroadcast(broadcast));
  }
  const broadcastMatch = url.pathname.match(/^\/api\/broadcasts\/([^/]+)$/);
  if (req.method === "PUT" && broadcastMatch) {
    if (!requirePermission(req, res, "broadcast.publish")) return;
    const broadcast = db.broadcasts.find(item => item.id === broadcastMatch[1]);
    if (!broadcast) return json(res, 404, { error: "Broadcast not found" });
    if (["ended", "cancelled"].includes(broadcastStatusAt(broadcast))) return json(res, 409, { error: "Ended or cancelled broadcasts cannot be edited." });
    const viewer = currentViewer(req);
    if (broadcastTargetRooms(broadcast).some(room => !viewerCanAccessRoom(viewer, room))) return json(res, 403, { error: "This broadcast includes rooms outside your assigned scope." });
    const previousRoomCodes = broadcastTargetRooms(broadcast).map(room => room.code);
    const body = await readBody(req);
    const updated = broadcastFromBody(body, broadcast);
    const error = validateBroadcast(updated, viewer);
    if (error?.includes("outside your assigned scope")) return json(res, 403, { error });
    if (error) return validationError(res, error);
    updated.startsAt = new Date(updated.startsAt).toISOString();
    updated.endsAt = updated.endsAt ? new Date(updated.endsAt).toISOString() : null;
    updated.updatedAt = new Date().toISOString();
    updated.updatedBy = viewer?.id || null;
    updated.status = broadcastStatusAt(updated);
    updated.targetRoomCodes = broadcastTargetRooms({ ...broadcast, ...updated, targetRoomCodes: [] }).map(room => room.code);
    Object.assign(broadcast, updated);
    addAudit("broadcast.update", { id: broadcast.id, title: broadcast.title, targetRoomCodes: broadcast.targetRoomCodes });
    await saveData();
    notifyChangedRooms([...previousRoomCodes, ...broadcast.targetRoomCodes]);
    await notifyBroadcastEvent(broadcast, "updated");
    await saveData();
    return json(res, 200, publicBroadcast(broadcast));
  }
  const broadcastEndMatch = url.pathname.match(/^\/api\/broadcasts\/([^/]+)\/end$/);
  if (req.method === "POST" && broadcastEndMatch) {
    if (!requirePermission(req, res, "broadcast.publish")) return;
    const broadcast = db.broadcasts.find(item => item.id === broadcastEndMatch[1]);
    if (!broadcast) return json(res, 404, { error: "Broadcast not found" });
    const viewer = currentViewer(req);
    const rooms = broadcastTargetRooms(broadcast);
    if (rooms.some(room => !viewerCanAccessRoom(viewer, room))) return json(res, 403, { error: "This broadcast includes rooms outside your assigned scope." });
    broadcast.endedAt = new Date().toISOString();
    broadcast.endedBy = viewer?.id || null;
    broadcast.status = "ended";
    broadcast.endingNotifiedAt = broadcast.endedAt;
    addAudit("broadcast.end", { id: broadcast.id });
    await saveData();
    notifyChangedRooms(rooms.map(room => room.code));
    await notifyBroadcastEvent(broadcast, "ended");
    await saveData();
    return json(res, 200, publicBroadcast(broadcast));
  }
  const broadcastCancelMatch = url.pathname.match(/^\/api\/broadcasts\/([^/]+)\/cancel$/);
  if (req.method === "POST" && broadcastCancelMatch) {
    if (!requirePermission(req, res, "broadcast.publish")) return;
    const broadcast = db.broadcasts.find(item => item.id === broadcastCancelMatch[1]);
    if (!broadcast) return json(res, 404, { error: "Broadcast not found" });
    if (broadcastStatusAt(broadcast) !== "scheduled") return json(res, 409, { error: "Only scheduled broadcasts can be cancelled." });
    const viewer = currentViewer(req);
    const rooms = broadcastTargetRooms(broadcast);
    if (rooms.some(room => !viewerCanAccessRoom(viewer, room))) return json(res, 403, { error: "This broadcast includes rooms outside your assigned scope." });
    broadcast.status = "cancelled";
    broadcast.endedAt = new Date().toISOString();
    broadcast.endedBy = viewer?.id || null;
    addAudit("broadcast.cancel", { id: broadcast.id });
    await notifyBroadcastEvent(broadcast, "cancelled");
    await saveData();
    return json(res, 200, publicBroadcast(broadcast));
  }
  if (req.method === "POST" && url.pathname === "/api/broadcasts/end") {
    if (!requirePermission(req, res, "broadcast.publish")) return;
    const viewer = currentViewer(req);
    const broadcast = db.broadcasts
      .filter(item => broadcastStatusAt(item) === "active")
      .filter(item => broadcastTargetRooms(item).every(room => viewerCanAccessRoom(viewer, room)))
      .sort((a, b) => String(b.startsAt).localeCompare(String(a.startsAt)))[0];
    if (!broadcast) return json(res, 200, { ended: false });
    broadcast.endedAt = new Date().toISOString();
    broadcast.endedBy = viewer?.id || null;
    broadcast.status = "ended";
    broadcast.endingNotifiedAt = broadcast.endedAt;
    addAudit("broadcast.end", { id: broadcast.id });
    await saveData();
    notifyChangedRooms(broadcastTargetRooms(broadcast).map(room => room.code));
    await notifyBroadcastEvent(broadcast, "ended");
    await saveData();
    return json(res, 200, { ended: true, broadcast: publicBroadcast(broadcast) });
  }
  if (req.method === "POST" && url.pathname === "/api/theme-schedules") {
    if (!requirePermission(req, res, "theme.manage")) return;
    const body = await readBody(req);
    const viewer = currentViewer(req);
    const schedule = scheduleFromBody(body, {
      id: entityId("theme-schedule"),
      createdBy: viewer?.id || null,
      createdAt: new Date().toISOString(),
      updatedAt: null
    });
    const error = validateThemeSchedule(schedule, viewer);
    if (error) return validationError(res, error);
    schedule.startsAt = new Date(schedule.startsAt).toISOString();
    schedule.endsAt = new Date(schedule.endsAt).toISOString();
    db.themeSchedules.push(schedule);
    addAudit("theme.schedule.create", { scheduleId: schedule.id, themeId: schedule.themeId, roomCount: scheduleTargetRooms(schedule).length });
    await saveData();
    notifyChangedRooms(scheduleTargetRooms(schedule).map(room => room.code));
    return json(res, 201, publicThemeSchedule(schedule));
  }
  const themeScheduleMatch = url.pathname.match(/^\/api\/theme-schedules\/([^/]+)$/);
  if (req.method === "PUT" && themeScheduleMatch) {
    if (!requirePermission(req, res, "theme.manage")) return;
    const schedule = db.themeSchedules.find(item => item.id === themeScheduleMatch[1]);
    if (!schedule) return json(res, 404, { error: "Theme schedule not found" });
    const viewer = currentViewer(req);
    if (scheduleTargetRooms(schedule).some(room => !viewerCanAccessRoom(viewer, room))) {
      return json(res, 403, { error: "This schedule includes rooms outside your assigned scope." });
    }
    const previousRooms = scheduleTargetRooms(schedule);
    const updated = scheduleFromBody(await readBody(req), schedule);
    const error = validateThemeSchedule(updated, viewer);
    if (error) return validationError(res, error);
    updated.startsAt = new Date(updated.startsAt).toISOString();
    updated.endsAt = new Date(updated.endsAt).toISOString();
    updated.updatedBy = viewer?.id || null;
    updated.updatedAt = new Date().toISOString();
    Object.assign(schedule, updated);
    const changedRooms = [...previousRooms, ...scheduleTargetRooms(schedule)].map(room => room.code);
    addAudit("theme.schedule.update", { scheduleId: schedule.id, themeId: schedule.themeId, roomCount: scheduleTargetRooms(schedule).length });
    await saveData();
    notifyChangedRooms(changedRooms);
    return json(res, 200, publicThemeSchedule(schedule));
  }
  if (req.method === "DELETE" && themeScheduleMatch) {
    if (!requirePermission(req, res, "theme.manage")) return;
    const schedule = db.themeSchedules.find(item => item.id === themeScheduleMatch[1]);
    if (!schedule) return json(res, 404, { error: "Theme schedule not found" });
    const viewer = currentViewer(req);
    const rooms = scheduleTargetRooms(schedule);
    if (rooms.some(room => !viewerCanAccessRoom(viewer, room))) {
      return json(res, 403, { error: "This schedule includes rooms outside your assigned scope." });
    }
    db.themeSchedules = db.themeSchedules.filter(item => item.id !== schedule.id);
    addAudit("theme.schedule.delete", { scheduleId: schedule.id, themeId: schedule.themeId });
    await saveData();
    notifyChangedRooms(rooms.map(room => room.code));
    return json(res, 200, { deleted: true });
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
  const themeBackgroundMatch = url.pathname.match(/^\/api\/themes\/([^/]+)\/background$/);
  if (req.method === "POST" && themeBackgroundMatch) {
    if (!requirePermission(req, res, "theme.manage")) return;
    const theme = db.themes.find(item => item.id === themeBackgroundMatch[1]);
    if (!theme) return json(res, 404, { error: "Theme not found" });
    if (theme.builtIn) return json(res, 409, { error: "Clone a built-in theme before uploading a background." });
    const body = await readBody(req);
    const mimeTypes = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
    const mimeType = cleanText(body.mimeType, 80);
    const extension = mimeTypes[mimeType];
    if (!extension) return validationError(res, "Upload a PNG, JPEG, or WebP image.");
    const data = String(body.data || "").replace(/^data:[^;]+;base64,/, "");
    let image;
    try {
      image = Buffer.from(data, "base64");
    } catch {
      return validationError(res, "The uploaded image could not be decoded.");
    }
    if (!image.length || image.length > 5 * 1024 * 1024) return validationError(res, "Background images must be between 1 byte and 5 MB.");
    if (!validImageSignature(image, mimeType)) return validationError(res, "The uploaded file does not match its declared image type.");
    await fs.mkdir(themeAssetsDir, { recursive: true });
    const filename = `${theme.id}-${crypto.randomUUID()}${extension}`;
    const assetUrl = `/assets/uploads/themes/${filename}`;
    await fs.writeFile(path.join(themeAssetsDir, filename), image);
    const previousAsset = theme.cssTokens?.backgroundImage || "";
    theme.cssTokens = { ...defaultThemeTokens, ...theme.cssTokens, backgroundImage: assetUrl };
    theme.updatedAt = new Date().toISOString();
    const previousPath = uploadedThemeAssetPath(previousAsset);
    const previousInUse = db.themes.some(item => item.id !== theme.id && item.cssTokens?.backgroundImage === previousAsset);
    if (previousPath && !previousInUse) await fs.rm(previousPath, { force: true });
    addAudit("theme.background.upload", { themeId: theme.id, assetUrl, originalName: cleanText(body.filename, 255) });
    await saveData();
    notifyAllRooms();
    return json(res, 200, theme);
  }
  if (req.method === "DELETE" && themeBackgroundMatch) {
    if (!requirePermission(req, res, "theme.manage")) return;
    const theme = db.themes.find(item => item.id === themeBackgroundMatch[1]);
    if (!theme) return json(res, 404, { error: "Theme not found" });
    if (theme.builtIn) return json(res, 409, { error: "Built-in theme backgrounds cannot be removed." });
    const assetUrl = theme.cssTokens?.backgroundImage || "";
    theme.cssTokens = { ...defaultThemeTokens, ...theme.cssTokens, backgroundImage: "" };
    theme.updatedAt = new Date().toISOString();
    const assetPath = uploadedThemeAssetPath(assetUrl);
    const inUse = db.themes.some(item => item.id !== theme.id && item.cssTokens?.backgroundImage === assetUrl);
    if (assetPath && !inUse) await fs.rm(assetPath, { force: true });
    addAudit("theme.background.delete", { themeId: theme.id, assetUrl });
    await saveData();
    notifyAllRooms();
    return json(res, 200, theme);
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
      if (allowedTokens.has(key) && key !== "backgroundImage") cssTokens[key] = cleanText(value, 200);
    }
    Object.assign(theme, {
      name: cleanText(body.name) || theme.name,
      orientationMode: ["both", "landscape", "portrait"].includes(body.orientationMode) ? body.orientationMode : theme.orientationMode || "both",
      cssTokens: { ...defaultThemeTokens, ...theme.cssTokens, ...cssTokens },
      published: body.published === true,
      archived: body.archived === true,
      updatedAt: new Date().toISOString(),
      lastPublishedAt: body.published === true ? new Date().toISOString() : theme.lastPublishedAt || null
    });
    addAudit("theme.update", { themeId: theme.id, published: theme.published, archived: theme.archived });
    await saveData();
    notifyAllRooms();
    return json(res, 200, theme);
  }
  return json(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, baseUrl);
    if (url.pathname.startsWith("/static/")) return serveFile(req, res, path.join(rootDir, "public"), "/static/");
    if (url.pathname.startsWith("/assets/uploads/themes/")) return serveFile(req, res, themeAssetsDir, "/assets/uploads/themes/");
    if (url.pathname.startsWith("/assets/")) return serveFile(req, res, path.join(rootDir, "assets"), "/assets/");
    if (url.pathname.startsWith("/samples/")) return serveFile(req, res, path.join(rootDir, "samples"), "/samples/");
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    if (url.pathname === "/" || url.pathname === "/admin") return send(res, 200, adminPage());
    const previewMatch = url.pathname.match(/^\/preview\/([^/]+)$/);
    if (previewMatch) {
      const page = kioskPage(
        previewMatch[1],
        true,
        cleanText(url.searchParams.get("theme"), 120),
        cleanText(url.searchParams.get("state"), 20)
      );
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
        await calendarQueue.enqueue(assignment.id, "scheduled-reconciliation");
      } catch (error) {
        console.error(`Calendar sync enqueue failed for ${assignment.id}:`, error.message);
      }
    }
    for (const account of db.calendarAccounts.filter(item => ["google", "microsoft365"].includes(item.provider) && item.active !== false)) {
      for (const calendar of account.calendars.filter(item =>
        item.webhookStatus === "active"
        && item.webhookExpiration
        && new Date(item.webhookExpiration).getTime() - Date.now() < 24 * 60 * 60 * 1000
      )) {
        try {
          const providerPath = account.provider === "google" ? "google" : "microsoft";
          const result = await registerCalendarWebhook(
            account,
            calendar,
            `${baseUrl.replace(/\/+$/, "")}/api/calendar-webhooks/${providerPath}`
          );
          calendar.webhookExpiration = result.expiration || calendar.webhookExpiration;
          calendar.webhookChannelId = result.channelId || calendar.webhookChannelId;
          if (result.channelToken) calendar.encryptedWebhookToken = encryptCredential(result.channelToken);
          calendar.webhookSubscriptionId = result.subscriptionId || calendar.webhookSubscriptionId;
          calendar.webhookClientState = result.clientState || calendar.webhookClientState;
          account.webhookStatus = "active";
          account.webhookError = "";
        } catch (error) {
          account.webhookStatus = "polling-fallback";
          account.webhookError = cleanText(error.message, 500);
        }
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
const broadcastLifecycleTimer = setInterval(() => {
  runBroadcastLifecycle().catch(error => console.error("Broadcast lifecycle update failed:", error.message));
}, 5000);
broadcastLifecycleTimer.unref();
