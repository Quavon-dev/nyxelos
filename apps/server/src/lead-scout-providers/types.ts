import type { LeadScoutSourceConfigRecord, LeadScoutWebsiteStatus } from "@nyxel/db";

/** What a scan needs to run one query — the campaign's own config, plus the
 * workspace's per-provider source config (API keys, provider-specific
 * settings) and, for manual_csv only, the raw CSV text to import. */
export interface LeadSourceSearchInput {
  workspaceId: string;
  postalCode: string;
  country: string;
  radiusKm: number;
  niches: string[];
  maxResults: number;
  sourceConfig: LeadScoutSourceConfigRecord | null;
  csvText?: string;
}

/** The output shape every provider normalizes into — exactly what a
 * reviewer needs to judge a lead (no reviews/photos/ratings/bulk metadata,
 * per each provider's compliance requirements). */
export interface NormalizedBusiness {
  sourceId: string;
  businessName: string;
  category?: string | null;
  niche?: string | null;
  formattedAddress?: string | null;
  postalCode?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  websiteStatus: LeadScoutWebsiteStatus;
  confidence: number;
  evidenceSummary: string;
  missingReason?: string | null;
}

/**
 * Provider adapter contract (see the extension's design doc). `TRaw` is
 * whatever shape `searchBusinesses` returns per result (a search hit); the
 * details/normalize split lets a provider fetch more per-result info before
 * normalizing without every provider needing a separate details call —
 * providers whose search response is already complete (Google Places New,
 * manual CSV rows) just return the raw item unchanged from
 * `getBusinessDetails`.
 */
export interface LeadSourceProvider<TRaw = unknown> {
  readonly sourcePolicy: string;
  searchBusinesses(input: LeadSourceSearchInput): Promise<TRaw[]>;
  getBusinessDetails(raw: TRaw, input: LeadSourceSearchInput): Promise<TRaw | null>;
  normalizeBusiness(details: TRaw): NormalizedBusiness;
}

/** Runs one provider end-to-end and caps the result count — the one place
 * every scan's maxResultsPerRun limit is actually enforced, regardless of
 * how many raw results a provider's search returned. */
export async function collectNormalizedBusinesses(
  provider: LeadSourceProvider,
  input: LeadSourceSearchInput,
): Promise<NormalizedBusiness[]> {
  const raws = await provider.searchBusinesses(input);
  const normalized: NormalizedBusiness[] = [];
  for (const raw of raws) {
    if (normalized.length >= input.maxResults) break;
    const details = await provider.getBusinessDetails(raw, input);
    if (!details) continue;
    normalized.push(provider.normalizeBusiness(details));
  }
  return normalized;
}
