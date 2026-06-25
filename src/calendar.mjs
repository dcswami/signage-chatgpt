import crypto from "node:crypto";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import ical from "node-ical";
import { createDAVClient } from "tsdav";
import { decryptCredential, encryptCredential } from "./email.mjs";

function privateTitle(event) {
  const description = String(event.description || "");
  return event.privacy === "private" || /(?:private|rental) event/i.test(description)
    ? "Private Event"
    : event.title || "Untitled Event";
}

function normalizedEvent(event) {
  return {
    externalEventId: String(event.externalEventId || ""),
    originalTitle: String(event.title || "Untitled Event"),
    title: privateTitle(event),
    organizer: String(event.organizer || ""),
    location: String(event.location || ""),
    description: String(event.description || ""),
    privacy: String(event.privacy || "public"),
    startsAt: new Date(event.startsAt).toISOString(),
    endsAt: new Date(event.endsAt).toISOString(),
    sourceUpdatedAt: event.sourceUpdatedAt ? new Date(event.sourceUpdatedAt).toISOString() : null,
    recurring: Boolean(event.recurring),
    sourceUrl: String(event.sourceUrl || ""),
    sourceEtag: String(event.sourceEtag || "")
  };
}

function storedCredential(account) {
  try {
    return JSON.parse(decryptCredential(account.encryptedCredential));
  } catch {
    return {};
  }
}

function storeCredential(account, value) {
  account.encryptedCredential = encryptCredential(JSON.stringify(value));
}

function oauthRedirectUrl(provider, baseUrl) {
  return `${String(baseUrl).replace(/\/+$/, "")}/api/calendar-oauth/${provider}/callback`;
}

function googleOauthClient(account, baseUrl) {
  const stored = storedCredential(account);
  const client = new OAuth2Client(
    account.clientId,
    stored.clientSecret,
    oauthRedirectUrl("google", baseUrl || account.oauthBaseUrl)
  );
  if (stored.tokens) client.setCredentials(stored.tokens);
  client.on("tokens", tokens => {
    storeCredential(account, { ...stored, tokens: { ...(stored.tokens || {}), ...tokens } });
  });
  return client;
}

