import { promises as fs } from "node:fs";
import path from "node:path";
import {
	getDb,
	type AgentRecord,
	type PluginAgentDefinition,
	type PluginRecord,
	type SeoAnalysisRunRecord,
	type SeoBlogPostRecord,
	type SeoFindingCategory,
	type SeoFindingRecord,
	type SeoFindingSeverity,
	type SeoProjectRecord,
} from "@nyxel/db";
import { listAvailableModels } from "@nyxel/model-providers";
import { executeManagedTask } from "./agent-runtime";
import { logAudit } from "./audit";
import { getInstalledProvidersForWorkspace } from "./models";
import { findPluginByRepoUrl, loadPluginSkillDefinitions } from "./plugins";
import { notifyWorkspaceOwner } from "./push";

/** Confirms `repoPath` is an absolute, existing, readable directory before
 * we ever link it to a project — the analyzer and fixer agent both treat
 * this path as their filesystem root, so a bad path here would otherwise
 * surface as a much more confusing error deep in a crawl or agent run. */
export async function validateRepoPath(repoPath: string): Promise<void> {
	if (!path.isAbsolute(repoPath)) {
		throw new Error(`Repo path must be absolute: "${repoPath}"`);
	}
	let stat: import("node:fs").Stats;
	try {
		stat = await fs.stat(repoPath);
	} catch {
		throw new Error(`Repo path does not exist: "${repoPath}"`);
	}
	if (!stat.isDirectory()) {
		throw new Error(`Repo path is not a directory: "${repoPath}"`);
	}
	try {
		await fs.access(repoPath, fs.constants.R_OK);
	} catch {
		throw new Error(`Repo path is not readable: "${repoPath}"`);
	}
}

export interface DraftFinding {
	category: SeoFindingCategory;
	severity: SeoFindingSeverity;
	title: string;
	description: string;
	recommendation: string;
	location?: string | null;
}

const MAX_PAGES = 15;
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "NyxelSEOAnalyzer/1.0 (+https://nyxel.local)";

function normalizeDomain(domain: string): string {
	return domain.startsWith("http://") || domain.startsWith("https://")
		? domain
		: `https://${domain}`;
}

async function fetchText(
	url: string,
): Promise<{ status: number; body: string } | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			headers: { "User-Agent": USER_AGENT },
		});
		return { status: res.status, body: await res.text() };
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Sitemap-first URL discovery, falling back to just the homepage — a full
 * crawler (following in-page links breadth-first) is more than a v1 needs
 * and risks wandering into an unbounded site. */
async function discoverUrls(baseUrl: string): Promise<string[]> {
	const urls = new Set<string>([baseUrl]);
	const sitemapUrl = new URL("/sitemap.xml", baseUrl).toString();
	const sitemap = await fetchText(sitemapUrl);
	if (sitemap && sitemap.status === 200) {
		const locMatches = sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi);
		for (const match of locMatches) {
			if (urls.size >= MAX_PAGES) break;
			const loc = match[1]?.trim();
			if (loc) urls.add(loc);
		}
	}
	return [...urls].slice(0, MAX_PAGES);
}

function extractTag(html: string, regex: RegExp): string | null {
	const match = html.match(regex);
	return match?.[1]?.trim() ?? null;
}

function countMatches(html: string, regex: RegExp): number {
	return [...html.matchAll(regex)].length;
}

/** Stable identity for a finding across separate analysis runs — used to
 * reconcile instead of re-inserting duplicates every re-scan. Two findings
 * are "the same" if they're the same category+severity+title at the same
 * location, regardless of which run detected them. */
function findingKey(f: Pick<DraftFinding, "category" | "severity" | "title" | "location">): string {
	return `${f.category}|${f.severity}|${f.title}|${f.location ?? ""}`;
}

/** Rough word count from rendered-ish text — strips script/style blocks and
 * tags, not a real DOM text extraction, but close enough to flag genuinely
 * thin pages without needing a parser. */
function estimateWordCount(html: string): number {
	const text = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&[a-z]+;/gi, " ")
		.trim();
	return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

/** Findings for meta values (title or description) shared by more than one
 * crawled page — only meaningful once there are 2+ pages to compare. */
function findDuplicateMetaFindings(
	pages: { url: string; title: string | null; description: string | null }[],
	field: "title" | "description",
): DraftFinding[] {
	const groups = new Map<string, string[]>();
	for (const page of pages) {
		const value = page[field];
		if (!value) continue;
		const key = value.trim().toLowerCase();
		const urls = groups.get(key) ?? [];
		urls.push(page.url);
		groups.set(key, urls);
	}

	const label = field === "title" ? "<title>" : "meta description";
	const findings: DraftFinding[] = [];
	for (const [value, urls] of groups) {
		if (urls.length < 2) continue;
		findings.push({
			category: "seo",
			severity: "warning",
			title: `Duplicate ${label} across pages`,
			description: `${urls.length} pages share the same ${label} ("${value}"): ${urls.join(", ")}`,
			recommendation: `Give each page a unique ${label} describing its own content instead of reusing the same one.`,
			location: urls[0],
		});
	}
	return findings;
}

