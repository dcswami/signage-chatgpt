let state = null;

const entityDialog = document.querySelector("#entityDialog");
const entityForm = document.querySelector("#entityForm");
const conflictDialog = document.querySelector("#conflictDialog");
const conflictActionForm = document.querySelector("#conflictActionForm");
const passwordDialog = document.querySelector("#passwordDialog");
const adminPasswordForm = document.querySelector("#adminPasswordForm");

async function api(path, options = {}) {
  const csrfToken = state?.viewer?.csrfToken || "";
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Your session has expired.");
  }
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

function roomName(id) {
  return state.rooms.find(item => item.id === id)?.name || "Unknown room";
}

function roleName(id) {
  return state.roles.find(item => item.id === id)?.name || "Unknown role";
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
  const allowedRoomIds = new Set(state.viewer.accessibleRoomIds || []);
  const rooms = state.rooms.filter(room => allowedRoomIds.has(room.id));
  const fullyAccessible = (id, key) => {
    const targets = state.rooms.filter(room => room[key] === id);
    return targets.length && targets.every(room => allowedRoomIds.has(room.id));
  };
  const renderMulti = (selector, items, label) => {
    const select = document.querySelector(selector);
    const selected = new Set(Array.from(select.selectedOptions).map(option => option.value));
    select.innerHTML = items.map(item => `<option value="${escapeHtml(item.id)}" ${selected.has(item.id) ? "selected" : ""}>${escapeHtml(label(item))}</option>`).join("");
  };
  renderMulti("#broadcastCenters", state.centers.filter(item => fullyAccessible(item.id, "centerId")), item => item.name);
  renderMulti("#broadcastCampuses", state.campuses.filter(item => fullyAccessible(item.id, "campusId")), item => `${item.name} - ${centerName(item.centerId)}`);
  renderMulti("#broadcastBuildings", state.buildings.filter(item => fullyAccessible(item.id, "buildingId")), item => `${item.name} - ${campusName(item.campusId)}`);
  renderMulti("#broadcastRoomGroups", state.roomGroups || [], item => `${item.name} (${item.roomIds.length})`);
  renderMulti("#targetRooms", rooms, item => `${item.name} - ${item.buildingName}`);
}

function renderKioskRefreshTargets() {
  const allowedRoomIds = new Set(state.viewer.accessibleRoomIds || []);
  const rooms = state.rooms.filter(room => allowedRoomIds.has(room.id));
  const fullyAccessible = (id, key) => {
    const targets = state.rooms.filter(room => room[key] === id);
    return targets.length && targets.every(room => allowedRoomIds.has(room.id));
  };
  const renderMulti = (selector, items, label) => {
    const select = document.querySelector(selector);
    const selected = new Set(Array.from(select.selectedOptions).map(option => option.value));
    select.innerHTML = items.map(item => `<option value="${escapeHtml(item.id)}" ${selected.has(item.id) ? "selected" : ""}>${escapeHtml(label(item))}</option>`).join("");
  };
  renderMulti("#kioskRefreshCenters", state.centers.filter(item => fullyAccessible(item.id, "centerId")), item => item.name);
  renderMulti("#kioskRefreshCampuses", state.campuses.filter(item => fullyAccessible(item.id, "campusId")), item => `${item.name} - ${centerName(item.centerId)}`);
  renderMulti("#kioskRefreshBuildings", state.buildings.filter(item => fullyAccessible(item.id, "buildingId")), item => `${item.name} - ${campusName(item.campusId)}`);
  renderMulti("#kioskRefreshRoomGroups", state.roomGroups || [], item => `${item.name} (${item.roomIds.length})`);
  renderMulti("#kioskRefreshRooms", rooms, item => `${item.name} - ${item.buildingName}`);
}

