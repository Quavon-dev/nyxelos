import { boundingBoxFromCenter, geocodePostalCode } from "../lead-scout-geocode";
import type { LeadSourceProvider, LeadSourceSearchInput } from "./types";

/** Descriptive User-Agent as required by the Overpass/OSM usage policy —
 * https://operations.osmfoundation.org/policies/overpass/ */
const OVERPASS_USER_AGENT = "NyxelOS-LocalLeadScout/1.0 (local business discovery extension)";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const QUERY_TIMEOUT_S = 25;

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
}

function buildOverpassQuery(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): string {
  const bounds = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  // nwr matches node/way/relation in one clause per OSM Overpass QL — one
  // clause per top-level key the extension is allowed to query (shop,
  // amenity, office, craft), scoped to the bounding box.
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];
(
  nwr["shop"](${bounds});
  nwr["amenity"](${bounds});
  nwr["office"](${bounds});
  nwr["craft"](${bounds});
);
out center tags;`;
}

function elementCategory(tags: Record<string, string>): string | null {
  for (const key of ["shop", "amenity", "office", "craft"]) {
    if (tags[key]) return tags[key];
  }
  return null;
}

function elementMatchesNiches(tags: Record<string, string>, niches: string[]): boolean {
  if (niches.length === 0) return true;
  const haystack = [tags.name, tags.shop, tags.amenity, tags.office, tags.craft]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return niches.some((niche) => haystack.includes(niche.toLowerCase()));
}

function elementAddress(tags: Record<string, string>): string | null {
  if (tags["addr:full"]) return tags["addr:full"];
  const parts = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

export const osmOverpassProvider: LeadSourceProvider<OverpassElement> = {
  sourcePolicy:
    "Public Overpass API over OpenStreetMap data (ODbL license) — a compliant, key-free public API, not scraping. " +
    "Fair-use: bounded bounding box per scan, capped result count, descriptive User-Agent.",

  async searchBusinesses(input: LeadSourceSearchInput) {
    const center = await geocodePostalCode(input.postalCode, input.country);
    const bbox = boundingBoxFromCenter(center.lat, center.lon, input.radiusKm);
    const query = buildOverpassQuery(bbox);

    const res = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OVERPASS_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) throw new Error(`Overpass API error: HTTP ${res.status}`);
    const body = (await res.json()) as { elements?: OverpassElement[] };
    const elements = (body.elements ?? []).filter((el) => el.tags?.name);

    const matching = elements.filter((el) => elementMatchesNiches(el.tags ?? {}, input.niches));
    return matching.slice(0, input.maxResults);
  },

  async getBusinessDetails(raw) {
    return raw;
  },

  normalizeBusiness(element) {
    const tags = element.tags ?? {};
    const website = (tags.website || tags["contact:website"] || "").trim() || null;
    const email = (tags.email || tags["contact:email"] || "").trim() || null;
    const phone = (tags.phone || tags["contact:phone"] || "").trim() || null;
    const missingEmail = !email;

    return {
      sourceId: `${element.type}/${element.id}`,
      businessName: tags.name ?? "Unknown business",
      category: elementCategory(tags),
      formattedAddress: elementAddress(tags),
      postalCode: tags["addr:postcode"] ?? null,
      city: tags["addr:city"] ?? null,
      phone,
      email,
      website,
      websiteStatus: website ? "has_website" : "missing_website",
      // Lower than google_places_api's default (90) — OSM tag completeness
      // varies a lot by region/contributor.
      confidence: 70,
      evidenceSummary: [
        website
          ? `OSM tags include a website/contact:website value (${website}).`
          : "No website or contact:website tag present on this OSM element.",
        missingEmail
          ? "No email or contact:email tag present (missing_email) — outreach needs a manually supplied address."
          : null,
      ]
        .filter(Boolean)
        .join(" "),
      missingReason: website ? null : "No website/contact:website tag on the OSM node/way.",
    };
  },
};
