import crypto from "node:crypto";

export const PHONE_VERIFICATION_TTL_MS = 5 * 60 * 1000;
export const DEVICE_AUTH_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const BRIDGE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function createPhoneChallenge(): string {
  return `AVP-${crypto.randomBytes(32).toString("hex")}`;
}

export function createOpaqueToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function hashVerificationValue(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function bridgeSigningPayload(input: {
  senderNumber: string;
  message: string;
  receivedAt: string;
  gatewayMessageId: string;
}): string {
  return [
    input.senderNumber.trim(),
    input.message.trim(),
    input.receivedAt.trim(),
    input.gatewayMessageId.trim(),
  ].join("\n");
}

export function verifyBridgeSignature(
  input: {
    senderNumber: string;
    message: string;
    receivedAt: string;
    gatewayMessageId: string;
  },
  signature: string,
): boolean {
  const secret = process.env["SMS_BRIDGE_SHARED_SECRET"]?.trim();
  if (!secret || !/^[a-f0-9]+$/i.test(signature) || signature.length !== 64) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(bridgeSigningPayload(input), "utf8")
    .digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(signature, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isBridgeTimestampFresh(receivedAt: string): boolean {
  const timestamp = Date.parse(receivedAt);
  if (!Number.isFinite(timestamp)) return false;
  const now = Date.now();
  return timestamp <= now + 60_000 && timestamp >= now - BRIDGE_CLOCK_SKEW_MS;
}

export function extractPhoneChallenge(message: string): string | null {
  const match = /^AVARPUS VERIFY (AVP-[a-f0-9]{64})$/i.exec(message.trim());
  return match?.[1] ?? null;
}

export function verifyDeviceSignature(
  publicKey: string,
  challenge: string,
  signatureBase64: string,
): boolean {
  try {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(challenge, "utf8");
    verifier.end();
    return verifier.verify(publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}