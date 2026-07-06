import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@nyxel/db";
import { installTestDb } from "@nyxel/db/test-utils";
import { upsertLeadScoutEmailSettings } from "./lead-scout-email";
import {
  addLeadScoutSuppression,
  approveLeadScoutOutreachDraft,
  rejectLeadScoutOutreachDraft,
  resetLeadScoutLeadForResend,
  sendLeadScoutOutreachDraft,
} from "./lead-scout-send";

let ctx: Awaited<ReturnType<typeof installTestDb>>;
beforeEach(async () => {
  ctx = await installTestDb();
});
afterEach(async () => {
  await ctx.cleanup();
});

async function setupWorkspace(outreachMode: "draft_only" | "review_and_send" = "review_and_send") {
  const db = getDb();
  const user = await db.getOrCreateDemoUser();
  const workspace = await db.createWorkspace({ userId: user.id, name: "ws" });
  const ext = await db.installExtension({ workspaceId: workspace.id, key: "local-lead-scout" });
  const campaign = await db.createLeadScoutCampaign({
    workspaceId: workspace.id,
    extensionId: ext.id,
    name: "c",
    postalCode: "94103",
    provider: "manual_csv",
    outreachMode,
  });
  await upsertLeadScoutEmailSettings(workspace.id, {
    fromName: "Acme",
    fromEmail: "acme@example.com",
    dryRunMode: true,
    perCampaignSendLimit: 1,
    dailySendLimit: 10,
  });
  return { db, workspace, campaign };
}

async function makeApprovedDraft(
  db: ReturnType<typeof getDb>,
  workspaceId: string,
  campaignId: string,
  email: string | null,
) {
  const lead = await db.createLeadScoutLead({
    workspaceId,
    campaignId,
    sourceProvider: "manual_csv",
    sourceId: `row-${email ?? "none"}`,
    businessName: "Joe's Pizza",
    email,
    websiteStatus: "missing_website",
  });
  await db.claimLeadScoutLeadStatus({ id: lead.id, fromStatus: "new", toStatus: "email_drafted" });
  const draft = await db.createLeadScoutOutreachDraft({ workspaceId, leadId: lead.id });
  await db.updateLeadScoutOutreachDraft(draft.id, { subject: "Hi", bodyText: "Body" });
  return { lead, draft };
}

describe("approval-gated send flow", () => {
  test("draft-only campaigns block sending entirely", async () => {
    const { db, workspace, campaign } = await setupWorkspace("draft_only");
    const { draft } = await makeApprovedDraft(db, workspace.id, campaign.id, "lead@business.com");
    await approveLeadScoutOutreachDraft(draft.id);
    await expect(sendLeadScoutOutreachDraft(draft.id)).rejects.toThrow(/draft-only/);
  });

  test("rejected approval never sends", async () => {
    const { db, workspace, campaign } = await setupWorkspace();
    const { draft } = await makeApprovedDraft(db, workspace.id, campaign.id, "lead2@business.com");
    await rejectLeadScoutOutreachDraft(draft.id);
    await expect(sendLeadScoutOutreachDraft(draft.id)).rejects.toThrow();
  });

  test("no email on the lead blocks send (never guessed)", async () => {
    const { db, workspace, campaign } = await setupWorkspace();
    const { draft } = await makeApprovedDraft(db, workspace.id, campaign.id, null);
    await approveLeadScoutOutreachDraft(draft.id);
    await expect(sendLeadScoutOutreachDraft(draft.id)).rejects.toThrow(/no email/i);
  });

  test("a suppressed email/domain blocks send and marks the lead suppressed", async () => {
    const { db, workspace, campaign } = await setupWorkspace();
    await addLeadScoutSuppression({
      workspaceId: workspace.id,
      email: "blocked@business.com",
      reason: "opted out",
    });
    const { lead, draft } = await makeApprovedDraft(
      db,
      workspace.id,
      campaign.id,
      "blocked@business.com",
    );
    await approveLeadScoutOutreachDraft(draft.id);
    await expect(sendLeadScoutOutreachDraft(draft.id)).rejects.toThrow(/suppression/);

    const leadAfter = await db.getLeadScoutLead(lead.id);
    expect(leadAfter?.status).toBe("suppressed");
  });

  test("send succeeds once; duplicate send is blocked; explicit reset allows resend", async () => {
    const { db, workspace, campaign } = await setupWorkspace();
    const { lead, draft } = await makeApprovedDraft(
      db,
      workspace.id,
      campaign.id,
      "good@business.com",
    );
    await approveLeadScoutOutreachDraft(draft.id);
    const sent = await sendLeadScoutOutreachDraft(draft.id);
    expect(sent.status).toBe("sent");

    const leadAfter = await db.getLeadScoutLead(lead.id);
    expect(leadAfter?.status).toBe("sent");

    // Duplicate send attempt on the same (already-sent) draft is rejected.
    await expect(sendLeadScoutOutreachDraft(draft.id)).rejects.toThrow();

    // An explicit reset is required before the lead can be emailed again.
    const reset = await resetLeadScoutLeadForResend(lead.id);
    expect(reset.status).toBe("reviewed");
    await expect(resetLeadScoutLeadForResend(lead.id)).rejects.toThrow();
  });

  test("per-campaign send limit is enforced", async () => {
    const { db, workspace, campaign } = await setupWorkspace();
    const first = await makeApprovedDraft(db, workspace.id, campaign.id, "first@business.com");
    await approveLeadScoutOutreachDraft(first.draft.id);
    await sendLeadScoutOutreachDraft(first.draft.id);

    const second = await makeApprovedDraft(db, workspace.id, campaign.id, "second@business.com");
    await approveLeadScoutOutreachDraft(second.draft.id);
    await expect(sendLeadScoutOutreachDraft(second.draft.id)).rejects.toThrow(/send limit/);
  });
});
