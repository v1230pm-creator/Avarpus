// Email delivery for OTP codes via Resend.
//
// Two transports:
// - RESEND_API_KEY set → call the Resend REST API directly (used when the API
//   runs outside Replit, e.g. on a VPS).
// - otherwise → the Replit Resend connector proxy. A new ReplitConnectors
//   instance is created per call — never cached, as recommended by the SDK.

import { ReplitConnectors } from "@replit/connectors-sdk";

const RESEND_API_BASE = "https://api.resend.com";

function getResendApiKey(): string | null {
  const key = process.env["RESEND_API_KEY"]?.trim();
  return key ? key : null;
}

async function postToResend(path: string, body: string): Promise<Response> {
  const apiKey = getResendApiKey();
  if (apiKey) {
    return fetch(`${RESEND_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  }
  const connectors = new ReplitConnectors();
  return connectors.proxy("resend", path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

// Sender address is driven by the MAIL_FROM env secret. Until a verified
// domain is configured in Resend, fall back to Resend's shared onboarding
// sender, which can only deliver to the Resend account owner's email.
const FALLBACK_FROM = "Avarpus <onboarding@resend.dev>";

export function getMailFrom(): string {
  return process.env["MAIL_FROM"] || FALLBACK_FROM;
}

export function isMailSenderConfigured(): boolean {
  return Boolean(process.env["MAIL_FROM"]);
}

export function warnIfMailFromUnset(): void {
  if (!process.env["MAIL_FROM"]) {
    console.warn(
      `[mailer] MAIL_FROM is not set — falling back to "${FALLBACK_FROM}". ` +
        "Emails will only be delivered to the Resend account owner. " +
        "Verify a domain in the Resend dashboard and set MAIL_FROM (see replit.md).",
    );
  }
}

export async function sendOtpEmail(
  to: string,
  code: string,
  purposeLabel: string,
  tags?: Record<string, string>,
): Promise<string | null> {
  return sendEmail(
    to,
    `${code} is your Avarpus verification code`,
    buildHtml(purposeLabel, code),
    `Your Avarpus ${purposeLabel} code is: ${code}\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.`,
    tags,
  );
}

export async function sendReadyNotification(
  to: string,
  d: {
    customerName: string;
    brand: string;
    model: string;
    ticket: string;
    balance: number;
    businessName: string;
  },
): Promise<void> {
  const amountDue = d.balance > 0 ? `₹${d.balance}` : "Nil";
  await sendEmail(
    to,
    `Your device is ready for pickup — ${d.ticket}`,
    buildReadyHtml(d, amountDue),
    `Hi ${d.customerName},\n\nGood news! Your ${d.brand} ${d.model} (ticket ${d.ticket}) is repaired and ready for pickup.\n\nAmount due on collection: ${amountDue}\n\nThank you,\n${d.businessName}`,
  );
}

export async function sendPublicRequestAlertEmail(
  to: string,
  d: {
    kindLabel: string;
    requesterName: string;
    mobile: string;
    email: string | null;
    subject: string | null;
    message: string;
  },
): Promise<void> {
  const subjectLine = d.subject?.trim()
    ? `${d.kindLabel}: ${d.subject.trim()}`
    : `New ${d.kindLabel.toLowerCase()} from ${d.requesterName}`;
  const lines = [
    `Name: ${d.requesterName}`,
    `Mobile: ${d.mobile}`,
    `Email: ${d.email || "not provided"}`,
    `Subject: ${d.subject || "not provided"}`,
    "",
    d.message,
  ];
  await sendEmail(
    to,
    subjectLine,
    buildPublicRequestHtml(d),
    `${d.kindLabel} received via avarpus.com\n\n${lines.join("\n")}\n\nReview it in the Avarpus admin console under Public Requests.`,
  );
}

function buildPublicRequestHtml(d: {
  kindLabel: string;
  requesterName: string;
  mobile: string;
  email: string | null;
  subject: string | null;
  message: string;
}): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#64748B;font-size:13px;white-space:nowrap;">${label}</td><td style="padding:4px 0;color:#F1F5F9;font-size:14px;">${escapeHtml(value)}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${d.kindLabel}</title></head>
<body style="margin:0;padding:0;font-family:sans-serif;background:#0D1528;color:#F1F5F9;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#0F172A;border-radius:16px;border:1px solid #1E293B;">
        <tr><td style="padding:28px 36px 8px;">
          <h1 style="margin:0 0 4px;font-size:20px;color:#F1F5F9;">Avarpus</h1>
          <p style="margin:0;color:#60A5FA;font-size:14px;">${d.kindLabel} received via avarpus.com</p>
        </td></tr>
        <tr><td style="padding:12px 36px 0;">
          <table cellpadding="0" cellspacing="0">
            ${row("Name", d.requesterName)}
            ${row("Mobile", d.mobile)}
            ${row("Email", d.email || "not provided")}
            ${row("Subject", d.subject || "not provided")}
          </table>
        </td></tr>
        <tr><td style="padding:20px 36px 8px;">
          <div style="background:#0B1220;border:1px solid #1E293B;border-radius:12px;padding:16px;color:#E2E8F0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(d.message)}</div>
        </td></tr>
        <tr><td style="padding:16px 36px 32px;">
          <p style="color:#64748B;font-size:12px;margin:0;">Review and respond from the Avarpus admin console under Public Requests.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendStaffApprovedEmail(
  to: string,
  name: string,
): Promise<void> {
  await sendEmail(
    to,
    "Your Avarpus account was approved",
    buildStaffDecisionHtml(
      name,
      "Account approved",
      "#22C55E",
      "Your registration has been approved. You can now sign in to Avarpus with a mobile verification code.",
    ),
    `Hi ${name},\n\nYour registration has been approved. You can now sign in to Avarpus with a mobile verification code.\n\nThank you,\nAvarpus`,
  );
}

export async function sendStaffRejectedEmail(
  to: string,
  name: string,
): Promise<void> {
  await sendEmail(
    to,
    "Your Avarpus registration was declined",
    buildStaffDecisionHtml(
      name,
      "Registration declined",
      "#F87171",
      "Unfortunately, your registration was declined and the account has been removed. If you believe this is a mistake, please contact your shop administrator.",
    ),
    `Hi ${name},\n\nUnfortunately, your registration was declined and the account has been removed. If you believe this is a mistake, please contact your shop administrator.\n\nAvarpus`,
  );
}

function buildStaffDecisionHtml(
  name: string,
  headline: string,
  headlineColor: string,
  message: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${headline}</title></head>
<body style="margin:0;padding:0;font-family:sans-serif;background:#0D1528;color:#F1F5F9;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#0F172A;border-radius:16px;border:1px solid #1E293B;">
        <tr><td style="padding:32px 40px 16px;text-align:center;">
          <h1 style="margin:0 0 8px;font-size:22px;color:#F1F5F9;">Avarpus</h1>
          <p style="margin:0;color:${headlineColor};font-size:15px;font-weight:600;">${headline}</p>
        </td></tr>
        <tr><td style="padding:8px 40px 32px;color:#CBD5E1;font-size:14px;line-height:1.6;">
          <p style="margin:0 0 12px;">Hi ${name},</p>
          <p style="margin:0;">${message}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildReadyHtml(
  d: { customerName: string; brand: string; model: string; ticket: string; businessName: string },
  amountDue: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Device Ready</title></head>
<body style="margin:0;padding:0;font-family:sans-serif;background:#0D1528;color:#F1F5F9;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#0F172A;border-radius:16px;border:1px solid #1E293B;">
        <tr><td style="padding:32px 40px 16px;text-align:center;">
          <h1 style="margin:0 0 8px;font-size:22px;color:#F1F5F9;">${d.businessName}</h1>
          <p style="margin:0;color:#22C55E;font-size:15px;font-weight:600;">Your device is ready for pickup</p>
        </td></tr>
        <tr><td style="padding:8px 40px 24px;color:#CBD5E1;font-size:14px;line-height:1.6;">
          <p style="margin:0 0 12px;">Hi ${d.customerName},</p>
          <p style="margin:0 0 12px;">Your <strong>${d.brand} ${d.model}</strong> (ticket <strong>${d.ticket}</strong>) has been repaired and is ready for collection.</p>
          <p style="margin:0;">Amount due on collection: <strong style="color:#60A5FA;">${amountDue}</strong></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildHtml(label: string, code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Avarpus OTP</title></head>
<body style="margin:0;padding:0;font-family:sans-serif;background:#0D1528;color:#F1F5F9;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#0F172A;border-radius:16px;border:1px solid #1E293B;">
        <tr><td style="padding:32px 40px 24px;text-align:center;">
          <h1 style="margin:0 0 8px;font-size:22px;color:#F1F5F9;">Avarpus</h1>
          <p style="margin:0;color:#64748B;font-size:14px;">Verification Code — ${label}</p>
        </td></tr>
        <tr><td style="padding:8px 40px 24px;text-align:center;">
          <p style="letter-spacing:14px;font-size:40px;font-weight:700;color:#60A5FA;margin:0;padding:16px 0;">${code}</p>
          <p style="color:#64748B;font-size:13px;margin:8px 0 0;">This code expires in 10 minutes.</p>
        </td></tr>
        <tr><td style="padding:16px 40px 32px;text-align:center;">
          <p style="color:#334155;font-size:12px;margin:0;">If you did not request this code, ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  tags?: Record<string, string>,
): Promise<string | null> {
  const response = await postToResend(
    "/emails",
    JSON.stringify({
      from: getMailFrom(),
      to: [to],
      subject,
      html,
      text,
      ...(tags && Object.keys(tags).length > 0
        ? {
            tags: Object.entries(tags).map(([name, value]) => ({ name, value })),
          }
        : {}),
    }),
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(`Resend API error ${response.status}: ${body}`);
  }

  const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return typeof payload?.id === "string" && payload.id.trim() ? payload.id : null;
}