async function googleAccessToken(account) {
  if (account.authMode === "oauth") {
    const client = googleOauthClient(account);
    const token = await client.getAccessToken();
    if (!token.token) throw new Error("Google OAuth did not return an access token.");
    return token.token;
  }
  const credentials = JSON.parse(decryptCredential(account.encryptedCredential));
  const auth = new GoogleAuth({
    credentials,
    scopes: account.accessLevel === "writable"
      ? ["https://www.googleapis.com/auth/calendar"]
      : ["https://www.googleapis.com/auth/calendar.readonly"]
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Google did not return an access token.");
  return token.token;
}

function googlePrincipal(account) {
  if (account.authMode === "oauth") return account.principalEmail || "the connected Google account";
  if (account.principalEmail) return account.principalEmail;
  try {
    return JSON.parse(decryptCredential(account.encryptedCredential)).client_email || "the service account";
  } catch {
    return "the service account";
  }
}

async function responseError(response) {
  const text = await response.text();
  try {
    return JSON.parse(text)?.error?.message || text;
  } catch {
    return text;
  }
}

async function googleError(response, account, calendarId = "") {
  const message = await responseError(response);
  if (response.status === 404 && calendarId) {
    return new Error(
      `Google calendar "${calendarId}" was not found or is not shared with ${googlePrincipal(account)}. `
      + "Copy the Calendar ID from Google Calendar Settings > Integrate calendar, then share that calendar with the service-account email."
    );
  }
  if (response.status === 403) {
    return new Error(`Google Calendar denied access for ${googlePrincipal(account)}: ${message}`);
  }
  return new Error(`Google Calendar returned ${response.status}: ${message}`);
}

async function googleRequest(account, url, calendarId = "") {
  const token = await googleAccessToken(account);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw await googleError(response, account, calendarId);
  return response.json();
}

async function fetchGoogle(account, calendar, start, end) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.externalId)}/events`);
  url.searchParams.set("timeMin", start.toISOString());
  url.searchParams.set("timeMax", end.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "2500");
  const items = [];
  do {
    const body = await googleRequest(account, url, calendar.externalId);
    items.push(...(body.items || []));
    if (body.nextPageToken) url.searchParams.set("pageToken", body.nextPageToken);
    else url.searchParams.delete("pageToken");
    if (!body.nextPageToken) break;
  } while (true);
  return items
    .filter(item => item.status !== "cancelled")
    .map(item => normalizedEvent({
      externalEventId: item.id,
      title: item.summary,
      organizer: item.organizer?.displayName || item.organizer?.email,
      location: item.location,
      description: item.description,
      privacy: item.visibility === "private" ? "private" : "public",
      startsAt: item.start?.dateTime || `${item.start?.date}T00:00:00Z`,
      endsAt: item.end?.dateTime || `${item.end?.date}T00:00:00Z`,
      sourceUpdatedAt: item.updated,
      recurring: Boolean(item.recurringEventId)
    }));
}

async function inspectGoogle(account) {
  const configured = [];
  for (const calendar of account.calendars || []) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.externalId)}`;
    try {
      const body = await googleRequest(account, url, calendar.externalId);
      configured.push({ calendarId: calendar.id, externalId: calendar.externalId, name: body.summary || calendar.name, status: "available" });
    } catch (error) {
      configured.push({ calendarId: calendar.id, externalId: calendar.externalId, name: calendar.name, status: "error", error: error.message });
    }
  }

  const discovered = [];
  const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  url.searchParams.set("maxResults", "250");
  url.searchParams.set("showHidden", "true");
  do {
    const body = await googleRequest(account, url);
    discovered.push(...(body.items || []).map(item => ({
      name: item.summaryOverride || item.summary || item.id,
      externalId: item.id,
      accessRole: item.accessRole || ""
    })));
    if (body.nextPageToken) url.searchParams.set("pageToken", body.nextPageToken);
    else url.searchParams.delete("pageToken");
    if (!body.nextPageToken) break;
  } while (true);
  return { principalEmail: googlePrincipal(account), discovered, configured };
}

async function microsoftAccessToken(account) {
  if (account.authMode === "oauth") {
    const stored = storedCredential(account);
    const tokens = stored.tokens || {};
    if (tokens.access_token && Number(tokens.expires_at || 0) > Date.now() + 60_000) return tokens.access_token;
    if (!tokens.refresh_token) throw new Error("Microsoft OAuth connection must be authorized again.");
    const refreshBody = new URLSearchParams({
      client_id: account.clientId,
      client_secret: stored.clientSecret || "",
      refresh_token: tokens.refresh_token,
      scope: account.accessLevel === "writable"
        ? "offline_access User.Read Calendars.ReadWrite"
        : "offline_access User.Read Calendars.Read",
      grant_type: "refresh_token"
    });
    const refreshResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(account.tenantId || "common")}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshBody
    });
    if (!refreshResponse.ok) throw new Error(`Microsoft OAuth refresh returned ${refreshResponse.status}: ${await refreshResponse.text()}`);
    const refreshed = await refreshResponse.json();
    storeCredential(account, {
      ...stored,
      tokens: {
        ...tokens,
        ...refreshed,
        refresh_token: refreshed.refresh_token || tokens.refresh_token,
        expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000
      }
    });
    return refreshed.access_token;
  }
  const secret = decryptCredential(account.encryptedCredential);
  const body = new URLSearchParams({
    client_id: account.clientId,
    client_secret: secret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(account.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) throw new Error(`Microsoft token request returned ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  return payload.access_token;
}

async function fetchMicrosoft(account, calendar, start, end) {
  const token = await microsoftAccessToken(account);
  const mailbox = calendar.mailbox || account.mailbox;
  if (account.authMode !== "oauth" && !mailbox) throw new Error("Microsoft 365 application calendars require a mailbox user ID or email.");
  const ownerPath = account.authMode === "oauth" ? "me" : `users/${encodeURIComponent(mailbox)}`;
  const url = new URL(`https://graph.microsoft.com/v1.0/${ownerPath}/calendars/${encodeURIComponent(calendar.externalId)}/calendarView`);
  url.searchParams.set("startDateTime", start.toISOString());
  url.searchParams.set("endDateTime", end.toISOString());
  url.searchParams.set("$top", "1000");
  url.searchParams.set("$orderby", "start/dateTime");
  const items = [];
  let nextUrl = url.toString();
  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"'
      }
    });
    if (!response.ok) throw new Error(`Microsoft Graph returned ${response.status}: ${await responseError(response)}`);
    const body = await response.json();
    items.push(...(body.value || []));
    nextUrl = body["@odata.nextLink"] || "";
  }
  return items.filter(item => !item.isCancelled).map(item => normalizedEvent({
    externalEventId: item.id,
    title: item.subject,
    organizer: item.organizer?.emailAddress?.name || item.organizer?.emailAddress?.address,
    location: item.location?.displayName,
    description: item.bodyPreview,
    privacy: item.sensitivity === "private" ? "private" : "public",
    startsAt: `${item.start.dateTime}${/[zZ]|[+-]\d\d:\d\d$/.test(item.start.dateTime) ? "" : "Z"}`,
    endsAt: `${item.end.dateTime}${/[zZ]|[+-]\d\d:\d\d$/.test(item.end.dateTime) ? "" : "Z"}`,
    sourceUpdatedAt: item.lastModifiedDateTime,
    recurring: item.type && item.type !== "singleInstance"
  }));
}