function renderKioskDevices() {
  const healthCounts = ["online", "stale", "offline", "revoked"].map(status => ({
    status,
    count: state.kioskDevices.filter(device => device.healthStatus === status).length
  }));
  document.querySelector("#kioskDeviceSummary").innerHTML = healthCounts.map(item => `
    <article><span>${escapeHtml(item.status)}</span><strong>${item.count}</strong></article>
  `).join("");
  const roomFilter = document.querySelector("#kioskDeviceRoomFilter");
  const selectedRoom = roomFilter.value;
  const deviceRoomIds = new Set(state.kioskDevices.map(device => device.roomId));
  roomFilter.innerHTML = `<option value="">All rooms</option>${state.rooms
    .filter(room => deviceRoomIds.has(room.id))
    .map(room => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.name)} - ${escapeHtml(room.buildingName)}</option>`)
    .join("")}`;
  roomFilter.value = selectedRoom;
  const search = document.querySelector("#kioskDeviceSearch").value.trim().toLowerCase();
  const registrationStatus = document.querySelector("#kioskDeviceStatusFilter").value;
  const healthStatus = document.querySelector("#kioskDeviceHealthFilter").value;
  const devices = state.kioskDevices.filter(device => {
    const haystack = `${device.name} ${device.roomName} ${device.deviceType} ${device.browser} ${device.platform} ${device.lastIpAddress}`.toLowerCase();
    return (!search || haystack.includes(search))
      && (!roomFilter.value || device.roomId === roomFilter.value)
      && (!registrationStatus || device.status === registrationStatus)
      && (!healthStatus || device.healthStatus === healthStatus);
  });
  document.querySelector("#kioskDeviceList").innerHTML = devices.map(device => {
    return `<article class="entity-item kiosk-device-item">
      <div>
        <strong>${escapeHtml(device.name || device.roomName)}</strong>
        <span class="device-badges"><span class="status-pill device-${escapeHtml(device.status)}">${escapeHtml(device.status)}</span><span class="status-pill health-${escapeHtml(device.healthStatus)}">${escapeHtml(device.healthStatus)}</span></span>
        <span>${escapeHtml(device.roomName)} / ${escapeHtml(device.deviceType || "Unknown device")} / ${escapeHtml(device.orientation || "unknown orientation")}</span>
        <span>${escapeHtml(device.browser || "Browser not reported")} / ${escapeHtml(device.viewport || "Viewport not reported")}</span>
        <span>IP: ${escapeHtml(device.lastIpAddress || "Not reported")} / Audio: ${device.audioEnabled ? "Ready" : "Not enabled"}</span>
        <span>Last contact: ${device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never"} / Last data: ${device.lastDataAt ? new Date(device.lastDataAt).toLocaleString() : "Never"}</span>
        ${device.status === "pending" ? `<span class="pairing-code">Pairing code: ${escapeHtml(device.pairingCode)}</span>` : ""}
      </div>
      <div class="entity-actions">
        ${device.status === "pending" && device.pairingCode ? `<button type="button" data-approve-device="${escapeHtml(device.id)}" data-pairing-code="${escapeHtml(device.pairingCode)}">Approve</button>` : ""}
        ${device.status === "active" ? `<button type="button" class="secondary" data-device-command="${escapeHtml(device.id)}" data-command="data-refresh">Refresh Data</button>
        <button type="button" class="secondary" data-device-command="${escapeHtml(device.id)}" data-command="reload">Reload</button>` : ""}
        ${device.status !== "revoked" ? `<button type="button" class="secondary" data-reassign-device="${escapeHtml(device.id)}">Reassign</button>
        <button type="button" class="danger-text" data-revoke-device="${escapeHtml(device.id)}">Revoke</button>` : ""}
        ${device.status === "revoked" ? `<button type="button" class="danger-text" data-delete-device="${escapeHtml(device.id)}">Remove Record</button>` : ""}
      </div>
    </article>`;
  }).join("") || `<p class="empty-state">No kiosk devices match these filters.</p>`;
}

function renderBroadcastTemplates() {
  const activeTemplates = state.broadcastTemplates.filter(template => template.active);
  const templateSelect = document.querySelector("#broadcastTemplateSelect");
  const selectedId = templateSelect.value;
  templateSelect.innerHTML = `<option value="">Custom message</option>${activeTemplates.map(template =>
    `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`
  ).join("")}`;
  if (activeTemplates.some(template => template.id === selectedId)) templateSelect.value = selectedId;

  document.querySelector("#broadcastTemplateList").innerHTML = state.broadcastTemplates.map(template =>
    entityItem(
      template,
      `${template.severity} / ${template.active ? "Active" : "Inactive"} / Confirmation required`,
      "broadcastTemplate"
    )
  ).join("") || `<p class="empty-state">No broadcast templates configured.</p>`;
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
    entityItem(room, `${room.code} / ${room.buildingName} / ${room.themeName}${room.maintenanceStatus !== "available" ? ` / ${room.maintenanceStatus}` : ""}`, "room")
  ).join("") || `<p class="empty-state">No rooms configured.</p>`;

  document.querySelector("#roomGroupList").innerHTML = (state.roomGroups || []).map(group =>
    entityItem(group, `${group.roomIds.length} room${group.roomIds.length === 1 ? "" : "s"} / ${group.active ? "Active" : "Inactive"}`, "roomGroup")
  ).join("") || `<p class="empty-state">No room groups configured.</p>`;
}

function broadcastTargetSummary(item) {
  const scopes = [
    ...(item.centerIds || []).map(centerName),
    ...(item.campusIds || []).map(campusName),
    ...(item.buildingIds || []).map(buildingName),
    ...(item.roomGroupIds || []).map(id => state.roomGroups.find(group => group.id === id)?.name || "Deleted room group"),
    ...(item.roomIds || []).map(id => state.rooms.find(room => room.id === id)?.name || "Deleted room")
  ];
  return `${scopes.join(", ") || "Direct room snapshot"} / ${item.resolvedRoomCount || item.targetRoomCodes?.length || 0} rooms`;
}

function broadcastItem(item, scheduled = false) {
  return `<article class="entity-item broadcast-item severity-${escapeHtml(item.severity)}">
    <div>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.severity)} / ${new Date(item.startsAt).toLocaleString()}${item.endsAt ? ` - ${new Date(item.endsAt).toLocaleString()}` : " / no automatic end"}</span>
      <span>${escapeHtml(broadcastTargetSummary(item))}</span>
      <span>Owner: ${escapeHtml(item.createdByName)}${item.updatedAt ? ` / Updated by ${escapeHtml(item.updatedByName)}` : ""}</span>
    </div>
    <div class="entity-actions">
      <button type="button" class="secondary" data-edit-broadcast="${escapeHtml(item.id)}">Edit</button>
      ${scheduled
        ? `<button type="button" class="danger-text" data-cancel-broadcast="${escapeHtml(item.id)}">Cancel</button>`
        : `<button type="button" class="danger-text" data-end-broadcast="${escapeHtml(item.id)}">End</button>`}
    </div>
  </article>`;
}

function renderBroadcastDashboard() {
  document.querySelector("#activeBroadcastList").innerHTML = (state.activeBroadcasts || []).map(item => broadcastItem(item)).join("")
    || `<p class="empty-state">No active broadcasts.</p>`;
  document.querySelector("#scheduledBroadcastList").innerHTML = (state.scheduledBroadcasts || []).map(item => broadcastItem(item, true)).join("")
    || `<p class="empty-state">No scheduled broadcasts.</p>`;
}

function renderInAppNotifications() {
  document.querySelector("#inAppNotificationList").innerHTML = (state.notifications || []).map(item => `
    <article class="entity-item notification-item severity-${escapeHtml(item.severity)}">
      <div><strong>${escapeHtml(item.title)}</strong><span>${new Date(item.createdAt).toLocaleString()} / ${escapeHtml(item.source)}</span><span>${escapeHtml(item.message)}</span></div>
    </article>
  `).join("") || `<p class="empty-state">No in-app notifications yet.</p>`;
}

function renderThemes() {
  document.querySelector("#themeManagerList").innerHTML = state.themes.map(theme => `
    <article class="entity-item">
      <div><strong>${escapeHtml(theme.name)}</strong><span>${theme.builtIn ? "Built-in" : "Custom"} / ${theme.published ? "Published" : "Draft"}${theme.archived ? " / Archived" : ""}</span></div>
      <div class="entity-actions">
        ${theme.builtIn ? `<button type="button" class="secondary" data-clone-theme="${escapeHtml(theme.id)}">Clone</button>` : `<button type="button" class="secondary" data-edit-theme="${escapeHtml(theme.id)}">Edit</button>`}
      </div>
    </article>
  `).join("");
  const roomSelect = document.querySelector("#themePreviewRoom");
  const selectedRoomId = roomSelect.value || state.rooms[0]?.id || "";
  roomSelect.innerHTML = optionList(state.rooms, selectedRoomId, room => `${room.name} - ${room.buildingName}`);
}

function accessibleScheduleRooms() {
  const allowed = new Set(state.viewer.accessibleRoomIds || []);
  return state.rooms.filter(room => allowed.has(room.id));
}

function scheduleTargetSummary(schedule) {
  const labels = [
    ...schedule.centerIds.map(centerName),
    ...schedule.campusIds.map(campusName),
    ...schedule.buildingIds.map(buildingName),
    ...schedule.roomIds.map(id => state.rooms.find(room => room.id === id)?.name || "Unknown room")
  ];
  return `${labels.join(", ")} / ${schedule.resolvedRoomCount} room${schedule.resolvedRoomCount === 1 ? "" : "s"}`;
}

function scheduleItem(schedule, upcoming) {
  const active = new Date(schedule.startsAt) <= new Date() && new Date(schedule.endsAt) > new Date();
  return `<article class="entity-item">
    <div>
      <strong>${escapeHtml(schedule.themeName)}</strong>
      <span>${active ? "Active now / " : ""}${new Date(schedule.startsAt).toLocaleString()} - ${new Date(schedule.endsAt).toLocaleString()}</span>
      <span>${escapeHtml(scheduleTargetSummary(schedule))}</span>
      <span>Owner: ${escapeHtml(schedule.ownerName)}${schedule.updatedAt ? ` / Updated by ${escapeHtml(schedule.updatedByName)}` : ""}</span>
    </div>
    ${upcoming ? `<div class="entity-actions">
      <button type="button" class="secondary" data-edit-theme-schedule="${escapeHtml(schedule.id)}">Edit</button>
      <button type="button" class="danger-text" data-delete-theme-schedule="${escapeHtml(schedule.id)}">Delete</button>
    </div>` : ""}
  </article>`;
}

function renderThemeSchedules() {
  const rooms = accessibleScheduleRooms();
  const roomIds = new Set(rooms.map(room => room.id));
  const fullyAccessible = (allRooms, id, key) => {
    const targetRooms = allRooms.filter(room => room[key] === id);
    return targetRooms.length > 0 && targetRooms.every(room => roomIds.has(room.id));
  };
  const centers = state.centers.filter(center => fullyAccessible(state.rooms, center.id, "centerId"));
  const campuses = state.campuses.filter(campus => fullyAccessible(state.rooms, campus.id, "campusId"));
  const buildings = state.buildings.filter(building => fullyAccessible(state.rooms, building.id, "buildingId"));
  const retainSelection = select => new Set(Array.from(select.selectedOptions).map(option => option.value));
  const renderMulti = (selector, items, label) => {
    const select = document.querySelector(selector);
    const selected = retainSelection(select);
    select.innerHTML = items.map(item => `<option value="${escapeHtml(item.id)}" ${selected.has(item.id) ? "selected" : ""}>${escapeHtml(label(item))}</option>`).join("");
  };
  const themeSelect = document.querySelector("#scheduleTheme");
  const selectedTheme = themeSelect.value;
  themeSelect.innerHTML = optionList(state.themes.filter(theme => theme.published && !theme.archived), selectedTheme);
  renderMulti("#scheduleCenters", centers, center => center.name);
  renderMulti("#scheduleCampuses", campuses, campus => `${campus.name} - ${centerName(campus.centerId)}`);
  renderMulti("#scheduleBuildings", buildings, building => `${building.name} - ${campusName(building.campusId)}`);
  renderMulti("#scheduleRooms", rooms, room => `${room.name} - ${room.buildingName}`);

  const now = Date.now();
  const schedules = state.themeSchedules.filter(schedule => schedule.resolvedRoomIds.some(id => roomIds.has(id)));
  const upcoming = schedules.filter(schedule => new Date(schedule.endsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = schedules.filter(schedule => new Date(schedule.endsAt).getTime() <= now)
    .sort((a, b) => b.endsAt.localeCompare(a.endsAt));
  document.querySelector("#upcomingThemeSchedules").innerHTML = upcoming.map(schedule => scheduleItem(schedule, true)).join("")
    || `<p class="empty-state">No active or upcoming theme schedules.</p>`;
  document.querySelector("#pastThemeSchedules").innerHTML = past.map(schedule => scheduleItem(schedule, false)).join("")
    || `<p class="empty-state">No completed theme schedules in the last two years.</p>`;
}

function renderUsersRoles() {
  document.querySelector("#roleManagerList").innerHTML = state.roles.map(role => `
    <article class="entity-item">
      <div><strong>${escapeHtml(role.name)}</strong><span>${role.builtIn ? "Built-in" : "Custom"} / ${role.active ? "Active" : "Inactive"} / ${role.permissions.length} permissions</span></div>
      <div class="entity-actions">
        <button type="button" class="secondary" data-edit="role" data-id="${escapeHtml(role.id)}">Edit</button>
        <button type="button" class="secondary" data-clone-role="${escapeHtml(role.id)}">Clone</button>
        ${role.builtIn ? "" : `<button type="button" class="danger-text" data-delete="role" data-id="${escapeHtml(role.id)}">Delete</button>`}
      </div>
    </article>
  `).join("");
}

function filteredUsers() {
  const search = document.querySelector("#userSearch").value.trim().toLowerCase();
  const status = document.querySelector("#userStatusFilter").value;
  return state.users.filter(user =>
    (!search || `${user.name} ${user.email}`.toLowerCase().includes(search)) &&
    (!status || user.status === status)
  );
}

function renderUsers() {
  const users = filteredUsers();
  const target = document.querySelector("#userRows");
  if (!users.length) {
    target.innerHTML = `<tr><td colspan="6" class="empty-state">No users match these filters.</td></tr>`;
    return;
  }
  target.innerHTML = users.map(user => `
    <tr>
      <td><strong>${escapeHtml(user.name)}</strong><span class="subtle">${escapeHtml(user.email)}</span></td>
      <td><span class="status-pill user-${escapeHtml(user.status)}">${escapeHtml(user.status)}</span>${user.twoFactorEnabled ? `<span class="subtle">2FA enabled</span>` : ""}</td>
      <td>${user.roleIds.map(roleName).map(escapeHtml).join(", ") || "None"}</td>
      <td>${[
        ...user.centerIds.map(centerName),
        ...user.campusIds.map(campusName),
        ...user.buildingIds.map(buildingName),
        ...(user.roomIds || []).map(roomName)
      ].map(escapeHtml).join(", ") || "None"}</td>
      <td><span class="feature-summary">${user.features.map(escapeHtml).join(", ") || "None"}</span>
        ${(user.featureGrants || []).map(grant => `<span class="subtle">${escapeHtml(grant.featureName)}: ${new Date(grant.startsAt).toLocaleString()} - ${new Date(grant.endsAt).toLocaleString()} <button type="button" class="danger-text compact-button" data-delete-feature-grant="${escapeHtml(grant.id)}">Remove</button></span>`).join("")}
      </td>
      <td><div class="row-actions">
        <button type="button" class="secondary" data-edit="user" data-id="${escapeHtml(user.id)}">Edit</button>
        <button type="button" class="secondary" data-invite-user="${escapeHtml(user.id)}">Send Invite</button>
        ${state.viewer.isSystemAdmin ? `<button type="button" class="secondary" data-set-user-password="${escapeHtml(user.id)}">Set Password</button>` : ""}
      </div></td>
    </tr>
  `).join("");
}

function renderEmailSettings() {
  const settings = state.settings.email;
  const form = document.querySelector("#smtpForm");
  form.elements.enabled.checked = settings.enabled;
  form.elements.host.value = settings.host;
  form.elements.port.value = settings.port;
  form.elements.secure.checked = settings.secure;
  form.elements.username.value = settings.username;
  form.elements.password.value = "";
  form.elements.fromName.value = settings.fromName;
  form.elements.fromEmail.value = settings.fromEmail;
  form.elements.replyTo.value = settings.replyTo;
  document.querySelector("#smtpPasswordStatus").textContent = settings.hasPassword
    ? "An encrypted SMTP password is stored. Leave the field blank to keep it."
    : "No SMTP password is stored.";
  document.querySelector("#smtpStatus").textContent = settings.lastTestAt
    ? `Last test: ${settings.lastTestStatus} at ${new Date(settings.lastTestAt).toLocaleString()}${settings.lastTestError ? ` - ${settings.lastTestError}` : ""}`
    : "";
  document.querySelector("#emailRecipients").innerHTML = state.users
    .filter(user => user.status !== "deactivated")
    .map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} - ${escapeHtml(user.email)}</option>`)
    .join("");
  document.querySelector("#emailRecipientRoles").innerHTML = state.roles
    .map(role => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`)
    .join("");
  document.querySelector("#emailRecipientCenters").innerHTML = state.centers
    .map(center => `<option value="${escapeHtml(center.id)}">${escapeHtml(center.name)}</option>`)
    .join("");
}

function renderEmailHistory() {
  const target = document.querySelector("#emailHistoryRows");
  target.innerHTML = state.emailNotifications.map(item => `
    <tr>
      <td>${new Date(item.createdAt).toLocaleString()}</td>
      <td>${escapeHtml(item.to)}</td>
      <td>${escapeHtml(item.subject)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td><span class="status-pill email-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>${item.error ? `<span class="subtle">${escapeHtml(item.error)}</span>` : ""}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="empty-state">No email delivery attempts yet.</td></tr>`;
}

function providerLabel(provider) {
  return { google: "Google Calendar", microsoft365: "Microsoft 365", caldav: "CalDAV / iCloud", "public-url": "Public URL" }[provider] || provider;
}

function renderCalendars() {
  document.querySelector("#calendarAccountList").innerHTML = state.calendarAccounts.map(account => `
    <article class="entity-item">
      <div>
        <strong>${escapeHtml(account.accountName)}</strong>
        <span>${escapeHtml(providerLabel(account.provider))} / ${escapeHtml(account.authMode)} / ${escapeHtml(account.accessLevel)} / ${account.calendars.length} calendars${account.principalEmail ? ` / ${escapeHtml(account.principalEmail)}` : ""}</span>
        <span>Sync: every ${account.syncIntervalMinutes} minutes / Webhook: ${escapeHtml(account.webhookStatus)}${account.webhookError ? ` / ${escapeHtml(account.webhookError)}` : ""}</span>
      </div>
      <div class="entity-actions">
        ${account.authMode === "oauth" ? `<button type="button" class="secondary" data-connect-calendar="${escapeHtml(account.id)}">Connect OAuth</button>` : ""}
        <button type="button" class="secondary" data-discover-calendar="${escapeHtml(account.id)}">${account.provider === "public-url" ? "Verify" : "Discover / Verify"}</button>
        <button type="button" class="secondary" data-edit="calendarAccount" data-id="${escapeHtml(account.id)}">Edit</button>
        <button type="button" class="danger-text" data-delete="calendarAccount" data-id="${escapeHtml(account.id)}">Delete</button>
      </div>
      ${["google", "microsoft365"].includes(account.provider) && account.calendars.length ? `<div class="calendar-webhook-actions">${account.calendars.map(calendar =>
        `<button type="button" class="secondary compact" data-register-webhook="${escapeHtml(account.id)}" data-calendar-id="${escapeHtml(calendar.id)}">Enable webhook: ${escapeHtml(calendar.name)}</button>`
      ).join("")}</div>` : ""}
    </article>
  `).join("") || `<p class="empty-state">No calendar accounts configured.</p>`;

  const roomSelect = document.querySelector("#calendarAssignmentRoom");
  roomSelect.innerHTML = optionList(state.rooms, roomSelect.value, room => room.name);
  const accountSelect = document.querySelector("#calendarAssignmentAccount");
  accountSelect.innerHTML = optionList(state.calendarAccounts.filter(account => account.active), accountSelect.value, account => account.accountName);
  renderCalendarChoices();

  document.querySelector("#calendarAssignmentList").innerHTML = state.calendarAssignments.map(assignment => {
    const room = state.rooms.find(item => item.id === assignment.roomId);
    const account = state.calendarAccounts.find(item => item.id === assignment.accountId);
    const calendar = account?.calendars.find(item => item.id === assignment.calendarId);
    return `<article class="entity-item">
      <div><strong>${escapeHtml(room?.name || "Unknown room")}</strong><span>${escapeHtml(account?.accountName || "Unknown account")} / ${escapeHtml(calendar?.name || "Unknown calendar")}${assignment.lastSyncError ? ` / ${escapeHtml(assignment.lastSyncError)}` : ""}</span></div>
      <div class="entity-actions">
        <button type="button" class="secondary" data-sync-calendar="${escapeHtml(assignment.id)}">Sync Now</button>
        <button type="button" class="danger-text" data-delete-assignment="${escapeHtml(assignment.id)}">Remove</button>
      </div>
    </article>`;
  }).join("") || `<p class="empty-state">No room calendars assigned.</p>`;

  document.querySelector("#calendarSyncRows").innerHTML = state.calendarSyncHistory.map(item => {
    const room = state.rooms.find(roomItem => roomItem.id === item.roomId);
    const account = state.calendarAccounts.find(accountItem => accountItem.id === item.accountId);
    const eventSummary = item.status === "success"
      ? `<strong>${item.eventCount ?? 0} total</strong><span class="subtle">${item.futureEventCount ?? 0} upcoming · ${item.currentEventCount ?? 0} active · ${item.pastEventCount ?? 0} past</span><span class="subtle">${item.displayedUpcomingEventCount ?? item.futureEventCount ?? 0} projected to signage</span>${item.nextEventAt ? `<span class="subtle">Next: ${escapeHtml(new Date(item.nextEventAt).toLocaleString())}</span>` : `<span class="subtle">No future event found in the next 30 days.</span>`}${item.firstEventAt && item.lastEventAt ? `<span class="subtle">Imported range: ${escapeHtml(new Date(item.firstEventAt).toLocaleString())} - ${escapeHtml(new Date(item.lastEventAt).toLocaleString())}</span>` : ""}`
      : "-";
    return `<tr><td>${new Date(item.createdAt).toLocaleString()}</td><td>${escapeHtml(room?.name || "Unknown")}</td><td>${escapeHtml(account?.accountName || "Unknown")}</td><td><span class="status-pill email-${item.status === "success" ? "sent" : "failed"}">${escapeHtml(item.status)}</span>${item.error ? `<span class="subtle">${escapeHtml(item.error)}</span>` : ""}</td><td>${eventSummary}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="empty-state">No calendar sync history yet.</td></tr>`;

  const conflictCounts = state.calendarConflicts.reduce((counts, conflict) => {
    counts.total += 1;
    counts[conflict.status] = (counts[conflict.status] || 0) + 1;
    return counts;
  }, { total: 0 });
  document.querySelector("#calendarConflictSummary").innerHTML = [
    ["Active Overlap Groups", conflictCounts.total],
    ["Unresolved", conflictCounts.unresolved || 0],
    ["Ignored", conflictCounts.ignored || 0],
    ["Resolved Display", conflictCounts.resolved || 0]
  ].map(([label, value]) => `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${value}</strong></article>`).join("");

  document.querySelector("#calendarConflictList").innerHTML = state.calendarConflicts.map(conflict => {
    const room = state.rooms.find(item => item.id === conflict.roomId);
    const events = conflict.eventIds.map(id => state.calendarEvents.find(item => item.id === id)).filter(Boolean);
    const selected = events.find(event => event.externalEventId === conflict.selectedExternalEventId);
    return `<article class="entity-item conflict-item">
      <div><strong>${escapeHtml(room?.name || "Unknown room")}</strong><span>${formatDateTime(conflict.startsAt, room?.timezone)} - ${formatDateTime(conflict.endsAt, room?.timezone)}</span><span>${events.length} overlapping events · ${escapeHtml(conflict.status)}${selected ? ` · Displaying ${escapeHtml(selected.title)}` : " · Deterministic earliest event"}</span></div>
      <div class="conflict-options"><button type="button" data-review-conflict="${escapeHtml(conflict.id)}">Review Conflict</button></div>
    </article>`;
  }).join("") || `<p class="empty-state">No calendar conflicts detected.</p>`;

  document.querySelector("#calendarConflictHistoryRows").innerHTML = (state.calendarConflictHistory || []).map(decision => {
    const externalId = decision.selectedExternalEventId || decision.targetExternalEventId;
    const snapshot = decision.eventSnapshots?.find(event => event.externalEventId === externalId);
    const room = state.rooms.find(item => item.id === decision.roomId);
    return `<tr>
      <td>${new Date(decision.createdAt).toLocaleString()}</td>
      <td>${escapeHtml(decision.roomName || state.rooms.find(room => room.id === decision.roomId)?.name || "Unknown")}</td>
      <td>${escapeHtml(decision.actorName || "System")}</td>
      <td>${escapeHtml(decision.action)}</td>
      <td>${decision.sourceWrite ? "Yes" : "No"}</td>
      <td>${escapeHtml(snapshot?.title || externalId || "-")}${decision.newStartsAt ? `<span class="subtle">Moved to ${escapeHtml(formatDateTime(decision.newStartsAt, room?.timezone))}</span>` : ""}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty-state">No conflict decisions recorded.</td></tr>`;
}

function calendarContextForEvent(event) {
  const assignment = state.calendarAssignments.find(item => item.id === event.assignmentId);
  const account = state.calendarAccounts.find(item => item.id === assignment?.accountId);
  const calendar = account?.calendars.find(item => item.id === assignment?.calendarId);
  return { assignment, account, calendar };
}

function formatDateTime(value, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || undefined,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function zonedDateTimeInput(value, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value)).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function zonedLocalToIso(value, timeZone) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(guess)).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    guess += desired - represented;
  }
  return new Date(guess).toISOString();
}

function selectedConflictEvent() {
  const selected = conflictActionForm.querySelector('input[name="selectedExternalEventId"]:checked');
  const conflict = state.calendarConflicts.find(item => item.id === conflictActionForm.elements.conflictId.value);
  return conflict?.eventIds
    .map(id => state.calendarEvents.find(event => event.id === id))
    .find(event => event?.externalEventId === selected?.value);
}

function updateConflictActionAvailability() {
  const conflict = state.calendarConflicts.find(item => item.id === conflictActionForm.elements.conflictId.value);
  const events = conflict?.eventIds.map(id => state.calendarEvents.find(event => event.id === id)).filter(Boolean) || [];
  const selected = selectedConflictEvent();
  if (!selected) return;
  const selectedContext = calendarContextForEvent(selected);
  const room = state.rooms.find(item => item.id === conflict?.roomId);
  const timezone = room?.timezone || "UTC";
  const selectedWritable = selectedContext.account?.accessLevel === "writable"
    && ["google", "microsoft365"].includes(selectedContext.account?.provider);
  const replaceWritable = events
    .filter(event => event.id !== selected.id)
    .every(event => {
      const context = calendarContextForEvent(event);
      return context.account?.accessLevel === "writable"
        && ["google", "microsoft365"].includes(context.account?.provider);
    });
  conflictActionForm.querySelector('[data-conflict-action="cancel"]').disabled = !selectedWritable;
  conflictActionForm.querySelector('[data-conflict-action="move"]').disabled = !selectedWritable;
  conflictActionForm.querySelector('[data-conflict-action="replace"]').disabled = !replaceWritable;
  conflictActionForm.elements.startsAt.value = zonedDateTimeInput(selected.startsAt, timezone);
  conflictActionForm.elements.endsAt.value = zonedDateTimeInput(selected.endsAt, timezone);
}

function reviewConflict(conflictId) {
  const conflict = state.calendarConflicts.find(item => item.id === conflictId);
  const room = state.rooms.find(item => item.id === conflict?.roomId);
  const events = conflict?.eventIds
    .map(id => state.calendarEvents.find(event => event.id === id))
    .filter(Boolean)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.externalEventId.localeCompare(right.externalEventId)) || [];
  if (!conflict || !events.length) return;
  const selectedId = conflict.selectedExternalEventId || events[0].externalEventId;
  const timezone = room?.timezone || "UTC";
  document.querySelector("#conflictDialogTitle").textContent = `${room?.name || "Room"} Calendar Conflict`;
  conflictActionForm.elements.conflictId.value = conflict.id;
  conflictActionForm.dataset.timezone = timezone;
  document.querySelector("#conflictReviewBody").innerHTML = `
    <p class="help-text">Unresolved and ignored conflicts display one deterministic event: earliest start, earliest end, then source event ID. Select an event below to override that choice or apply a source action.</p>
    <div class="conflict-review-list">${events.map(event => {
      const context = calendarContextForEvent(event);
      const writable = context.account?.accessLevel === "writable" && ["google", "microsoft365"].includes(context.account?.provider);
      return `<label class="conflict-review-event">
        <input type="radio" name="selectedExternalEventId" value="${escapeHtml(event.externalEventId)}" ${event.externalEventId === selectedId ? "checked" : ""} />
        <span><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(formatDateTime(event.startsAt, timezone))} - ${escapeHtml(formatDateTime(event.endsAt, timezone))} (${escapeHtml(timezone)})</small><small>${escapeHtml(context.account?.accountName || event.provider || "Unknown source")} · ${escapeHtml(context.calendar?.name || "Calendar")} · ${writable ? "Writable" : "Read-only"}</small>${event.description ? `<small>${escapeHtml(event.description)}</small>` : ""}</span>
      </label>`;
    }).join("")}</div>`;
  document.querySelector("#conflictFormStatus").textContent = "";
  updateConflictActionAvailability();
  conflictDialog.showModal();
}

