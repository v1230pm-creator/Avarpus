import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const loginSource = await readFile(
  new URL("../src/pages/login.tsx", import.meta.url),
  "utf8",
);
const authSource = await readFile(new URL("../src/lib/auth.tsx", import.meta.url), "utf8");
const routesSource = await readFile(new URL("../src/routes.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../src/components/layout.tsx", import.meta.url), "utf8");
const chatsSource = await readFile(new URL("../src/pages/chats.tsx", import.meta.url), "utf8");

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

test("customer OTP sessions have only Chats and profile-safe web navigation", () => {
  assert.match(authSource, /customer: \['chat'\]/);
  assert.match(authSource, /if \(isCustomerRole\)[\s\S]*perms\.includes\(feature\)/);
  assert.match(routesSource, /if \(canAccess\("chat"\)\) return <Redirect to="\/chats" \/>/);
  assert.match(routesSource, /<ProtectedRoute component=\{ChatsPage\} feature="chat" \/>/);
  assert.match(
    layoutSource,
    /!isCustomer \|\| item\.href === "\/chats" \|\| item\.href === "\/settings"/,
  );
  assert.match(layoutSource, /isCustomer && item\.href === "\/settings" \? "Profile" : item\.label/);
  assert.match(chatsSource, /room\.kind === "customer" \|\| room\.kind === "direct"/);
});
