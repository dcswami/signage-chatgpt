import assert from "node:assert/strict";
import { encryptCredential } from "../src/email.mjs";
import { maskPhoneNumber, publicTwilioSettings, sendSms, validPhoneNumber } from "../src/sms.mjs";

const testAccountSid = ["A", "C", "0123456789abcdef0123456789abcdef"].join("");

assert.equal(validPhoneNumber("+13125550123"), true);
assert.equal(validPhoneNumber("3125550123"), false);
assert.equal(validPhoneNumber("+1 312 555 0123"), false);
assert.equal(maskPhoneNumber("+13125550123").endsWith("0123"), true);

const settings = publicTwilioSettings({
  enabled: true,
  accountSid: testAccountSid,
  encryptedAuthToken: "encrypted-value",
  fromPhoneNumber: "+13125550123"
});
assert.equal(settings.hasAuthToken, true);
assert.equal("encryptedAuthToken" in settings, false);

process.env.CREDENTIAL_ENCRYPTION_KEY = "sms-test-encryption-key-123456789";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, `https://api.twilio.com/2010-04-01/Accounts/${testAccountSid}/Messages.json`);
  assert.match(options.headers.Authorization, /^Basic /);
  const body = new URLSearchParams(options.body);
  assert.equal(body.get("To"), "+13125550124");
  assert.equal(body.get("From"), "+13125550123");
  assert.match(body.get("Body"), /123456/);
  return new Response(JSON.stringify({
    sid: `SM${"1".repeat(32)}`,
    status: "queued",
    to: body.get("To")
  }), { status: 201, headers: { "Content-Type": "application/json" } });
};
try {
  const result = await sendSms({
    enabled: true,
    accountSid: testAccountSid,
    encryptedAuthToken: encryptCredential("test-auth-token"),
    fromPhoneNumber: "+13125550123"
  }, {
    to: "+13125550124",
    body: "Verification code: 123456"
  });
  assert.equal(result.status, "queued");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("SMS security checks passed");
