import type { LeadScoutScanRunRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { logAudit } from "./audit";
import { collectNormalizedBusinesses, getLeadSourceProvider } from "./lead-scout-providers";
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
