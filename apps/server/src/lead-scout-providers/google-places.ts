import { geocodePostalCode } from "../lead-scout-geocode";
import type { LeadSourceProvider, LeadSourceSearchInput } from "./types";

/**
 * Official Places API (New) Text Search only — no browser automation, no
 * Google Maps DOM scraping. FieldMask is explicit and minimal (never `*`),
 * per the extension's compliance requirements: only what the workflow needs
 * to judge a lead and dedupe it (`id`, name, address, location, status,
 * types, phone, website, maps link). Reviews/photos/ratings are never
 * requested and never stored.
 */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.businessStatus",
  "places.types",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
].join(",");

const MAX_RESULTS_PER_QUERY = 20;
const QUERY_DELAY_MS = 250;

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  businessStatus?: string;
  types?: string[];
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  /** Not part of the API response — stamped on by searchBusinesses so
   * normalizeBusiness knows which niche query surfaced this result. */
  __niche?: string;
}

async function searchTextOnce(
  apiKey: string,
  textQuery: string,
  center: { lat: number; lon: number },
  radiusMeters: number,
  maxResultCount: number,
): Promise<GooglePlace[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lon },
          radius: radiusMeters,
        },
      },
      maxResultCount: Math.min(maxResultCount, MAX_RESULTS_PER_QUERY),
    }),
  });
  if (!res.ok) {
    throw new Error(`Google Places API error: HTTP ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { places?: GooglePlace[] };
  return body.places ?? [];
}

export const googlePlacesProvider: LeadSourceProvider<GooglePlace> = {
  sourcePolicy:
    "Official Google Places API (Text Search, New) only — no Maps scraping, no DOM automation, no bulk harvesting. " +
    "You are responsible for complying with the Google Maps Platform Terms of Service for any data retrieved this way.",

  async searchBusinesses(input: LeadSourceSearchInput) {
    const apiKey = input.sourceConfig?.apiKey;
    if (!apiKey) {
      throw new Error(
        "google_places_api requires an API key configured in workspace source settings first.",
      );
    }
    const center = await geocodePostalCode(input.postalCode, input.country);
    const radiusMeters = Math.min(Math.max(input.radiusKm, 0.5), 50) * 1000;
    const niches = input.niches.length > 0 ? input.niches : ["local business"];

    const results: GooglePlace[] = [];
    for (const niche of niches) {
      if (results.length >= input.maxResults) break;
      const remaining = input.maxResults - results.length;
      const textQuery = `${niche} near ${input.postalCode}, ${input.country}`;
      const places = await searchTextOnce(apiKey, textQuery, center, radiusMeters, remaining);
      for (const place of places) results.push({ ...place, __niche: niche });
      if (niches.indexOf(niche) < niches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, QUERY_DELAY_MS));
      }
    }
    return results;
  },

  async getBusinessDetails(raw) {
    // Text Search (New) with the FieldMask above already returns everything
    // the workflow needs — no separate Place Details call, which would be
    // extra quota/latency for data already in hand.
    return raw;
  },

  normalizeBusiness(place) {
    const website = place.websiteUri?.trim() || null;
    return {
      sourceId: place.id,
      businessName: place.displayName?.text ?? "Unknown business",
      category: place.types?.[0] ?? null,
      niche: place.__niche ?? null,
      formattedAddress: place.formattedAddress ?? null,
      postalCode: null,
      city: null,
      phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? null,
      email: null,
      website,
      websiteStatus: website ? "has_website" : "missing_website",
      confidence: 90,
      evidenceSummary: website
        ? `Google Places API returned a websiteUri (${website}).`
        : "Google Places API (Text Search) returned no websiteUri for this business.",
      missingReason: website ? null : "No websiteUri field in the Places API response.",
    };
  },
};