async function applyConflictAction(action) {
  const conflictId = conflictActionForm.elements.conflictId.value;
  const selected = selectedConflictEvent();
  if (!selected) return;
  const body = {
    action,
    selectedExternalEventId: selected.externalEventId,
    targetExternalEventId: selected.externalEventId
  };
  if (action === "move") {
    const startsAt = zonedLocalToIso(conflictActionForm.elements.startsAt.value, conflictActionForm.dataset.timezone || "UTC");
    const endsAt = zonedLocalToIso(conflictActionForm.elements.endsAt.value, conflictActionForm.dataset.timezone || "UTC");
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
      document.querySelector("#conflictFormStatus").textContent = "Enter a valid new start and end time.";
      return;
    }
    body.startsAt = startsAt;
    body.endsAt = endsAt;
  }
  if (["cancel", "replace", "move"].includes(action)) {
    const wording = {
      cancel: `cancel "${selected.title}" in its source calendar`,
      replace: `keep "${selected.title}" and cancel the other overlapping source events`,
      move: `change "${selected.title}" in its source calendar`
    }[action];
    if (!confirm(`This will ${wording}. Continue?`)) return;
  }
  const status = document.querySelector("#conflictFormStatus");
  status.textContent = "Applying conflict action...";
  try {
    const result = await api(`/api/calendar-conflicts/${conflictId}/action`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    conflictDialog.close();
    await load();
    if (result.syncWarnings?.length) alert(`Source calendar updated, but refresh reported:\n\n${result.syncWarnings.join("\n")}`);
  } catch (error) {
    status.textContent = error.message;
  }
}

function renderCalendarChoices() {
  const account = state.calendarAccounts.find(item => item.id === document.querySelector("#calendarAssignmentAccount").value);
  document.querySelector("#calendarAssignmentCalendar").innerHTML = optionList(account?.calendars || [], "", calendar => calendar.name);
}