/** SEO/GEO/AEO checks against one already-fetched page's HTML. Regex-based
 * on purpose — a full DOM parser (cheerio/jsdom) is unnecessary weight for
 * meta-tag presence/shape checks, and this runs per-page across a crawl. */
function analyzePageHtml(
	url: string,
	html: string,
): { findings: DraftFinding[]; title: string | null; description: string | null } {
	const findings: DraftFinding[] = [];

	// --- SEO ---
	const title = extractTag(html, /<title[^>]*>([^<]*)<\/title>/i);
	if (!title) {
		findings.push({
			category: "seo",
			severity: "critical",
			title: "Missing <title> tag",
			description: `${url} has no <title> element.`,
			recommendation: "Add a unique, descriptive <title> (50-60 characters) to every page.",
			location: url,
		});
	} else if (title.length < 10 || title.length > 60) {
		findings.push({
			category: "seo",
			severity: "warning",
			title: "Title length outside recommended range",
			description: `${url}'s title is ${title.length} characters ("${title}").`,
			recommendation: "Keep titles between roughly 10 and 60 characters so they don't truncate in search results.",
			location: url,
		});
	}

	const description = extractTag(
		html,
		/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
	);
	if (!description) {
		findings.push({
			category: "seo",
			severity: "warning",
			title: "Missing meta description",
			description: `${url} has no <meta name="description"> tag.`,
			recommendation: "Add a unique meta description (roughly 50-160 characters) summarizing the page.",
			location: url,
		});
	} else if (description.length < 50 || description.length > 160) {
		findings.push({
			category: "seo",
			severity: "info",
			title: "Meta description length outside recommended range",
			description: `${url}'s meta description is ${description.length} characters.`,
			recommendation: "Aim for roughly 50-160 characters so the snippet doesn't truncate in search results.",
			location: url,
		});
	}

	const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html);
	if (!hasCanonical) {
		findings.push({
			category: "seo",
			severity: "info",
			title: "Missing canonical link",
			description: `${url} has no <link rel="canonical"> tag.`,
			recommendation: "Add a self-referencing canonical link to avoid duplicate-content ambiguity.",
			location: url,
		});
	}

	const h1Count = countMatches(html, /<h1[\s>]/gi);
	if (h1Count === 0) {
		findings.push({
			category: "seo",
			severity: "warning",
			title: "No <h1> heading",
			description: `${url} has no <h1> element.`,
			recommendation: "Every page should have exactly one <h1> describing its main topic.",
			location: url,
		});
	} else if (h1Count > 1) {
		findings.push({
			category: "seo",
			severity: "info",
			title: "Multiple <h1> headings",
			description: `${url} has ${h1Count} <h1> elements.`,
			recommendation: "Use a single <h1> per page; demote the rest to <h2>/<h3>.",
			location: url,
		});
	}

	const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
	const imagesMissingAlt = imgTags.filter((tag) => !/\balt=/i.test(tag)).length;
	if (imagesMissingAlt > 0) {
		findings.push({
			category: "seo",
			severity: "warning",
			title: "Images missing alt text",
			description: `${url} has ${imagesMissingAlt} <img> tag(s) without an alt attribute.`,
			recommendation: "Add descriptive alt text to every content image for accessibility and image search.",
			location: url,
		});
	}

	const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
	if (!hasViewport) {
		findings.push({
			category: "seo",
			severity: "warning",
			title: "Missing viewport meta tag",
			description: `${url} has no <meta name="viewport"> tag.`,
			recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> so mobile search ranking isn\'t penalized.',
			location: url,
		});
	}

	const htmlLang = extractTag(html, /<html[^>]+lang=["']([a-zA-Z-]+)["']/i);
	if (!htmlLang) {
		findings.push({
			category: "seo",
			severity: "info",
			title: "Missing lang attribute on <html>",
			description: `${url}'s <html> tag has no lang attribute.`,
			recommendation: 'Add lang="en" (or the page\'s actual language) to <html> — screen readers and search/answer engines both use it.',
			location: url,
		});
	}

	const robotsMeta = extractTag(
		html,
		/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i,
	);
	if (robotsMeta && /noindex/i.test(robotsMeta)) {
		findings.push({
			category: "seo",
			severity: "warning",
			title: "Page is set to noindex",
			description: `${url} has <meta name="robots" content="${robotsMeta}">.`,
			recommendation: "Remove noindex if this page should actually rank — easy to leave on by accident after staging/launch.",
			location: url,
		});
	}

	const wordCount = estimateWordCount(html);
	if (wordCount > 0 && wordCount < 300) {
		findings.push({
			category: "seo",
			severity: "info",
			title: "Thin content",
			description: `${url} has roughly ${wordCount} words of text.`,
			recommendation: "Pages under ~300 words often struggle to rank — expand with genuinely useful content, don't pad with filler.",
			location: url,
		});
	}

	// --- GEO (structured data / answer-engine readability of facts) ---
	const jsonLdBlocks = [
		...html.matchAll(
			/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
		),
	].map((m) => m[1] ?? "");

	if (jsonLdBlocks.length === 0) {
		findings.push({
			category: "geo",
			severity: "warning",
			title: "No structured data (JSON-LD) found",
			description: `${url} has no application/ld+json script blocks.`,
			recommendation:
				"Add JSON-LD structured data (Organization, WebSite, and page-specific types) so search and answer engines can extract facts reliably.",
			location: url,
		});
	}

	const parsedTypes = new Set<string>();
	const parsedEntries: Record<string, unknown>[] = [];
	for (const block of jsonLdBlocks) {
		try {
			const parsed = JSON.parse(block);
			const entries = Array.isArray(parsed) ? parsed : [parsed];
			for (const entry of entries) {
				parsedEntries.push(entry);
				const type = entry?.["@type"];
				if (typeof type === "string") parsedTypes.add(type);
				else if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && parsedTypes.add(t));
			}
		} catch {
			// Malformed JSON-LD — surfaced separately below rather than crashing the scan.
		}
	}

	if (jsonLdBlocks.length > 0 && parsedTypes.size === 0) {
		findings.push({
			category: "geo",
			severity: "info",
			title: "Structured data present but unparseable",
			description: `${url} has JSON-LD script block(s) that failed to parse as JSON.`,
			recommendation: "Validate structured data with a JSON-LD linter — malformed blocks are silently ignored by consumers.",
			location: url,
		});
	}

	const orgEntry = parsedEntries.find((entry) => {
		const type = entry?.["@type"];
		const types = Array.isArray(type) ? type : [type];
		return types.some((t) => typeof t === "string" && /Organization|LocalBusiness/i.test(t));
	});
	if (jsonLdBlocks.length > 0 && !orgEntry) {
		findings.push({
			category: "geo",
			severity: "info",
			title: "No Organization/LocalBusiness structured data",
			description: `${url}'s structured data doesn't declare an Organization or LocalBusiness type.`,
			recommendation:
				"Add an Organization (or LocalBusiness) JSON-LD block site-wide so answer engines can attribute facts to your brand.",
			location: url,
		});
	} else if (orgEntry && (!orgEntry.name || !orgEntry.url)) {
		const missing = [!orgEntry.name && "name", !orgEntry.url && "url"].filter(Boolean).join(", ");
		findings.push({
			category: "geo",
			severity: "info",
			title: "Organization structured data is incomplete",
			description: `${url}'s Organization/LocalBusiness JSON-LD is missing: ${missing}.`,
			recommendation: "Fill in every core field (name, url, and ideally logo) so answer engines can attribute facts to your brand confidently.",
			location: url,
		});
	}

	const ogTags = {
		title: /<meta[^>]+property=["']og:title["']/i.test(html),
		description: /<meta[^>]+property=["']og:description["']/i.test(html),
		image: /<meta[^>]+property=["']og:image["']/i.test(html),
	};
	const missingOgTags = Object.entries(ogTags)
		.filter(([, present]) => !present)
		.map(([key]) => `og:${key}`);
	if (missingOgTags.length > 0) {
		findings.push({
			category: "geo",
			severity: "warning",
			title: "Missing Open Graph tags",
			description: `${url} is missing: ${missingOgTags.join(", ")}.`,
			recommendation: "Add Open Graph meta tags so links to this page render correctly (and with the right facts) when shared or summarized.",
			location: url,
		});
	}

	const hasTwitterCard = /<meta[^>]+name=["']twitter:card["']/i.test(html);
	if (!hasTwitterCard) {
		findings.push({
			category: "geo",
			severity: "info",
			title: "Missing Twitter Card meta tag",
			description: `${url} has no <meta name="twitter:card"> tag.`,
			recommendation: 'Add <meta name="twitter:card" content="summary_large_image"> for a proper card preview when the page is shared on X.',
			location: url,
		});
	}

	// --- AEO (answer-engine optimization) ---
	const hasFaqSchema = [...parsedTypes].some((t) => /FAQPage|QAPage/i.test(t));
	if (!hasFaqSchema) {
		const headingTexts = [
			...html.matchAll(/<h[23][^>]*>([^<]*)<\/h[23]>/gi),
		].map((m) => m[1]?.trim() ?? "");
		const questionHeadings = headingTexts.filter((t) =>
			/^(what|how|why|when|where|who|can|does|is)\b/i.test(t),
		);
		if (questionHeadings.length > 0) {
			findings.push({
				category: "aeo",
				severity: "info",
				title: "Question-style headings without FAQPage schema",
				description: `${url} has ${questionHeadings.length} question-style heading(s) but no FAQPage/QAPage structured data.`,
				recommendation:
					"Wrap Q&A-style content in FAQPage JSON-LD so answer engines (and search AI overviews) can surface it directly.",
				location: url,
			});
		}
	}

	return { findings, title, description };
}

/** Runs the full crawl + on-page analysis for a domain. Network failures on
 * individual pages are recorded as findings rather than aborting the whole
 * run — a single broken page shouldn't hide findings from the rest of the
 * site. */
export async function crawlAndAnalyze(
	domain: string,
): Promise<{ findings: DraftFinding[]; pagesScanned: number }> {
	const baseUrl = normalizeDomain(domain);
	const urls = await discoverUrls(baseUrl);
	const findings: DraftFinding[] = [];
	let pagesScanned = 0;
	const pageMeta: { url: string; title: string | null; description: string | null }[] = [];

	for (const url of urls) {
		const startedAt = Date.now();
		const page = await fetchText(url);
		const elapsedMs = Date.now() - startedAt;
		if (!page || page.status >= 400) {
			findings.push({
				category: "seo",
				severity: "critical",
				title: "Page unreachable",
				description: `${url} ${page ? `returned HTTP ${page.status}` : "could not be fetched"}.`,
				recommendation: "Fix the broken URL or remove it from the sitemap/navigation.",
				location: url,
			});
			continue;
		}
		pagesScanned += 1;
		const analyzed = analyzePageHtml(url, page.body);
		findings.push(...analyzed.findings);
		pageMeta.push({ url, title: analyzed.title, description: analyzed.description });

		if (elapsedMs > 2000) {
			findings.push({
				category: "seo",
				severity: "info",
				title: "Slow response time",
				description: `${url} took ${elapsedMs}ms to respond.`,
				recommendation: "Pages over ~2s hurt both crawl budget and user experience — check caching, CDN, and server-side rendering cost.",
				location: url,
			});
		}
	}

	if (pageMeta.length > 1) {
		findings.push(...findDuplicateMetaFindings(pageMeta, "title"));
		findings.push(...findDuplicateMetaFindings(pageMeta, "description"));
	}

	const llmsTxt = await fetchText(new URL("/llms.txt", baseUrl).toString());
	if (!llmsTxt || llmsTxt.status >= 400) {
		findings.push({
			category: "aeo",
			severity: "info",
			title: "No llms.txt found",
			description: `${baseUrl} has no /llms.txt file.`,
			recommendation:
				"Add an llms.txt at the domain root summarizing the site for AI crawlers and answer engines (see llmstxt.org).",
			location: baseUrl,
		});
	}

	return { findings, pagesScanned };
}

/** Known blog-content directory conventions, checked in order — the first
 * one that exists under repoPath wins. Covers Next.js/Astro/Hugo-ish
 * layouts without needing per-framework detection logic. */
const BLOG_DIR_CANDIDATES = [
	{ dir: "content/blog", frontmatterStyle: "yaml" },
	{ dir: "src/content/blog", frontmatterStyle: "yaml" },
	{ dir: "posts", frontmatterStyle: "yaml" },
	{ dir: "src/posts", frontmatterStyle: "yaml" },
	{ dir: "blog", frontmatterStyle: "yaml" },
	{ dir: "app/blog", frontmatterStyle: "yaml" },
	{ dir: "src/app/blog", frontmatterStyle: "yaml" },
];

async function pathIsDirectory(target: string): Promise<boolean> {
	try {
		const stat = await fs.stat(target);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

/** Repo-side checks that don't require network access: robots.txt/sitemap
 * presence, Next.js metadata usage, and blog directory detection. Runs
 * alongside crawlAndAnalyze so a linked project gets both "what the live
 * site shows" and "what the source is set up to produce" findings. */
export async function analyzeRepoSource(repoPath: string): Promise<{
	findings: DraftFinding[];
	blogConfig: { dir: string; frontmatterStyle: string } | null;
}> {
	const findings: DraftFinding[] = [];

	const robotsExists =
		(await pathIsDirectory(repoPath)) &&
		(await Promise.all(
			["public/robots.txt", "static/robots.txt", "app/robots.ts", "app/robots.js"].map(
				async (rel) => {
					try {
						await fs.access(path.join(repoPath, rel));
						return true;
					} catch {
						return false;
					}
				},
			),
		)).some(Boolean);
	if (!robotsExists) {
		findings.push({
			category: "seo",
			severity: "warning",
			title: "No robots.txt found in repo",
			description: "None of the common robots.txt locations exist under the linked repo.",
			recommendation: "Add a robots.txt (or a Next.js app/robots.ts) so crawlers get explicit guidance.",
			location: repoPath,
		});
	}

	const sitemapExists = (
		await Promise.all(
			["public/sitemap.xml", "app/sitemap.ts", "app/sitemap.js"].map(async (rel) => {
				try {
					await fs.access(path.join(repoPath, rel));
					return true;
				} catch {
					return false;
				}
			}),
		)
	).some(Boolean);
	if (!sitemapExists) {
		findings.push({
			category: "seo",
			severity: "warning",
			title: "No sitemap generation found in repo",
			description: "None of the common sitemap.xml locations exist under the linked repo.",
			recommendation: "Add a generated sitemap.xml (or a Next.js app/sitemap.ts) so search engines can discover every page.",
			location: repoPath,
		});
	}

	let blogConfig: { dir: string; frontmatterStyle: string } | null = null;
	for (const candidate of BLOG_DIR_CANDIDATES) {
		if (await pathIsDirectory(path.join(repoPath, candidate.dir))) {
			blogConfig = candidate;
			break;
		}
	}

	return { findings, blogConfig };
}

/** 100 minus a per-severity penalty, floored at 0 — deliberately simple
 * (no weighting by category) so the score stays easy to explain: "critical
 * issues cost the most, info notes barely move it." */
function scoreFindings(findings: DraftFinding[]): number {
	const penalty = findings.reduce((sum, f) => {
		if (f.severity === "critical") return sum + 15;
		if (f.severity === "warning") return sum + 6;
		return sum + 2;
	}, 0);
	return Math.max(0, 100 - penalty);
}

/** Orchestrates one full analysis run for a linked project: crawls the live
 * domain, scans the repo source, persists every finding, and updates the
 * run record with a score/summary. Runs entirely server-side — the tRPC
 * mutation just calls this and returns the resulting run. */
export async function runSeoAnalysis(
	seoProjectId: string,
): Promise<SeoAnalysisRunRecord> {
	const db = getDb();
	const project = await db.getSeoProject(seoProjectId);
	if (!project) throw new Error(`Unknown SEO project: ${seoProjectId}`);

	const run = await db.createSeoAnalysisRun({
		seoProjectId,
		workspaceId: project.workspaceId,
	});

	try {
		const [crawl, repoScan] = await Promise.all([
			crawlAndAnalyze(project.domain),
			analyzeRepoSource(project.repoPath),
		]);
		const findings = [...crawl.findings, ...repoScan.findings];

		// Reconcile against what's already open instead of re-inserting the same
		// finding every re-scan: a finding detected again this run stays exactly
		// as it was (still tied to whichever run first found it); a finding that
		// was open but isn't detected this time gets auto-resolved (fixed, or
		// the page/condition is gone); only genuinely new ones get a new row.
		const existingOpen = await db.listOpenSeoFindingsByProject(seoProjectId);
		const existingByKey = new Map(existingOpen.map((f) => [findingKey(f), f]));
		const detectedKeys = new Set<string>();
		let newCount = 0;

		for (const finding of findings) {
			const key = findingKey(finding);
			detectedKeys.add(key);
			if (existingByKey.has(key)) continue;
			await db.createSeoFinding({ runId: run.id, seoProjectId, ...finding });
			newCount++;
		}

		let resolvedCount = 0;
		for (const [key, existing] of existingByKey) {
			if (detectedKeys.has(key)) continue;
			await db.setSeoFindingResolved(existing.id, true);
			resolvedCount++;
		}

		if (repoScan.blogConfig && !project.blogConfig) {
			await db.updateSeoProject(seoProjectId, { blogConfig: repoScan.blogConfig });
		}

		const score = scoreFindings(findings);
		const critical = findings.filter((f) => f.severity === "critical").length;
		const warning = findings.filter((f) => f.severity === "warning").length;
		const info = findings.filter((f) => f.severity === "info").length;
		const summary = `${findings.length} open finding(s): ${critical} critical, ${warning} warning, ${info} info (${newCount} new, ${resolvedCount} resolved since last run).`;

		const completed = await db.updateSeoAnalysisRun(run.id, {
			status: "completed",
			score,
			pagesScanned: crawl.pagesScanned,
			summary,
			completedAt: new Date(),
		});

		await logAudit({
			workspaceId: project.workspaceId,
			actor: "extension",
			toolLabel: "seo_analyzer.run_analysis",
			input: { seoProjectId, domain: project.domain },
			output: { score, pagesScanned: crawl.pagesScanned, findingCount: findings.length },
			status: "success",
		});
		await notifyWorkspaceOwner(project.workspaceId, {
			title: "SEO analysis complete",
			body: `${project.domain}: score ${score} — ${summary}`,
			url: `/workspace/${project.workspaceId}/extensions/seo-analyzer`,
			tag: `seo-analysis-${seoProjectId}`,
		});

		return completed;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const failed = await db.updateSeoAnalysisRun(run.id, {
			status: "failed",
			errorMessage: message,
			completedAt: new Date(),
		});

		await logAudit({
			workspaceId: project.workspaceId,
			actor: "extension",
			toolLabel: "seo_analyzer.run_analysis",
			input: { seoProjectId, domain: project.domain },
			output: message,
			status: "error",
		});

		return failed;
	}
}

/** The claude-seo plugin auto-installed alongside this extension (see
 * EXTENSION_CATALOG's `pluginRepoUrl` in extensions.ts) — kept as its own
 * constant rather than importing extensions.ts, so this module doesn't need
 * to know the extension-catalog shape, just which repo to look for. */
const SEO_PLUGIN_REPO_URL = "https://github.com/AgricIDaniel/claude-seo";

/** Keyword heuristics matching a plugin skill/sub-agent's name+description to
 * a finding category — the plugin's actual skill set isn't known ahead of
 * time (any GitHub repo can be installed here, not just claude-seo), so this
 * is deliberately generic substring matching rather than a hardcoded id list. */
const CATEGORY_KEYWORDS: Record<SeoFindingCategory, string[]> = {
	seo: ["technical", "page", "sitemap", "hreflang", "image", "site", "crawl", "core web vital", "audit"],
	geo: ["geo", "schema", "structured", "organization", "local", "maps", "backlink", "google"],
	aeo: ["aeo", "answer", "faq", "content", "sxo", "citation", "cluster", "programmatic", "drift"],
};

export function matchesCategory(text: string, categories: SeoFindingCategory[]): boolean {
	const lower = text.toLowerCase();
	return categories.some((category) =>
		CATEGORY_KEYWORDS[category].some((keyword) => lower.includes(keyword)),
	);
}

/** Matches the installed plugin's skills against the categories being worked
 * on this dispatch. Falls back to every skill the plugin ships if nothing
 * matches (an unfamiliar plugin whose naming doesn't hit these keywords)
 * rather than silently using none of it. */
export async function pickRelevantPluginSkills(
	plugin: PluginRecord,
	categories: SeoFindingCategory[],
): Promise<{ skillIds: string[]; skillNames: string[] }> {
	const definitions = await loadPluginSkillDefinitions(plugin);
	const matched = definitions.filter((skill) =>
		matchesCategory(`${skill.name} ${skill.description}`, categories),
	);
	const chosen = matched.length > 0 ? matched : definitions;
	return { skillIds: chosen.map((s) => s.id), skillNames: chosen.map((s) => s.name) };
}

/** Same idea as pickRelevantPluginSkills but for the plugin's parsed
 * sub-agent personas (agents/*.md) — these aren't wired into the runtime as
 * real agents (see ADR-0014), but their instructions are still useful
 * context to fold into the fixer's system prompt. Unlike skills, an
 * unmatched persona is just skipped rather than dumping all of them in. */
export function pickRelevantPluginPersonas(
	plugin: PluginRecord,
	categories: SeoFindingCategory[],
): PluginAgentDefinition[] {
	return plugin.agentDefs.filter((agent) =>
		matchesCategory(`${agent.name} ${agent.description}`, categories),
	);
}

const CHEAP_MODEL_MARKERS = ["mini", "haiku", "flash", "nano", "lite"];
const STRONG_MODEL_MARKERS = ["opus", "gpt-5", "o3", "gemini-2.5-pro", "gemini-pro", "sonnet"];

/** Picks the strongest-looking model actually available to the workspace for
 * the SEO fixer agent, instead of blindly reusing whatever casual default is
 * set for everyday chat. This is a heuristic, not a real capability lookup
 * (Nyxel doesn't track per-model benchmark tiers) — it ranks by known
 * high-end model family name fragments, skips obviously-cheap variants
 * (mini/haiku/flash/...), and falls back to the workspace default (then to
 * any installed model) if nothing ranks. */
export async function pickBestModelIdForSeo(
	workspaceId: string,
	fallback: string | null,
): Promise<string> {
	const providers = await getInstalledProvidersForWorkspace(workspaceId);
	const models = await listAvailableModels(providers);
	const candidates = models.filter(
		(m) => !CHEAP_MODEL_MARKERS.some((marker) => m.id.toLowerCase().includes(marker)),
	);
	for (const marker of STRONG_MODEL_MARKERS) {
		const match = candidates.find((m) => m.id.toLowerCase().includes(marker));
		if (match) return match.id;
	}
	const [firstCandidate] = candidates;
	if (firstCandidate) return firstCandidate.id;
	if (fallback) return fallback;
	const [firstModel] = models;
	if (firstModel) return firstModel.id;
	throw new Error(
		"No models are installed for this workspace — add one in Settings before running SEO analysis.",
	);
}

function seoFixerSystemPrompt(
	project: SeoProjectRecord,
	personas: PluginAgentDefinition[],
): string {
	const prose = [
		`You are the SEO/GEO/AEO fixer agent for "${project.domain}".`,
		`Its source lives at "${project.repoPath}" — every file tool you have is scoped to that directory, so use relative paths from there.`,
		"You will be given a list of SEO/GEO/AEO findings (each with a category, severity, description, and recommendation). Fix as many as you reasonably can by editing the repo source directly — meta tags, structured data, headings, alt text, robots.txt, sitemap generation, etc.",
		"Prefer minimal, targeted edits over rewrites. If a finding needs a decision only a human can make (e.g. business-specific copy), leave a clear TODO comment instead of guessing content.",
		"When you're done, summarize exactly what you changed and which findings you addressed.",
	].join(" ");
	if (personas.length === 0) return prose;
	const personaBlock = [
		"",
		"",
		"You also have skills from an installed SEO plugin available as tools — invoke them before editing, their instructions go deeper than this prompt. Specialist personas relevant to this batch:",
		...personas.map((p) => `- ${p.name}: ${p.description}`),
	].join("\n");
	return prose + personaBlock;
}

export interface FixerAgentSelection {
	agent: AgentRecord;
	modelId: string;
	pluginSkillNames: string[];
}

/** Prepares the fixer agent for a specific batch of findings/categories.
 * Lazily provisions the dedicated per-project agent on first use, scoped to
 * the project's repoPath via dedicated DB tools (never the workspace-wide
 * toolset) so it can never touch files outside the linked repo. Unless the
 * user has pinned a different agent via setFixerAgent, the auto-provisioned
 * agent's skillIds/systemPrompt/modelId are refreshed on every call so it
 * draws on whichever installed-plugin specialist skills/personas actually
 * match these categories and runs on the strongest model available, instead
 * of being frozen at whatever was configured the first time it ran. */
async function configureSeoFixerAgent(
	project: SeoProjectRecord,
	categories: SeoFindingCategory[],
): Promise<FixerAgentSelection> {
	const db = getDb();

	if (project.fixerAgentId) {
		const pinned = await db.getAgent(project.fixerAgentId);
		if (pinned && pinned.name !== `SEO Fixer — ${project.domain}`) {
			// User-pinned, non-auto-provisioned agent (see FixerAgentControl on
			// the web client) — respect it as configured, don't overwrite it.
			return { agent: pinned, modelId: pinned.modelId, pluginSkillNames: [] };
		}
	}

	const workspace = await db.getWorkspace(project.workspaceId);
	if (!workspace?.defaultModelId && !project.fixerAgentId) {
		throw new Error(
			"Set a default model for this workspace before dispatching SEO fixes (Settings → General).",
		);
	}

	const plugin = await findPluginByRepoUrl(project.workspaceId, SEO_PLUGIN_REPO_URL);
	const { skillIds: pluginSkillIds, skillNames: pluginSkillNames } = plugin
		? await pickRelevantPluginSkills(plugin, categories)
		: { skillIds: [], skillNames: [] };
	const personas = plugin ? pickRelevantPluginPersonas(plugin, categories) : [];
	const modelId = await pickBestModelIdForSeo(
		project.workspaceId,
		workspace?.defaultModelId ?? null,
	);
	const systemPrompt = seoFixerSystemPrompt(project, personas);

	const existing = project.fixerAgentId ? await db.getAgent(project.fixerAgentId) : null;
	if (existing) {
		const updated = await db.updateAgent(existing.id, {
			systemPrompt,
			modelId,
			skillIds: pluginSkillIds,
		});
		return { agent: updated, modelId, pluginSkillNames };
	}

	const dirConfig = { allowedDirs: [project.repoPath] };
	const toolSeeds: { kind: "file_read" | "file_list" | "file_write" | "file_patch"; name: string; description: string; sensitive: boolean }[] = [
		{ kind: "file_read", name: "SEO fixer: read file", description: `Read a file under ${project.repoPath}.`, sensitive: false },
		{ kind: "file_list", name: "SEO fixer: list files", description: `List files under ${project.repoPath}.`, sensitive: false },
		{ kind: "file_write", name: "SEO fixer: write file", description: `Write a file under ${project.repoPath}.`, sensitive: true },
		{ kind: "file_patch", name: "SEO fixer: patch file", description: `Apply a targeted edit to a file under ${project.repoPath}.`, sensitive: true },
	];
	const tools = await Promise.all(
		toolSeeds.map((seed) =>
			db.createTool({
				workspaceId: project.workspaceId,
				name: seed.name,
				description: seed.description,
				kind: seed.kind,
				config: dirConfig,
				sensitive: seed.sensitive,
				enabled: true,
			}),
		),
	);

	const agent = await db.createAgent({
		workspaceId: project.workspaceId,
		name: `SEO Fixer — ${project.domain}`,
		systemPrompt,
		modelId,
		autonomyLevel: "assisted",
		toolIds: tools.map((t) => t.id),
		skillIds: pluginSkillIds,
	});

	await db.updateSeoProject(project.id, { fixerAgentId: agent.id });
	return { agent, modelId, pluginSkillNames };
}

function formatFindingForPrompt(finding: SeoFindingRecord, index: number): string {
	const location = finding.location ? ` (${finding.location})` : "";
	return [
		`${index + 1}. [${finding.category.toUpperCase()}/${finding.severity}] ${finding.title}${location}`,
		`   ${finding.description}`,
		`   Recommendation: ${finding.recommendation}`,
	].join("\n");
}

/** Dispatches the fixer agent at a chosen set of findings for a project,
 * running synchronously to completion (same "await the whole run" shape as
 * automations.runNow) and marking every targeted finding resolved once the
 * run finishes without throwing. */
export async function dispatchSeoFix(
	seoProjectId: string,
	findingIds: string[],
): Promise<{
	taskId: string;
	runId: string;
	output: string;
	modelId: string;
	pluginSkillsUsed: string[];
}> {
	const db = getDb();
	const project = await db.getSeoProject(seoProjectId);
	if (!project) throw new Error(`Unknown SEO project: ${seoProjectId}`);
	if (findingIds.length === 0) throw new Error("Select at least one finding to fix.");

	const findings = (
		await Promise.all(findingIds.map((id) => db.getSeoFinding(id)))
	).filter((f): f is SeoFindingRecord => f !== null && f.seoProjectId === seoProjectId);
	if (findings.length === 0) throw new Error("None of the selected findings belong to this project.");

	const categories = [...new Set(findings.map((f) => f.category))];
	const { agent, modelId, pluginSkillNames } = await configureSeoFixerAgent(project, categories);

	const instruction = [
		`Fix the following ${findings.length} SEO/GEO/AEO finding(s) for ${project.domain}:`,
		"",
		...findings.map((f, i) => formatFindingForPrompt(f, i)),
	].join("\n");

	const task = await db.createTask({
		workspaceId: project.workspaceId,
		assignedAgentId: agent.id,
		title: `Fix ${findings.length} SEO finding(s) — ${project.domain}`,
		instruction,
		input: { seoProjectId, findingIds: findings.map((f) => f.id) },
	});

	const result = await executeManagedTask({
		taskId: task.id,
		agent,
		trigger: "extension",
		workingDirectory: project.repoPath,
	});

	for (const finding of findings) {
		await db.setSeoFindingResolved(finding.id, true);
	}

	await logAudit({
		workspaceId: project.workspaceId,
		agentId: agent.id,
		actor: "extension",
		toolLabel: "seo_analyzer.dispatch_fix",
		input: { seoProjectId, findingIds: findings.map((f) => f.id), categories },
		output: { output: result.output, modelId, pluginSkillNames },
		status: "success",
	});
	await notifyWorkspaceOwner(project.workspaceId, {
		title: "SEO fixes applied",
		body: `${project.domain}: fixer agent addressed ${findings.length} finding(s).`,
		url: `/workspace/${project.workspaceId}/extensions/seo-analyzer`,
		tag: `seo-fix-${seoProjectId}`,
	});

	return {
		taskId: task.id,
		runId: result.run.id,
		output: result.output,
		modelId,
		pluginSkillsUsed: pluginSkillNames,
	};
}

/** Generates one blog post targeting `keyword`, dispatched to the same
 * repo-scoped fixer agent used for findings. Requires a detected blog
 * directory (set by analyzeRepoSource during a prior analysis run, or
 * re-detected here if the project predates that detection). */
export async function generateSeoBlogPost(
	seoProjectId: string,
	keyword: string,
): Promise<SeoBlogPostRecord> {
	const db = getDb();
	const project = await db.getSeoProject(seoProjectId);
	if (!project) throw new Error(`Unknown SEO project: ${seoProjectId}`);

	let blogConfig = project.blogConfig;
	if (!blogConfig) {
		const scan = await analyzeRepoSource(project.repoPath);
		blogConfig = scan.blogConfig;
		if (blogConfig) await db.updateSeoProject(seoProjectId, { blogConfig });
	}
	if (!blogConfig) {
		throw new Error(
			"No blog directory detected in this repo yet — run an analysis first, or this site may not have a blog.",
		);
	}

	const post = await db.createSeoBlogPost({
		seoProjectId,
		workspaceId: project.workspaceId,
		keyword,
	});

	try {
		// Content generation draws on the plugin's content/AEO-flavored skills
		// (not GEO — structured-data specialists have little to add to drafting
		// prose) — see configureSeoFixerAgent.
		const { agent, modelId, pluginSkillNames } = await configureSeoFixerAgent(project, [
			"seo",
			"aeo",
		]);
		await db.updateSeoBlogPost(post.id, { status: "generating" });

		const instruction = [
			`Write a new blog post targeting the keyword "${keyword}" for ${project.domain}.`,
			`The blog content directory is "${blogConfig.dir}" (relative to the repo root); the site's frontmatter convention is "${blogConfig.frontmatterStyle}".`,
			"1. List the files in that directory and read one or two existing posts to learn the frontmatter fields and tone used.",
			"2. Write a new, original, genuinely useful markdown post targeting the keyword — not thin or duplicate content — matching the site's existing frontmatter and style.",
			"3. Pick a URL-safe filename slug derived from the keyword.",
			"4. On the final line of your response, report the result in exactly this format: FILE: <path relative to repo root> TITLE: <post title>",
		].join("\n");

		const task = await db.createTask({
			workspaceId: project.workspaceId,
			assignedAgentId: agent.id,
			title: `Draft blog post — "${keyword}" (${project.domain})`,
			instruction,
			input: { seoProjectId, blogPostId: post.id, keyword },
		});

		const result = await executeManagedTask({
			taskId: task.id,
			agent,
			trigger: "extension",
			workingDirectory: project.repoPath,
		});

		const fileMatch = result.output.match(/FILE:\s*(\S+)/i);
		const titleMatch = result.output.match(/TITLE:\s*(.+)/i);
		const title = titleMatch?.[1]?.trim() ?? null;
		const filePath = fileMatch?.[1]?.trim() ?? null;

		const written = await db.updateSeoBlogPost(post.id, {
			status: "written",
			filePath,
			title,
			taskId: task.id,
		});

		await logAudit({
			workspaceId: project.workspaceId,
			agentId: agent.id,
			actor: "extension",
			toolLabel: "seo_analyzer.generate_blog_post",
			input: { seoProjectId, keyword },
			output: { title, filePath, modelId, pluginSkillNames },
			status: "success",
		});
		await notifyWorkspaceOwner(project.workspaceId, {
			title: "Blog post drafted",
			body: `${project.domain}: "${title ?? keyword}" is ready for review.`,
			url: `/workspace/${project.workspaceId}/extensions/seo-analyzer`,
			tag: `seo-blog-${post.id}`,
		});

		return written;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const failed = await db.updateSeoBlogPost(post.id, {
			status: "failed",
			errorMessage: message,
		});

		await logAudit({
			workspaceId: project.workspaceId,
			actor: "extension",
			toolLabel: "seo_analyzer.generate_blog_post",
			input: { seoProjectId, keyword },
			output: message,
			status: "error",
		});

		return failed;
	}
}
