import type {
  LeadScoutLeadRecord,
  LeadScoutOutreachDraftRecord,
  LeadScoutSuppressionRecord,
} from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { logAudit } from "./audit";
import { reserveLeadScoutDailySendSlot, sendLeadScoutEmail } from "./lead-scout-email";
import { notifyWorkspaceOwner } from "./push";

function domainFromEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

/**
 * Approves a drafted outreach email — the one human decision that unlocks
 * `sendLeadScoutOutreachDraft`. Nothing is sent here; this only moves the
 * draft/lead into the state that permits a send attempt. Atomic on both the
 * draft and the lead so a duplicate click can't approve twice.
 */
export async function approveLeadScoutOutreachDraft(
  draftId: string,
): Promise<LeadScoutOutreachDraftRecord> {
  const db = getDb();
  const draft = await db.getLeadScoutOutreachDraft(draftId);
  if (!draft) throw new Error(`Unknown outreach draft: ${draftId}`);

  const claimed = await db.claimLeadScoutOutreachDraftStatus({
    id: draftId,
    fromStatus: "draft",
    toStatus: "approved",
  });
  if (!claimed) throw new Error("This draft was already approved, rejected, or sent.");

  const updated = await db.updateLeadScoutOutreachDraft(draftId, { approvedAt: new Date() });
  await db.claimLeadScoutLeadStatus({
    id: draft.leadId,
    fromStatus: "email_drafted",
    toStatus: "approved_to_send",
  });

  await logAudit({
    workspaceId: draft.workspaceId,
    actor: "extension",
    toolLabel: "local_lead_scout.request_send_approval",
    input: { draftId },
    output: { decision: "approved" },
    status: "success",
  });
  return updated;
}

/** Rejecting a draft is final for that draft — nothing sends, and the lead
 * moves to `rejected` rather than looping back for another draft attempt
 * automatically (a human should decide to re-draft explicitly). */
export async function rejectLeadScoutOutreachDraft(
  draftId: string,
): Promise<LeadScoutOutreachDraftRecord> {
  const db = getDb();
  const draft = await db.getLeadScoutOutreachDraft(draftId);
  if (!draft) throw new Error(`Unknown outreach draft: ${draftId}`);

  const claimed = await db.claimLeadScoutOutreachDraftStatus({
    id: draftId,
    fromStatus: "draft",
    toStatus: "rejected",
  });
  if (!claimed) throw new Error("This draft was already approved, rejected, or sent.");

  await db.claimLeadScoutLeadStatus({
    id: draft.leadId,
    fromStatus: "email_drafted",
    toStatus: "rejected",
  });

  await logAudit({
    workspaceId: draft.workspaceId,
    actor: "extension",
    toolLabel: "local_lead_scout.request_send_approval",
    input: { draftId },
    output: { decision: "rejected" },
    status: "rejected",
  });
  return claimed;
}

async function countSentForCampaign(campaignId: string): Promise<number> {
  const leads = await getDb().listLeadScoutLeadsByCampaign(campaignId);
  return leads.filter((lead) => lead.status === "sent").length;
}

/**
 * Sends an approved outreach draft — the single irreversible action in this
 * whole extension. Every compliance gate lives here: campaign outreach mode,
 * no-guessed-email, suppression list, per-campaign and daily send limits,
 * and an atomic claim (draft `approved` -> `sending`) so a duplicate click
 * or a concurrent request can never send the same draft twice. On any
 * failure past the claim, both the draft and lead revert to their
 * pre-send state so the user can fix the issue and retry.
 */
