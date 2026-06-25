import crypto from "node:crypto";
import nodemailer from "nodemailer";

function encryptionKey() {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY || "";
  if (secret.length < 24) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must contain at least 24 characters.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptCredential(value) {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(part => part.toString("base64url")).join(".");
}

export function decryptCredential(value) {
  if (!value) return "";
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Stored credential is invalid.");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function publicEmailSettings(settings = {}) {
  return {
    enabled: Boolean(settings.enabled),
    host: settings.host || "",
    port: Number(settings.port || 587),
    secure: Boolean(settings.secure),
    username: settings.username || "",
    hasPassword: Boolean(settings.encryptedPassword),
    fromName: settings.fromName || "",
    fromEmail: settings.fromEmail || "",
    replyTo: settings.replyTo || "",
    lastTestAt: settings.lastTestAt || null,
    lastTestStatus: settings.lastTestStatus || "",
    lastTestError: settings.lastTestError || ""
  };
}

function transportFor(settings) {
  if (!settings?.host) throw new Error("SMTP host is not configured.");
  return nodemailer.createTransport({
    host: settings.host,
    port: Number(settings.port || 587),
    secure: Boolean(settings.secure),
    auth: settings.username
      ? {
          user: settings.username,
          pass: decryptCredential(settings.encryptedPassword)
        }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

export async function verifySmtp(settings) {
  await transportFor(settings).verify();
}

export async function sendEmail(settings, message) {
  if (!settings?.enabled) throw new Error("Email notifications are disabled.");
  const transporter = transportFor(settings);
  return transporter.sendMail({
    from: {
      name: settings.fromName || "Signage Management System",
      address: settings.fromEmail
    },
    replyTo: settings.replyTo || undefined,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html
  });
}