async function inspectMicrosoft(account) {
  const token = await microsoftAccessToken(account);
  if (account.authMode !== "oauth" && !account.mailbox) throw new Error("Enter a default Microsoft mailbox before discovering calendars.");
  const discovered = [];
  const ownerPath = account.authMode === "oauth" ? "me" : `users/${encodeURIComponent(account.mailbox)}`;
  let nextUrl = `https://graph.microsoft.com/v1.0/${ownerPath}/calendars?$top=100`;
  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Microsoft Graph returned ${response.status}: ${await responseError(response)}`);
    const body = await response.json();
    discovered.push(...(body.value || []).map(item => ({
      name: item.name || item.id,
      externalId: item.id,
      mailbox: account.authMode === "oauth" ? "" : account.mailbox
    })));
    nextUrl = body["@odata.nextLink"] || "";
  }
  let principalEmail = account.mailbox || "";
  if (account.authMode === "oauth") {
    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName,mail", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (profileResponse.ok) {
      const profile = await profileResponse.json();
      principalEmail = profile.mail || profile.userPrincipalName || profile.displayName || "";
    }
  }
  return { principalEmail, discovered, configured: [] };
}

function icsOccurrences(item, start, end) {
  if (!item.rrule) return [{ start: item.start, end: item.end, item }];
  const duration = item.end.getTime() - item.start.getTime();
  const excluded = new Set(Object.values(item.exdate || {}).map(value => new Date(value).getTime()));
  const overrides = Object.values(item.recurrences || {});
  const overridesByTime = new Map(overrides.map(override => [
    new Date(override.recurrenceid || override.start).getTime(),
    override
  ]));
  const includedOverrides = new Set();
  const occurrences = item.rrule.between(start, end, true)
    .filter(date => !excluded.has(date.getTime()))
    .map(date => {
      const override = overridesByTime.get(date.getTime());
      if (override) includedOverrides.add(override);
      return override
        ? { start: override.start, end: override.end, item: override }
        : { start: date, end: new Date(date.getTime() + duration), item };
    });
  for (const override of overrides) {
    if (includedOverrides.has(override) || !override.start || !override.end) continue;
    if (override.end < start || override.start > end) continue;
    occurrences.push({ start: override.start, end: override.end, item: override });
  }
  return occurrences.sort((left, right) => left.start - right.start);
}

async function fetchPublicUrl(calendar, start, end) {
  const parsed = await ical.async.fromURL(calendar.externalId);
  const events = [];
  for (const item of Object.values(parsed)) {
    if (item.type !== "VEVENT" || !item.start || !item.end) continue;
    for (const occurrence of icsOccurrences(item, start, end)) {
      if (occurrence.end < start || occurrence.start > end) continue;
      const occurrenceItem = occurrence.item || item;
      events.push(normalizedEvent({
        externalEventId: `${item.uid || item.id || "event"}:${occurrence.start.toISOString()}`,
        title: occurrenceItem.summary,
        organizer: typeof occurrenceItem.organizer === "string" ? occurrenceItem.organizer : occurrenceItem.organizer?.val,
        location: occurrenceItem.location,
        description: occurrenceItem.description,
        privacy: String(occurrenceItem.class || "").toLowerCase() === "private" ? "private" : "public",
        startsAt: occurrence.start,
        endsAt: occurrence.end,
        recurring: Boolean(item.rrule)
      }));
    }
  }
  return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function parseIcsData(data, start, end, source = {}) {
  const parsed = ical.sync.parseICS(String(data || ""));
  const events = [];
  for (const item of Object.values(parsed)) {
    if (item.type !== "VEVENT" || !item.start || !item.end) continue;
    for (const occurrence of icsOccurrences(item, start, end)) {
      if (occurrence.end < start || occurrence.start > end) continue;
      const occurrenceItem = occurrence.item || item;
      events.push(normalizedEvent({
        externalEventId: `${item.uid || item.id || "event"}:${occurrence.start.toISOString()}`,
        title: occurrenceItem.summary,
        organizer: typeof occurrenceItem.organizer === "string" ? occurrenceItem.organizer : occurrenceItem.organizer?.val,
        location: occurrenceItem.location,
        description: occurrenceItem.description,
        privacy: String(occurrenceItem.class || "").toLowerCase() === "private" ? "private" : "public",
        startsAt: occurrence.start,
        endsAt: occurrence.end,
        recurring: Boolean(item.rrule),
        sourceUrl: source.url,
        sourceEtag: source.etag
      }));
    }
  }
  return events;
}

async function caldavClient(account) {
  const credential = storedCredential(account);
  return createDAVClient({
    serverUrl: account.serverUrl,
    credentials: {
      username: account.username,
      password: credential.password || ""
    },
    authMethod: "Basic",
    defaultAccountType: "caldav"
  });
}

async function fetchCaldav(account, calendar, start, end) {
  const client = await caldavClient(account);
  const objects = await client.fetchCalendarObjects({
    calendar: { url: calendar.externalId },
    timeRange: { start: start.toISOString(), end: end.toISOString() },
    expand: true
  });
  return objects
    .flatMap(object => parseIcsData(object.data, start, end, { url: object.url, etag: object.etag }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

async function inspectCaldav(account) {
  const client = await caldavClient(account);
  const calendars = await client.fetchCalendars();
  return {
    principalEmail: account.username,
    discovered: calendars.map(calendar => ({
      name: typeof calendar.displayName === "string" ? calendar.displayName : calendar.url,
      externalId: calendar.url,
      components: calendar.components || []
    })),
    configured: []
  };
}

export async function syncCalendar(account, calendar, start, end) {
  if (account.provider === "google") return fetchGoogle(account, calendar, start, end);
  if (account.provider === "microsoft365") return fetchMicrosoft(account, calendar, start, end);
  if (account.provider === "caldav") return fetchCaldav(account, calendar, start, end);
  if (account.provider === "public-url") return fetchPublicUrl(calendar, start, end);
  throw new Error(`Unsupported calendar provider: ${account.provider}`);
}

export async function inspectCalendarAccount(account) {
  if (account.provider === "google") return inspectGoogle(account);
  if (account.provider === "microsoft365") return inspectMicrosoft(account);
  if (account.provider === "caldav") return inspectCaldav(account);
  if (account.provider === "public-url") {
    const now = new Date();
    const configured = [];
    for (const calendar of account.calendars || []) {
      try {
        await fetchPublicUrl(calendar, now, new Date(now.getTime() + 24 * 60 * 60 * 1000));
        configured.push({ calendarId: calendar.id, externalId: calendar.externalId, name: calendar.name, status: "available" });
      } catch (error) {
        configured.push({ calendarId: calendar.id, externalId: calendar.externalId, name: calendar.name, status: "error", error: error.message });
      }
    }
    return { principalEmail: "", discovered: [], configured };
  }
  throw new Error(`Unsupported calendar provider: ${account.provider}`);
}

export function calendarAuthorizationUrl(account, provider, baseUrl, state) {
  if (provider === "google") {
    const client = googleOauthClient(account, baseUrl);
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      state,
      scope: account.accessLevel === "writable"
        ? ["https://www.googleapis.com/auth/calendar", "openid", "email"]
        : ["https://www.googleapis.com/auth/calendar.readonly", "openid", "email"]
    });
  }
  if (provider === "microsoft365") {
    const redirectUri = oauthRedirectUrl("microsoft365", baseUrl);
    const params = new URLSearchParams({
      client_id: account.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: account.accessLevel === "writable"
        ? "offline_access User.Read Calendars.ReadWrite"
        : "offline_access User.Read Calendars.Read",
      state
    });
    return `https://login.microsoftonline.com/${encodeURIComponent(account.tenantId || "common")}/oauth2/v2.0/authorize?${params}`;
  }
  throw new Error("OAuth is available only for Google and Microsoft 365.");
}

