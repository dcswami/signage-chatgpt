let state = null;

const entityDialog = document.querySelector("#entityDialog");
const entityForm = document.querySelector("#entityForm");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = await response.json().catch(() => ({ error: response.statusText }));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(status) {
  return {
    available: "Available",
    busy: "Busy",
    warning: "Buffer/Warning"
  }[status] || status;
}

function optionList(items, selectedId, label = item => item.name) {
  return items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(label(item))}</option>`).join("");
}

function centerName(id) {
  return state.centers.find(item => item.id === id)?.name || "Unknown center";
}

function campusName(id) {
  return state.campuses.find(item => item.id === id)?.name || "Unknown campus";
}

function buildingName(id) {
  return state.buildings.find(item => item.id === id)?.name || "Unknown building";
}

function renderSummary() {
  const counts = {
    total: state.rooms.length,
    available: state.rooms.filter(room => room.status === "available").length,
    busy: state.rooms.filter(room => room.status === "busy").length,
    warning: state.rooms.filter(room => room.status === "warning").length
  };
  document.querySelector("#summaryCards").innerHTML = `
    <article><span>Managed Rooms</span><strong>${counts.total}</strong></article>
    <article class="available"><span>Available</span><strong>${counts.available}</strong></article>
    <article class="busy"><span>Busy</span><strong>${counts.busy}</strong></article>
    <article class="warning"><span>Buffer/Warning</span><strong>${counts.warning}</strong></article>
  `;
}

function dashboardRooms() {
  const search = document.querySelector("#roomSearch").value.trim().toLowerCase();
  const centerId = document.querySelector("#dashboardCenterFilter").value;
  const status = document.querySelector("#dashboardStatusFilter").value;
  return state.rooms.filter(room => {
    const haystack = `${room.name} ${room.code} ${room.centerName} ${room.campusName} ${room.buildingName}`.toLowerCase();
    return (!search || haystack.includes(search)) &&
      (!centerId || room.centerId === centerId) &&
      (!status || room.status === status);
  });
}

function renderDashboardRows() {
  const rooms = dashboardRooms();
  const target = document.querySelector("#roomRows");
  if (!rooms.length) {
    target.innerHTML = `<tr><td colspan="5" class="empty-state">No rooms match these filters.</td></tr>`;
    return;
  }
  target.innerHTML = rooms.map(room => `
    <tr>
      <td><strong>${escapeHtml(room.name)}</strong><span class="subtle">/${escapeHtml(room.code)}</span></td>
      <td>${escapeHtml(room.buildingName)}<span class="subtle">${escapeHtml(room.campusName)} / ${escapeHtml(room.centerName)}</span></td>
      <td><span class="status-pill ${escapeHtml(room.status)}">${escapeHtml(statusLabel(room.status))}</span>${room.currentEventTitle ? `<span class="subtle">${escapeHtml(room.currentEventTitle)}</span>` : ""}</td>
      <td>${escapeHtml(room.themeName)}</td>
      <td>
        <div class="row-actions">
          <select aria-label="Set ${escapeHtml(room.name)} status" data-status-room="${escapeHtml(room.code)}">
            <option value="available" ${room.status === "available" ? "selected" : ""}>Available</option>
            <option value="busy" ${room.status === "busy" ? "selected" : ""}>Busy</option>
            <option value="warning" ${room.status === "warning" ? "selected" : ""}>Warning</option>
          </select>
          <button type="button" class="secondary" data-preview="${escapeHtml(room.code)}">Preview</button>
          <a href="/${escapeHtml(room.code)}" target="_blank">Kiosk</a>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderDashboardFilters() {
  const select = document.querySelector("#dashboardCenterFilter");
  const selected = select.value;
  select.innerHTML = `<option value="">All centers</option>${optionList(state.centers, selected)}`;
  select.value = selected;
}

function renderBroadcastTargets() {
  const select = document.querySelector("#targetRooms");
  const selected = new Set(Array.from(select.selectedOptions).map(option => option.value));
  select.innerHTML = state.rooms.map(room => `
    <option value="${escapeHtml(room.code)}" ${selected.size === 0 || selected.has(room.code) ? "selected" : ""}>
      ${escapeHtml(room.name)} - ${escapeHtml(room.buildingName)}
    </option>
  `).join("");
}

