import type { Context, MiddlewareHandler } from "hono";

interface Bucket {
	count: number;
	resetAt: number;
}

/**
 * In-memory sliding-window-by-reset counter, keyed per caller. No Redis
 * dependency (NyxelOS's PC mode has no external services running at all —
 * ARCHITECTURE.md section 3), which is enough for a self-hosted
 * single/few-user server. Not shared across process restarts or multiple
 * server instances; fine for the deployment shape this project targets
 * today (see ADR-0010's same reasoning for the DB-backed scheduler over a
 * job queue).
 */
const buckets = new Map<string, Bucket>();

// Bound memory growth from an attacker cycling IPs/keys.
const MAX_TRACKED_KEYS = 50_000;

function take(key: string, windowMs: number, max: number): boolean {
	const now = Date.now();
	const existing = buckets.get(key);
	if (!existing || existing.resetAt <= now) {
		if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return true;
	}
	if (existing.count >= max) return false;
	existing.count += 1;
	return true;
}

function clientKey(c: Context): string {
	// Behind a reverse proxy (Caddy, per ARCHITECTURE.md section 3), the real
	// client IP arrives via X-Forwarded-For; fall back to the raw connection
	// info for direct/local access.
	const forwarded = c.req.header("x-forwarded-for");
	if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
	return c.req.header("x-real-ip") ?? "unknown";
}

export function rateLimitMiddleware(options: {
	windowMs: number;
	max: number;
	keyPrefix: string;
}): MiddlewareHandler {
	return async (c, next) => {
		const key = `${options.keyPrefix}:${clientKey(c)}`;
		if (!take(key, options.windowMs, options.max)) {
			return c.json({ error: "Too many requests" }, 429);
		}
		await next();
	};
}
