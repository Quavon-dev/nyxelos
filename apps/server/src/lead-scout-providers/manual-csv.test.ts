import { describe, expect, test } from "bun:test";
import { manualCsvProvider } from "./manual-csv";
import { parseCsv } from "./shared";
import { collectNormalizedBusinesses } from "./types";

describe("parseCsv", () => {
  test("parses quoted fields with embedded commas and escaped quotes", () => {
    const csv = 'businessName,address,notes\n"Joe, Inc.","123 Main St","Great ""spot"""\n';
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      { businessName: "Joe, Inc.", address: "123 Main St", notes: 'Great "spot"' },
    ]);
  });

  test("pads ragged rows with empty strings for missing trailing columns", () => {
    const csv = "businessName,address,phone\nJoe's Pizza,123 Main St\n";
    const rows = parseCsv(csv);
    expect(rows).toEqual([{ businessName: "Joe's Pizza", address: "123 Main St", phone: "" }]);
  });
});

describe("manualCsvProvider", () => {
  test("flags missing website, assigns maximum confidence to user-supplied data", async () => {
    const csvText =
      "businessName,address,postalCode,city,category,phone,email,website,notes\n" +
      "Joe's Pizza,123 Main St,94103,SF,restaurant,555-1234,,,\n" +
      "Acme Plumbing,55 Elm St,94103,SF,plumber,555-9999,acme@x.com,https://acme.com,has site\n";

    const results = await collectNormalizedBusinesses(manualCsvProvider, {
      workspaceId: "w1",
      postalCode: "94103",
      country: "US",
      radiusKm: 5,
      niches: [],
      maxResults: 10,
      sourceConfig: null,
      csvText,
    });

    expect(results).toHaveLength(2);
    const pizza = results.find((r) => r.businessName === "Joe's Pizza");
    expect(pizza?.websiteStatus).toBe("missing_website");
    expect(pizza?.website).toBeNull();
    expect(pizza?.confidence).toBe(100);
    expect(pizza?.missingReason).toContain("No website column value in the CSV row");
    expect(pizza?.evidenceSummary).toContain("no website value was provided");

    const acme = results.find((r) => r.businessName === "Acme Plumbing");
    expect(acme?.websiteStatus).toBe("has_website");
    expect(acme?.website).toBe("https://acme.com");
  });

  test("re-importing the same row produces the same sourceId (dedupe key)", async () => {
    const csvText =
      "businessName,address,postalCode,city,category,phone,email,website,notes\n" +
      "Joe's Pizza,123 Main St,94103,SF,restaurant,555-1234,,,\n";
    const input = {
      workspaceId: "w1",
      postalCode: "94103",
      country: "US",
      radiusKm: 5,
      niches: [],
      maxResults: 10,
      sourceConfig: null,
      csvText,
    };
    const first = await collectNormalizedBusinesses(manualCsvProvider, input);
    const second = await collectNormalizedBusinesses(manualCsvProvider, input);
    expect(first[0]?.sourceId).toBe(second[0]?.sourceId);
  });

  test("throws when csvText is missing", async () => {
    await expect(
      collectNormalizedBusinesses(manualCsvProvider, {
        workspaceId: "w1",
        postalCode: "94103",
        country: "US",
        radiusKm: 5,
        niches: [],
        maxResults: 10,
        sourceConfig: null,
      }),
    ).rejects.toThrow(/csvText/);
  });
});
