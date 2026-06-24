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
  const select = document.querySelector("#targetRooms");
  const selected = new Set(Array.from(select.selectedOptions).map(option => option.value));
  select.innerHTML = state.rooms.map(room => `
    <option value="${escapeHtml(room.code)}" ${selected.size === 0 || selected.has(room.code) ? "selected" : ""}>
      ${escapeHtml(room.name)} - ${escapeHtml(room.buildingName)}
    </option>
  `).join("");
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
    entityItem(room, `${room.code} / ${room.buildingName} / ${room.themeName}`, "room")
  ).join("") || `<p class="empty-state">No rooms configured.</p>`;
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
        ...user.buildingIds.map(buildingName)
      ].map(escapeHtml).join(", ") || "None"}</td>
      <td><span class="feature-summary">${user.features.map(escapeHtml).join(", ") || "None"}</span></td>
      <td><div class="row-actions">
        <button type="button" class="secondary" data-edit="user" data-id="${escapeHtml(user.id)}">Edit</button>
        <button type="button" class="secondary" data-invite-user="${escapeHtml(user.id)}">Send Invite</button>
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
  return { google: "Google Calendar", microsoft365: "Microsoft 365", "public-url": "Public URL" }[provider] || provider;
}

function renderCalendars() {
  document.querySelector("#calendarAccountList").innerHTML = state.calendarAccounts.map(account => `
    <article class="entity-item">
      <div><strong>${escapeHtml(account.accountName)}</strong><span>${escapeHtml(providerLabel(account.provider))} / ${escapeHtml(account.accessLevel)} / ${account.calendars.length} calendars${account.principalEmail ? ` / ${escapeHtml(account.principalEmail)}` : ""}${account.lastSyncError ? ` / Error: ${escapeHtml(account.lastSyncError)}` : ""}</span></div>
      <div class="entity-actions">
        <button type="button" class="secondary" data-discover-calendar="${escapeHtml(account.id)}">${account.provider === "public-url" ? "Verify" : "Discover / Verify"}</button>
        <button type="button" class="secondary" data-edit="calendarAccount" data-id="${escapeHtml(account.id)}">Edit</button>
        <button type="button" class="danger-text" data-delete="calendarAccount" data-id="${escapeHtml(account.id)}">Delete</button>
      </div>
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
    return `<tr><td>${new Date(item.createdAt).toLocaleString()}</td><td>${escapeHtml(room?.name || "Unknown")}</td><td>${escapeHtml(account?.accountName || "Unknown")}</td><td><span class="status-pill email-${item.status === "success" ? "sent" : "failed"}">${escapeHtml(item.status)}</span>${item.error ? `<span class="subtle">${escapeHtml(item.error)}</span>` : ""}</td><td>${item.eventCount ?? "-"}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="empty-state">No calendar sync history yet.</td></tr>`;
}

function renderCalendarChoices() {
  const account = state.calendarAccounts.find(item => item.id === document.querySelector("#calendarAssignmentAccount").value);
  document.querySelector("#calendarAssignmentCalendar").innerHTML = optionList(account?.calendars || [], "", calendar => calendar.name);
}

function renderBroadcastHistory() {
  const panel = document.querySelector("#broadcastHistoryPanel");
  panel.hidden = !state.viewer.isSystemAdmin;
  if (!state.viewer.isSystemAdmin) return;
  document.querySelector("#broadcastHistoryRows").innerHTML = state.broadcastHistory.map(item => `
    <tr>
      <td>${new Date(item.startedAt || item.createdAt).toLocaleString()}</td>
      <td>${escapeHtml(item.createdByName || "System")}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.severity)}</td>
      <td>${item.targetRoomCodes.length}</td>
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

