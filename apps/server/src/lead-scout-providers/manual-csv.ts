import { createHash } from "node:crypto";
import { classifyWebsite, parseCsv } from "./shared";
import type { LeadSourceProvider, LeadSourceSearchInput } from "./types";

/** businessName is the only strictly required column — everything else is
 * optional per the extension's field list (businessName, address,
 * postalCode, city, category, phone, email, website, notes). */
interface CsvLeadRow {
  businessName: string;
  address: string;
  postalCode: string;
  city: string;
  category: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
}

/** Stable per-row identity: a CSV has no natural id, so hash the row's own
 * content — re-importing the same file reconciles against existing leads
 * instead of duplicating them (see lead_scout_lead's unique constraint). */
function csvRowSourceId(row: Record<string, string>): string {
  const key = [row.businessName, row.address, row.postalCode, row.phone, row.email]
    .join("|")
    .toLowerCase();
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export const manualCsvProvider: LeadSourceProvider<CsvLeadRow & { sourceId: string }> = {
  sourcePolicy:
    "User-supplied CSV import — fully within the user's own control, no external data source involved.",

  async searchBusinesses(input: LeadSourceSearchInput) {
    if (!input.csvText) {
      throw new Error("manual_csv requires csvText — upload a CSV to import leads.");
    }
    const rows = parseCsv(input.csvText);
    return rows
      .filter((row) => row.businessName)
      .map((row) => ({
        sourceId: csvRowSourceId(row),
        businessName: row.businessName ?? "",
        address: row.address ?? "",
        postalCode: row.postalCode ?? "",
        city: row.city ?? "",
        category: row.category ?? "",
        phone: row.phone ?? "",
        email: row.email ?? "",
        website: row.website ?? "",
        notes: row.notes ?? "",
      }));
  },

  async getBusinessDetails(raw) {
    return raw;
  },

  normalizeBusiness(row) {
    const { website, websiteStatus } = classifyWebsite(row.website);
    return {
      sourceId: row.sourceId,
      businessName: row.businessName,
      category: row.category || null,
      formattedAddress: row.address || null,
      postalCode: row.postalCode || null,
      city: row.city || null,
      phone: row.phone || null,
      email: row.email || null,
      website,
      websiteStatus,
      confidence: 100,
      evidenceSummary:
        websiteStatus === "missing_website"
          ? "Imported via manual CSV; no website value was provided."
          : `Imported via manual CSV.${row.notes ? ` Notes: ${row.notes}` : ""}`,
      missingReason:
        websiteStatus === "missing_website" ? "No website column value in the CSV row." : null,
    };
  },
};
