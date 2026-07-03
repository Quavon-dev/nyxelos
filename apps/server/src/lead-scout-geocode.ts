/**
 * Postal code -> coordinates via Nominatim (OpenStreetMap's own geocoder,
 * free, no API key) — used by both the google_places_api provider (needs a
 * center point for Nearby Search) and the osm_overpass provider (needs a
 * bounding box). Respects Nominatim's usage policy: max 1 request/second
 * and a descriptive User-Agent identifying the app.
 * https://operations.osmfoundation.org/policies/nominatim/
 */

const NOMINATIM_USER_AGENT = "NyxelOS-LocalLeadScout/1.0 (local business discovery extension)";
const NOMINATIM_MIN_INTERVAL_MS = 1100;

// Process-local throttle, not cross-replica — matches the rest of the
// codebase's "single-process is the deployment target today" assumption
// (see scheduler.ts's automationsInFlight).
let lastNominatimCallAt = 0;

async function throttleNominatim(): Promise<void> {
  const elapsed = Date.now() - lastNominatimCallAt;
  if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed));
  }
  lastNominatimCallAt = Date.now();
}

export interface GeocodeResult {
  lat: number;
  lon: number;
}

export async function geocodePostalCode(
  postalCode: string,
  country: string,
): Promise<GeocodeResult> {
  await throttleNominatim();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("postalcode", postalCode);
  url.searchParams.set("country", country);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim geocoding failed: HTTP ${res.status}`);
  const results = (await res.json()) as { lat: string; lon: string }[];
  const [first] = results;
  if (!first) throw new Error(`Could not geocode postal code "${postalCode}, ${country}".`);
  return { lat: Number(first.lat), lon: Number(first.lon) };
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Rough equirectangular approximation — plenty accurate for a "search
 * within N km of this postal code" radius, not a routing/distance product. */
export function boundingBoxFromCenter(lat: number, lon: number, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    south: lat - latDelta,
    west: lon - lonDelta,
    north: lat + latDelta,
    east: lon + lonDelta,
  };
}
