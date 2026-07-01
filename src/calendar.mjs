import dns from "node:dns/promises";
import net from "node:net";
import { GoogleAuth } from "google-auth-library";
import ical from "node-ical";
import { decryptCredential } from "./email.mjs";

function isDisallowedAddress(address) {
  const type = net.isIP(address);
  if (!type) return true;
  if (type === 4) {
    const octets = address.split(".").map(Number);
    if (octets[0] === 0) return true;
    if (octets[0] === 10) return true;
    if (octets[0] === 127) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
    if (octets[0] >= 224) return true;
    return false;
  }
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) return isDisallowedAddress(normalized.slice(7));
  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  return false;
}

async function assertPublicCalendarUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS calendar URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Public calendars require a valid HTTP or HTTPS URL.");
  }
  // Test/dev only escape hatch for exercising the sync flow against a local fixture server.
  // Never set this in production; it disables the private-network SSRF guard below.
  if (process.env.ALLOW_PRIVATE_CALENDAR_HOSTS === "true") return parsed;
  let records;
  try {
    records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve calendar host "${parsed.hostname}".`);
  }
  if (!records.length || records.some(record => isDisallowedAddress(record.address))) {
    throw new Error("This calendar URL resolves to a disallowed private or internal network address.");
  }
  return parsed;
}

function privateTitle(event) {
  const description = String(event.description || "");
  return event.privacy === "private" || /(?:private|rental) event/i.test(description)
    ? "Private Event"
    : event.title || "Untitled Event";
}

function normalizedEvent(event) {
  return {
    externalEventId: String(event.externalEventId || ""),
    title: privateTitle(event),
    organizer: String(event.organizer || ""),
    location: String(event.location || ""),
    description: String(event.description || ""),
    privacy: String(event.privacy || "public"),
    startsAt: new Date(event.startsAt).toISOString(),
    endsAt: new Date(event.endsAt).toISOString(),
    sourceUpdatedAt: event.sourceUpdatedAt ? new Date(event.sourceUpdatedAt).toISOString() : null,
    recurring: Boolean(event.recurring)
  };
}

async function googleAccessToken(account) {
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
  if (!mailbox) throw new Error("Microsoft 365 calendar requires a mailbox user ID or email.");
  const url = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendars/${encodeURIComponent(calendar.externalId)}/calendarView`);
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
  if (!account.mailbox) throw new Error("Enter a default Microsoft mailbox before discovering calendars.");
  const discovered = [];
  let nextUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(account.mailbox)}/calendars?$top=100`;
  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Microsoft Graph returned ${response.status}: ${await responseError(response)}`);
    const body = await response.json();
    discovered.push(...(body.value || []).map(item => ({
      name: item.name || item.id,
      externalId: item.id,
      mailbox: account.mailbox
    })));
    nextUrl = body["@odata.nextLink"] || "";
  }
  return { principalEmail: account.mailbox, discovered, configured: [] };
}

function icsOccurrences(item, start, end) {
  if (!item.rrule) return [{ start: item.start, end: item.end }];
  const duration = item.end.getTime() - item.start.getTime();
  return item.rrule.between(start, end, true).map(date => ({
    start: date,
    end: new Date(date.getTime() + duration)
  }));
}

async function fetchPublicUrl(calendar, start, end) {
  const validatedUrl = await assertPublicCalendarUrl(calendar.externalId);
  const response = await fetch(validatedUrl, { redirect: "error" });
  if (!response.ok) throw new Error(`Public calendar returned ${response.status}.`);
  const text = await response.text();
  if (text.length > 10 * 1024 * 1024) throw new Error("Public calendar feed is too large to process.");
  const parsed = ical.parseICS(text);
  const events = [];
  for (const item of Object.values(parsed)) {
    if (item.type !== "VEVENT" || !item.start || !item.end) continue;
    for (const occurrence of icsOccurrences(item, start, end)) {
      if (occurrence.end < start || occurrence.start > end) continue;
      events.push(normalizedEvent({
        externalEventId: `${item.uid || item.id || "event"}:${occurrence.start.toISOString()}`,
        title: item.summary,
        organizer: typeof item.organizer === "string" ? item.organizer : item.organizer?.val,
        location: item.location,
        description: item.description,
        privacy: String(item.class || "").toLowerCase() === "private" ? "private" : "public",
        startsAt: occurrence.start,
        endsAt: occurrence.end,
        recurring: Boolean(item.rrule)
      }));
    }
  }
  return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function syncCalendar(account, calendar, start, end) {
  if (account.provider === "google") return fetchGoogle(account, calendar, start, end);
  if (account.provider === "microsoft365") return fetchMicrosoft(account, calendar, start, end);
  if (account.provider === "public-url") return fetchPublicUrl(calendar, start, end);
  throw new Error(`Unsupported calendar provider: ${account.provider}`);
}

export async function inspectCalendarAccount(account) {
  if (account.provider === "google") return inspectGoogle(account);
  if (account.provider === "microsoft365") return inspectMicrosoft(account);
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