function fieldsFor(type, entity = {}) {
  const active = entity.active !== false;
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
        </select></label>
        <label>Access Level <select name="accessLevel">
          <option value="read-only" ${entity.accessLevel !== "writable" ? "selected" : ""}>Read-only</option>
          <option value="writable" ${entity.accessLevel === "writable" ? "selected" : ""}>Writable</option>
        </select></label>
        <label>Sync Interval (minutes) <input name="syncIntervalMinutes" type="number" min="5" value="${escapeHtml(entity.syncIntervalMinutes || 15)}" /></label>
        <label>Microsoft Tenant ID <input name="tenantId" value="${escapeHtml(entity.tenantId)}" /></label>
        <label>Microsoft Client ID <input name="clientId" value="${escapeHtml(entity.clientId)}" /></label>
        <label>Default Microsoft Mailbox <input name="mailbox" value="${escapeHtml(entity.mailbox)}" placeholder="room@example.org" /></label>
      </div>
      <label>Credential ${entity.hasCredential ? "(stored; leave blank to keep)" : ""}
        <textarea name="credential" autocomplete="off" placeholder="Google service-account JSON or Microsoft client secret"></textarea>
      </label>
      <label>Calendars <textarea name="calendarLines" placeholder="Name|Calendar ID or public URL&#10;Microsoft: Name|Calendar ID|Mailbox">${escapeHtml(calendarLines)}</textarea></label>
      <p class="help-text">Google and Microsoft accounts may be saved first, then use Discover / Verify to load accessible calendars. Google calendars must be shared with the service-account email.</p>
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
      <fieldset class="feature-fieldset"><legend>Feature Access Grants</legend>
        ${state.features.map(feature => `<label class="check-label"><input type="checkbox" name="features" value="${escapeHtml(feature)}" ${entity.features?.includes(feature) ? "checked" : ""} /> ${escapeHtml(feature)}</label>`).join("")}
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
          ${["warning", "urgent", "critical"].map(value => `<option value="${value}" ${value === severity ? "selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")}
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
  const collection = {
    center: state.centers,
    campus: state.campuses,
    building: state.buildings,
    room: state.rooms,
    user: state.users,
    broadcastTemplate: state.broadcastTemplates,
    role: state.roles,
    calendarAccount: state.calendarAccounts
  }[type];
  return collection?.find(item => item.id === id);
}

function openEntityDialog(type, id = "") {
  const entity = id ? findEntity(type, id) : {};
  const labels = { broadcastTemplate: "Broadcast Template" };
  document.querySelector("#entityDialogTitle").textContent = `${id ? "Edit" : "New"} ${labels[type] || `${type[0].toUpperCase()}${type.slice(1)}`}`;
  entityForm.elements.entityType.value = type;
  entityForm.elements.entityId.value = id;
  document.querySelector("#entityFields").innerHTML = fieldsFor(type, entity);
  if (type === "user") {
    const selectedRoles = new Set(entity.roleIds || []);
    const selectedCenters = new Set(entity.centerIds || []);
    const selectedCampuses = new Set(entity.campusIds || []);
    const selectedBuildings = new Set(entity.buildingIds || []);
    Array.from(entityForm.elements.roleIds.options).forEach(option => { option.selected = selectedRoles.has(option.value); });
    Array.from(entityForm.elements.centerIds.options).forEach(option => { option.selected = selectedCenters.has(option.value); });
    Array.from(entityForm.elements.campusIds.options).forEach(option => { option.selected = selectedCampuses.has(option.value); });
    Array.from(entityForm.elements.buildingIds.options).forEach(option => { option.selected = selectedBuildings.has(option.value); });
  }
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
  if (type === "user") {
    data.roleIds = Array.from(entityForm.elements.roleIds.selectedOptions).map(option => option.value);
    data.centerIds = Array.from(entityForm.elements.centerIds.selectedOptions).map(option => option.value);
    data.campusIds = Array.from(entityForm.elements.campusIds.selectedOptions).map(option => option.value);
    data.buildingIds = Array.from(entityForm.elements.buildingIds.selectedOptions).map(option => option.value);
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
        : `${type}s`;
    const result = await api(`/api/${endpoint}${id ? `/${id}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(data)
    });
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
  const form = new FormData(event.currentTarget);
  const targetRoomCodes = Array.from(document.querySelector("#targetRooms").selectedOptions).map(option => option.value);
  if (!targetRoomCodes.length) return alert("Select at least one target room.");
  if (!confirm("Publish this Emergency/Safety Broadcast to the selected rooms?")) return;
  await api("/api/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      title: form.get("title"),
      message: form.get("message"),
      severity: form.get("severity"),
      templateId: form.get("templateId") || null,
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
    alert(`Calendar assigned and synchronized. ${result.eventCount} events loaded.`);
  } catch (error) {
    await load();
    alert(`Calendar was assigned, but the first sync failed.\n\n${error.message}`);
  }
}

async function syncCalendarAssignment(assignmentId) {
  try {
    const result = await api(`/api/calendar-assignments/${assignmentId}/sync`, { method: "POST", body: "{}" });
    await load();
    alert(`Calendar synchronized. ${result.eventCount} events loaded.`);
  } catch (error) {
    await load();
    alert(error.message);
  }
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
  "ink"
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
  if (themeColorTokens.has(key)) {
    return `<label>${escapeHtml(label)} <input name="${escapeHtml(key)}" type="color" value="${escapeHtml(colorParts(value).hex)}" /></label>`;
  }
  if (key === "panel") {
    const parts = colorParts(value);
    const transparency = Math.round((1 - parts.opacity) * 100);
    return `<fieldset class="color-opacity-field">
      <legend>${escapeHtml(label)}</legend>
      <label>Color <input name="panelColor" type="color" value="${escapeHtml(parts.hex)}" /></label>
      <label>Transparency <input name="panelTransparency" type="range" min="0" max="100" step="5" value="${transparency}" /><output id="panelTransparencyValue">${transparency}%</output></label>
    </fieldset>`;
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
  document.querySelector("#themePreviewFrame").src = `/preview/${encodeURIComponent(room.code)}?theme=${encodeURIComponent(theme.id)}`;
}

function editTheme(themeId) {
  const theme = state.themes.find(item => item.id === themeId);
  if (!theme || theme.builtIn) return;
  const form = document.querySelector("#themeEditorForm");
  form.hidden = false;
  form.elements.themeId.value = theme.id;
  form.elements.name.value = theme.name;
  form.elements.published.checked = theme.published;
  form.elements.archived.checked = theme.archived;
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
    else cssTokens[key] = values[key];
  }
  await api(`/api/themes/${values.themeId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: values.name,
      cssTokens,
      published: form.elements.published.checked,
      archived: form.elements.archived.checked
    })
  });
  await load();
  editTheme(values.themeId);
}