function renderBroadcastHistory() {
  const panel = document.querySelector("#broadcastHistoryPanel");
  panel.hidden = !state.viewer.isSystemAdmin && !state.viewer.permissions.includes("broadcast.history.view");
  if (panel.hidden) return;
  document.querySelector("#broadcastHistoryRows").innerHTML = state.broadcastHistory.map(item => `
    <tr>
      <td>${new Date(item.startsAt || item.startedAt || item.createdAt).toLocaleString()}${item.endsAt ? `<span class="subtle">to ${new Date(item.endsAt).toLocaleString()}</span>` : ""}</td>
      <td>${escapeHtml(item.createdByName || "System")}${item.updatedAt ? `<span class="subtle">Updated by ${escapeHtml(item.updatedByName || "System")} at ${new Date(item.updatedAt).toLocaleString()}</span>` : ""}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.severity)}</td>
      <td>${escapeHtml(broadcastTargetSummary(item))}</td>
      <td>${escapeHtml(item.status || (item.endedAt ? "ended" : "active"))}</td>
      <td>${item.endedAt ? `${new Date(item.endedAt).toLocaleString()}<span class="subtle">by ${escapeHtml(item.endedByName || "System")}</span>` : "-"}</td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="empty-state">No broadcasts recorded.</td></tr>`;
}

function renderAudit() {
  document.querySelector("#auditList").innerHTML = `<div class="list">${state.auditLogs.map(log => `
    <div class="list-item"><strong>${escapeHtml(log.action)}</strong><span>${new Date(log.createdAt).toLocaleString()}</span></div>
  `).join("") || `<p class="empty-state">No audit activity yet.</p>`}</div>`;
}

function renderLoginAudit() {
  const panel = document.querySelector("#loginAuditPanel");
  panel.hidden = !state.viewer.isSystemAdmin;
  document.querySelector("#loginAuditRows").innerHTML = (state.loginAudit || []).map(item => `
    <tr>
      <td>${new Date(item.createdAt).toLocaleString()}</td>
      <td>${escapeHtml(item.email || "-")}</td>
      <td>${escapeHtml(item.outcome)}</td>
      <td>${escapeHtml(item.ipAddress || "-")}</td>
      <td>${escapeHtml(item.userAgent || "-")}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="empty-state">No login activity recorded.</td></tr>`;
}

function renderSessions() {
  document.querySelector("#sessionList").innerHTML = (state.sessions || []).filter(item => !item.revokedAt).map(item => `
    <article class="entity-item">
      <div><strong>${item.current ? "Current session" : escapeHtml(item.ipAddress || "Session")}</strong>
        <span>${escapeHtml(item.userAgent || "Browser not reported")}</span>
        <span>Expires ${new Date(item.expiresAt).toLocaleString()}</span>
      </div>
      <div class="entity-actions">${item.current ? "" : `<button type="button" class="danger-text" data-revoke-session="${escapeHtml(item.id)}">Revoke</button>`}</div>
    </article>
  `).join("") || `<p class="empty-state">No active sessions.</p>`;
}

function fieldsFor(type, entity = {}) {
  const active = entity.active !== false;
  if (type === "kioskDevice") {
    const accessibleRooms = state.rooms.filter(room => state.viewer.accessibleRoomIds.includes(room.id));
    return `
      <label>Device Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Device Type <input name="deviceType" maxlength="80" value="${escapeHtml(entity.deviceType)}" /></label>
      <label>Assigned Room <select name="roomId" required>${optionList(accessibleRooms, entity.roomId, room => `${room.name} - ${room.buildingName}`)}</select></label>
      <p class="help-text">An online kiosk will automatically navigate to the destination room after this change.</p>
    `;
  }
  if (type === "role") {
    return `
      <label>Role Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <fieldset class="feature-fieldset"><legend>Permissions</legend>
        ${state.permissionCatalog.map(permission => `<label class="check-label"><input type="checkbox" name="permissions" value="${escapeHtml(permission)}" ${entity.permissions?.includes(permission) ? "checked" : ""} /> ${escapeHtml(permission)}</label>`).join("")}
      </fieldset>
      <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
    `;
  }
  if (type === "calendarAccount") {
    const provider = entity.provider || "public-url";
    const authMode = entity.authMode || (provider === "google" ? "service-account" : provider === "microsoft365" ? "application" : provider === "caldav" ? "app-password" : "public-url");
    const calendarLines = (entity.calendars || []).map(calendar =>
      provider === "microsoft365"
        ? `${calendar.name}|${calendar.externalId}|${calendar.mailbox || ""}`
        : `${calendar.name}|${calendar.externalId}`
    ).join("\n");
    return `
      <div class="form-grid">
        <label>Account Name <input name="accountName" required maxlength="160" value="${escapeHtml(entity.accountName)}" /></label>
        <label>Provider <select name="provider" required>
          <option value="public-url" ${provider === "public-url" ? "selected" : ""}>Public Calendar URL</option>
          <option value="google" ${provider === "google" ? "selected" : ""}>Google Calendar</option>
          <option value="microsoft365" ${provider === "microsoft365" ? "selected" : ""}>Microsoft 365</option>
          <option value="caldav" ${provider === "caldav" ? "selected" : ""}>CalDAV / iCloud</option>
        </select></label>
        <label>Connection Method <select name="authMode">
          <option value="public-url" ${authMode === "public-url" ? "selected" : ""}>Public URL</option>
          <option value="service-account" ${authMode === "service-account" ? "selected" : ""}>Google Service Account</option>
          <option value="application" ${authMode === "application" ? "selected" : ""}>Microsoft Application</option>
          <option value="oauth" ${authMode === "oauth" ? "selected" : ""}>Interactive OAuth</option>
          <option value="app-password" ${authMode === "app-password" ? "selected" : ""}>CalDAV App Password</option>
        </select></label>
        <label>Access Level <select name="accessLevel">
          <option value="read-only" ${entity.accessLevel !== "writable" ? "selected" : ""}>Read-only</option>
          <option value="writable" ${entity.accessLevel === "writable" ? "selected" : ""}>Writable</option>
        </select></label>
        <label>Sync Interval (minutes) <input name="syncIntervalMinutes" type="number" min="5" value="${escapeHtml(entity.syncIntervalMinutes || 15)}" /></label>
        <label>Microsoft Tenant ID <input name="tenantId" value="${escapeHtml(entity.tenantId)}" /></label>
        <label>Microsoft Client ID <input name="clientId" value="${escapeHtml(entity.clientId)}" /></label>
        <label>Default Microsoft Mailbox <input name="mailbox" value="${escapeHtml(entity.mailbox)}" placeholder="room@example.org" /></label>
        <label>CalDAV Server URL <input name="serverUrl" type="url" value="${escapeHtml(entity.serverUrl)}" placeholder="https://caldav.icloud.com/" /></label>
        <label>CalDAV Username <input name="username" value="${escapeHtml(entity.username)}" /></label>
      </div>
      <label>Credential ${entity.hasCredential ? "(stored; leave blank to keep)" : ""}
        <textarea name="credential" autocomplete="off" placeholder="Service-account JSON, application/OAuth client secret, or CalDAV app password"></textarea>
      </label>
      <label>Calendars <textarea name="calendarLines" placeholder="Name|Calendar ID or public URL&#10;Microsoft: Name|Calendar ID|Mailbox">${escapeHtml(calendarLines)}</textarea></label>
      <p class="help-text">OAuth connections are system-owned. Save the account, select Connect OAuth, then Discover / Verify. Public-feed intervals are configurable, but providers may cache feeds for much longer than the selected interval.</p>
      <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
    `;
  }
  if (type === "user") {
    const status = entity.status || "invited";
    return `
      <div class="form-grid">
        <label>Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
        <label>Email <input name="email" type="email" required maxlength="255" value="${escapeHtml(entity.email)}" /></label>
        <label>Status <select name="status" required>
          ${["active", "invited", "suspended", "deactivated"].map(value => `<option value="${value}" ${value === status ? "selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")}
        </select></label>
      </div>
      <label>Roles <select name="roleIds" multiple>${optionList(state.roles, "", item => item.name)}</select></label>
      <label>Centers <select name="centerIds" multiple>${optionList(state.centers, "", item => item.name)}</select></label>
      <label>Campuses <select name="campusIds" multiple>${optionList(state.campuses, "", item => `${item.name} - ${centerName(item.centerId)}`)}</select></label>
      <label>Buildings <select name="buildingIds" multiple>${optionList(state.buildings, "", item => `${item.name} - ${campusName(item.campusId)}`)}</select></label>
      <label>Individual Rooms <select name="roomIds" multiple>${optionList(state.rooms, "", item => `${item.name} - ${item.buildingName}`)}</select></label>
      <fieldset class="feature-fieldset"><legend>Feature Access Grants</legend>
        ${state.features.map(feature => `<label class="check-label"><input type="checkbox" name="features" value="${escapeHtml(feature)}" ${entity.features?.includes(feature) ? "checked" : ""} /> ${escapeHtml(feature)}</label>`).join("")}
      </fieldset>
      <fieldset class="feature-fieldset"><legend>Add Temporary Feature Grant</legend>
        <label>Feature <select name="temporaryFeatureName"><option value="">No new temporary grant</option>${state.features.map(feature => `<option value="${escapeHtml(feature)}">${escapeHtml(feature)}</option>`).join("")}</select></label>
        <div class="form-grid">
          <label>Starts <input name="temporaryFeatureStartsAt" type="datetime-local" /></label>
          <label>Ends <input name="temporaryFeatureEndsAt" type="datetime-local" /></label>
        </div>
      </fieldset>
      ${entity.id ? "" : `<label class="check-label"><input name="sendInvitation" type="checkbox" /> Send invitation email after creating user</label>`}
    `;
  }
  if (type === "broadcastTemplate") {
    const severity = entity.severity || "urgent";
    return `
      <label>Template Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Broadcast Title <input name="title" required maxlength="200" value="${escapeHtml(entity.title)}" /></label>
      <label>Message <textarea name="message" required maxlength="5000">${escapeHtml(entity.message)}</textarea></label>
      <div class="form-grid">
        <label>Severity <select name="severity" required>
          ${["informational", "warning", "urgent", "critical", "emergency"].map(value => `<option value="${value}" ${value === severity ? "selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")}
        </select></label>
        <label>Visual Style <input name="visualStyle" maxlength="60" value="${escapeHtml(entity.visualStyle || "emergency")}" /></label>
        <label>Default Target Scope <select name="defaultTargetScope">
          ${["rooms", "buildings", "campuses", "centers"].map(value => `<option value="${value}" ${value === (entity.defaultTargetScope || "rooms") ? "selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")}
        </select></label>
      </div>
      <label class="check-label"><input name="audibleAlert" type="checkbox" ${entity.audibleAlert !== false ? "checked" : ""} /> Play alert sound</label>
      <label class="check-label"><input name="active" type="checkbox" ${entity.active !== false ? "checked" : ""} /> Active</label>
      <p class="help-text">Confirmation is mandatory for every template and cannot be disabled.</p>
    `;
  }
  if (type === "roomGroup") {
    return `
      <label>Group Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Description <textarea name="description" maxlength="1000">${escapeHtml(entity.description)}</textarea></label>
      <label>Rooms <select name="roomIds" multiple required>${optionList(state.rooms.filter(room => state.viewer.accessibleRoomIds.includes(room.id)), "", room => `${room.name} - ${room.buildingName}`)}</select></label>
      <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
    `;
  }
  if (type === "center") {
    return `
      <label>Center Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Description <textarea name="description" maxlength="2000">${escapeHtml(entity.description)}</textarea></label>
      <div class="form-grid">
        <label>Time Zone <input name="timezone" required value="${escapeHtml(entity.timezone || "America/Chicago")}" placeholder="America/Chicago" /></label>
        <label>Default Theme <select name="defaultThemeId" required>${optionList(state.themes, entity.defaultThemeId || state.themes[0]?.id)}</select></label>
        <label>Logo URL / Asset Path <input name="logoUrl" value="${escapeHtml(entity.logoUrl || "/assets/branding/aksharderi-small2.png")}" /></label>
        <label>Default Booking URL <input name="bookingUrl" type="url" value="${escapeHtml(entity.bookingUrl)}" /></label>
        <label>Upcoming Events Per Page <input name="upcomingEventCount" type="number" min="1" max="10" value="${escapeHtml(entity.upcomingEventCount || 5)}" /></label>
        <label>Show Event Description <select name="showEventDescription">
          <option value="false" ${entity.showEventDescription !== true ? "selected" : ""}>No</option>
          <option value="true" ${entity.showEventDescription === true ? "selected" : ""}>Yes</option>
        </select></label>
        <label>Contact Name <input name="contactName" value="${escapeHtml(entity.contactName)}" /></label>
        <label>Contact Email <input name="contactEmail" type="email" value="${escapeHtml(entity.contactEmail)}" /></label>
        <label>Contact Phone <input name="contactPhone" value="${escapeHtml(entity.contactPhone)}" /></label>
      </div>
      <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
    `;
  }
  if (type === "campus") {
    return `
      <label>Center <select name="centerId" required>${optionList(state.centers, entity.centerId || state.centers[0]?.id)}</select></label>
      <label>Campus Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Address <textarea name="address">${escapeHtml(entity.address)}</textarea></label>
      <div class="form-grid">
        <label>Default Theme <select name="defaultThemeId"><option value="">Inherit center theme</option>${optionList(state.themes, entity.defaultThemeId)}</select></label>
        <label>Default Booking URL <input name="bookingUrl" type="url" value="${escapeHtml(entity.bookingUrl)}" placeholder="Inherit center booking URL" /></label>
        <label>Upcoming Events Per Page <input name="upcomingEventCount" type="number" min="1" max="10" value="${escapeHtml(entity.upcomingEventCount ?? "")}" placeholder="Inherit" /></label>
        <label>Show Event Description <select name="showEventDescription">
          <option value="" ${entity.showEventDescription == null ? "selected" : ""}>Inherit center</option>
          <option value="false" ${entity.showEventDescription === false ? "selected" : ""}>No</option>
          <option value="true" ${entity.showEventDescription === true ? "selected" : ""}>Yes</option>
        </select></label>
        <label>Contact Name <input name="contactName" value="${escapeHtml(entity.contactName)}" /></label>
        <label>Contact Email <input name="contactEmail" type="email" value="${escapeHtml(entity.contactEmail)}" /></label>
        <label>Contact Phone <input name="contactPhone" value="${escapeHtml(entity.contactPhone)}" /></label>
      </div>
      <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
    `;
  }
  if (type === "building") {
    return `
      <label>Campus <select name="campusId" required>${optionList(state.campuses, entity.campusId || state.campuses[0]?.id, item => `${item.name} - ${centerName(item.centerId)}`)}</select></label>
      <label>Building Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <div class="form-grid">
        <label>Building Code <input name="code" maxlength="40" value="${escapeHtml(entity.code)}" /></label>
        <label>Floors <input name="floors" maxlength="300" value="${escapeHtml(entity.floors)}" placeholder="1, 2, Lower Level" /></label>
        <label>Timezone Override <input name="timezone" value="${escapeHtml(entity.timezone)}" placeholder="Inherit center timezone" /></label>
        <label>Default Theme <select name="defaultThemeId"><option value="">Inherit campus or center theme</option>${optionList(state.themes, entity.defaultThemeId)}</select></label>
        <label>Default Booking URL <input name="bookingUrl" type="url" value="${escapeHtml(entity.bookingUrl)}" placeholder="Inherit booking URL" /></label>
        <label>Upcoming Events Per Page <input name="upcomingEventCount" type="number" min="1" max="10" value="${escapeHtml(entity.upcomingEventCount ?? "")}" placeholder="Inherit" /></label>
        <label>Show Event Description <select name="showEventDescription">
          <option value="" ${entity.showEventDescription == null ? "selected" : ""}>Inherit campus or center</option>
          <option value="false" ${entity.showEventDescription === false ? "selected" : ""}>No</option>
          <option value="true" ${entity.showEventDescription === true ? "selected" : ""}>Yes</option>
        </select></label>
      </div>
      <label>Address <textarea name="address">${escapeHtml(entity.address)}</textarea></label>
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
      <label>Theme <select name="themeId"><option value="">Inherit building, campus, or center theme</option>${optionList(state.themes, entity.configuredThemeId || entity.themeId)}</select></label>
      <label>Room Name <input name="name" required maxlength="160" value="${escapeHtml(entity.name)}" /></label>
      <label>Room Code <input name="code" required maxlength="80" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${escapeHtml(entity.code)}" placeholder="room-108-shishu" /></label>
      <label>Room Number <input name="roomNumber" maxlength="80" value="${escapeHtml(entity.roomNumber)}" /></label>
      <label>Floor <input name="floor" maxlength="80" value="${escapeHtml(entity.floor)}" /></label>
      <label>Room Type <input name="roomType" maxlength="80" value="${escapeHtml(entity.roomType || "Classroom")}" /></label>
      <label>Capacity <input name="capacity" type="number" min="1" value="${escapeHtml(entity.capacity || "")}" /></label>
      <label>Maintenance Status <select name="maintenanceStatus">
        ${["available", "maintenance", "closed"].map(value => `<option value="${value}" ${value === (entity.maintenanceStatus || "available") ? "selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")}
      </select></label>
      <label>Privacy <select name="privacyMode">
        <option value="standard" ${entity.privacyMode === "standard" || !entity.privacyMode ? "selected" : ""}>Standard event details</option>
        <option value="private-title" ${entity.privacyMode === "private-title" ? "selected" : ""}>Show all titles as Private Event</option>
        <option value="hide-details" ${entity.privacyMode === "hide-details" ? "selected" : ""}>Hide titles and time details</option>
      </select></label>
      <label>Upcoming Events Per Page <input name="upcomingEventCount" type="number" min="1" max="10" value="${escapeHtml(entity.upcomingEventCount ?? "")}" placeholder="Inherit" /></label>
      <label>Show Event Description <select name="showEventDescription">
        <option value="" ${entity.showEventDescription == null ? "selected" : ""}>Inherit location setting</option>
        <option value="false" ${entity.showEventDescription === false ? "selected" : ""}>No</option>
        <option value="true" ${entity.showEventDescription === true ? "selected" : ""}>Yes</option>
      </select></label>
    </div>
    <label>Booking URL Override <input name="bookingUrl" type="url" value="${escapeHtml(entity.configuredBookingUrl ?? entity.bookingUrl ?? "")}" placeholder="Inherit building, campus, or center booking URL" /></label>
    <label>Equipment <textarea name="equipment" maxlength="2000">${escapeHtml(entity.equipment)}</textarea></label>
    <label>Accessibility Notes <textarea name="accessibilityNotes" maxlength="2000">${escapeHtml(entity.accessibilityNotes)}</textarea></label>
    <label class="check-label"><input name="active" type="checkbox" ${active ? "checked" : ""} /> Active</label>
  `;
}

function findEntity(type, id) {
  const collection = {
    center: state.centers,
    campus: state.campuses,
    building: state.buildings,
    room: state.rooms,
    user: state.users,
    roomGroup: state.roomGroups,
    broadcastTemplate: state.broadcastTemplates,
    role: state.roles,
    calendarAccount: state.calendarAccounts,
    kioskDevice: state.kioskDevices
  }[type];
  return collection?.find(item => item.id === id);
}

function openEntityDialog(type, id = "") {
  const entity = id ? findEntity(type, id) : {};
  const labels = { broadcastTemplate: "Broadcast Template", kioskDevice: "Kiosk Device" };
  document.querySelector("#entityDialogTitle").textContent = `${id ? "Edit" : "New"} ${labels[type] || `${type[0].toUpperCase()}${type.slice(1)}`}`;
  entityForm.elements.entityType.value = type;
  entityForm.elements.entityId.value = id;
  document.querySelector("#entityFields").innerHTML = fieldsFor(type, entity);
  if (type === "user") {
    const selectedRoles = new Set(entity.roleIds || []);
    const selectedCenters = new Set(entity.centerIds || []);
    const selectedCampuses = new Set(entity.campusIds || []);
    const selectedBuildings = new Set(entity.buildingIds || []);
    const selectedRooms = new Set(entity.roomIds || []);
    Array.from(entityForm.elements.roleIds.options).forEach(option => { option.selected = selectedRoles.has(option.value); });
    Array.from(entityForm.elements.centerIds.options).forEach(option => { option.selected = selectedCenters.has(option.value); });
    Array.from(entityForm.elements.campusIds.options).forEach(option => { option.selected = selectedCampuses.has(option.value); });
    Array.from(entityForm.elements.buildingIds.options).forEach(option => { option.selected = selectedBuildings.has(option.value); });
    Array.from(entityForm.elements.roomIds.options).forEach(option => { option.selected = selectedRooms.has(option.value); });
  } else if (type === "roomGroup") {
    const selectedRooms = new Set(entity.roomIds || []);
    Array.from(entityForm.elements.roomIds.options).forEach(option => { option.selected = selectedRooms.has(option.value); });
  }
  document.querySelector("#formError").textContent = "";
  if (type === "calendarAccount") updateCalendarAuthMode();
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

function updateCalendarAuthMode() {
  if (entityForm.elements.entityType.value !== "calendarAccount") return;
  const provider = entityForm.elements.provider.value;
  const allowed = {
    google: ["service-account", "oauth"],
    microsoft365: ["application", "oauth"],
    caldav: ["app-password"],
    "public-url": ["public-url"]
  };
  const defaults = {
    google: "service-account",
    microsoft365: "application",
    caldav: "app-password",
    "public-url": "public-url"
  };
  if (!allowed[provider].includes(entityForm.elements.authMode.value)) {
    entityForm.elements.authMode.value = defaults[provider];
  }
  entityForm.elements.accessLevel.disabled = provider === "public-url";
  if (provider === "public-url") entityForm.elements.accessLevel.value = "read-only";
}

async function saveEntity(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(entityForm));
  const type = data.entityType;
  const id = data.entityId;
  const temporaryGrant = type === "user" && data.temporaryFeatureName
    ? {
        featureName: data.temporaryFeatureName,
        startsAt: data.temporaryFeatureStartsAt ? new Date(data.temporaryFeatureStartsAt).toISOString() : "",
        endsAt: data.temporaryFeatureEndsAt ? new Date(data.temporaryFeatureEndsAt).toISOString() : ""
      }
    : null;
  delete data.entityType;
  delete data.entityId;
  delete data.temporaryFeatureName;
  delete data.temporaryFeatureStartsAt;
  delete data.temporaryFeatureEndsAt;
  if (type === "user") {
    data.roleIds = Array.from(entityForm.elements.roleIds.selectedOptions).map(option => option.value);
    data.centerIds = Array.from(entityForm.elements.centerIds.selectedOptions).map(option => option.value);
    data.campusIds = Array.from(entityForm.elements.campusIds.selectedOptions).map(option => option.value);
    data.buildingIds = Array.from(entityForm.elements.buildingIds.selectedOptions).map(option => option.value);
    data.roomIds = Array.from(entityForm.elements.roomIds.selectedOptions).map(option => option.value);
    data.features = Array.from(entityForm.querySelectorAll('input[name="features"]:checked')).map(input => input.value);
    data.sendInvitation = Boolean(entityForm.elements.sendInvitation?.checked);
  } else if (type === "broadcastTemplate") {
    data.audibleAlert = entityForm.elements.audibleAlert.checked;
    data.active = entityForm.elements.active.checked;
  } else if (type === "role") {
    data.permissions = Array.from(entityForm.querySelectorAll('input[name="permissions"]:checked')).map(input => input.value);
    data.active = entityForm.elements.active.checked;
  } else if (type === "calendarAccount") {
    data.active = entityForm.elements.active.checked;
    data.syncIntervalMinutes = Number(data.syncIntervalMinutes);
    data.calendars = String(data.calendarLines || "").split("\n").map(line => {
      const [name, externalId, mailbox] = line.split("|").map(value => value.trim());
      const existing = findEntity("calendarAccount", id)?.calendars.find(item => item.externalId === externalId);
      return { id: existing?.id, name, externalId, mailbox };
    }).filter(item => item.name && item.externalId);
    delete data.calendarLines;
  } else if (type === "roomGroup") {
    data.roomIds = Array.from(entityForm.elements.roomIds.selectedOptions).map(option => option.value);
    data.active = entityForm.elements.active.checked;
  } else if (type === "kioskDevice") {
    try {
      await api(`/api/kiosk-devices/${id}/reassign`, {
        method: "POST",
        body: JSON.stringify(data)
      });
      entityDialog.close();
      await load();
    } catch (error) {
      document.querySelector("#formError").textContent = error.message;
    }
    return;
  } else {
    data.active = entityForm.elements.active.checked;
  }
  try {
    const endpoint = type === "campus"
      ? "campuses"
      : type === "broadcastTemplate"
        ? "broadcast-templates"
        : type === "calendarAccount"
          ? "calendar-accounts"
          : type === "roomGroup"
            ? "room-groups"
        : `${type}s`;
    const result = await api(`/api/${endpoint}${id ? `/${id}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(data)
    });
    if (temporaryGrant) {
      await api(`/api/users/${result.id}/feature-grants`, {
        method: "POST",
        body: JSON.stringify(temporaryGrant)
      });
    }
    entityDialog.close();
    await load();
    if (result.invitationError) {
      alert(`User was created, but the invitation email failed: ${result.invitationError}`);
    }
  } catch (error) {
    document.querySelector("#formError").textContent = error.message;
  }
}

async function inviteUser(userId) {
  const user = state.users.find(item => item.id === userId);
  if (!user || !confirm(`Send an invitation email to ${user.email}?`)) return;
  try {
    await api(`/api/users/${userId}/invite`, { method: "POST", body: "{}" });
    await load();
    alert(`Invitation sent to ${user.email}.`);
  } catch (error) {
    alert(error.message);
  }
}

async function deleteFeatureGrant(grantId) {
  if (!confirm("Remove this temporary feature grant?")) return;
  await api(`/api/feature-grants/${grantId}`, { method: "DELETE" });
  await load();
}

async function revokeSession(sessionId) {
  if (!confirm("Revoke this signed-in session?")) return;
  await api(`/api/auth/sessions/${sessionId}`, { method: "DELETE" });
  await load();
}

async function changePassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector("#changePasswordStatus");
  const values = Object.fromEntries(new FormData(form));
  if (values.newPassword !== values.confirmPassword) {
    status.textContent = "New passwords do not match.";
    return;
  }
  status.textContent = "Changing password...";
  try {
    await api("/api/auth/change-password", { method: "POST", body: JSON.stringify(values) });
    form.reset();
    status.textContent = "Password changed. Other signed-in sessions were revoked.";
    await load();
  } catch (error) {
    status.textContent = error.message;
  }
}

function openPasswordDialog(userId) {
  const user = state.users.find(item => item.id === userId);
  if (!user) return;
  adminPasswordForm.reset();
  adminPasswordForm.elements.userId.value = user.id;
  document.querySelector("#passwordDialogUser").textContent = `${user.name} (${user.email})`;
  document.querySelector("#adminPasswordStatus").textContent = "";
  passwordDialog.showModal();
}

async function setUserPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const status = document.querySelector("#adminPasswordStatus");
  if (values.newPassword !== values.confirmPassword) {
    status.textContent = "New passwords do not match.";
    return;
  }
  values.resetTwoFactor = form.elements.resetTwoFactor.checked;
  try {
    await api(`/api/users/${values.userId}/password`, {
      method: "POST",
      body: JSON.stringify(values)
    });
    passwordDialog.close();
    await load();
  } catch (error) {
    status.textContent = error.message;
  }
}

async function setupTwoFactor() {
  const status = document.querySelector("#twoFactorStatus");
  try {
    const result = await api("/api/auth/2fa/setup", { method: "POST", body: "{}" });
    document.querySelector("#twoFactorSecret").value = result.secret;
    document.querySelector("#twoFactorUri").value = result.otpauthUri;
    document.querySelector("#twoFactorSetup").hidden = false;
    status.textContent = "Add the account to your authenticator app, then enter its current code.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function confirmTwoFactor(event) {
  event.preventDefault();
  const status = document.querySelector("#twoFactorStatus");
  try {
    await api("/api/auth/2fa/confirm", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
    });
    document.querySelector("#twoFactorSetup").hidden = true;
    status.textContent = "Two-factor authentication is enabled.";
    await load();
  } catch (error) {
    status.textContent = error.message;
  }
}

async function saveSmtpSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.enabled = form.elements.enabled.checked;
  values.secure = form.elements.secure.checked;
  values.port = Number(values.port);
  const status = document.querySelector("#smtpStatus");
  status.textContent = "Saving...";
  try {
    await api("/api/settings/email", { method: "PUT", body: JSON.stringify(values) });
    await load();
    status.textContent = "SMTP settings saved.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function testSmtp(event) {
  event.preventDefault();
  const recipient = new FormData(event.currentTarget).get("recipient");
  const status = document.querySelector("#smtpStatus");
  status.textContent = "Testing SMTP connection...";
  try {
    const result = await api("/api/settings/email/test", {
      method: "POST",
      body: JSON.stringify({ recipient })
    });
    await load();
    status.textContent = result.emailSent ? "SMTP verified and test email sent." : "SMTP connection verified.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function sendAdministrativeEmail(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.userIds = Array.from(form.elements.userIds.selectedOptions).map(option => option.value);
  values.roleIds = Array.from(form.elements.roleIds.selectedOptions).map(option => option.value);
  values.centerIds = Array.from(form.elements.centerIds.selectedOptions).map(option => option.value);
  const status = document.querySelector("#emailSendStatus");
  status.textContent = "Sending...";
  try {
    const result = await api("/api/email/send", { method: "POST", body: JSON.stringify(values) });
    const sent = result.results.filter(item => item.status === "sent").length;
    const failed = result.results.length - sent;
    status.textContent = `Sent: ${sent}${failed ? `, failed: ${failed}` : ""}.`;
    form.elements.subject.value = "";
    form.elements.message.value = "";
    await load();
  } catch (error) {
    status.textContent = error.message;
  }
}

async function deleteEntity(type, id) {
  const entity = findEntity(type, id);
  if (!entity || !confirm(`Delete ${entity.name}? This action is recorded in the audit log.`)) return;
  const plural = type === "campus"
    ? "campuses"
    : type === "broadcastTemplate"
      ? "broadcast-templates"
      : type === "calendarAccount"
        ? "calendar-accounts"
        : type === "roomGroup"
          ? "room-groups"
      : `${type}s`;
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
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const id = values.broadcastId;
  const start = new Date(values.startsAt);
  const end = values.endsAt ? new Date(values.endsAt) : null;
  const payload = {
    title: values.title,
    message: values.message,
    severity: values.severity,
    templateId: values.templateId || null,
    audibleAlert: form.elements.audibleAlert.checked,
    startsAt: start.toISOString(),
    endsAt: end?.toISOString() || null,
    centerIds: selectedValues("#broadcastCenters"),
    campusIds: selectedValues("#broadcastCampuses"),
    buildingIds: selectedValues("#broadcastBuildings"),
    roomGroupIds: selectedValues("#broadcastRoomGroups"),
    roomIds: selectedValues("#targetRooms"),
    confirm: true
  };
  const action = id ? "update this broadcast" : (start > new Date() ? "schedule this broadcast" : "publish this broadcast now");
  if (!confirm(`Confirm that you want to ${action}?`)) return;
  const status = document.querySelector("#broadcastFormStatus");
  status.textContent = "Saving broadcast...";
  try {
    await api(`/api/broadcasts${id ? `/${id}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    await load();
    resetBroadcastForm();
    status.textContent = "Broadcast saved.";
  } catch (error) {
    status.textContent = error.message;
  }
}

function resetBroadcastForm() {
  const form = document.querySelector("#broadcastForm");
  form.reset();
  form.elements.broadcastId.value = "";
  form.elements.title.value = "IMPORTANT SYSTEM OVERRIDE";
  form.elements.message.value = "ADMINISTRATIVE OVERRIDE: ACTIVE ALARM DRILL RUNNING. VACATE BUILDING ACCORDING TO DRILL PROTOCOLS.";
  form.elements.severity.value = "emergency";
  form.elements.audibleAlert.checked = true;
  form.elements.startsAt.value = localDateTimeValue(new Date());
  form.elements.endsAt.value = "";
  document.querySelector("#cancelBroadcastEdit").hidden = true;
  document.querySelector("#saveBroadcast").textContent = "Confirm & Publish";
  for (const selector of ["#broadcastCenters", "#broadcastCampuses", "#broadcastBuildings", "#broadcastRoomGroups", "#targetRooms"]) {
    Array.from(document.querySelector(selector).options).forEach(option => { option.selected = false; });
  }
}

function editBroadcast(id) {
  const item = [...(state.activeBroadcasts || []), ...(state.scheduledBroadcasts || [])].find(broadcast => broadcast.id === id);
  if (!item) return;
  const form = document.querySelector("#broadcastForm");
  form.elements.broadcastId.value = item.id;
  form.elements.templateId.value = item.templateId || "";
  form.elements.title.value = item.title;
  form.elements.message.value = item.message;
  form.elements.severity.value = item.severity;
  form.elements.audibleAlert.checked = item.audibleAlert !== false;
  form.elements.startsAt.value = localDateTimeValue(item.startsAt);
  form.elements.endsAt.value = item.endsAt ? localDateTimeValue(item.endsAt) : "";
  const selections = {
    centerIds: new Set(item.centerIds || []),
    campusIds: new Set(item.campusIds || []),
    buildingIds: new Set(item.buildingIds || []),
    roomGroupIds: new Set(item.roomGroupIds || []),
    roomIds: new Set(item.roomIds || [])
  };
  for (const [name, values] of Object.entries(selections)) {
    Array.from(form.elements[name].options).forEach(option => { option.selected = values.has(option.value); });
  }
  document.querySelector("#cancelBroadcastEdit").hidden = false;
  document.querySelector("#saveBroadcast").textContent = "Confirm & Save Changes";
  document.querySelector("#broadcastFormStatus").textContent = `Editing broadcast created by ${item.createdByName}.`;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function endBroadcast(id) {
  if (!confirm("End this broadcast now?")) return;
  await api(`/api/broadcasts/${id}/end`, { method: "POST", body: "{}" });
  await load();
}

async function cancelBroadcast(id) {
  if (!confirm("Cancel this scheduled broadcast?")) return;
  await api(`/api/broadcasts/${id}/cancel`, { method: "POST", body: "{}" });
  await load();
}

async function sendKioskRefresh(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector("#kioskRefreshStatus");
  const payload = {
    centerIds: selectedValues("#kioskRefreshCenters"),
    campusIds: selectedValues("#kioskRefreshCampuses"),
    buildingIds: selectedValues("#kioskRefreshBuildings"),
    roomGroupIds: selectedValues("#kioskRefreshRoomGroups"),
    roomIds: selectedValues("#kioskRefreshRooms"),
    command: form.elements.command.value
  };
  status.textContent = "Sending kiosk command...";
  try {
    const result = await api("/api/kiosks/refresh", { method: "POST", body: JSON.stringify(payload) });
    status.textContent = `${result.command === "reload" ? "Reload" : "Data refresh"} sent to ${result.sent} room(s).`;
  } catch (error) {
    status.textContent = error.message;
  }
}

async function approveKioskDevice(deviceId, pairingCode) {
  if (!confirm(`Approve kiosk pairing code ${pairingCode}?`)) return;
  await api(`/api/kiosk-devices/${deviceId}/approve`, {
    method: "POST",
    body: JSON.stringify({ pairingCode })
  });
  await load();
}

async function sendKioskDeviceCommand(deviceId, command) {
  await api(`/api/kiosk-devices/${deviceId}/command`, {
    method: "POST",
    body: JSON.stringify({ command })
  });
  await load();
}

async function deleteKioskDevice(deviceId) {
  if (!confirm("Remove this revoked device record? The physical kiosk can register again afterward.")) return;
  await api(`/api/kiosk-devices/${deviceId}`, { method: "DELETE" });
  await load();
}

async function revokeKioskDevice(deviceId) {
  if (!confirm("Revoke this kiosk device? Its registration token will stop working immediately.")) return;
  await api(`/api/kiosk-devices/${deviceId}/revoke`, { method: "POST", body: "{}" });
  await load();
}

async function cloneTheme(themeId) {
  const theme = await api(`/api/themes/${themeId}/clone`, { method: "POST", body: "{}" });
  await load();
  editTheme(theme.id);
}

async function cloneRole(roleId) {
  const role = await api(`/api/roles/${roleId}/clone`, { method: "POST", body: "{}" });
  await load();
  openEntityDialog("role", role.id);
}

async function saveCalendarAssignment(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const assignment = await api("/api/calendar-assignments", { method: "POST", body: JSON.stringify(values) });
  try {
    const result = await api(`/api/calendar-assignments/${assignment.id}/sync`, { method: "POST", body: "{}" });
    await load();
    alert(calendarSyncMessage("Calendar assigned and synchronized.", result));
  } catch (error) {
    await load();
    alert(`Calendar was assigned, but the first sync failed.\n\n${error.message}`);
  }
}

async function syncCalendarAssignment(assignmentId) {
  try {
    const result = await api(`/api/calendar-assignments/${assignmentId}/sync`, { method: "POST", body: "{}" });
    await load();
    alert(calendarSyncMessage("Calendar synchronized.", result));
  } catch (error) {
    await load();
    alert(error.message);
  }
}

function calendarSyncMessage(prefix, result) {
  const nextLine = result.nextEventAt
    ? `Next event: ${new Date(result.nextEventAt).toLocaleString()}`
    : "No future event was found in the next 30 days.";
  return `${prefix}\n\n${result.eventCount} total events loaded\n${result.futureEventCount} upcoming · ${result.currentEventCount} active · ${result.pastEventCount} past\n${result.displayedUpcomingEventCount} projected to signage\n${nextLine}`;
}

async function discoverCalendars(accountId) {
  try {
    const result = await api(`/api/calendar-accounts/${accountId}/discover`, { method: "POST", body: "{}" });
    await load();
    const failed = result.configured.filter(item => item.status === "error");
    const message = failed.length
      ? `${result.discoveredCount} calendars discovered. ${failed.length} configured calendar(s) could not be accessed:\n\n${failed.map(item => `${item.name}: ${item.error}`).join("\n")}`
      : `${result.discoveredCount} calendars discovered and configured calendars verified.`;
    alert(message);
  } catch (error) {
    await load();
    alert(error.message);
  }
}

async function connectCalendarOauth(accountId) {
  try {
    const result = await api(`/api/calendar-accounts/${accountId}/oauth/start`);
    window.location.href = result.authorizationUrl;
  } catch (error) {
    alert(error.message);
  }
}

async function registerCalendarWebhook(accountId, calendarId) {
  try {
    await api(`/api/calendar-accounts/${accountId}/calendars/${calendarId}/webhook`, {
      method: "POST",
      body: "{}"
    });
    await load();
    alert("Webhook enabled. Scheduled polling remains active as reconciliation.");
  } catch (error) {
    await load();
    alert(error.message);
  }
}

async function selectConflictEvent(conflictId, externalEventId) {
  await api(`/api/calendar-conflicts/${conflictId}/select`, {
    method: "POST",
    body: JSON.stringify({ externalEventId })
  });
  await load();
}

async function deleteCalendarAssignment(assignmentId) {
  if (!confirm("Remove this room calendar assignment?")) return;
  await api(`/api/calendar-assignments/${assignmentId}`, { method: "DELETE" });
  await load();
}

const themeTokenLabels = {
  availableBg: "Available Background",
  availableText: "Available Text",
  busyBg: "Busy Background",
  busyText: "Busy Text",
  warningBg: "Warning Background",
  warningText: "Warning Text",
  footerText: "Footer Text",
  ink: "General Text",
  panel: "Event Panel",
  upcomingTileBg: "Upcoming Event Tile",
  upcomingTitleText: "Upcoming Event Title",
  upcomingDetailText: "Upcoming Event Details",
  qrForeground: "QR Foreground",
  qrBackground: "QR Background",
  qrTransparent: "Transparent QR Background",
  qrSize: "QR Size (pixels)",
  qrBorder: "QR Border (pixels)",
  qrMargin: "QR Quiet-Zone Modules",
  headerFont: "Header Font",
  footerFont: "Footer Font",
  eventDetailFont: "Event Detail Font",
  upcomingFont: "Upcoming Events Font"
};
const themeTokenProperties = {
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
  qrBackground: "--qr-background",
  qrSize: "--qr-size",
  qrBorder: "--qr-border",
  headerFont: "--theme-header-font",
  footerFont: "--theme-footer-font",
  eventDetailFont: "--theme-event-detail-font",
  upcomingFont: "--theme-upcoming-font"
};
const themeColorTokens = new Set([
  "availableBg",
  "availableText",
  "busyBg",
  "busyText",
  "warningBg",
  "warningText",
  "footerText",
  "ink",
  "upcomingTitleText",
  "upcomingDetailText",
  "qrForeground",
  "qrBackground"
]);

function colorParts(value) {
  const text = String(value || "").trim();
  const shortHex = text.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("").map(part => `${part}${part}`);
    return { hex: `#${r}${g}${b}`.toLowerCase(), opacity: 1 };
  }
  const hex = text.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { hex: `#${hex[1]}`.toLowerCase(), opacity: 1 };
  const rgba = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([.\d]+))?\s*\)$/i);
  if (rgba) {
    const hexPart = value => Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, "0");
    return {
      hex: `#${hexPart(rgba[1])}${hexPart(rgba[2])}${hexPart(rgba[3])}`,
      opacity: Math.max(0, Math.min(1, Number(rgba[4] ?? 1)))
    };
  }
  return { hex: "#ffffff", opacity: 1 };
}

