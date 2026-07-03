import type { LeadSourceProvider, LeadSourceSearchInput } from "./types";
import { classifyWebsite } from "./shared";

/** Minimal generic REST adapter placeholder — expects a compliant endpoint
 * (configured per-workspace as sourceConfig.config.baseUrl) that returns a
 * flat JSON array shaped like the manual_csv row fields. Real
 * provider-specific behavior (auth scheme, pagination, rate limits) is left
 * to whichever compliant API a workspace wires up here; this adapter only
 * defines the minimal request/response contract. */
interface CustomApiRow {
  sourceId: string;
  businessName: string;
  category?: string;
  formattedAddress?: string;
  postalCode?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export const customApiProvider: LeadSourceProvider<CustomApiRow> = {
  sourcePolicy:
    "Generic compliant API adapter placeholder — only queries the endpoint you configure; " +
    "you are responsible for that endpoint's own terms of service and rate limits.",

  async searchBusinesses(input: LeadSourceSearchInput) {
    const baseUrl = input.sourceConfig?.config?.baseUrl;
    if (!baseUrl || typeof baseUrl !== "string") {
      throw new Error(
        "custom_api requires a baseUrl configured in workspace source settings first.",
      );
    }
    const apiKey = input.sourceConfig?.apiKey;
    const url = new URL(baseUrl);
    url.searchParams.set("postalCode", input.postalCode);
    url.searchParams.set("country", input.country);
    url.searchParams.set("radiusKm", String(input.radiusKm));
    url.searchParams.set("niches", input.niches.join(","));
    url.searchParams.set("maxResults", String(input.maxResults));

    const res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    if (!res.ok) throw new Error(`custom_api provider error: HTTP ${res.status}`);
    const rows = (await res.json()) as CustomApiRow[];
    return Array.isArray(rows) ? rows : [];
  },

  async getBusinessDetails(raw) {
    return raw;
  },

  normalizeBusiness(row) {
    const { website, websiteStatus } = classifyWebsite(row.website);
    return {
      sourceId: row.sourceId,
      businessName: row.businessName,
      category: row.category ?? null,
      formattedAddress: row.formattedAddress ?? null,
      postalCode: row.postalCode ?? null,
      city: row.city ?? null,
      phone: row.phone ?? null,
      email: row.email ?? null,
      website,
      websiteStatus,
      confidence: 60,
      evidenceSummary:
        websiteStatus === "missing_website"
          ? "custom_api response had no website value for this business."
          : "custom_api reported a website for this business.",
      missingReason: websiteStatus === "missing_website" ? "No website field in the custom API response." : null,
    };
  },
};
