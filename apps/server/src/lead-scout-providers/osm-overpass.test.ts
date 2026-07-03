import { describe, expect, test } from "bun:test";
import { osmOverpassProvider } from "./osm-overpass";

describe("osmOverpassProvider.normalizeBusiness", () => {
  test("flags missing_website and a separate missing_email note when neither tag is present", () => {
    const result = osmOverpassProvider.normalizeBusiness({
      type: "node",
      id: 123,
      tags: { name: "Village Cafe", shop: "cafe", "addr:postcode": "94103", "addr:city": "SF" },
    });
    expect(result.sourceId).toBe("node/123");
    expect(result.websiteStatus).toBe("missing_website");
    expect(result.email).toBeNull();
    expect(result.evidenceSummary).toContain("missing_email");
    // Lower default than google_places_api's 90, per the extension's design
    // (OSM tag completeness varies a lot by region/contributor).
    expect(result.confidence).toBe(70);
  });

  test("has_website when a contact:website tag is present", () => {
    const result = osmOverpassProvider.normalizeBusiness({
      type: "way",
      id: 456,
      tags: { name: "Acme Hardware", shop: "hardware", "contact:website": "https://acme.example" },
    });
    expect(result.websiteStatus).toBe("has_website");
    expect(result.website).toBe("https://acme.example");
  });

  test("has_website when a plain website tag is present (contact:website takes priority when both exist)", () => {
    const result = osmOverpassProvider.normalizeBusiness({
      type: "node",
      id: 789,
      tags: { name: "Bike Shop", shop: "bicycle", website: "https://bikes.example" },
    });
    expect(result.websiteStatus).toBe("has_website");
    expect(result.website).toBe("https://bikes.example");
  });

  test("category picked from whichever of shop/amenity/office/craft is present", () => {
    const result = osmOverpassProvider.normalizeBusiness({
      type: "node",
      id: 1,
      tags: { name: "Law Office", office: "lawyer" },
    });
    expect(result.category).toBe("lawyer");
  });
});