function rgbaValue(hex, opacity) {
  const normalized = colorParts(hex).hex.slice(1);
  const channels = [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16));
  return `rgba(${channels.join(", ")}, ${Math.max(0, Math.min(1, Number(opacity))).toFixed(2)})`;
}

function themeTokenField(key, label, value) {
  const statusColorLocked = !state.viewer.isSystemAdmin && ["availableBg", "availableText", "busyBg", "busyText", "warningBg", "warningText"].includes(key);
  if (themeColorTokens.has(key)) {
    return `<label>${escapeHtml(label)} <input name="${escapeHtml(key)}" type="color" value="${escapeHtml(colorParts(value).hex)}" ${statusColorLocked ? "disabled" : ""} />${statusColorLocked ? '<span class="subtle">System Admin controlled</span>' : ""}</label>`;
  }
  if (key === "panel" || key === "upcomingTileBg") {
    const parts = colorParts(value);
    const transparency = Math.round((1 - parts.opacity) * 20) * 5;
    const prefix = key === "panel" ? "panel" : "upcomingTile";
    return `<fieldset class="color-opacity-field">
      <legend>${escapeHtml(label)}</legend>
      <label>Color <input name="${prefix}Color" type="color" value="${escapeHtml(parts.hex)}" /></label>
      <label>Transparency <input name="${prefix}Transparency" type="range" min="0" max="100" step="5" value="${transparency}" /><output id="${prefix}TransparencyValue">${transparency}%</output></label>
    </fieldset>`;
  }
  if (key === "qrTransparent") {
    return `<label class="check-label"><input name="qrTransparent" type="checkbox" ${String(value) === "true" ? "checked" : ""} /> ${escapeHtml(label)}</label>`;
  }
  if (key === "qrSize" || key === "qrBorder" || key === "qrMargin") {
    const limits = key === "qrSize"
      ? 'min="96" max="512"'
      : key === "qrBorder"
        ? 'min="0" max="24"'
        : 'min="1" max="8"';
    return `<label>${escapeHtml(label)} <input name="${escapeHtml(key)}" type="number" ${limits} value="${escapeHtml(value || "")}" /></label>`;
  }
  return `<label>${escapeHtml(label)} <input name="${escapeHtml(key)}" value="${escapeHtml(value || "")}" /></label>`;
}