export async function sendLeadScoutOutreachDraft(
  draftId: string,
): Promise<LeadScoutOutreachDraftRecord> {
  const db = getDb();
  const draft = await db.getLeadScoutOutreachDraft(draftId);
  if (!draft) throw new Error(`Unknown outreach draft: ${draftId}`);
  const lead = await db.getLeadScoutLead(draft.leadId);
  if (!lead) throw new Error(`Unknown lead: ${draft.leadId}`);
  const campaign = await db.getLeadScoutCampaign(lead.campaignId);
  if (!campaign) throw new Error(`Unknown lead scout campaign: ${lead.campaignId}`);
  const emailSettings = await db.getLeadScoutEmailSettings(lead.workspaceId);
  if (!emailSettings) throw new Error("Configure email settings before sending outreach.");

  if (campaign.outreachMode !== "review_and_send") {
    throw new Error("This campaign is in draft-only mode — sending is disabled.");
  }
  if (!lead.email) {
    throw new Error("This lead has no email address — outreach is blocked until one is supplied.");
  }
  const suppressed = await db.getLeadScoutSuppressionMatch(
    lead.workspaceId,
    lead.email,
    domainFromEmail(lead.email),
  );
  if (suppressed) {
    await db.claimLeadScoutOutreachDraftStatus({
      id: draftId,
      fromStatus: "approved",
      toStatus: "rejected",
    });
    await db.claimLeadScoutLeadStatus({
      id: lead.id,
      fromStatus: "approved_to_send",
      toStatus: "suppressed",
    });
    throw new Error(`This lead's email/domain is on the suppression list (${suppressed.reason}).`);
  }
  if (lead.status === "sent") {
    throw new Error(
      "This lead was already sent — use the explicit reset action before sending again.",
    );
  }
  const sentSoFar = await countSentForCampaign(campaign.id);
  if (sentSoFar >= emailSettings.perCampaignSendLimit) {
    throw new Error(
      `This campaign's send limit (${emailSettings.perCampaignSendLimit}) has been reached.`,
    );
  }

  const claimedDraft = await db.claimLeadScoutOutreachDraftStatus({
    id: draftId,
    fromStatus: "approved",
    toStatus: "sending",
  });
  if (!claimedDraft) throw new Error("This draft is no longer approved (already sent or reset).");
  const claimedLead = await db.claimLeadScoutLeadStatus({
    id: lead.id,
    fromStatus: "approved_to_send",
    toStatus: "sending",
  });
  if (!claimedLead) {
    // Lead moved on some other way (e.g. reset) between our reads and the
    // claim above — revert the draft claim so nothing is left half-sent.
    await db.claimLeadScoutOutreachDraftStatus({
      id: draftId,
      fromStatus: "sending",
      toStatus: "approved",
    });
    throw new Error("Lead status changed concurrently — refresh and try again.");
  }

  try {
    await reserveLeadScoutDailySendSlot(lead.workspaceId);
    await sendLeadScoutEmail(lead.workspaceId, {
      to: lead.email,
      subject: draft.subject ?? "A quick idea for your business",
      text: draft.bodyText ?? "",
      html: draft.bodyHtml ?? undefined,
    });

    const sent = await db.updateLeadScoutOutreachDraft(draftId, {
      status: "sent",
      sentAt: new Date(),
    });
    await db.claimLeadScoutLeadStatus({ id: lead.id, fromStatus: "sending", toStatus: "sent" });

    await logAudit({
      workspaceId: lead.workspaceId,
      actor: "extension",
      toolLabel: "local_lead_scout.send_email",
      input: { draftId, leadId: lead.id },
      output: { sent: true },
      status: "success",
    });
    await notifyWorkspaceOwner(lead.workspaceId, {
      title: "Outreach email sent",
      body: `${lead.businessName}: outreach email sent.`,
      url: `/workspace/${lead.workspaceId}/extensions/local-lead-scout`,
      tag: `lead-scout-send-${draftId}`,
    });
    return sent;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await db.updateLeadScoutOutreachDraft(draftId, {
      status: "failed",
      errorMessage: message,
    });
    await db.claimLeadScoutLeadStatus({
      id: lead.id,
      fromStatus: "sending",
      toStatus: "approved_to_send",
    });
    await logAudit({
      workspaceId: lead.workspaceId,
      actor: "extension",
      toolLabel: "local_lead_scout.send_email",
      input: { draftId, leadId: lead.id },
      output: message,
      status: "error",
    });
    return failed;
  }
}

/** Explicit, manual escape hatch for "email this lead again" — a sent lead
 * is otherwise permanently done (see the `lead.status === "sent"` check in
 * sendLeadScoutOutreachDraft). Resets it to `reviewed` so the whole
 * prototype -> draft -> approve -> send cycle can run again from scratch,
 * rather than resurrecting old (possibly stale) prototype/draft rows. */
export async function resetLeadScoutLeadForResend(leadId: string): Promise<LeadScoutLeadRecord> {
  const db = getDb();
  const claimed = await db.claimLeadScoutLeadStatus({
    id: leadId,
    fromStatus: "sent",
    toStatus: "reviewed",
  });
  if (!claimed) throw new Error("Only a previously-sent lead can be reset for resend.");
  await logAudit({
    workspaceId: claimed.workspaceId,
    actor: "extension",
    toolLabel: "local_lead_scout.reset_for_resend",
    input: { leadId },
    output: { status: "reviewed" },
    status: "success",
  });
  return claimed;
}

export async function addLeadScoutSuppression(input: {
  workspaceId: string;
  email?: string | null;
  domain?: string | null;
  reason: string;
}): Promise<LeadScoutSuppressionRecord> {
  if (!input.email && !input.domain) {
    throw new Error("A suppression entry needs at least an email or a domain.");
  }
  const record = await getDb().createLeadScoutSuppression(input);
  await logAudit({
    workspaceId: input.workspaceId,
    actor: "extension",
    toolLabel: "local_lead_scout.add_suppression",
    input: { email: input.email, domain: input.domain, reason: input.reason },
    output: { id: record.id },
    status: "success",
  });
  return record;
}
