import type { LeadScoutProvider } from "@nyxel/db";
import { customApiProvider } from "./custom-api";
import { googlePlacesProvider } from "./google-places";
import { manualCsvProvider } from "./manual-csv";
import { osmOverpassProvider } from "./osm-overpass";
import type { LeadSourceProvider } from "./types";

export { collectNormalizedBusinesses } from "./types";
export type { LeadSourceProvider, LeadSourceSearchInput, NormalizedBusiness } from "./types";

const PROVIDERS: Record<LeadScoutProvider, LeadSourceProvider> = {
  manual_csv: manualCsvProvider,
  google_places_api: googlePlacesProvider,
  osm_overpass: osmOverpassProvider,
  custom_api: customApiProvider,
};

export function getLeadSourceProvider(provider: LeadScoutProvider): LeadSourceProvider {
  return PROVIDERS[provider];
}