function selectedThemePreviewRoom() {
  return state.rooms.find(room => room.id === document.querySelector("#themePreviewRoom").value) || state.rooms[0];
}

function refreshThemePreview(theme) {
  const room = selectedThemePreviewRoom();
  if (!theme || !room) return;
  document.querySelector("#themePreviewTitle").textContent = `${theme.name} using ${room.name}`;
  const stateValue = document.querySelector("#themePreviewState").value || "available";
  document.querySelector("#themePreviewFrame").src = `/preview/${encodeURIComponent(room.code)}?theme=${encodeURIComponent(theme.id)}&state=${encodeURIComponent(stateValue)}`;
}

function editTheme(themeId) {
  const theme = state.themes.find(item => item.id === themeId);
  if (!theme || theme.builtIn) return;
  const form = document.querySelector("#themeEditorForm");
  form.hidden = false;
  form.elements.themeId.value = theme.id;
  form.elements.name.value = theme.name;
  form.elements.orientationMode.value = theme.orientationMode || "both";
  form.elements.published.checked = theme.published;
  form.elements.archived.checked = theme.archived;
  const backgroundPreview = document.querySelector("#themeBackgroundPreview");
  backgroundPreview.src = theme.cssTokens.backgroundImage || "";
  backgroundPreview.hidden = !theme.cssTokens.backgroundImage;
  document.querySelector("#deleteThemeBackground").disabled = !theme.cssTokens.backgroundImage;
  document.querySelector("#themeBackgroundStatus").textContent = theme.cssTokens.backgroundImage || "No background image assigned.";
  document.querySelector("#themeTokenFields").innerHTML = Object.entries(themeTokenLabels)
    .map(([key, label]) => themeTokenField(key, label, theme.cssTokens[key]))
    .join("");
  refreshThemePreview(theme);
}