function entityItem(entity, meta, type) {
  return `
    <article class="entity-item">
      <div><strong>${escapeHtml(entity.name)}</strong><span>${escapeHtml(meta)}</span></div>
      <div class="entity-actions">
        <button type="button" class="secondary" data-edit="${type}" data-id="${escapeHtml(entity.id)}">Edit</button>
        <button type="button" class="danger-text" data-delete="${type}" data-id="${escapeHtml(entity.id)}">Delete</button>
      </div>
    </article>
  `;
}

function renderEntityLists() {
  document.querySelector("#centerList").innerHTML = state.centers.map(center =>
    entityItem(center, `${center.timezone} / ${state.themes.find(theme => theme.id === center.defaultThemeId)?.name || "No default theme"}`, "center")
  ).join("") || `<p class="empty-state">No centers configured.</p>`;

  document.querySelector("#campusList").innerHTML = state.campuses.map(campus =>
    entityItem(campus, centerName(campus.centerId), "campus")
  ).join("") || `<p class="empty-state">No campuses configured.</p>`;

  document.querySelector("#buildingList").innerHTML = state.buildings.map(building =>
    entityItem(building, `${campusName(building.campusId)}${building.code ? ` / ${building.code}` : ""}`, "building")
  ).join("") || `<p class="empty-state">No buildings configured.</p>`;

  document.querySelector("#roomList").innerHTML = state.rooms.map(room =>
    entityItem(room, `${room.code} / ${room.buildingName} / ${room.themeName}`, "room")
  ).join("") || `<p class="empty-state">No rooms configured.</p>`;
}

function renderThemes() {
  document.querySelector("#themeList").innerHTML = `<div class="list">${state.themes.map(theme => `
    <div class="list-item">
      <strong>${escapeHtml(theme.name)}</strong>
      <span>${theme.builtIn ? "Built-in system theme" : "Custom theme"} / ${theme.cloneable ? "Cloneable" : "Locked"}</span>
      ${theme.cloneable ? `<button type="button" class="secondary compact" data-clone-theme="${escapeHtml(theme.id)}">Clone</button>` : ""}
    </div>
  `).join("")}</div>`;
}

function renderUsersRoles() {
  document.querySelector("#userRoleList").innerHTML = `<div class="list">
    ${state.users.map(user => `<div class="list-item"><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(user.email)}</span><span>Features: ${user.features.map(escapeHtml).join(", ")}</span></div>`).join("")}
    ${state.roles.map(role => `<div class="list-item"><strong>${escapeHtml(role.name)}</strong><span>${role.cloneable ? "Cloneable role" : "System locked"}</span></div>`).join("")}
  </div>`;
}

function renderCalendars() {
  document.querySelector("#calendarList").innerHTML = `<div class="list">${state.calendarAccounts.map(account => `
    <div class="list-item">
      <strong>${escapeHtml(account.accountName)}</strong>
      <span>${escapeHtml(account.provider)} / ${escapeHtml(account.accessLevel)}</span>
      <span>${account.calendars.map(escapeHtml).join(", ")}</span>
    </div>
  `).join("")}</div>`;
}

function renderAudit() {
  document.querySelector("#auditList").innerHTML = `<div class="list">${state.auditLogs.map(log => `
    <div class="list-item"><strong>${escapeHtml(log.action)}</strong><span>${new Date(log.createdAt).toLocaleString()}</span></div>
  `).join("") || `<p class="empty-state">No audit activity yet.</p>`}</div>`;
}

