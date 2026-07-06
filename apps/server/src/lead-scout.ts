import type {
  AgentRecord,
  LeadScoutCampaignRecord,
  LeadScoutOutreachDraftRecord,
  LeadScoutPrototypeRecord,
  LeadScoutScanRunRecord,
} from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { listAvailableModels } from "@nyxel/model-providers";
import { executeManagedTask } from "./agent-runtime";
import { logAudit } from "./audit";
import { collectNormalizedBusinesses, getLeadSourceProvider } from "./lead-scout-providers";
import { getInstalledProvidersForWorkspace } from "./models";
import { notifyWorkspaceOwner } from "./push";

/**
 * Runs one scan for a campaign: dispatches to its configured provider,
 * reconciles results against already-ingested leads (same-source businesses
 * update in place instead of duplicating — see lead_scout_lead's unique
 * constraint), and records a scan_run with the outcome. Mirrors
 * runSeoAnalysis's shape (create run -> do the work -> update run ->
 * audit -> notify), synchronous end-to-end so both the manual tRPC mutation
 * and the scheduler poll can just await it.
 */
export async function runLeadScoutScan(
  campaignId: string,
  options?: { csvText?: string },
): Promise<LeadScoutScanRunRecord> {
  const db = getDb();
  const campaign = await db.getLeadScoutCampaign(campaignId);
  if (!campaign) throw new Error(`Unknown lead scout campaign: ${campaignId}`);

  const sourceConfig = await db.getLeadScoutSourceConfig(campaign.workspaceId, campaign.provider);
  const run = await db.createLeadScoutScanRun({
    campaignId,
    workspaceId: campaign.workspaceId,
    provider: campaign.provider,
  });

  try {
    const provider = getLeadSourceProvider(campaign.provider);
    const businesses = await collectNormalizedBusinesses(provider, {
      workspaceId: campaign.workspaceId,
      postalCode: campaign.postalCode,
      country: campaign.country,
      radiusKm: campaign.radiusKm,
      niches: campaign.niches,
      maxResults: campaign.maxResultsPerRun,
      sourceConfig,
      csvText: options?.csvText,
    });

    let newLeadCount = 0;
    let missingWebsiteCount = 0;
    for (const business of businesses) {
      if (business.confidence < campaign.minConfidence) continue;
      if (business.websiteStatus === "missing_website") missingWebsiteCount++;

      const existing = await db.getLeadScoutLeadBySource(
        campaignId,
        campaign.provider,
        business.sourceId,
      );
      if (existing) {
        await db.updateLeadScoutLead(existing.id, {
          scanRunId: run.id,
          category: business.category ?? existing.category,
          niche: business.niche ?? existing.niche,
          formattedAddress: business.formattedAddress ?? existing.formattedAddress,
          postalCode: business.postalCode ?? existing.postalCode,
          city: business.city ?? existing.city,
          phone: business.phone ?? existing.phone,
          email: business.email ?? existing.email,
          website: business.website ?? existing.website,
          websiteStatus: business.websiteStatus,
          confidence: business.confidence,
          evidenceSummary: business.evidenceSummary,
          missingReason: business.missingReason ?? null,
        });
        continue;
      }

      await db.createLeadScoutLead({
        workspaceId: campaign.workspaceId,
        campaignId,
        scanRunId: run.id,
        sourceProvider: campaign.provider,
        sourceId: business.sourceId,
        businessName: business.businessName,
        category: business.category,
        niche: business.niche,
        formattedAddress: business.formattedAddress,
        postalCode: business.postalCode,
        city: business.city,
        phone: business.phone,
        email: business.email,
        website: business.website,
        websiteStatus: business.websiteStatus,
        confidence: business.confidence,
        evidenceSummary: business.evidenceSummary,
        missingReason: business.missingReason,
      });
      newLeadCount++;
    }

    const completed = await db.updateLeadScoutScanRun(run.id, {
      status: "completed",
      resultCount: businesses.length,
      newLeadCount,
      missingWebsiteCount,
      summary: `${businesses.length} result(s) — ${newLeadCount} new, ${missingWebsiteCount} missing a website.`,
      completedAt: new Date(),
    });
    await db.updateLeadScoutCampaign(campaignId, { lastScanAt: new Date() });

    await logAudit({
      workspaceId: campaign.workspaceId,
      actor: "extension",
      toolLabel: "local_lead_scout.scan",
      input: { campaignId, provider: campaign.provider },
      output: { resultCount: businesses.length, newLeadCount, missingWebsiteCount },
      status: "success",
    });
    await notifyWorkspaceOwner(campaign.workspaceId, {
      title: "Lead scan complete",
      body: `${campaign.name}: ${newLeadCount} new lead(s), ${missingWebsiteCount} missing a website.`,
      url: `/workspace/${campaign.workspaceId}/extensions/local-lead-scout`,
      tag: `lead-scout-scan-${run.id}`,
    });

    return completed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await db.updateLeadScoutScanRun(run.id, {
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
    });
    await logAudit({
      workspaceId: campaign.workspaceId,
      actor: "extension",
      toolLabel: "local_lead_scout.scan",
      input: { campaignId, provider: campaign.provider },
      output: message,
      status: "error",
    });
    return failed;
  }
}