async function saveTheme(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const cssTokens = {};
  for (const key of Object.keys(themeTokenLabels)) {
    if (key === "panel") cssTokens.panel = rgbaValue(values.panelColor, 1 - Number(values.panelTransparency) / 100);
    else if (key === "upcomingTileBg") cssTokens.upcomingTileBg = rgbaValue(values.upcomingTileColor, 1 - Number(values.upcomingTileTransparency) / 100);
    else if (key === "qrTransparent") cssTokens[key] = form.elements.qrTransparent.checked ? "true" : "false";
    else cssTokens[key] = values[key];
  }
  await api(`/api/themes/${values.themeId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: values.name,
      orientationMode: values.orientationMode,
      cssTokens,
      published: form.elements.published.checked,
      archived: form.elements.archived.checked
    })
  });
  await load();
  editTheme(values.themeId);
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });
}

async function uploadThemeBackground() {
  const form = document.querySelector("#themeEditorForm");
  const themeId = form.elements.themeId.value;
  const file = form.elements.backgroundImageFile.files[0];
  const status = document.querySelector("#themeBackgroundStatus");
  if (!themeId || !file) {
    status.textContent = "Select a PNG, JPEG, or WebP image first.";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    status.textContent = "Background images must be 5 MB or smaller.";
    return;
  }
  status.textContent = "Uploading background image...";
  try {
    const theme = await api(`/api/themes/${themeId}/background`, {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        data: await fileDataUrl(file)
      })
    });
    await load();
    editTheme(theme.id);
    status.textContent = "Background image uploaded.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function deleteThemeBackground() {
  const themeId = document.querySelector("#themeEditorForm").elements.themeId.value;
  if (!themeId || !confirm("Remove this theme background image?")) return;
  try {
    const theme = await api(`/api/themes/${themeId}/background`, { method: "DELETE" });
    await load();
    editTheme(theme.id);
  } catch (error) {
    document.querySelector("#themeBackgroundStatus").textContent = error.message;
  }
}

function localDateTimeValue(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function selectedValues(selector) {
  return Array.from(document.querySelector(selector).selectedOptions).map(option => option.value);
}

function resetThemeScheduleForm() {
  const form = document.querySelector("#themeScheduleForm");
  form.reset();
  form.elements.scheduleId.value = "";
  document.querySelector("#cancelThemeSchedule").hidden = true;
  document.querySelector("#themeScheduleStatus").textContent = "";
  renderThemeSchedules();
}

function editThemeSchedule(scheduleId) {
  const schedule = state.themeSchedules.find(item => item.id === scheduleId);
  if (!schedule) return;
  const form = document.querySelector("#themeScheduleForm");
  form.elements.scheduleId.value = schedule.id;
  form.elements.themeId.value = schedule.themeId;
  form.elements.startsAt.value = localDateTimeValue(schedule.startsAt);
  form.elements.endsAt.value = localDateTimeValue(schedule.endsAt);
  const selections = {
    centerIds: new Set(schedule.centerIds),
    campusIds: new Set(schedule.campusIds),
    buildingIds: new Set(schedule.buildingIds),
    roomIds: new Set(schedule.roomIds)
  };
  for (const [name, values] of Object.entries(selections)) {
    Array.from(form.elements[name].options).forEach(option => { option.selected = values.has(option.value); });
  }
  document.querySelector("#cancelThemeSchedule").hidden = false;
  document.querySelector("#themeScheduleStatus").textContent = `Editing schedule owned by ${schedule.ownerName}.`;
}

async function saveThemeSchedule(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.scheduleId.value;
  const start = new Date(form.elements.startsAt.value);
  const end = new Date(form.elements.endsAt.value);
  const status = document.querySelector("#themeScheduleStatus");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    status.textContent = "Enter valid schedule start and end times.";
    return;
  }
  const payload = {
    themeId: form.elements.themeId.value,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    centerIds: selectedValues("#scheduleCenters"),
    campusIds: selectedValues("#scheduleCampuses"),
    buildingIds: selectedValues("#scheduleBuildings"),
    roomIds: selectedValues("#scheduleRooms")
  };
  status.textContent = "Saving schedule...";
  try {
    await api(`/api/theme-schedules${id ? `/${id}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    await load();
    resetThemeScheduleForm();
    status.textContent = "Theme schedule saved.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function deleteThemeSchedule(scheduleId) {
  if (!confirm("Delete this upcoming theme schedule?")) return;
  try {
    await api(`/api/theme-schedules/${scheduleId}`, { method: "DELETE" });
    await load();
    resetThemeScheduleForm();
  } catch (error) {
    document.querySelector("#themeScheduleStatus").textContent = error.message;
  }
}

function render() {
  document.querySelector("#storageBadge").textContent = state.storageType === "postgresql-normalized" ? "PostgreSQL" : "Local JSON";
  renderSummary();
  renderDashboardFilters();
  renderDashboardRows();
  renderBroadcastTargets();
  renderKioskRefreshTargets();
  renderKioskDevices();
  renderBroadcastTemplates();
  renderBroadcastDashboard();
  renderEntityLists();
  renderThemes();
  renderThemeSchedules();
  renderUsers();
  renderEmailSettings();
  renderEmailHistory();
  renderInAppNotifications();
  renderUsersRoles();
  renderCalendars();
  renderBroadcastHistory();
  renderAudit();
  renderLoginAudit();
  renderSessions();
}

async function load() {
  const firstLoad = !state;
  state = await api("/api/state");
  render();
  if (firstLoad) {
    resetBroadcastForm();
    const requestedTab = window.location.hash.slice(1);
    const tab = requestedTab ? document.querySelector(`[data-tab="${requestedTab}"]`) : null;
    if (tab) tab.click();
    const oauthResult = new URLSearchParams(window.location.search).get("calendarOAuth");
    if (oauthResult) {
      document.querySelector("#calendarAccountList").insertAdjacentHTML(
        "beforebegin",
        `<p class="form-status">${escapeHtml(oauthResult === "connected" ? "Calendar OAuth connected successfully." : oauthResult)}</p>`
      );
    }
  }
}

document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === button.dataset.tab));
  });
});

document.querySelectorAll("[data-calendar-tab]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-calendar-tab]").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-calendar-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.calendarPanel === button.dataset.calendarTab));
  });
});

document.querySelector("#roomSearch").addEventListener("input", renderDashboardRows);
document.querySelector("#dashboardCenterFilter").addEventListener("change", renderDashboardRows);
document.querySelector("#dashboardStatusFilter").addEventListener("change", renderDashboardRows);
document.querySelector("#refreshDashboard").addEventListener("click", load);
document.querySelector("#setupTwoFactor").addEventListener("click", setupTwoFactor);
document.querySelector("#confirmTwoFactorForm").addEventListener("submit", confirmTwoFactor);
document.querySelector("#changePasswordForm").addEventListener("submit", changePassword);
document.querySelector("#logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  window.location.assign("/login");
});
document.querySelector("#refreshKioskDevices").addEventListener("click", load);
document.querySelector("#kioskDeviceSearch").addEventListener("input", renderKioskDevices);
document.querySelector("#kioskDeviceRoomFilter").addEventListener("change", renderKioskDevices);
document.querySelector("#kioskDeviceStatusFilter").addEventListener("change", renderKioskDevices);
document.querySelector("#kioskDeviceHealthFilter").addEventListener("change", renderKioskDevices);
document.querySelector("#userSearch").addEventListener("input", renderUsers);
document.querySelector("#userStatusFilter").addEventListener("change", renderUsers);
document.querySelector("#smtpForm").addEventListener("submit", saveSmtpSettings);
document.querySelector("#smtpTestForm").addEventListener("submit", testSmtp);
document.querySelector("#emailForm").addEventListener("submit", sendAdministrativeEmail);
document.querySelector("#calendarAssignmentForm").addEventListener("submit", saveCalendarAssignment);
document.querySelector("#kioskRefreshForm").addEventListener("submit", sendKioskRefresh);
document.querySelector("#calendarAssignmentAccount").addEventListener("change", renderCalendarChoices);
document.querySelector("#themePreviewRoom").addEventListener("change", () => {
  const themeId = document.querySelector("#themeEditorForm").elements.themeId.value;
  refreshThemePreview(state.themes.find(theme => theme.id === themeId));
});
document.querySelector("#themePreviewState").addEventListener("change", () => {
  const themeId = document.querySelector("#themeEditorForm").elements.themeId.value;
  refreshThemePreview(state.themes.find(theme => theme.id === themeId));
});
document.querySelector("#themeEditorForm").addEventListener("submit", saveTheme);
document.querySelector("#uploadThemeBackground").addEventListener("click", uploadThemeBackground);
document.querySelector("#deleteThemeBackground").addEventListener("click", deleteThemeBackground);
document.querySelector("#themeScheduleForm").addEventListener("submit", saveThemeSchedule);
document.querySelector("#cancelThemeSchedule").addEventListener("click", resetThemeScheduleForm);
document.querySelector("#themeEditorForm").addEventListener("input", event => {
  let tokenName = event.target.name;
  let value = event.target.value;
  if (tokenName === "panelColor" || tokenName === "panelTransparency") {
    tokenName = "panel";
    const form = event.currentTarget;
    value = rgbaValue(form.elements.panelColor.value, 1 - Number(form.elements.panelTransparency.value) / 100);
    document.querySelector("#panelTransparencyValue").textContent = `${Math.round(Number(form.elements.panelTransparency.value))}%`;
  } else if (tokenName === "upcomingTileColor" || tokenName === "upcomingTileTransparency") {
    tokenName = "upcomingTileBg";
    const form = event.currentTarget;
    value = rgbaValue(form.elements.upcomingTileColor.value, 1 - Number(form.elements.upcomingTileTransparency.value) / 100);
    document.querySelector("#upcomingTileTransparencyValue").textContent = `${Math.round(Number(form.elements.upcomingTileTransparency.value))}%`;
  } else if (tokenName === "qrTransparent") {
    tokenName = "qrBackground";
    value = event.target.checked
      ? "transparent"
      : event.currentTarget.elements.qrBackground.value || "#ffffff";
  }
  const property = themeTokenProperties[tokenName];
  const kiosk = document.querySelector("#themePreviewFrame").contentDocument?.querySelector("#kiosk");
  if (property && kiosk) kiosk.style.setProperty(
    property,
    tokenName === "qrSize" || tokenName === "qrBorder" ? `${value}px` : value
  );
});
document.querySelector("#broadcastForm").addEventListener("submit", publishBroadcast);
document.querySelector("#broadcastTemplateSelect").addEventListener("change", event => {
  const template = state.broadcastTemplates.find(item => item.id === event.target.value);
  if (!template) return;
  const form = document.querySelector("#broadcastForm");
  form.elements.title.value = template.title;
  form.elements.message.value = template.message;
  form.elements.severity.value = template.severity;
  form.elements.audibleAlert.checked = template.audibleAlert !== false;
});
document.querySelector("#cancelBroadcastEdit").addEventListener("click", resetBroadcastForm);
document.querySelector("#closeDialog").addEventListener("click", () => entityDialog.close());
document.querySelector("#cancelDialog").addEventListener("click", () => entityDialog.close());
document.querySelector("#closeConflictDialog").addEventListener("click", () => conflictDialog.close());
document.querySelector("#closePasswordDialog").addEventListener("click", () => passwordDialog.close());
document.querySelector("#cancelPasswordDialog").addEventListener("click", () => passwordDialog.close());
adminPasswordForm.addEventListener("submit", setUserPassword);
conflictActionForm.addEventListener("change", event => {
  if (event.target.name === "selectedExternalEventId") updateConflictActionAvailability();
});
conflictActionForm.addEventListener("submit", event => event.preventDefault());
entityForm.addEventListener("submit", saveEntity);
entityForm.addEventListener("change", event => {
  if (event.target.name === "centerId" || event.target.name === "campusId") updateRoomHierarchy(event.target.name);
  if (event.target.name === "provider") updateCalendarAuthMode();
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
  const inviteButton = event.target.closest("[data-invite-user]");
  if (inviteButton) return inviteUser(inviteButton.dataset.inviteUser);
  const setPasswordButton = event.target.closest("[data-set-user-password]");
  if (setPasswordButton) return openPasswordDialog(setPasswordButton.dataset.setUserPassword);
  const deleteFeatureGrantButton = event.target.closest("[data-delete-feature-grant]");
  if (deleteFeatureGrantButton) return deleteFeatureGrant(deleteFeatureGrantButton.dataset.deleteFeatureGrant);
  const revokeSessionButton = event.target.closest("[data-revoke-session]");
  if (revokeSessionButton) return revokeSession(revokeSessionButton.dataset.revokeSession);
  const cloneRoleButton = event.target.closest("[data-clone-role]");
  if (cloneRoleButton) return cloneRole(cloneRoleButton.dataset.cloneRole);
  const syncButton = event.target.closest("[data-sync-calendar]");
  if (syncButton) return syncCalendarAssignment(syncButton.dataset.syncCalendar);
  const discoverButton = event.target.closest("[data-discover-calendar]");
  if (discoverButton) return discoverCalendars(discoverButton.dataset.discoverCalendar);
  const connectCalendarButton = event.target.closest("[data-connect-calendar]");
  if (connectCalendarButton) return connectCalendarOauth(connectCalendarButton.dataset.connectCalendar);
  const webhookButton = event.target.closest("[data-register-webhook]");
  if (webhookButton) return registerCalendarWebhook(webhookButton.dataset.registerWebhook, webhookButton.dataset.calendarId);
  const conflictButton = event.target.closest("[data-select-conflict]");
  if (conflictButton) return selectConflictEvent(conflictButton.dataset.selectConflict, conflictButton.dataset.externalEventId);
  const reviewConflictButton = event.target.closest("[data-review-conflict]");
  if (reviewConflictButton) return reviewConflict(reviewConflictButton.dataset.reviewConflict);
  const conflictActionButton = event.target.closest("[data-conflict-action]");
  if (conflictActionButton) return applyConflictAction(conflictActionButton.dataset.conflictAction);
  const deleteAssignmentButton = event.target.closest("[data-delete-assignment]");
  if (deleteAssignmentButton) return deleteCalendarAssignment(deleteAssignmentButton.dataset.deleteAssignment);
  const editThemeButton = event.target.closest("[data-edit-theme]");
  if (editThemeButton) return editTheme(editThemeButton.dataset.editTheme);
  const editScheduleButton = event.target.closest("[data-edit-theme-schedule]");
  if (editScheduleButton) return editThemeSchedule(editScheduleButton.dataset.editThemeSchedule);
  const deleteScheduleButton = event.target.closest("[data-delete-theme-schedule]");
  if (deleteScheduleButton) return deleteThemeSchedule(deleteScheduleButton.dataset.deleteThemeSchedule);
  const editBroadcastButton = event.target.closest("[data-edit-broadcast]");
  if (editBroadcastButton) return editBroadcast(editBroadcastButton.dataset.editBroadcast);
  const endBroadcastButton = event.target.closest("[data-end-broadcast]");
  if (endBroadcastButton) return endBroadcast(endBroadcastButton.dataset.endBroadcast);
  const cancelBroadcastButton = event.target.closest("[data-cancel-broadcast]");
  if (cancelBroadcastButton) return cancelBroadcast(cancelBroadcastButton.dataset.cancelBroadcast);
  const approveDeviceButton = event.target.closest("[data-approve-device]");
  if (approveDeviceButton) return approveKioskDevice(approveDeviceButton.dataset.approveDevice, approveDeviceButton.dataset.pairingCode);
  const deviceCommandButton = event.target.closest("[data-device-command]");
  if (deviceCommandButton) return sendKioskDeviceCommand(deviceCommandButton.dataset.deviceCommand, deviceCommandButton.dataset.command);
  const reassignDeviceButton = event.target.closest("[data-reassign-device]");
  if (reassignDeviceButton) return openEntityDialog("kioskDevice", reassignDeviceButton.dataset.reassignDevice);
  const revokeDeviceButton = event.target.closest("[data-revoke-device]");
  if (revokeDeviceButton) return revokeKioskDevice(revokeDeviceButton.dataset.revokeDevice);
  const deleteDeviceButton = event.target.closest("[data-delete-device]");
  if (deleteDeviceButton) return deleteKioskDevice(deleteDeviceButton.dataset.deleteDevice);
});

document.addEventListener("change", event => {
  if (event.target.matches("[data-status-room]")) {
    setRoomStatus(event.target.dataset.statusRoom, event.target.value).catch(error => alert(error.message));
  }
});

load().catch(error => {
  document.body.insertAdjacentHTML("afterbegin", `<pre>${escapeHtml(error.message)}</pre>`);
});