export async function exchangeCalendarAuthorizationCode(account, provider, baseUrl, code) {
  if (provider === "google") {
    const client = googleOauthClient(account, baseUrl);
    const result = await client.getToken(code);
    const stored = storedCredential(account);
    storeCredential(account, { ...stored, tokens: result.tokens });
    account.oauthBaseUrl = baseUrl;
    return;
  }
  if (provider === "microsoft365") {
    const stored = storedCredential(account);
    const body = new URLSearchParams({
      client_id: account.clientId,
      client_secret: stored.clientSecret || "",
      code,
      redirect_uri: oauthRedirectUrl("microsoft365", baseUrl),
      grant_type: "authorization_code",
      scope: account.accessLevel === "writable"
        ? "offline_access User.Read Calendars.ReadWrite"
        : "offline_access User.Read Calendars.Read"
    });
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(account.tenantId || "common")}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) throw new Error(`Microsoft OAuth token exchange returned ${response.status}: ${await response.text()}`);
    const tokens = await response.json();
    storeCredential(account, {
      ...stored,
      tokens: {
        ...tokens,
        expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000
      }
    });
    account.oauthBaseUrl = baseUrl;
    return;
  }
  throw new Error("Unsupported OAuth provider.");
}

export async function registerCalendarWebhook(account, calendar, notificationUrl) {
  if (account.provider === "google") {
    const token = await googleAccessToken(account);
    const channelId = crypto.randomUUID();
    const channelToken = crypto.randomBytes(24).toString("hex");
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.externalId)}/events/watch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address: notificationUrl,
          token: channelToken,
          params: { ttl: "604800" }
        })
      }
    );
    if (!response.ok) throw await googleError(response, account, calendar.externalId);
    const result = await response.json();
    return {
      channelId,
      channelToken,
      resourceId: result.resourceId || "",
      expiration: result.expiration ? new Date(Number(result.expiration)).toISOString() : null
    };
  }
  if (account.provider === "microsoft365") {
    const token = await microsoftAccessToken(account);
    const mailbox = calendar.mailbox || account.mailbox;
    const ownerPath = account.authMode === "oauth" ? "me" : `users/${encodeURIComponent(mailbox)}`;
    const clientState = crypto.randomBytes(24).toString("hex");
    const response = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        changeType: "created,updated,deleted",
        notificationUrl,
        resource: `${ownerPath}/calendars/${calendar.externalId}/events`,
        expirationDateTime: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        clientState
      })
    });
    if (!response.ok) throw new Error(`Microsoft webhook registration returned ${response.status}: ${await responseError(response)}`);
    const result = await response.json();
    return {
      subscriptionId: result.id,
      clientState,
      expiration: result.expirationDateTime
    };
  }
  throw new Error("Webhooks are supported only for Google and Microsoft 365.");
}

function icsTimestamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function eventIcs(event, uid) {
  const clean = value => String(value || "").replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BAPS Signage//Calendar Sync//EN",
    "BEGIN:VEVENT",
    `UID:${clean(uid)}`,
    `DTSTAMP:${icsTimestamp(new Date())}`,
    `DTSTART:${icsTimestamp(event.startsAt)}`,
    `DTEND:${icsTimestamp(event.endsAt)}`,
    `SUMMARY:${clean(event.title)}`,
    event.description ? `DESCRIPTION:${clean(event.description)}` : "",
    event.location ? `LOCATION:${clean(event.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n");
}

export async function writeCalendarEvent(account, calendar, event, existing = null) {
  if (account.accessLevel !== "writable") throw new Error("This calendar connection is read-only.");
  if (account.provider === "google") {
    const token = await googleAccessToken(account);
    const url = existing?.externalEventId
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.externalId)}/events/${encodeURIComponent(existing.externalEventId)}`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.externalId)}/events`;
    const response = await fetch(url, {
      method: existing?.externalEventId ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: event.title,
        description: event.description || "",
        location: event.location || "",
        start: { dateTime: new Date(event.startsAt).toISOString() },
        end: { dateTime: new Date(event.endsAt).toISOString() }
      })
    });
    if (!response.ok) throw await googleError(response, account, calendar.externalId);
    return response.json();
  }
  if (account.provider === "microsoft365") {
    const token = await microsoftAccessToken(account);
    const mailbox = calendar.mailbox || account.mailbox;
    const ownerPath = account.authMode === "oauth" ? "me" : `users/${encodeURIComponent(mailbox)}`;
    const root = `https://graph.microsoft.com/v1.0/${ownerPath}/calendars/${encodeURIComponent(calendar.externalId)}/events`;
    const response = await fetch(existing?.externalEventId ? `${root}/${encodeURIComponent(existing.externalEventId)}` : root, {
      method: existing?.externalEventId ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: event.title,
        body: { contentType: "text", content: event.description || "" },
        location: { displayName: event.location || "" },
        start: { dateTime: new Date(event.startsAt).toISOString(), timeZone: "UTC" },
        end: { dateTime: new Date(event.endsAt).toISOString(), timeZone: "UTC" }
      })
    });
    if (!response.ok) throw new Error(`Microsoft event write returned ${response.status}: ${await responseError(response)}`);
    return response.json();
  }
  if (account.provider === "caldav") {
    const client = await caldavClient(account);
    const uid = existing?.externalEventId?.split(":")[0] || crypto.randomUUID();
    const data = eventIcs(event, uid);
    if (existing?.sourceUrl) {
      const response = await client.updateCalendarObject({
        calendarObject: { url: existing.sourceUrl, etag: existing.sourceEtag, data }
      });
      if (!response.ok) throw new Error(`CalDAV event update returned ${response.status}.`);
      return { id: uid };
    }
    const response = await client.createCalendarObject({
      calendar: { url: calendar.externalId },
      filename: `${uid}.ics`,
      iCalString: data
    });
    if (!response.ok) throw new Error(`CalDAV event creation returned ${response.status}.`);
    return { id: uid };
  }
  throw new Error("This provider does not support event writes.");
}

