import assert from "node:assert/strict";
import {
  generateTotpSecret,
  hashPassword,
  numericCode,
  otpauthUri,
  randomToken,
  tokenHash,
  totpCode,
  verifyPassword,
  verifyTotp
} from "../src/auth.mjs";

const password = "Strong-Test-Password-2026!";
const encoded = await hashPassword(password);
assert.match(encoded, /^scrypt\$/);
assert.equal(await verifyPassword(password, encoded), true);
assert.equal(await verifyPassword("wrong-password", encoded), false);

const secret = generateTotpSecret();
const now = Date.now();
const code = totpCode(secret, now);
assert.equal(verifyTotp(secret, code, now), true);
assert.equal(verifyTotp(secret, "000000", now), code === "000000");
assert.match(otpauthUri({ secret, email: "admin@example.org", issuer: "Signage" }), /^otpauth:\/\/totp\//);

const token = randomToken();
assert.equal(tokenHash(token), tokenHash(token));
assert.notEqual(tokenHash(token), tokenHash(`${token}x`));
assert.match(numericCode(), /^\d{6}$/);

console.log("Authentication security checks passed");
