const root = document.querySelector("#kiosk");
const roomCode = root.dataset.roomCode;
const themeOverride = root.dataset.themeOverride;
const stateOverride = root.dataset.stateOverride;
const isPreview = root.dataset.preview === "true";
const alertSound = document.querySelector("#alertSound");
const soundGate = document.querySelector("#soundGate");
const enableSoundButton = document.querySelector("#enableSoundButton");
const connectionStatus = document.querySelector("#connectionStatus");
const deviceStatus = document.querySelector("#deviceStatus");
const soundEnabledKey = `signageAlertSoundEnabled:${roomCode}`;
const roomCacheKey = `signageRoomCache:${roomCode}`;
const roomCacheTimeKey = `signageRoomCacheTime:${roomCode}`;
const clientDeviceIdKey = "signageKioskClientDeviceId";
const deviceTokenKey = "signageKioskDeviceToken";

let alertTimer = null;
let latestRoom = null;
let renderPromise = null;
let eventPage = 0;
let eventPageTimer = null;
let lastSuccessfulFetchAt = Number(localStorage.getItem(roomCacheTimeKey) || 0);
let lastFetchFailed = false;
let deviceRegistration = null;
let deviceRevoked = false;

function clientDeviceId() {
  let value = localStorage.getItem(clientDeviceIdKey);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(clientDeviceIdKey, value);
  }
  return value;
}

function deviceProfile() {
  const userAgent = navigator.userAgent || "";
  const deviceType = /iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
    ? "iPad"
    : /iPhone/i.test(userAgent)
      ? "iPhone"
      : /Android/i.test(userAgent) && !/Mobile/i.test(userAgent)
        ? "Android tablet"
        : /Android/i.test(userAgent)
          ? "Android phone"
          : /CrOS/i.test(userAgent)
            ? "ChromeOS kiosk"
            : /Windows/i.test(userAgent)
              ? "Windows signage"
              : /Raspberry|Linux arm/i.test(userAgent)
                ? "Raspberry Pi / Linux signage"
                : "Browser kiosk";
  return {
    clientDeviceId: clientDeviceId(),
    roomCode,
    name: `${deviceType} - ${roomCode}`,
    deviceType,
    browser: navigator.userAgent,
    platform: navigator.platform || "",
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    orientation: window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape",
    audioEnabled: soundEnabled()
  };
}

