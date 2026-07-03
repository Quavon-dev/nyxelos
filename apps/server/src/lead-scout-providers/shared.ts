import type { LeadScoutWebsiteStatus } from "@nyxel/db";

/** A lead qualifies as missing_website only when no website value is present
 * at all (per every provider's compliance requirements — never inferred
 * from scraping). A present-but-unparseable value is reported separately
 * (invalid_website) so a reviewer can tell "no site" from "bad data" apart. */
export function classifyWebsite(raw: string | null | undefined): {
  website: string | null;
  websiteStatus: LeadScoutWebsiteStatus;
} {
  const trimmed = raw?.trim();
  if (!trimmed) return { website: null, websiteStatus: "missing_website" };
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(withProtocol);
    return { website: trimmed, websiteStatus: "has_website" };
  } catch {
    return { website: trimmed, websiteStatus: "invalid_website" };
  }
}

/** Minimal RFC4180-ish CSV parser (quoted fields, escaped `""`, embedded
 * commas/newlines) — avoids a new dependency for the one thing manual_csv
 * needs. Returns each row as a header-keyed record; ragged rows are padded
 * with empty strings for missing trailing columns. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      // swallow, \n (or end of input) closes the row
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const [header, ...dataRows] = rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""));
  if (!header) return [];
  return dataRows.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key.trim()] = (cells[index] ?? "").trim();
    });
    return record;
  });
}