/** Marks a new lead reviewed — the human "I looked at this" gate that
 * requireApprovalBeforePrototype checks for before letting a prototype be
 * requested. */
export async function markLeadScoutLeadReviewed(leadId: string): Promise<void> {
  const claimed = await getDb().claimLeadScoutLeadStatus({
    id: leadId,
    fromStatus: "new",
    toStatus: "reviewed",
  });
  if (!claimed) throw new Error("Lead isn't in a reviewable state (already reviewed or moved on).");
}

async function pickDefaultModelId(workspaceId: string): Promise<string> {
  const db = getDb();
  const workspace = await db.getWorkspace(workspaceId);
  if (workspace?.defaultModelId) return workspace.defaultModelId;
  const providers = await getInstalledProvidersForWorkspace(workspaceId);
  const models = await listAvailableModels(providers);
  const [first] = models;
  if (!first) {
    throw new Error(
      "No models are installed for this workspace — add one in Settings before generating content.",
    );
  }
  return first.id;
}

const LEAD_SCOUT_AGENT_SYSTEM_PROMPT =
  "You are the Local Lead Scout content agent. You draft lightweight website concepts and short, " +
  "respectful outreach emails for local businesses that currently have no website. You never make " +
  "misleading claims, never invent a prior relationship with the business, and never use pressure " +
  "tactics. Follow the requested output format exactly.";

/** Lazily provisions (once) and thereafter reuses the campaign's content
 * agent — mirrors configureSeoFixerAgent's "auto-provision unless the user
 * pinned one" shape, but this agent needs no file tools (it only writes
 * text), so there's no sandboxed tool setup to redo per dispatch. */
async function configureLeadScoutAgent(campaign: LeadScoutCampaignRecord): Promise<AgentRecord> {
  const db = getDb();
  if (campaign.prototypeAgentId) {
    const existing = await db.getAgent(campaign.prototypeAgentId);
    if (existing) return existing;
  }
  const modelId = await pickDefaultModelId(campaign.workspaceId);
  const agent = await db.createAgent({
    workspaceId: campaign.workspaceId,
    name: `Lead Scout Content Agent — ${campaign.name}`,
    systemPrompt: LEAD_SCOUT_AGENT_SYSTEM_PROMPT,
    modelId,
    autonomyLevel: "assisted",
    toolIds: [],
    skillIds: [],
  });
  await db.updateLeadScoutCampaign(campaign.id, { prototypeAgentId: agent.id });
  return agent;
}

export function parsePrototypeOutput(output: string): {
  concept: string | null;
  heroCopy: string | null;
  sections: string[];
  callToAction: string | null;
  styleDirection: string | null;
  artifactMarkdown: string | null;
} {
  const concept = output.match(/CONCEPT:\s*(.+)/i)?.[1]?.trim() ?? null;
  const heroCopy = output.match(/HERO_COPY:\s*(.+)/i)?.[1]?.trim() ?? null;
  const sectionsRaw = output.match(/SECTIONS:\s*(.+)/i)?.[1]?.trim() ?? "";
  const sections = sectionsRaw
    ? sectionsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const callToAction = output.match(/CTA:\s*(.+)/i)?.[1]?.trim() ?? null;
  const styleDirection = output.match(/STYLE:\s*(.+)/i)?.[1]?.trim() ?? null;
  const artifactRaw = output.split(/---ARTIFACT---/i)[1]?.trim() ?? null;
  const artifactMarkdown = artifactRaw && artifactRaw.toLowerCase() !== "none" ? artifactRaw : null;
  return { concept, heroCopy, sections, callToAction, styleDirection, artifactMarkdown };
}

const PROTOTYPE_OUTPUT_FORMAT = [
  "Respond in exactly this structure (plain text):",
  "CONCEPT: <one paragraph website concept>",
  "HERO_COPY: <headline + one short subheading>",
  'SECTIONS: <comma-separated section names, e.g. "Hero, Services, Testimonials, Contact">',
  "CTA: <call to action text>",
  "STYLE: <color/style direction in a short phrase>",
  "---ARTIFACT---",
  '<an optional short markdown or simple HTML prototype, or the word "none">',
].join("\n");

