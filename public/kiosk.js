const root = document.querySelector("#kiosk");
const roomCode = root.dataset.roomCode;
const isPreview = root.dataset.preview === "true";
const alertSound = document.querySelector("#alertSound");
let alertTimer = null;
let alertAudioEnabled = isPreview;
let audioContext = null;
let latestRoom = null;
const alertAudioButton = createAlertAudioButton();

async function fetchRoom() {
  const response = await fetch(`/api/rooms/${roomCode}`, { cache: "no-store" });
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
      <div class="kiosk-events" aria-label="Upcoming events">${eventsHtml(room)}</div>
    </section>
    ${footerHtml(room)}`;
}

function renderFormal(room) {
  return `
    ${headerHtml(room)}
    <section class="formal-content">
      <div class="formal-current"><p>${stateLabel(room)}</p><h3>${escapeHtml(statusTitle(room))}</h3><span>${escapeHtml(statusSubline(room))}</span></div>
      <div class="kiosk-events formal-events" aria-label="Upcoming events"><p>Upcoming Events</p>${eventsHtml(room)}</div>
    </section>
    ${footerHtml(room)}`;
}

function renderCustom(room) {
  return `
    ${headerHtml(room, "custom-top")}
    <section class="custom-content">
      <div class="custom-status"><p class="state-label">${stateLabel(room)}</p><h3>${escapeHtml(statusTitle(room))}</h3><span>${escapeHtml(statusSubline(room))}</span></div>
      <div class="kiosk-events custom-events" aria-label="Upcoming events"><p>Upcoming Events</p>${eventsHtml(room)}</div>
    </section>
    ${footerHtml(room, "custom-footer")}`;
}

function stopAlert() {
  if (alertTimer) {
    clearInterval(alertTimer);
  }
  alertTimer = null;
  if (alertSound) {
    alertSound.pause();
    alertSound.currentTime = 0;
  }
}

function createAlertAudioButton() {
  if (isPreview || !alertSound) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "alert-audio-button";
  button.textContent = "Test Alert Sound";
  button.addEventListener("click", unlockAlertAudio);
  document.body.append(button);
  return button;
}

function showAlertAudioButton(needsAttention = false) {
  if (!alertAudioButton || alertAudioEnabled) return;
  alertAudioButton.hidden = false;
  alertAudioButton.classList.toggle("needs-attention", needsAttention);
  alertAudioButton.textContent = needsAttention ? "Tap to Play Alert Sound" : "Test Alert Sound";
}

function hideAlertAudioButton() {
  if (alertAudioButton) {
    alertAudioButton.hidden = true;
    alertAudioButton.classList.remove("needs-attention");
  }
}

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext = new AudioContextClass();
  return audioContext;
}

async function resumeAudioContext() {
  const context = getAudioContext();
  if (context?.state === "suspended") {
    await context.resume();
  }
  return context;
}

function playGeneratedAlert(durationMs = 1200) {
  const context = getAudioContext();
  if (!context || context.state !== "running") return false;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  oscillator.frequency.setValueAtTime(660, context.currentTime + 0.35);
  oscillator.frequency.setValueAtTime(880, context.currentTime + 0.7);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.28, context.currentTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationMs / 1000);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + durationMs / 1000);
  return true;
}

async function unlockAlertAudio() {
  if (!alertSound) return;
  try {
    await resumeAudioContext();
    alertSound.currentTime = 0;
    await alertSound.play();
    alertAudioEnabled = true;
    hideAlertAudioButton();
    if (latestRoom?.activeBroadcast) {
      startAlert(latestRoom);
      return;
    }
    setTimeout(() => {
      if (!latestRoom?.activeBroadcast) {
        alertSound.pause();
        alertSound.currentTime = 0;
      }
    }, 1800);
  } catch {
    const fallbackPlayed = playGeneratedAlert();
    alertAudioEnabled = fallbackPlayed;
    if (fallbackPlayed) {
      hideAlertAudioButton();
    } else {
      showAlertAudioButton(true);
    }
  }
}

function startAlert(room) {
  if (isPreview || !room.activeBroadcast || !alertSound) {
    stopAlert();
    return;
  }

  const play = () => {
    alertSound.currentTime = 0;
    alertSound.play()
      .then(() => {
        alertAudioEnabled = true;
        hideAlertAudioButton();
      })
      .catch(() => {
        const fallbackPlayed = playGeneratedAlert();
        alertAudioEnabled = fallbackPlayed;
        if (fallbackPlayed) {
          hideAlertAudioButton();
        } else {
          showAlertAudioButton(true);
        }
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
  root.className = `kiosk-frame ${themeClass(room.themeId)}`;
  root.dataset.roomState = room.activeBroadcast ? "broadcast" : room.status;
  root.innerHTML = room.themeId === "event-formal"
    ? renderFormal(room)
    : room.themeId === "custom-background"
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

render().catch(error => {
  root.innerHTML = `<section class="loading">${escapeHtml(error.message)}</section>`;
});
showAlertAudioButton();

const events = new EventSource(`/api/rooms/${roomCode}/events`);
events.addEventListener("refresh", () => render());
setInterval(() => render().catch(() => {}), 10000);