async function fetchRoom() {
  const query = new URLSearchParams();
  if (themeOverride) query.set("theme", themeOverride);
  if (stateOverride) query.set("state", stateOverride);
  const response = await fetch(`/api/rooms/${roomCode}?${query}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" }
  });
  if (!response.ok) throw new Error("Unable to load room");
  const room = await response.json();
  lastSuccessfulFetchAt = Date.now();
  lastFetchFailed = false;
  localStorage.setItem(roomCacheKey, JSON.stringify(room));
  localStorage.setItem(roomCacheTimeKey, String(lastSuccessfulFetchAt));
  return room;
}

function cachedRoom() {
  try {
    return JSON.parse(localStorage.getItem(roomCacheKey));
  } catch {
    return null;
  }
}

function themeClass(themeId) {
  return {
    "classic-institutional": "theme-classic",
    "event-formal": "theme-formal",
    "custom-background": "theme-custom"
  }[themeId] || "theme-classic";
}

function applyThemeTokens(tokens = {}) {
  const properties = {
    availableBg: "--available-bg",
    availableText: "--available-text",
    busyBg: "--busy-bg",
    busyText: "--busy-text",
    warningBg: "--warning-bg",
    warningText: "--warning-text",
    footerText: "--footer-text",
    ink: "--ink",
    panel: "--panel",
    upcomingTileBg: "--upcoming-tile-bg",
    upcomingTitleText: "--upcoming-title-text",
    upcomingDetailText: "--upcoming-detail-text",
    headerFont: "--theme-header-font",
    footerFont: "--theme-footer-font",
    eventDetailFont: "--theme-event-detail-font",
    upcomingFont: "--theme-upcoming-font",
    qrBackground: "--qr-background",
    qrSize: "--qr-size",
    qrBorder: "--qr-border"
  };
  for (const [key, property] of Object.entries(properties)) {
    if (tokens[key]) {
      root.style.setProperty(
        property,
        key === "qrSize" || key === "qrBorder" ? `${tokens[key]}px` : tokens[key]
      );
    }
  }
  root.style.setProperty(
    "--qr-background",
    String(tokens.qrTransparent) === "true" ? "transparent" : tokens.qrBackground || "#ffffff"
  );
  root.style.setProperty(
    "--theme-background-image",
    tokens.backgroundImage ? `url("${String(tokens.backgroundImage).replaceAll('"', '\\"')}")` : "none"
  );
}

function statusTitle(room) {
  if (room.activeBroadcast) return room.activeBroadcast.title;
  if (room.status === "available") return "Available Until";
  return room.currentEventTitle || "Current Event";
}

function statusSubline(room) {
  if (room.activeBroadcast) return room.activeBroadcast.message;
  if (room.status === "available") return room.currentEventUntil || "No upcoming event";
  return room.currentEventTime || `Until ${room.currentEventUntil || ""}`;
}

function stateLabel(room) {
  if (room.activeBroadcast) return "Emergency / Safety Broadcast";
  return {
    available: "Available",
    busy: "Busy",
    warning: "Buffer / Warning"
  }[room.status] || room.status;
}

function eventPages(room) {
  const size = Math.max(1, Number(room.upcomingEventPageSize || 5));
  const pages = [];
  for (let index = 0; index < room.upcomingEvents.length; index += size) {
    pages.push(room.upcomingEvents.slice(index, index + size));
  }
  return pages.length ? pages : [[]];
}

function eventsHtml(room) {
  const pages = eventPages(room);
  if (eventPage >= pages.length) eventPage = 0;
  const events = pages[eventPage];
  const cards = events.length
    ? events.map(event => `
      <div class="event-card" role="listitem">
        <strong>${escapeHtml(event.title)}</strong>
        <span>${escapeHtml(event.detail)}</span>
        ${event.description ? `<small>${escapeHtml(event.description)}</small>` : ""}
      </div>
    `).join("")
    : `<p class="no-events">No more events</p>`;
  const indicator = pages.length > 1
    ? `<span class="event-page-indicator" aria-label="Upcoming events page ${eventPage + 1} of ${pages.length}">${eventPage + 1} / ${pages.length}</span>`
    : "";
  return `${cards}${indicator}`;
}

function classicEventsHtml(room) {
  if (room.activeBroadcast) return "";
  return `<div class="kiosk-events" aria-label="Upcoming events" role="list">${eventsHtml(room)}</div>`;
}

function formalEventsHtml(room) {
  if (room.activeBroadcast) return "";
  return `<div class="kiosk-events formal-events" aria-label="Upcoming events" role="list"><p>Upcoming Events</p>${eventsHtml(room)}</div>`;
}

function customEventsHtml(room) {
  if (room.activeBroadcast) return "";
  return `<div class="kiosk-events custom-events" aria-label="Upcoming events" role="list"><p>Upcoming Events</p>${eventsHtml(room)}</div>`;
}

function footerHtml(room, footerClass = "kiosk-footer") {
  const qrUrl = `/api/rooms/${encodeURIComponent(room.code)}/qr.svg?v=${encodeURIComponent(room.bookingUrl || "")}`;
  return `
    <footer class="${footerClass}">
      <strong>${escapeHtml(room.name)}</strong>
      <div class="footer-booking">
        ${room.bookingUrl ? `<img class="qr-code qr-small" src="${qrUrl}" alt="QR code to book ${escapeHtml(room.name)}" />` : ""}
        <p>${escapeHtml(room.bookingUrl || "")}</p>
      </div>
    </footer>`;
}

function headerHtml(room, headerClass = "kiosk-top") {
  return `
    <header class="${headerClass}">
      <img class="kiosk-logo" src="${escapeHtml(room.logoUrl || "/assets/branding/aksharderi-small2.png")}" alt="${escapeHtml(room.centerName)} logo" />
      <div><p class="center-name">${escapeHtml(room.centerName)}</p><p class="building-name">${escapeHtml(room.buildingName)}</p></div>
      <time data-kiosk-clock aria-label="Current local date and time"></time>
    </header>`;
}

function currentDescriptionHtml(room) {
  return room.currentEventDescription && !room.activeBroadcast
    ? `<p class="current-event-description">${escapeHtml(room.currentEventDescription)}</p>`
    : "";
}

function renderClassic(room) {
  return `
    ${headerHtml(room)}
    <section class="classic-main">
      <div class="classic-left"><div class="kiosk-status"><p class="state-label">${stateLabel(room)}</p><h3>${escapeHtml(statusTitle(room))}</h3><p class="kiosk-status-time">${escapeHtml(statusSubline(room))}</p>${currentDescriptionHtml(room)}</div></div>
      ${classicEventsHtml(room)}
    </section>
    ${footerHtml(room)}`;
}

function renderFormal(room) {
  return `
    ${headerHtml(room)}
    <section class="formal-content">
      <div class="formal-current"><p>${stateLabel(room)}</p><h3>${escapeHtml(statusTitle(room))}</h3><span>${escapeHtml(statusSubline(room))}</span>${currentDescriptionHtml(room)}</div>
      ${formalEventsHtml(room)}
    </section>
    ${footerHtml(room)}`;
}

function renderCustom(room) {
  return `
    ${headerHtml(room, "custom-top")}
    <section class="custom-content">
      <div class="custom-status"><p class="state-label">${stateLabel(room)}</p><h3>${escapeHtml(statusTitle(room))}</h3><span>${escapeHtml(statusSubline(room))}</span>${currentDescriptionHtml(room)}</div>
      ${customEventsHtml(room)}
    </section>
    ${footerHtml(room, "custom-footer")}`;
}

function soundEnabled() {
  return isPreview || sessionStorage.getItem(soundEnabledKey) === "true";
}

function showSoundGate(mode = "setup") {
  if (isPreview || !soundGate || !enableSoundButton) return;
  soundGate.hidden = false;
  soundGate.dataset.mode = mode;
  enableSoundButton.textContent = mode === "blocked" ? "Tap to Play Alert Sound" : "Enable Sound";
}

function hideSoundGate() {
  if (soundGate) soundGate.hidden = true;
}

function stopAlert() {
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = null;
  if (alertSound) {
    alertSound.pause();
    alertSound.currentTime = 0;
  }
}

async function enableAlertSound() {
  if (!alertSound) return;
  try {
    alertSound.volume = 0.08;
    alertSound.currentTime = 0;
    await alertSound.play();
    sessionStorage.setItem(soundEnabledKey, "true");
    hideSoundGate();
    heartbeat();
    if (latestRoom?.activeBroadcast) {
      alertSound.volume = 1;
      startAlert(latestRoom);
      return;
    }
    window.setTimeout(() => {
      if (!latestRoom?.activeBroadcast) {
        alertSound.pause();
        alertSound.currentTime = 0;
        alertSound.volume = 1;
      }
    }, 900);
  } catch {
    sessionStorage.removeItem(soundEnabledKey);
    showSoundGate("blocked");
  }
}

function startAlert(room) {
  if (isPreview || !room.activeBroadcast || room.activeBroadcast.audibleAlert === false || !alertSound) {
    stopAlert();
    return;
  }
  if (!soundEnabled()) {
    stopAlert();
    showSoundGate("blocked");
    return;
  }
  const play = () => {
    alertSound.volume = 1;
    alertSound.currentTime = 0;
    alertSound.play().catch(() => {
      sessionStorage.removeItem(soundEnabledKey);
      showSoundGate("blocked");
    });
  };
  if (!alertTimer) {
    play();
    alertTimer = setInterval(play, 15000);
  }
}

function updateClock() {
  if (!latestRoom) return;
  const now = new Date();
  const timezone = latestRoom.timezone || "UTC";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(now);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(now);
  document.querySelectorAll("[data-kiosk-clock]").forEach(element => {
    element.textContent = `${date} ${time}`;
    element.dateTime = now.toISOString();
  });
}

function updateConnectionStatus() {
  if (!connectionStatus) return;
  const age = Date.now() - lastSuccessfulFetchAt;
  const offline = lastFetchFailed || !navigator.onLine;
  const stale = lastSuccessfulFetchAt > 0 && age >= 5 * 60 * 1000;
  connectionStatus.hidden = !offline && !stale;
  connectionStatus.textContent = offline ? "Offline - displaying cached schedule" : stale ? "Data may be outdated" : "";
  connectionStatus.dataset.state = offline ? "offline" : stale ? "stale" : "online";
}

function scheduleEventPagination(room) {
  if (eventPageTimer) clearInterval(eventPageTimer);
  const pages = eventPages(room);
  if (pages.length <= 1 || room.activeBroadcast) return;
  eventPageTimer = setInterval(() => {
    eventPage = (eventPage + 1) % pages.length;
    renderRoom(room);
  }, Number(room.upcomingEventPageSeconds || 10) * 1000);
}

function orientationMode(room) {
  const actual = window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape";
  const supported = room.themeOrientationMode || "both";
  root.dataset.orientation = actual;
  root.dataset.orientationFallback = supported !== "both" && supported !== actual ? "true" : "false";
}

function renderRoom(room) {
  latestRoom = room;
  root.className = `kiosk-frame ${themeClass(room.themeBaseId || room.themeId)}`;
  applyThemeTokens(room.themeCssTokens);
  orientationMode(room);
  root.dataset.roomState = room.activeBroadcast ? "broadcast" : room.status;
  root.innerHTML = (room.themeBaseId || room.themeId) === "event-formal"
    ? renderFormal(room)
    : (room.themeBaseId || room.themeId) === "custom-background"
      ? renderCustom(room)
      : renderClassic(room);
  updateClock();
  startAlert(room);
  scheduleEventPagination(room);
  updateConnectionStatus();
}

async function render() {
  try {
    const room = await fetchRoom();
    if (room.buildVersion && root.dataset.buildVersion && room.buildVersion !== root.dataset.buildVersion) {
      await fullReload();
      return;
    }
    renderRoom(room);
  } catch (error) {
    lastFetchFailed = true;
    const room = latestRoom || cachedRoom();
    if (room) renderRoom(room);
    else root.innerHTML = `<section class="loading">${escapeHtml(error.message)}</section>`;
    updateConnectionStatus();
  }
}

function refresh() {
  if (renderPromise) return renderPromise;
  renderPromise = render().finally(() => {
    renderPromise = null;
  });
  return renderPromise;
}

async function fullReload() {
  const registration = await navigator.serviceWorker?.getRegistration();
  registration?.active?.postMessage({ type: "CLEAR_RUNTIME" });
  await registration?.update();
  window.location.reload();
}

function executeCommand(command) {
  if (command === "reload") fullReload();
  else if (command === "data-refresh") refresh();
  else if (command === "revoked") {
    deviceRevoked = true;
    updateDeviceStatus({ status: "revoked" });
  } else if (command?.startsWith("navigate:")) {
    const destination = command.slice("navigate:".length);
    if (destination && destination !== roomCode) window.location.assign(`/${encodeURIComponent(destination)}`);
  }
}

function updateDeviceStatus(registration) {
  if (!deviceStatus || isPreview) return;
  deviceStatus.hidden = false;
  deviceStatus.dataset.state = registration.status;
  deviceStatus.textContent = registration.status === "active"
    ? `Kiosk connected${registration.name ? `: ${registration.name}` : ""}`
    : registration.status === "revoked"
      ? "Kiosk registration revoked - contact an administrator"
      : registration.status === "registration-error"
        ? registration.message
        : `Pairing code: ${registration.pairingCode}`;
}

async function registerDevice() {
  if (isPreview || deviceRevoked) return;
  try {
    const response = await fetch("/api/kiosk-devices/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deviceProfile())
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      if (response.status === 403) {
        deviceRevoked = true;
        updateDeviceStatus({ status: "revoked" });
      } else if (response.status === 409) {
        updateDeviceStatus({
          status: "registration-error",
          message: result.error || "This kiosk is already registered. Contact an administrator."
        });
      }
      return;
    }
    deviceRegistration = await response.json();
    localStorage.setItem(deviceTokenKey, deviceRegistration.deviceToken);
    updateDeviceStatus(deviceRegistration);
  } catch {
    // Device registration is optional; the kiosk continues without it.
  }
}

async function heartbeat() {
  if (isPreview || deviceRevoked) return;
  const token = localStorage.getItem(deviceTokenKey);
  if (!token) return registerDevice();
  try {
    const response = await fetch("/api/kiosk-devices/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...deviceProfile(),
        deviceToken: token,
        lastDataAt: lastSuccessfulFetchAt ? new Date(lastSuccessfulFetchAt).toISOString() : null
      })
    });
    if (response.status === 401) {
      localStorage.removeItem(deviceTokenKey);
      return registerDevice();
    }
    if (response.status === 403) {
      deviceRevoked = true;
      updateDeviceStatus({ status: "revoked" });
      return;
    }
    if (!response.ok) return;
    const result = await response.json();
    deviceRegistration = { ...deviceRegistration, status: result.status, healthStatus: result.healthStatus };
    updateDeviceStatus(deviceRegistration);
    if (result.roomCode && result.roomCode !== roomCode) executeCommand(`navigate:${result.roomCode}`);
    if (result.pendingCommand) executeCommand(result.pendingCommand);
  } catch {
    // Heartbeats resume automatically when connectivity returns.
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (enableSoundButton) enableSoundButton.addEventListener("click", enableAlertSound);
if (isPreview || soundEnabled()) hideSoundGate();
else showSoundGate("setup");

if ("serviceWorker" in navigator && !isPreview) {
  navigator.serviceWorker.register(`/static/kiosk-sw.js?v=${encodeURIComponent(root.dataset.buildVersion || "")}`).catch(() => {});
}

refresh();
heartbeat();
setInterval(updateClock, 1000);
setInterval(updateConnectionStatus, 30000);
setInterval(refresh, 10000);
setInterval(heartbeat, 60000);

const events = new EventSource(`/api/rooms/${roomCode}/events?deviceId=${encodeURIComponent(clientDeviceId())}&build=${encodeURIComponent(root.dataset.buildVersion || "")}`);
events.addEventListener("refresh", event => {
  try {
    executeCommand(JSON.parse(event.data).command || "data-refresh");
  } catch {
    refresh();
  }
});
events.onerror = updateConnectionStatus;

window.addEventListener("focus", refresh);
window.addEventListener("online", () => {
  refresh();
  heartbeat();
});
window.addEventListener("offline", updateConnectionStatus);
window.addEventListener("pageshow", refresh);
window.addEventListener("resize", () => {
  if (latestRoom) renderRoom(latestRoom);
  heartbeat();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refresh();
    heartbeat();
  }
});