/**
 * Dispatches the campaign's content agent to draft a lightweight website
 * concept for one lead — an existing NyxelOS agent/task run, not a bespoke
 * LLM pipeline (see ADR-style rationale in seo-analyzer.ts's
 * configureSeoFixerAgent). Gated on requireApprovalBeforePrototype: if set,
 * the lead must already be "reviewed" (a human looked at it) before a
 * prototype can be requested at all.
 */
export async function dispatchLeadScoutPrototype(
  leadId: string,
): Promise<LeadScoutPrototypeRecord> {
  const db = getDb();
  const lead = await db.getLeadScoutLead(leadId);
  if (!lead) throw new Error(`Unknown lead: ${leadId}`);
  const campaign = await db.getLeadScoutCampaign(lead.campaignId);
  if (!campaign) throw new Error(`Unknown lead scout campaign: ${lead.campaignId}`);

  if (campaign.requireApprovalBeforePrototype && lead.status !== "reviewed") {
    throw new Error('This lead needs to be marked "reviewed" before generating a prototype.');
  }
  if (lead.status !== "new" && lead.status !== "reviewed") {
    throw new Error(`Lead is "${lead.status}" and can't have a prototype requested right now.`);
  }
  const claimed = await db.claimLeadScoutLeadStatus({
    id: leadId,
    fromStatus: lead.status,
    toStatus: "prototype_requested",
  });
  if (!claimed) throw new Error("Lead status changed concurrently — refresh and try again.");

  const agent = await configureLeadScoutAgent(campaign);
  const instruction = [
    "Generate a lightweight website concept for a local business that currently has no website.",
    `Business: ${lead.businessName}`,
    lead.category ? `Category/niche: ${lead.category}` : null,
    lead.formattedAddress ? `Region: ${lead.formattedAddress}` : null,
    `Evidence this business has no website: ${lead.evidenceSummary ?? "none recorded"}`,
    "Target style: clean, modern, mobile-first, trustworthy for a local service business.",
    "Requested prototype type: single-page marketing site concept.",
    "",
    PROTOTYPE_OUTPUT_FORMAT,
  ]
    .filter(Boolean)
    .join("\n");

  const prototype = await db.createLeadScoutPrototype({ workspaceId: lead.workspaceId, leadId });
  const task = await db.createTask({
    workspaceId: lead.workspaceId,
    assignedAgentId: agent.id,
    title: `Generate prototype — ${lead.businessName}`,
    instruction,
    input: { leadId, prototypeId: prototype.id },
  });

  try {
    const result = await executeManagedTask({ taskId: task.id, agent, trigger: "extension" });
    const parsed = parsePrototypeOutput(result.output);
    const ready = await db.updateLeadScoutPrototype(prototype.id, {
      status: "ready",
      taskId: task.id,
      ...parsed,
    });
    await db.claimLeadScoutLeadStatus({
      id: leadId,
      fromStatus: "prototype_requested",
      toStatus: "prototype_ready",
    });
    await logAudit({
      workspaceId: lead.workspaceId,
      agentId: agent.id,
      actor: "extension",
      toolLabel: "local_lead_scout.generate_prototype",
      input: { leadId },
      output: { prototypeId: prototype.id },
      status: "success",
    });
    return ready;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await db.updateLeadScoutPrototype(prototype.id, {
      status: "failed",
      taskId: task.id,
      errorMessage: message,
    });
    // Revert to reviewed so the user can retry instead of being stuck.
    await db.claimLeadScoutLeadStatus({
      id: leadId,
      fromStatus: "prototype_requested",
      toStatus: "reviewed",
    });
    await logAudit({
      workspaceId: lead.workspaceId,
      agentId: agent.id,
      actor: "extension",
      toolLabel: "local_lead_scout.generate_prototype",
      input: { leadId },
      output: message,
      status: "error",
    });
    return failed;
  }
}

/** Requires a `ready` prototype — approving a failed/pending one makes no
 * sense, there'd be nothing reviewed. */
export async function approveLeadScoutPrototype(
  prototypeId: string,
): Promise<LeadScoutPrototypeRecord> {
  const db = getDb();
  const prototype = await db.getLeadScoutPrototype(prototypeId);
  if (!prototype) throw new Error(`Unknown prototype: ${prototypeId}`);
  if (prototype.status !== "ready") throw new Error("Only a ready prototype can be approved.");
  const approved = await db.updateLeadScoutPrototype(prototypeId, { approved: true });
  await logAudit({
    workspaceId: prototype.workspaceId,
    actor: "extension",
    toolLabel: "local_lead_scout.approve_prototype",
    input: { prototypeId },
    output: { approved: true },
    status: "success",
  });
  return approved;
}

