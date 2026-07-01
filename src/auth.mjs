import crypto from "node:crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const SETUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sessions = new Map();
const mfaChallenges = new Map();
const loginAttempts = new Map();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split(".");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64url");
    const expected = Buffer.from(parts[2], "base64url");
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generateSetupToken() {
  return {
    token: crypto.randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + SETUP_TOKEN_TTL_MS).toISOString()
  };
}

export function isSetupTokenValid(setupToken) {
  return Boolean(setupToken?.token) && new Date(setupToken.expiresAt).getTime() > Date.now();
}

function pruneExpired(map) {
  const now = Date.now();
  for (const [key, value] of map) {
    if (value.expiresAt <= now) map.delete(key);
  }
}

export function createSession(userId, sessionVersion) {
  pruneExpired(sessions);
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { userId, sessionVersion, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function readSession(token) {
  if (!token) return null;
  const entry = sessions.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return entry;
}

export function destroySession(token) {
  sessions.delete(token);
}

export function destroyAllSessionsForUser(userId) {
  for (const [token, entry] of sessions) {
    if (entry.userId === userId) sessions.delete(token);
  }
}

export function createMfaChallenge(userId) {
  pruneExpired(mfaChallenges);
  const token = crypto.randomBytes(24).toString("base64url");
  mfaChallenges.set(token, { userId, attempts: 0, expiresAt: Date.now() + MFA_CHALLENGE_TTL_MS });
  return token;
}

export function readMfaChallenge(token) {
  if (!token) return null;
  const entry = mfaChallenges.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    mfaChallenges.delete(token);
    return null;
  }
  return entry;
}

export function registerMfaFailure(token) {
  const entry = mfaChallenges.get(token);
  if (!entry) return;
  entry.attempts += 1;
  if (entry.attempts >= MFA_MAX_ATTEMPTS) mfaChallenges.delete(token);
}

export function consumeMfaChallenge(token) {
  mfaChallenges.delete(token);
}

export function isLoginLocked(email) {
  const entry = loginAttempts.get(email);
  if (!entry) return false;
  if (Date.now() - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(email);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

export function recordFailedLogin(email) {
  const entry = loginAttempts.get(email);
  if (!entry || Date.now() - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(email, { count: 1, firstAttemptAt: Date.now() });
    return;
  }
  entry.count += 1;
}

export function resetLoginAttempts(email) {
  loginAttempts.delete(email);
}

export function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function sessionCookieHeader(name, value, { maxAgeSeconds, secure } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  if (maxAgeSeconds === 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  else if (maxAgeSeconds) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join("; ");
}