function fieldsFor(type, entity = {}) {
  const active = entity.active !== false;
  if (type === "center") {
    return `
      <label>Center Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Time Zone <input name="timezone" required value="${escapeHtml(entity.timezone || "America/Chicago")}" placeholder="America/Chicago" /></label>
      <label>Default Theme <select name="defaultThemeId" required>${optionList(state.themes, entity.defaultThemeId || state.themes[0]?.id)}</select></label>
      <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
    `;
  }
  if (type === "campus") {
    return `
      <label>Center <select name="centerId" required>${optionList(state.centers, entity.centerId || state.centers[0]?.id)}</select></label>
      <label>Campus Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Address <textarea name="address">${escapeHtml(entity.address)}</textarea></label>
      <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
    `;
  }
  if (type === "building") {
    return `
      <label>Campus <select name="campusId" required>${optionList(state.campuses, entity.campusId || state.campuses[0]?.id, item => `${item.name} - ${centerName(item.centerId)}`)}</select></label>
      <label>Building Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Building Code <input name="code" maxlength="40" value="${escapeHtml(entity.code)}" /></label>
      <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
    `;
  }

  const centerId = entity.centerId || state.centers[0]?.id || "";
  const campuses = state.campuses.filter(campus => campus.centerId === centerId);
  const campusId = campuses.some(campus => campus.id === entity.campusId) ? entity.campusId : campuses[0]?.id || "";
  const buildings = state.buildings.filter(building => building.campusId === campusId);
  return `
    <div class="form-grid">
      <label>Center <select name="centerId" required>${optionList(state.centers, centerId)}</select></label>
      <label>Campus <select name="campusId" required>${optionList(campuses, campusId)}</select></label>
      <label>Building <select name="buildingId" required>${optionList(buildings, entity.buildingId || buildings[0]?.id)}</select></label>
      <label>Theme <select name="themeId" required>${optionList(state.themes, entity.themeId || state.centers.find(center => center.id === centerId)?.defaultThemeId || state.themes[0]?.id)}</select></label>
      <label>Room Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Room Code <input name="code" required maxlength="80" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${escapeHtml(entity.code)}" placeholder="room-108-shishu" /></label>
      <label>Room Type <input name="roomType" maxlength="80" value="${escapeHtml(entity.roomType || "Classroom")}" /></label>
      <label>Capacity <input name="capacity" type="number" min="1" value="${escapeHtml(entity.capacity || "")}" /></label>
    </div>
    <label>Booking URL <input name="bookingUrl" type="url" required value="${escapeHtml(entity.bookingUrl || "https://")}" /></label>
    <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
  `;
}

function findEntity(type, id) {
  const collection = { center: state.centers, campus: state.campuses, building: state.buildings, room: state.rooms }[type];
  return collection?.find(item => item.id === id);
}

function openEntityDialog(type, id = "") {
  const entity = id ? findEntity(type, id) : {};
  document.querySelector("#entityDialogTitle").textContent = `${id ? "Edit" : "New"} ${type[0].toUpperCase()}${type.slice(1)}`;
  entityForm.elements.entityType.value = type;
  entityForm.elements.entityId.value = id;
  document.querySelector("#entityFields").innerHTML = fieldsFor(type, entity);
  document.querySelector("#formError").textContent = "";
  entityDialog.showModal();
}

function updateRoomHierarchy(changedField) {
  if (entityForm.elements.entityType.value !== "room") return;
  const centerSelect = entityForm.elements.centerId;
  const campusSelect = entityForm.elements.campusId;
  const buildingSelect = entityForm.elements.buildingId;
  if (changedField === "centerId") {
    const campuses = state.campuses.filter(campus => campus.centerId === centerSelect.value);
    campusSelect.innerHTML = optionList(campuses, campuses[0]?.id);
  }
  const buildings = state.buildings.filter(building => building.campusId === campusSelect.value);
  buildingSelect.innerHTML = optionList(buildings, buildings[0]?.id);
}

async function saveEntity(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(entityForm));
  const type = data.entityType;
  const id = data.entityId;
  delete data.entityType;
  delete data.entityId;
  data.active = entityForm.elements.active.checked;
  try {
    const plural = type === "campus" ? "campuses" : `${type}s`;
    await api(`/api/${plural}${id ? `/${id}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(data)
    });
    entityDialog.close();
    await load();
  } catch (error) {
    document.querySelector("#formError").textContent = error.message;
  }
}

