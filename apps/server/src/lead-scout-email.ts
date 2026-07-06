import type {
  LeadScoutEmailCredentials,
  LeadScoutEmailProvider,
  LeadScoutEmailSettingsRecord,
} from "@nyxel/db";
import { getDb } from "@nyxel/db";
import nodemailer from "nodemailer";
import { logAudit } from "./audit";

/**
 * Strips `credentials` before a settings row leaves the server — the client
 * only needs to know a provider is configured, not its value (same
 * convention as toClientSafeInstallation/toClientSafeMcpServer in
 * trpc/router.ts).
 */
export function toClientSafeLeadScoutEmailSettings(settings: LeadScoutEmailSettingsRecord) {
  const { credentials, ...rest } = settings;
  return {
    ...rest,
    hasCredentials: credentials !== null && Object.keys(credentials).length > 0,
  };
}
export type LeadScoutEmailSettingsSummary = ReturnType<typeof toClientSafeLeadScoutEmailSettings>;

export async function getLeadScoutEmailSettings(
  workspaceId: string,
): Promise<LeadScoutEmailSettingsRecord | null> {
  return getDb().getLeadScoutEmailSettings(workspaceId);
}

export async function upsertLeadScoutEmailSettings(
  workspaceId: string,
  input: {
    provider?: LeadScoutEmailProvider;
    fromName: string;
    fromEmail: string;
    replyTo?: string | null;
    credentials?: LeadScoutEmailCredentials | null;
    dailySendLimit?: number;
    perCampaignSendLimit?: number;
    dryRunMode?: boolean;
    legalFooter?: string | null;
    unsubscribeText?: string;
  },
): Promise<LeadScoutEmailSettingsRecord> {
  const settings = await getDb().upsertLeadScoutEmailSettings({ workspaceId, ...input });
  await logAudit({
    workspaceId,
    actor: "extension",
    toolLabel: "local_lead_scout.email_settings.update",
    input: { provider: input.provider, fromEmail: input.fromEmail, dryRunMode: input.dryRunMode },
    output: { hasCredentials: input.credentials !== undefined && input.credentials !== null },
    status: "success",
  });
  return settings;
}

function buildTransportForSmtp(credentials: LeadScoutEmailCredentials) {
  if (!credentials.host) throw new Error("SMTP settings are missing a host.");
  return nodemailer.createTransport({
    host: credentials.host,
    port: Number(credentials.port ?? 587),
    secure: credentials.secure === "true",
    auth: credentials.username
      ? { user: credentials.username, pass: credentials.password }
      : undefined,
  });
}