export function parseEmailDraftOutput(output: string): { subject: string; body: string } {
  const subject = output.match(/SUBJECT:\s*(.+)/i)?.[1]?.trim() || "A quick idea for your business";
  const body = output.split(/---BODY---/i)[1]?.trim() || output.trim();
  return { subject, body };
}

/**
 * Dispatches the campaign's content agent to draft an outreach email for a
 * lead, using its approved prototype (never an unapproved one — the
 * compliance requirement that a human reviews the concept before it's
 * referenced in outreach). Sender identity and opt-out text are appended
 * programmatically from email settings after generation, rather than left
 * to the model, so they're always present regardless of what it wrote.
 */
export async function dispatchLeadScoutEmailDraft(
  leadId: string,
): Promise<LeadScoutOutreachDraftRecord> {
  const db = getDb();
  const lead = await db.getLeadScoutLead(leadId);
  if (!lead) throw new Error(`Unknown lead: ${leadId}`);
  const campaign = await db.getLeadScoutCampaign(lead.campaignId);
  if (!campaign) throw new Error(`Unknown lead scout campaign: ${lead.campaignId}`);

  const prototypes = await db.listLeadScoutPrototypesByLead(leadId);
  const prototype = prototypes.find((p) => p.approved);
  if (!prototype) throw new Error("Approve a prototype for this lead before drafting an email.");

  const emailSettings = await db.getLeadScoutEmailSettings(lead.workspaceId);
  if (!emailSettings) throw new Error("Configure email settings before drafting outreach emails.");

  if (lead.status !== "prototype_ready") {
    throw new Error(`Lead is "${lead.status}" and can't have an email drafted right now.`);
  }
  const claimed = await db.claimLeadScoutLeadStatus({
    id: leadId,
    fromStatus: "prototype_ready",
    toStatus: "email_drafted",
  });
  if (!claimed) throw new Error("Lead status changed concurrently — refresh and try again.");

  const agent = await configureLeadScoutAgent(campaign);
  const instruction = [
    "Draft a short, respectful, non-pushy cold outreach email to a local business about a website concept it might consider.",
    `Business: ${lead.businessName}`,
    `Website concept: ${prototype.concept ?? "N/A"}`,
    `Hero copy: ${prototype.heroCopy ?? "N/A"}`,
    `Call to action: ${prototype.callToAction ?? "N/A"}`,
    `Sender: ${emailSettings.fromName}`,
    "Rules: no misleading claims, no fake prior relationship, no pressure tactics, under 150 words, one clear next step.",
    "Do not include a signature or footer — those are added separately.",
    "",
    "Respond in exactly this format:",
    "SUBJECT: <subject line>",
    "---BODY---",
    "<plain text body>",
  ].join("\n");

  const draft = await db.createLeadScoutOutreachDraft({
    workspaceId: lead.workspaceId,
    leadId,
    prototypeId: prototype.id,
  });
  const task = await db.createTask({
    workspaceId: lead.workspaceId,
    assignedAgentId: agent.id,
    title: `Draft outreach email — ${lead.businessName}`,
    instruction,
    input: { leadId, draftId: draft.id },
  });

  try {
    const result = await executeManagedTask({ taskId: task.id, agent, trigger: "extension" });
    const { subject, body } = parseEmailDraftOutput(result.output);
    const footer = [emailSettings.unsubscribeText, emailSettings.legalFooter]
      .filter(Boolean)
      .join("\n\n");
    const bodyText = [body, "", `— ${emailSettings.fromName}`, footer].filter(Boolean).join("\n");

    const ready = await db.updateLeadScoutOutreachDraft(draft.id, {
      status: "draft",
      taskId: task.id,
      subject,
      bodyText,
    });
    await logAudit({
      workspaceId: lead.workspaceId,
      agentId: agent.id,
      actor: "extension",
      toolLabel: "local_lead_scout.draft_email",
      input: { leadId },
      output: { draftId: draft.id },
      status: "success",
    });
    return ready;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await db.updateLeadScoutOutreachDraft(draft.id, {
      status: "failed",
      taskId: task.id,
      errorMessage: message,
    });
    await db.claimLeadScoutLeadStatus({
      id: leadId,
      fromStatus: "email_drafted",
      toStatus: "prototype_ready",
    });
    await logAudit({
      workspaceId: lead.workspaceId,
      agentId: agent.id,
      actor: "extension",
      toolLabel: "local_lead_scout.draft_email",
      input: { leadId },
      output: message,
      status: "error",
    });
    return failed;
  }
}
