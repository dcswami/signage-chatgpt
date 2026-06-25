import crypto from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function fromBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const character of clean) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function toBase32(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) {
    result += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return result;
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password) {
  const value = String(password || "");
  if (value.length < 12) throw new Error("Password must be at least 12 characters.");
  const salt = crypto.randomBytes(16);
  const key = await scrypt(value, salt);
  return `scrypt$16384$8$1$${base64url(salt)}$${base64url(key)}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltValue, keyValue] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !saltValue || !keyValue) return false;
  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(keyValue, "base64url");
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ""), salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function numericCode(digits = 6) {
  const length = Math.max(4, Math.min(10, Number(digits) || 6));
  const maximum = 10 ** length;
  return String(crypto.randomInt(0, maximum)).padStart(length, "0");
}

export function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map(item => {
    const separator = item.indexOf("=");
    if (separator < 0) return ["", ""];
    return [item.slice(0, separator).trim(), decodeURIComponent(item.slice(separator + 1))];
  }).filter(([key]) => key));
}

export function sessionCookie(token, { secure = true, maxAge = 8 * 60 * 60 } = {}) {
  return [
    `signage_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
    `Max-Age=${maxAge}`
  ].filter(Boolean).join("; ");
}

export function clearSessionCookie({ secure = true } = {}) {
  return [
    "signage_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
    "Max-Age=0"
  ].filter(Boolean).join("; ");
}

export function generateTotpSecret() {
  return toBase32(crypto.randomBytes(20));
}

export function totpCode(secret, time = Date.now(), stepSeconds = 30) {
  const counter = Math.floor(time / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", fromBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

export function verifyTotp(secret, code, time = Date.now()) {
  const supplied = Buffer.from(String(code || "").replace(/\s/g, ""));
  for (const offset of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(totpCode(secret, time + offset));
    if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}

export function otpauthUri({ secret, email, issuer }) {
  const label = `${issuer}:${email}`;
  const query = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${encodeURIComponent(label)}?${query}`;
}
