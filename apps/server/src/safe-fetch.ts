import { lookup as dnsLookup } from "node:dns/promises";

/**
 * SSRF-resistant fetch for workflow/automation code that accepts an
 * arbitrary, user-configured URL (the workflow HTTP Request node in
 * particular — see workflow-runner.ts). Unlike packages/skills-sdk's
 * `ctx.fetch` (a per-skill *hostname allowlist*), this has no allowlist to
 * configure: it fails closed against the whole class of "the target
 * resolves to something on the local machine/network" regardless of what
 * hostname was typed, which is the right default for a node whose URL is
 * free-form workflow config, not a developer-declared permission.
 */

export class SafeFetchError extends Error {}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
]);

/** IPv4 ranges reserved for loopback, private (RFC 1918), link-local
 * (including the 169.254.169.254 cloud-metadata address), carrier-grade
 * NAT, and other non-routable/documentation use — see IANA's special-
 * purpose address registry. Blocking all of them (not just RFC1918) is
 * deliberate: a workflow HTTP node has no legitimate reason to reach any of
 * these from a request that's supposed to hit the public internet. */
const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  for (const [base, prefix] of IPV4_BLOCKED_RANGES) {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) continue;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((value & mask) === (baseValue & mask)) return true;
  }
  return false;
}

/** IPv6 loopback (::1), link-local (fe80::/10), and unique-local/private
 * (fc00::/7) — plus IPv4-mapped addresses (::ffff:a.b.c.d), which are
 * unwrapped and re-checked against the IPv4 ranges above rather than
 * treated as a distinct, un-blocked address family. */
function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);

  const firstGroup = normalized.split(":")[0] ?? "";
  const firstHextet = Number.parseInt(firstGroup || "0", 16);
  // fe80::/10 — first 10 bits are 1111111010.
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  // fc00::/7 — top 7 bits are 1111110, i.e. first hextet in 0xfc00-0xfdff.
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true;
  return false;
}

function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  /** Injected for tests — defaults to node:dns/promises' `lookup`. Must
   * behave like it: given an IP literal, resolves to that IP with no real
   * network call (that's what makes IP-literal test cases hermetic). */
  resolveHostname?: (hostname: string) => Promise<{ address: string }[]>;
  /** Injected for tests — defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

async function resolveAddresses(
  hostname: string,
  resolveHostname: NonNullable<SafeFetchOptions["resolveHostname"]>,
): Promise<string[]> {
  try {
    const records = await resolveHostname(hostname);
    return records.map((r) => r.address);
  } catch (err) {
    throw new SafeFetchError(
      `Could not resolve host "${hostname}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function assertSafeUrl(
  url: URL,
  resolveHostname: NonNullable<SafeFetchOptions["resolveHostname"]>,
): Promise<void> {
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SafeFetchError(
      `URL scheme "${url.protocol}" is not allowed — only http/https requests are permitted.`,
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SafeFetchError(`Requests to "${hostname}" are blocked.`);
  }
  if (isBlockedIp(hostname)) {
    throw new SafeFetchError(`Requests to "${hostname}" are blocked (private/reserved address).`);
  }

  const addresses = await resolveAddresses(hostname, resolveHostname);
  if (addresses.length === 0) {
    throw new SafeFetchError(`Host "${hostname}" did not resolve to any address.`);
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new SafeFetchError(
        `Host "${hostname}" resolves to a blocked private/reserved address (${address}).`,
      );
    }
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Reads a Response body up to `maxBytes`, throwing SafeFetchError instead
 * of silently truncating — a workflow node should fail loudly on an
 * unexpectedly huge response rather than proceed with partial data. */
async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        throw new SafeFetchError(
          `Response exceeded the maximum allowed size of ${maxBytes} bytes.`,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock?.();
  }
}

export interface SafeFetchResult {
  status: number;
  ok: boolean;
  statusText: string;
  text: string;
  url: string;
}

/**
 * Fetches `url` with SSRF protections: only http/https, blocks
 * localhost/loopback/link-local/private/metadata addresses (checked both on
 * the literal hostname and on every DNS-resolved address, including for
 * each hop of a redirect chain — a redirect can't be used to reach a
 * blocked address the initial URL check would have caught), a request
 * timeout, a capped number of redirects, and a capped response size.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolveHostname =
    options.resolveHostname ?? ((hostname: string) => dnsLookup(hostname, { all: true }));
  const fetchImpl = options.fetchImpl ?? fetch;

  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new SafeFetchError(`"${rawUrl}" is not a valid URL.`);
  }

  for (let redirectCount = 0; ; redirectCount++) {
    await assertSafeUrl(current, resolveHostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new SafeFetchError(`Request to "${current}" timed out after ${timeoutMs}ms.`);
      }
      throw new SafeFetchError(
        `Request to "${current}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SafeFetchError(`Received a redirect from "${current}" with no Location header.`);
      }
      if (redirectCount >= maxRedirects) {
        throw new SafeFetchError(
          `Too many redirects (max ${maxRedirects}) starting from "${rawUrl}".`,
        );
      }
      current = new URL(location, current);
      continue;
    }

    const text = await readBodyWithLimit(response, maxResponseBytes);
    return {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
      text,
      url: current.toString(),
    };
  }
}