async function deleteEntity(type, id) {
  const entity = findEntity(type, id);
  if (!entity || !confirm(`Delete ${entity.name}? This action is recorded in the audit log.`)) return;
  const plural = type === "campus" ? "campuses" : `${type}s`;
  try {
    await api(`/api/${plural}/${id}`, { method: "DELETE" });
    await load();
  } catch (error) {
    alert(error.message);
  }
}

async function setRoomStatus(roomCode, status) {
  await api(`/api/rooms/${roomCode}/status`, {
    method: "POST",
    body: JSON.stringify({
      status,
      currentEventTitle: status === "available" ? "" : "Current Event",
      currentEventUntil: status === "warning" ? "10 min" : status === "busy" ? "2:00 PM" : ""
    })
  });
  await load();
}

function showPreview(roomCode) {
  const room = state.rooms.find(item => item.code === roomCode);
  document.querySelector("#previewFrame").src = `/preview/${roomCode}`;
  document.querySelector("#previewTitle").textContent = room ? `${room.name} / ${room.buildingName}` : roomCode;
  document.querySelector("#openPreview").href = `/preview/${roomCode}`;
}

async function publishBroadcast(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const targetRoomCodes = Array.from(document.querySelector("#targetRooms").selectedOptions).map(option => option.value);
  if (!targetRoomCodes.length) return alert("Select at least one target room.");
  if (!confirm("Publish this Emergency/Safety Broadcast to the selected rooms?")) return;
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

async function cloneTheme(themeId) {
  const source = state.themes.find(theme => theme.id === themeId);
  const name = prompt("Name for the cloned theme:", `${source?.name || "Theme"} Copy`);
  if (!name) return;
  await api(`/api/themes/${themeId}/clone`, { method: "POST", body: JSON.stringify({ name }) });
  await load();
}

function render() {
  document.querySelector("#storageBadge").textContent = state.storageType === "postgresql" ? "PostgreSQL" : "Local JSON";
  renderSummary();
  renderDashboardFilters();
  renderDashboardRows();
  renderBroadcastTargets();
  renderEntityLists();
  renderThemes();
  renderUsersRoles();
  renderCalendars();
  renderAudit();
}

async function load() {
  state = await api("/api/state");
  render();
}

document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === button.dataset.tab));
  });
});

document.querySelector("#roomSearch").addEventListener("input", renderDashboardRows);
document.querySelector("#dashboardCenterFilter").addEventListener("change", renderDashboardRows);
document.querySelector("#dashboardStatusFilter").addEventListener("change", renderDashboardRows);
document.querySelector("#refreshDashboard").addEventListener("click", load);
document.querySelector("#broadcastForm").addEventListener("submit", publishBroadcast);
document.querySelector("#endBroadcast").addEventListener("click", endBroadcast);
document.querySelector("#closeDialog").addEventListener("click", () => entityDialog.close());
document.querySelector("#cancelDialog").addEventListener("click", () => entityDialog.close());
entityForm.addEventListener("submit", saveEntity);
entityForm.addEventListener("change", event => {
  if (event.target.name === "centerId" || event.target.name === "campusId") updateRoomHierarchy(event.target.name);
});

document.addEventListener("click", event => {
  const newButton = event.target.closest("[data-new]");
  if (newButton) return openEntityDialog(newButton.dataset.new);
  const editButton = event.target.closest("[data-edit]");
  if (editButton) return openEntityDialog(editButton.dataset.edit, editButton.dataset.id);
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) return deleteEntity(deleteButton.dataset.delete, deleteButton.dataset.id);
  const previewButton = event.target.closest("[data-preview]");
  if (previewButton) return showPreview(previewButton.dataset.preview);
  const cloneButton = event.target.closest("[data-clone-theme]");
  if (cloneButton) return cloneTheme(cloneButton.dataset.cloneTheme);
});

document.addEventListener("change", event => {
  if (event.target.matches("[data-status-room]")) {
    setRoomStatus(event.target.dataset.statusRoom, event.target.value).catch(error => alert(error.message));
  }
});

load().catch(error => {
  document.body.insertAdjacentHTML("afterbegin", `<pre>${escapeHtml(error.message)}</pre>`);
});
