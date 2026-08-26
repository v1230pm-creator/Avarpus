import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const loginSource = await readFile(
  new URL("../src/pages/login.tsx", import.meta.url),
  "utf8",
);

test("web auth entry offers mobile OTP as the only sign-in flow", () => {
  assert.match(loginSource, /<h1>Enter your mobile number<\/h1>/);
  assert.match(loginSource, /authOtpRequest\(\{ mobile: digits \}\)/);
  assert.match(loginSource, /By continuing, you agree to receive a verification code by SMS/);
  assert.doesNotMatch(loginSource, /authLogin|authPhoneVerification|authDevice/);
  assert.doesNotMatch(
    loginSource,
    /SIM-verified|Verify with SIM|device key|SMS bridge|sign in with/i,
  );
});