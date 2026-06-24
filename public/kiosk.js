const root = document.querySelector("#kiosk");
const roomCode = root.dataset.roomCode;
const themeOverride = root.dataset.themeOverride;
const isPreview = root.dataset.preview === "true";
const alertSound = document.querySelector("#alertSound");
const soundGate = document.querySelector("#soundGate");
const enableSoundButton = document.querySelector("#enableSoundButton");
const soundEnabledKey = `signageAlertSoundEnabled:${roomCode}`;

let alertTimer = null;
let latestRoom = null;

async function fetchRoom() {
  const suffix = themeOverride ? `?theme=${encodeURIComponent(themeOverride)}` : "";
  const response = await fetch(`/api/rooms/${roomCode}${suffix}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load room");
  return response.json();
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
    headerFont: "--theme-header-font",
    footerFont: "--theme-footer-font",
    eventDetailFont: "--theme-event-detail-font",
    upcomingFont: "--theme-upcoming-font"
  };
  for (const [key, property] of Object.entries(properties)) {
    if (tokens[key]) root.style.setProperty(property, tokens[key]);
  }
}

function statusTitle(room) {
  if (room.activeBroadcast) return room.activeBroadcast.title;
  if (room.status === "available") return "Available Until";
  if (room.status === "warning") return room.currentEventTitle || "Current Event";
  return room.currentEventTitle || "Current Event";
}

function statusSubline(room) {
  if (room.activeBroadcast) return room.activeBroadcast.message;
  if (room.status === "available") return room.currentEventUntil || "4:00 PM";
  if (room.status === "warning") return `Ends in ${room.currentEventUntil || "10 min"}`;
  return `Until ${room.currentEventUntil || "2:00 PM"}`;
}

function stateLabel(room) {
  if (room.activeBroadcast) return "Emergency / Safety Broadcast";
  return {
    available: "Available",
    busy: "Busy",
    warning: "Buffer / Warning"
  }[room.status] || room.status;
}

function eventsHtml(room) {
  return room.upcomingEvents.map(event => `
    <div class="event-card">
      <strong>${escapeHtml(event.title)}</strong>
      <span>${escapeHtml(event.detail)}</span>
    </div>
  `).join("");
}

function classicEventsHtml(room) {
  if (room.activeBroadcast) return "";
  return `<div class="kiosk-events" aria-label="Upcoming events">${eventsHtml(room)}</div>`;
}

function formalEventsHtml(room) {
  if (room.activeBroadcast) return "";
  return `<div class="kiosk-events formal-events" aria-label="Upcoming events"><p>Upcoming Events</p>${eventsHtml(room)}</div>`;
}

function customEventsHtml(room) {
  if (room.activeBroadcast) return "";
  return `<div class="kiosk-events custom-events" aria-label="Upcoming events"><p>Upcoming Events</p>${eventsHtml(room)}</div>`;
}

function footerHtml(room, footerClass = "kiosk-footer") {
  return `
    <footer class="${footerClass}">
      <strong>${escapeHtml(room.name)}</strong>
      <div class="footer-booking">
        <div class="qr-code qr-small" aria-label="QR code placeholder"><span></span><span></span><span></span></div>
        <p>${escapeHtml(room.bookingUrl)}</p>
      </div>
    </footer>`;
}

function headerHtml(room, headerClass = "kiosk-top") {
  return `
    <header class="${headerClass}">
      <img class="kiosk-logo" src="/assets/branding/aksharderi-small2.png" alt="BAPS logo" />
      <div><p class="center-name">${escapeHtml(room.centerName)}</p><p class="building-name">${escapeHtml(room.buildingName)}</p></div>
      <time>${escapeHtml(room.currentTime || new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</time>
    </header>`;
}

function renderClassic(room) {
  return `
    ${headerHtml(room)}
    <section class="classic-main">
      <div class="classic-left"><div class="kiosk-status"><p class="state-label">${stateLabel(room)}</p><h3>${escapeHtml(statusTitle(room))}</h3><p class="kiosk-status-time">${escapeHtml(statusSubline(room))}</p></div></div>
      ${classicEventsHtml(room)}
    </section>
    ${footerHtml(room)}`;
}

function renderFormal(room) {
  return `
    ${headerHtml(room)}
    <section class="formal-content">
      <div class="formal-current"><p>${stateLabel(room)}</p><h3>${escapeHtml(statusTitle(room))}</h3><span>${escapeHtml(statusSubline(room))}</span></div>
      ${formalEventsHtml(room)}
    </section>
    ${footerHtml(room)}`;
}

function renderCustom(room) {
  return `
    ${headerHtml(room, "custom-top")}
    <section class="custom-content">
      <div class="custom-status"><p class="state-label">${stateLabel(room)}</p><h3>${escapeHtml(statusTitle(room))}</h3><span>${escapeHtml(statusSubline(room))}</span></div>
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
  if (isPreview || !room.activeBroadcast || !alertSound) {
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

async function render() {
  const room = await fetchRoom();
  latestRoom = room;
  root.className = `kiosk-frame ${themeClass(room.themeBaseId || room.themeId)}`;
  applyThemeTokens(room.themeCssTokens);
  root.dataset.roomState = room.activeBroadcast ? "broadcast" : room.status;
  root.innerHTML = (room.themeBaseId || room.themeId) === "event-formal"
    ? renderFormal(room)
    : (room.themeBaseId || room.themeId) === "custom-background"
      ? renderCustom(room)
      : renderClassic(room);
  startAlert(room);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (enableSoundButton) {
  enableSoundButton.addEventListener("click", enableAlertSound);
}

if (isPreview || soundEnabled()) {
  hideSoundGate();
} else {
  showSoundGate("setup");
}

render().catch(error => {
  root.innerHTML = `<section class="loading">${escapeHtml(error.message)}</section>`;
});

const events = new EventSource(`/api/rooms/${roomCode}/events`);
events.addEventListener("refresh", () => render());
setInterval(() => render().catch(() => {}), 10000);
