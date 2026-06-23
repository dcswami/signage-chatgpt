let state = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function statusLabel(status) {
  return {
    available: "Available",
    busy: "Busy",
    warning: "Buffer/Warning"
  }[status] || status;
}

function renderRooms() {
  const target = document.querySelector("#roomCards");
  target.innerHTML = state.rooms.map(room => `
    <article class="room-card ${room.status}">
      <h3>${room.name}</h3>
      <p>${room.centerName} / ${room.buildingName}</p>
      <p><strong>${statusLabel(room.status)}</strong> ${room.currentEventTitle ? `- ${room.currentEventTitle}` : ""}</p>
      <p>Theme: ${room.themeName}</p>
      <div class="button-row">
        <button data-status="available" data-room="${room.code}">Available</button>
        <button data-status="busy" data-room="${room.code}">Busy</button>
        <button data-status="warning" data-room="${room.code}">Warning</button>
        <button data-preview="${room.code}">Preview</button>
        <a href="/${room.code}" target="_blank">Kiosk</a>
      </div>
    </article>
  `).join("");
  target.querySelectorAll("button[data-status]").forEach(button => {
    button.addEventListener("click", async () => {
      const status = button.dataset.status;
      await api(`/api/rooms/${button.dataset.room}/status`, {
        method: "POST",
        body: JSON.stringify({
          status,
          currentEventTitle: status === "available" ? "" : "Gujarati Class - I",
          currentEventUntil: status === "warning" ? "10 min" : status === "busy" ? "2:00 PM" : "4:00 PM"
        })
      });
      await load();
    });
  });
  target.querySelectorAll("button[data-preview]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelector("#previewFrame").src = `/preview/${button.dataset.preview}`;
    });
  });
}

function renderBroadcastTargets() {
  const select = document.querySelector("#targetRooms");
  select.innerHTML = state.rooms.map(room => `<option value="${room.code}" selected>${room.name}</option>`).join("");
}

function renderThemes() {
  document.querySelector("#themeList").innerHTML = `<div class="list">${state.themes.map(theme => `
    <div class="list-item">
      <strong>${theme.name}</strong>
      <span>${theme.builtIn ? "Built-in system theme" : "Custom theme"} / ${theme.cloneable ? "Cloneable by System Admin" : "Locked"}</span>
    </div>
  `).join("")}</div>`;
}

function renderUsersRoles() {
  document.querySelector("#userRoleList").innerHTML = `<div class="list">
    ${state.users.map(user => `<div class="list-item"><strong>${user.name}</strong><span>${user.email}</span><span>Features: ${user.features.join(", ")}</span></div>`).join("")}
    ${state.roles.map(role => `<div class="list-item"><strong>${role.name}</strong><span>${role.cloneable ? "Cloneable role" : "System locked"}</span></div>`).join("")}
  </div>`;
}

function renderCalendars() {
  document.querySelector("#calendarList").innerHTML = `<div class="list">${state.calendarAccounts.map(account => `
    <div class="list-item">
      <strong>${account.accountName}</strong>
      <span>${account.provider} / ${account.accessLevel}</span>
      <span>${account.calendars.join(", ")}</span>
    </div>
  `).join("")}</div>`;
}

async function publishBroadcast(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const targetRoomCodes = Array.from(document.querySelector("#targetRooms").selectedOptions).map(option => option.value);
  const confirmed = confirm("Publish this Emergency/Safety Broadcast to selected rooms?");
  if (!confirmed) return;
  await api("/api/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      title: form.get("title"),
      message: form.get("message"),
      targetRoomCodes,
      confirm: true
    })
  });
  await load();
}

async function endBroadcast() {
  await api("/api/broadcasts/end", { method: "POST", body: "{}" });
  await load();
}

async function load() {
  state = await api("/api/state");
  renderRooms();
  renderBroadcastTargets();
  renderThemes();
  renderUsersRoles();
  renderCalendars();
}

document.querySelector("#broadcastForm").addEventListener("submit", publishBroadcast);
document.querySelector("#endBroadcast").addEventListener("click", endBroadcast);
load().catch(error => {
  document.body.insertAdjacentHTML("afterbegin", `<pre>${error.message}</pre>`);
});
