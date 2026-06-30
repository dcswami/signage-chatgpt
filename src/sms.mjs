import { decryptCredential } from "./email.mjs";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function validPhoneNumber(value) {
  return E164_PATTERN.test(String(value || "").trim());
}

export function maskPhoneNumber(value) {
  const phone = String(value || "").trim();
  if (!phone) return "";
  return `${phone.slice(0, Math.min(3, phone.length - 4))}${"*".repeat(Math.max(0, phone.length - 7))}${phone.slice(-4)}`;
}

export function publicTwilioSettings(settings = {}) {
  return {
    enabled: Boolean(settings.enabled),
    accountSid: settings.accountSid || "",
    hasAuthToken: Boolean(settings.encryptedAuthToken),
    fromPhoneNumber: settings.fromPhoneNumber || "",
    lastTestAt: settings.lastTestAt || null,
    lastTestStatus: settings.lastTestStatus || "",
    lastTestError: settings.lastTestError || ""
  };
}

export async function sendSms(settings, { to, body }) {
  if (!settings?.enabled) throw new Error("Twilio SMS is disabled.");
  if (!/^AC[0-9a-fA-F]{32}$/.test(String(settings.accountSid || ""))) {
    throw new Error("Enter a valid Twilio Account SID.");
  }
  if (!settings.encryptedAuthToken) throw new Error("Twilio Auth Token is not configured.");
  if (!validPhoneNumber(settings.fromPhoneNumber)) throw new Error("Enter a valid Twilio sender phone number in E.164 format.");
  if (!validPhoneNumber(to)) throw new Error("Enter a valid recipient phone number in E.164 format.");
  const authToken = decryptCredential(settings.encryptedAuthToken);
  const apiBaseUrl = String(process.env.TWILIO_API_BASE_URL || "https://api.twilio.com").replace(/\/+$/, "");
  const response = await fetch(`${apiBaseUrl}/2010-04-01/Accounts/${encodeURIComponent(settings.accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${settings.accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      To: String(to).trim(),
      From: String(settings.fromPhoneNumber).trim(),
      Body: String(body || "")
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Twilio SMS failed (${response.status}): ${result.message || "Unknown Twilio error"}`);
  }
  return {
    sid: result.sid || "",
    status: result.status || "queued",
    to: result.to || to
  };
}