interface LeadScoutEmailMessage {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

async function sendViaSmtp(
  credentials: LeadScoutEmailCredentials,
  message: LeadScoutEmailMessage,
): Promise<void> {
  const transport = buildTransportForSmtp(credentials);
  await transport.sendMail(message);
}

async function sendViaResend(
  credentials: LeadScoutEmailCredentials,
  message: LeadScoutEmailMessage,
): Promise<void> {
  if (!credentials.apiKey) throw new Error("Resend settings are missing an API key.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: message.from,
      reply_to: message.replyTo,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  if (!res.ok) throw new Error(`Resend API error: HTTP ${res.status}`);
}

async function sendViaMailgun(
  credentials: LeadScoutEmailCredentials,
  message: LeadScoutEmailMessage,
): Promise<void> {
  if (!credentials.apiKey || !credentials.domain) {
    throw new Error("Mailgun settings are missing an API key or domain.");
  }
  const form = new URLSearchParams({
    from: message.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
  if (message.html) form.set("html", message.html);
  if (message.replyTo) form.set("h:Reply-To", message.replyTo);
  const res = await fetch(`https://api.mailgun.net/v3/${credentials.domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${credentials.apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!res.ok) throw new Error(`Mailgun API error: HTTP ${res.status}`);
}

/** Generic compliant API adapter placeholder — posts to a user-configured
 * webhook. Kept minimal per the extension's scope (no bespoke provider
 * integrations beyond SMTP/Resend/Mailgun). */
async function sendViaCustom(
  credentials: LeadScoutEmailCredentials,
  message: LeadScoutEmailMessage,
): Promise<void> {
  if (!credentials.webhookUrl)
    throw new Error("Custom email provider has no webhookUrl configured.");
  const res = await fetch(credentials.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(credentials.secret ? { Authorization: `Bearer ${credentials.secret}` } : {}),
    },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Custom email provider error: HTTP ${res.status}`);
}

async function dispatchByProvider(
  provider: LeadScoutEmailProvider,
  credentials: LeadScoutEmailCredentials,
  message: LeadScoutEmailMessage,
): Promise<void> {
  if (provider === "smtp") return sendViaSmtp(credentials, message);
  if (provider === "resend") return sendViaResend(credentials, message);
  if (provider === "mailgun") return sendViaMailgun(credentials, message);
  return sendViaCustom(credentials, message);
}

/**
 * Real outbound send through the workspace's configured provider — always
 * gated by dryRunMode as a defense-in-depth check (the approval-gated
 * outreach flow in lead-scout.ts is the primary gate; this is a second,
 * cheaper backstop). Body content is deliberately excluded from what's
 * logged to the audit trail (only recipient/subject), per the "never log
 * full message bodies" requirement.
 */
export async function sendLeadScoutEmail(
  workspaceId: string,
  message: { to: string; subject: string; text: string; html?: string },
): Promise<{ sent: boolean; dryRun: boolean }> {
  const settings = await getDb().getLeadScoutEmailSettings(workspaceId);
  if (!settings) throw new Error("Email settings aren't configured for this workspace yet.");

  if (settings.dryRunMode) {
    await logAudit({
      workspaceId,
      actor: "extension",
      toolLabel: "local_lead_scout.send_email",
      input: { to: message.to, subject: message.subject, dryRun: true },
      output: { sent: false, dryRun: true },
      status: "success",
    });
    return { sent: false, dryRun: true };
  }

  if (!settings.credentials && settings.provider !== "custom") {
    throw new Error(
      `${settings.provider} isn't configured — add credentials in email settings first.`,
    );
  }
  const from = `${settings.fromName} <${settings.fromEmail}>`;

  try {
    await dispatchByProvider(settings.provider, settings.credentials ?? {}, {
      from,
      replyTo: settings.replyTo ?? undefined,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    await logAudit({
      workspaceId,
      actor: "extension",
      toolLabel: "local_lead_scout.send_email",
      input: { to: message.to, subject: message.subject, dryRun: false },
      output: { sent: true },
      status: "success",
    });
    return { sent: true, dryRun: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await logAudit({
      workspaceId,
      actor: "extension",
      toolLabel: "local_lead_scout.send_email",
      input: { to: message.to, subject: message.subject, dryRun: false },
      output: { sent: false, error: errorMessage },
      status: "error",
    });
    throw err;
  }
}

export async function sendLeadScoutTestEmail(
  workspaceId: string,
  toEmail: string,
): Promise<{ sent: boolean; dryRun: boolean }> {
  const settings = await getDb().getLeadScoutEmailSettings(workspaceId);
  if (!settings) throw new Error("Email settings aren't configured for this workspace yet.");
  const footer = [settings.unsubscribeText, settings.legalFooter].filter(Boolean).join("\n\n");
  return sendLeadScoutEmail(workspaceId, {
    to: toEmail,
    subject: "Local Lead Scout — test email",
    text: `This is a test email from ${settings.fromName} confirming your Local Lead Scout email settings are working.\n\n${footer}`,
  });
}

/**
 * Lightweight connectivity check for the "test connection" action — verifies
 * credentials work without sending an actual message where the provider's
 * API supports that (SMTP handshake, Resend/Mailgun auth ping). `custom` has
 * no generic way to test a webhook without invoking it, so it's reported as
 * unsupported rather than guessed at.
 */
export async function testLeadScoutEmailConnection(
  workspaceId: string,
): Promise<{ ok: boolean; message: string }> {
  const settings = await getDb().getLeadScoutEmailSettings(workspaceId);
  if (!settings)
    return { ok: false, message: "Email settings aren't configured for this workspace yet." };
  const credentials = settings.credentials ?? {};

  try {
    if (settings.provider === "smtp") {
      await buildTransportForSmtp(credentials).verify();
    } else if (settings.provider === "resend") {
      if (!credentials.apiKey) throw new Error("Missing API key.");
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else if (settings.provider === "mailgun") {
      if (!credentials.apiKey) throw new Error("Missing API key.");
      const res = await fetch("https://api.mailgun.net/v3/domains", {
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${credentials.apiKey}`).toString("base64")}`,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else {
      return {
        ok: false,
        message: "Custom providers have no built-in connection test — send a test email instead.",
      };
    }
    await logAudit({
      workspaceId,
      actor: "extension",
      toolLabel: "local_lead_scout.email_settings.test_connection",
      input: { provider: settings.provider },
      output: { ok: true },
      status: "success",
    });
    return { ok: true, message: "Connection succeeded." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAudit({
      workspaceId,
      actor: "extension",
      toolLabel: "local_lead_scout.email_settings.test_connection",
      input: { provider: settings.provider },
      output: { ok: false, error: message },
      status: "error",
    });
    return { ok: false, message };
  }
}

/**
 * Daily send-limit enforcement — called by the approval-gated send flow
 * (lead-scout.ts) immediately before dispatching, so the counter and the
 * actual send stay consistent. Throws rather than returning false so a
 * blocked send can't be silently ignored by a caller that forgets to check
 * a boolean.
 */
export async function reserveLeadScoutDailySendSlot(workspaceId: string): Promise<void> {
  const settings = await getDb().getLeadScoutEmailSettings(workspaceId);
  if (!settings) throw new Error("Email settings aren't configured for this workspace yet.");
  const today = new Date().toISOString().slice(0, 10);
  const currentCount = settings.sendCountDate === today ? settings.sendCountToday : 0;
  if (currentCount >= settings.dailySendLimit) {
    throw new Error(`Daily send limit of ${settings.dailySendLimit} reached for this workspace.`);
  }
  await getDb().incrementLeadScoutEmailSendCount(workspaceId, today);
}