function render() {
  document.querySelector("#storageBadge").textContent = state.storageType === "postgresql" ? "PostgreSQL" : "Local JSON";
  renderSummary();
  renderDashboardFilters();
  renderDashboardRows();
  renderBroadcastTargets();
  renderBroadcastTemplates();
  renderEntityLists();
  renderThemes();
  renderUsers();
  renderEmailSettings();
  renderEmailHistory();
  renderUsersRoles();
  renderCalendars();
  renderBroadcastHistory();
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
document.querySelector("#userSearch").addEventListener("input", renderUsers);
document.querySelector("#userStatusFilter").addEventListener("change", renderUsers);
document.querySelector("#smtpForm").addEventListener("submit", saveSmtpSettings);
document.querySelector("#smtpTestForm").addEventListener("submit", testSmtp);
document.querySelector("#emailForm").addEventListener("submit", sendAdministrativeEmail);
document.querySelector("#calendarAssignmentForm").addEventListener("submit", saveCalendarAssignment);
document.querySelector("#calendarAssignmentAccount").addEventListener("change", renderCalendarChoices);
document.querySelector("#themePreviewRoom").addEventListener("change", () => {
  const themeId = document.querySelector("#themeEditorForm").elements.themeId.value;
  refreshThemePreview(state.themes.find(theme => theme.id === themeId));
});
document.querySelector("#themeEditorForm").addEventListener("submit", saveTheme);
document.querySelector("#themeEditorForm").addEventListener("input", event => {
  let tokenName = event.target.name;
  let value = event.target.value;
  if (tokenName === "panelColor" || tokenName === "panelTransparency") {
    tokenName = "panel";
    const form = event.currentTarget;
    value = rgbaValue(form.elements.panelColor.value, 1 - Number(form.elements.panelTransparency.value) / 100);
    document.querySelector("#panelTransparencyValue").textContent = `${Math.round(Number(form.elements.panelTransparency.value))}%`;
  }
  const property = themeTokenProperties[tokenName];
  const kiosk = document.querySelector("#themePreviewFrame").contentDocument?.querySelector("#kiosk");
  if (property && kiosk) kiosk.style.setProperty(property, value);
});
document.querySelector("#broadcastForm").addEventListener("submit", publishBroadcast);
document.querySelector("#broadcastTemplateSelect").addEventListener("change", event => {
  const template = state.broadcastTemplates.find(item => item.id === event.target.value);
  if (!template) return;
  const form = document.querySelector("#broadcastForm");
  form.elements.title.value = template.title;
  form.elements.message.value = template.message;
  form.elements.severity.value = template.severity;
});
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
  const inviteButton = event.target.closest("[data-invite-user]");
  if (inviteButton) return inviteUser(inviteButton.dataset.inviteUser);
  const cloneRoleButton = event.target.closest("[data-clone-role]");
  if (cloneRoleButton) return cloneRole(cloneRoleButton.dataset.cloneRole);
  const syncButton = event.target.closest("[data-sync-calendar]");
  if (syncButton) return syncCalendarAssignment(syncButton.dataset.syncCalendar);
  const discoverButton = event.target.closest("[data-discover-calendar]");
  if (discoverButton) return discoverCalendars(discoverButton.dataset.discoverCalendar);
  const deleteAssignmentButton = event.target.closest("[data-delete-assignment]");
  if (deleteAssignmentButton) return deleteCalendarAssignment(deleteAssignmentButton.dataset.deleteAssignment);
  const editThemeButton = event.target.closest("[data-edit-theme]");
  if (editThemeButton) return editTheme(editThemeButton.dataset.editTheme);
});

document.addEventListener("change", event => {
  if (event.target.matches("[data-status-room]")) {
    setRoomStatus(event.target.dataset.statusRoom, event.target.value).catch(error => alert(error.message));
  }
});

load().catch(error => {
  document.body.insertAdjacentHTML("afterbegin", `<pre>${escapeHtml(error.message)}</pre>`);
});
