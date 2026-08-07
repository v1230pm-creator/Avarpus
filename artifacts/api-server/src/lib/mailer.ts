// Email delivery for OTP codes via Resend (Replit connector).
// A new ReplitConnectors instance is created per call — never cached, as
// recommended by the connector SDK.

import { ReplitConnectors } from "@replit/connectors-sdk";

export async function sendOtpEmail(
  to: string,
  code: string,
  purposeLabel: string,
): Promise<void> {
  await sendEmail(
    to,
    `${code} is your VMC Electronic verification code`,
    buildHtml(purposeLabel, code),
    `Your VMC Electronic BMS ${purposeLabel} code is: ${code}\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.`,
  );
}

function buildHtml(label: string, code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>VMC Electronic OTP</title></head>
<body style="margin:0;padding:0;font-family:sans-serif;background:#0D1528;color:#F1F5F9;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#0F172A;border-radius:16px;border:1px solid #1E293B;">
        <tr><td style="padding:32px 40px 24px;text-align:center;">
          <h1 style="margin:0 0 8px;font-size:22px;color:#F1F5F9;">VMC Electronic BMS</h1>
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
): Promise<void> {
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env["MAIL_FROM"] ?? "VMC Electronic BMS <noreply@vmcelectronic.com>",
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(`Resend API error ${response.status}: ${body}`);
  }
}
