import { Router, type IRouter } from "express";
import type { DbUser } from "@workspace/db";
import { AccountDeletionExecuteBody, AccountDeletionRequestOtpBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { parseBody } from "../lib/validate";
import { consumeOtp, createOtp, invalidateOtp, maskEmail } from "../lib/authUtils";
import { getHanuOtpStatus, hanuSendOtp, normaliseIndianMobile } from "../lib/hanuOtp";
import { isMailSenderConfigured, sendOtpEmail } from "../lib/mailer";
import { checkWindowLimit, retryAfterText, verifyOtpWithDurableLimit } from "../lib/rateLimit";
import {
  accountDeletionRefusal,
  executeAccountDeletion,
  previewAccountDeletion,
  type AccountDeletionScope,
} from "../lib/accountDeletion";

// ── Settings → Account → Delete Account ──────────────────────────────────────
// Every route acts on the authenticated session's own account. No identifier
// is accepted from the client; the re-authentication code is delivered to
// the mobile number (or, for legacy email-only accounts, the email) already
// on file for that account and bound to it server-side.

const router: IRouter = Router();

const OTP_PURPOSE = "account_delete";
// A person deleting their account needs a code once or twice, not a stream.
const OTP_REQUEST_MAX = 3;
const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;

type VerificationChannel =
  | { channel: "sms"; identifier: string; target: string }
  | { channel: "email"; identifier: string; target: string };

// Synthetic addresses minted for OTP-only accounts are not deliverable.
function isDeliverableEmail(email: string): boolean {
  return !!email && !email.endsWith("@standalone.local") && email.includes("@");
}

function maskMobile(local10: string): string {
  return `+91 ••••• •${local10.slice(-4)}`;
}

export function verificationChannelFor(user: DbUser): VerificationChannel | null {
  const mobile = normaliseIndianMobile(user.mobile ?? "");
  if (mobile) return { channel: "sms", identifier: `mobile:${mobile}`, target: maskMobile(mobile) };
  if (isDeliverableEmail(user.email)) {
    return { channel: "email", identifier: `email:${user.email.toLowerCase()}`, target: maskEmail(user.email) };
  }
  return null;
}

// The OTP row is bound to the account id AND the scope the user chose, so a
// code requested for "chat" cannot be replayed to delete "both".
function otpIdentifier(user: DbUser, channel: VerificationChannel, scope: AccountDeletionScope): string {
  return `${user.id}:${scope}:${channel.identifier}`;
}

router.get(
  "/auth/account/deletion",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const channel = verificationChannelFor(me);
    const preview = await previewAccountDeletion(me);
    if (!channel) {
      const reason = "This account has no verified mobile number or email to confirm deletion with.";
      preview.chat = { ...preview.chat, allowed: false, reason };
      preview.business = { ...preview.business, allowed: false, reason: preview.business.reason ?? reason };
    }
    res.json({
      verificationChannel: channel?.channel ?? "sms",
      verificationTarget: channel?.target ?? "",
      ...preview,
    });
  }),
);

router.post(
  "/auth/account/deletion/otp",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = parseBody(AccountDeletionRequestOtpBody, req, res);
    if (!body) return;
    const scope = body.scope as AccountDeletionScope;
    const refusal = accountDeletionRefusal(me, scope);
    if (refusal) {
      res.status(403).json({ message: refusal });
      return;
    }
    const channel = verificationChannelFor(me);
    if (!channel) {
      res.status(403).json({
        message: "This account has no verified mobile number or email to confirm deletion with.",
      });
      return;
    }
    if (channel.channel === "sms" && !getHanuOtpStatus().configured) {
      res.status(503).json({ message: "SMS verification is temporarily unavailable. Please try again later." });
      return;
    }
    if (channel.channel === "email" && !isMailSenderConfigured()) {
      res.status(503).json({ message: "Email verification is temporarily unavailable. Please try again later." });
      return;
    }
    const throttle = checkWindowLimit(`acctdel:otp:${me.id}`, OTP_REQUEST_MAX, OTP_REQUEST_WINDOW_MS);
    if (throttle.limited) {
      res.status(429).json({
        message: `Too many code requests. Try again in ${retryAfterText(throttle.retryAfterMs)}.`,
      });
      return;
    }
    const identifier = otpIdentifier(me, channel, scope);
    const code = await createOtp(identifier, OTP_PURPOSE);
    if (channel.channel === "sms") {
      const result = await hanuSendOtp(channel.identifier.slice("mobile:".length), code);
      if (!result.ok) {
        await invalidateOtp(identifier, OTP_PURPOSE);
        if (result.notDispatched) throttle.release();
        req.log.warn({ providerReason: result.reason }, "Account deletion OTP send failed");
        res.status(502).json({
          message: "Could not send the SMS verification code. Please try again shortly.",
        });
        return;
      }
    } else {
      try {
        await sendOtpEmail(channel.identifier.slice("email:".length), code, "account deletion", {
          avarpus_email_kind: "account_deletion_verification",
        });
      } catch (err) {
        await invalidateOtp(identifier, OTP_PURPOSE);
        req.log.warn({ err }, "Account deletion OTP email failed");
        res.status(502).json({
          message: "Could not send the email verification code. Please try again shortly.",
        });
        return;
      }
    }
    res.json({
      message: `A verification code has been sent to ${channel.target}.`,
      verificationChannel: channel.channel,
      verificationTarget: channel.target,
    });
  }),
);

router.post(
  "/auth/account/deletion",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = parseBody(AccountDeletionExecuteBody, req, res);
    if (!body) return;
    const scope = body.scope as AccountDeletionScope;
    const refusal = accountDeletionRefusal(me, scope);
    if (refusal) {
      res.status(403).json({ message: refusal });
      return;
    }
    const channel = verificationChannelFor(me);
    if (!channel) {
      res.status(403).json({
        message: "This account has no verified mobile number or email to confirm deletion with.",
      });
      return;
    }
    const identifier = otpIdentifier(me, channel, scope);
    const attempt = await verifyOtpWithDurableLimit(
      `acctdel:verify:${me.id}`,
      async () => (await consumeOtp(identifier, OTP_PURPOSE, body.code.trim())).ok,
    );
    if (attempt.status === "limited") {
      res.status(429).json({
        message: `Too many incorrect attempts. Try again in ${retryAfterText(attempt.retryAfterMs)}.`,
      });
      return;
    }
    if (attempt.status === "in_flight") {
      res.status(429).json({
        message: `Verification already in progress. Try again in ${retryAfterText(attempt.retryAfterMs)}.`,
      });
      return;
    }
    if (attempt.status !== "approved") {
      // 400, not 401: the caller's session is fine, only the re-auth code is
      // wrong. Mobile clients treat an authenticated 401 as a dead session.
      res.status(400).json({ message: "Incorrect or expired code. Please try again.", code: "OTP_INVALID" });
      return;
    }

    // From here on the code is spent. The deletion runs in one transaction;
    // if it fails the client is told so and may request a fresh code.
    const outcome = await executeAccountDeletion(me, scope, req.log);
    req.log.info({ scope, accountRemoved: outcome.accountRemoved }, "Account deletion completed");
    res.json({
      scope: outcome.scope,
      accountRemoved: outcome.accountRemoved,
      message: outcome.scope === "chat"
        ? "Your Chat Account and its data have been permanently deleted."
        : outcome.scope === "business"
          ? "Your Business Account and its data have been permanently deleted."
          : "Your Chat Account and Business Account have been permanently deleted.",
    });
  }),
);

export default router;