export async function deleteCalendarEvent(account, calendar, event) {
  if (account.accessLevel !== "writable") throw new Error("This calendar connection is read-only.");
  if (account.provider === "google") {
    const token = await googleAccessToken(account);
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.externalId)}/events/${encodeURIComponent(event.externalEventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok && response.status !== 404) throw await googleError(response, account, calendar.externalId);
    return;
  }
  if (account.provider === "microsoft365") {
    const token = await microsoftAccessToken(account);
    const mailbox = calendar.mailbox || account.mailbox;
    const ownerPath = account.authMode === "oauth" ? "me" : `users/${encodeURIComponent(mailbox)}`;
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/${ownerPath}/calendars/${encodeURIComponent(calendar.externalId)}/events/${encodeURIComponent(event.externalEventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok && response.status !== 404) throw new Error(`Microsoft event deletion returned ${response.status}: ${await responseError(response)}`);
    return;
  }
  if (account.provider === "caldav") {
    const client = await caldavClient(account);
    const response = await client.deleteCalendarObject({
      calendarObject: { url: event.sourceUrl, etag: event.sourceEtag, data: "" }
    });
    if (!response.ok && response.status !== 404) throw new Error(`CalDAV event deletion returned ${response.status}.`);
    return;
  }
  throw new Error("This provider does not support event deletion.");
}
