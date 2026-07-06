import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@nyxel/db";
import { installTestDb } from "@nyxel/db/test-utils";
import {
  approveLeadScoutPrototype,
  dispatchLeadScoutPrototype,
  markLeadScoutLeadReviewed,
  parseEmailDraftOutput,
  parsePrototypeOutput,
  runLeadScoutScan,
} from "./lead-scout";

describe("parsePrototypeOutput", () => {
  test("extracts structured fields and an artifact block", () => {
    const output = [
      "CONCEPT: A clean single-page site for a local bakery.",
      "HERO_COPY: Fresh bread daily | Baked with love since 1990",
      "SECTIONS: Hero, Menu, About, Contact",
      "CTA: Order now",
      "STYLE: warm, rustic, earthy tones",
      "---ARTIFACT---",
      "# Village Bakery\n\nFresh bread daily.",
    ].join("\n");
    const parsed = parsePrototypeOutput(output);
    expect(parsed.concept).toBe("A clean single-page site for a local bakery.");
    expect(parsed.sections).toEqual(["Hero", "Menu", "About", "Contact"]);
    expect(parsed.callToAction).toBe("Order now");
    expect(parsed.artifactMarkdown).toContain("Village Bakery");
  });

  test("treats the literal word none as no artifact", () => {
    const output =
      "CONCEPT: x\nHERO_COPY: y\nSECTIONS: a, b\nCTA: z\nSTYLE: s\n---ARTIFACT---\nnone";
    expect(parsePrototypeOutput(output).artifactMarkdown).toBeNull();
  });
});

describe("parseEmailDraftOutput", () => {
  test("extracts subject and body", () => {
    const output =
      "SUBJECT: A quick idea\n---BODY---\nHi there, noticed you don't have a website...";
    const { subject, body } = parseEmailDraftOutput(output);
    expect(subject).toBe("A quick idea");
    expect(body).toContain("noticed you don't have a website");
  });

  test("falls back to a default subject when SUBJECT: is missing", () => {
    const { subject } = parseEmailDraftOutput("---BODY---\njust a body");
    expect(subject).toBe("A quick idea for your business");
  });
});

let ctx: Awaited<ReturnType<typeof installTestDb>>;
beforeEach(async () => {
  ctx = await installTestDb();
});
afterEach(async () => {
  await ctx.cleanup();
});

async function setupCampaign(provider: "manual_csv" = "manual_csv") {
  const db = getDb();
  const user = await db.getOrCreateDemoUser();
  const workspace = await db.createWorkspace({ userId: user.id, name: "ws" });
  const ext = await db.installExtension({ workspaceId: workspace.id, key: "local-lead-scout" });
  const campaign = await db.createLeadScoutCampaign({
    workspaceId: workspace.id,
    extensionId: ext.id,
    name: "SF test",
    postalCode: "94103",
    provider,
  });
  return { db, workspace, campaign };
}

describe("runLeadScoutScan", () => {
  test("ingests CSV leads with correct missing-website counts", async () => {
    const { db, campaign } = await setupCampaign();
    const csvText =
      "businessName,address,postalCode,city,category,phone,email,website,notes\n" +
      "Joe's Pizza,123 Main St,94103,SF,restaurant,555-1234,,,\n" +
      "Acme Plumbing,55 Elm St,94103,SF,plumber,555-9999,acme@x.com,https://acme.com,has site\n";

    const run = await runLeadScoutScan(campaign.id, { csvText });
    expect(run.status).toBe("completed");
    expect(run.newLeadCount).toBe(2);
    expect(run.missingWebsiteCount).toBe(1);

    const leads = await db.listLeadScoutLeadsByCampaign(campaign.id);
    expect(leads).toHaveLength(2);
    expect(leads.find((l) => l.businessName === "Joe's Pizza")?.websiteStatus).toBe(
      "missing_website",
    );
  });

  test("re-scanning the same CSV reconciles instead of duplicating leads", async () => {
    const { db, campaign } = await setupCampaign();
    const csvText =
      "businessName,address,postalCode,city,category,phone,email,website,notes\n" +
      "Joe's Pizza,123 Main St,94103,SF,restaurant,555-1234,,,\n";

    const first = await runLeadScoutScan(campaign.id, { csvText });
    expect(first.newLeadCount).toBe(1);
    const second = await runLeadScoutScan(campaign.id, { csvText });
    expect(second.newLeadCount).toBe(0);

    const leads = await db.listLeadScoutLeadsByCampaign(campaign.id);
    expect(leads).toHaveLength(1);
  });

  test("marks the scan run failed instead of throwing when the provider errors", async () => {
    const { campaign } = await setupCampaign();
    // manual_csv without csvText throws inside the provider.
    const run = await runLeadScoutScan(campaign.id);
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toMatch(/csvText/);
  });
});

describe("lead status gating for prototype dispatch", () => {
  test("requireApprovalBeforePrototype (default true) blocks dispatch until reviewed", async () => {
    const { db, workspace, campaign } = await setupCampaign();
    const lead = await db.createLeadScoutLead({
      workspaceId: workspace.id,
      campaignId: campaign.id,
      sourceProvider: "manual_csv",
      sourceId: "row-1",
      businessName: "Joe's Pizza",
      websiteStatus: "missing_website",
    });

    await expect(dispatchLeadScoutPrototype(lead.id)).rejects.toThrow(/reviewed/);

    await markLeadScoutLeadReviewed(lead.id);
    const reviewed = await db.getLeadScoutLead(lead.id);
    expect(reviewed?.status).toBe("reviewed");
  });

  test("marking an already-reviewed lead reviewed again fails (no double transition)", async () => {
    const { workspace, campaign } = await setupCampaign();
    const db = getDb();
    const lead = await db.createLeadScoutLead({
      workspaceId: workspace.id,
      campaignId: campaign.id,
      sourceProvider: "manual_csv",
      sourceId: "row-2",
      businessName: "Acme",
      websiteStatus: "missing_website",
    });
    await markLeadScoutLeadReviewed(lead.id);
    await expect(markLeadScoutLeadReviewed(lead.id)).rejects.toThrow();
  });

  test("approving a prototype that isn't ready is rejected", async () => {
    const { db, workspace, campaign } = await setupCampaign();
    const lead = await db.createLeadScoutLead({
      workspaceId: workspace.id,
      campaignId: campaign.id,
      sourceProvider: "manual_csv",
      sourceId: "row-3",
      businessName: "Pending Co",
      websiteStatus: "missing_website",
    });
    const prototype = await db.createLeadScoutPrototype({
      workspaceId: workspace.id,
      leadId: lead.id,
    });
    await expect(approveLeadScoutPrototype(prototype.id)).rejects.toThrow(/ready/);
  });
});
