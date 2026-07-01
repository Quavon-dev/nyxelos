import type { ToolRecord } from "@nyxel/db";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { type Browser, type Dialog, type Page, chromium } from "playwright";
import { z } from "zod";
import { baseFields } from "./shared";

/** Process-wide, lazily launched, one shared headless browser with named
 * pages (default "default") — see the plan's "browser" row: this is the
 * heaviest new runtime dependency, mirroring the same in-process trust model
 * as custom_code (ADR-0007) rather than a sandboxed subprocess. */
let browserPromise: Promise<Browser> | null = null;
const pages = new Map<string, Page>();
const pendingDialogAction = new Map<string, { accept: boolean; promptText?: string }>();

async function getBrowser(): Promise<Browser> {
	if (!browserPromise) {
		browserPromise = chromium.launch({ headless: true });
	}
	return browserPromise;
}

async function getPage(pageId: string): Promise<Page> {
	const existing = pages.get(pageId);
	if (existing && !existing.isClosed()) return existing;
	const browser = await getBrowser();
	const context = await browser.newContext();
	const page = await context.newPage();
	// Dialogs (alert/confirm/prompt) block the page until handled — default
	// to dismissing unless browser_handle_dialog queued an explicit action for
	// this page first.
	page.on("dialog", async (dialog: Dialog) => {
		const pending = pendingDialogAction.get(pageId);
		pendingDialogAction.delete(pageId);
		if (pending?.accept) {
			await dialog.accept(pending.promptText);
		} else {
			await dialog.dismiss();
		}
	});
	pages.set(pageId, page);
	return page;
}

const pageIdSchema = z.string().default("default");

export function buildBrowserNavigateTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ url: z.string(), pageId: pageIdSchema }),
		permissions: { network: [], filesystem: [] },
		async run({ url, pageId }) {
			const page = await getPage(pageId);
			await page.goto(url, { waitUntil: "domcontentloaded" });
			return { pageId, url: page.url(), title: await page.title() };
		},
	};
}

export function buildBrowserClickTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ selector: z.string(), pageId: pageIdSchema }),
		permissions: { network: [], filesystem: [] },
		async run({ selector, pageId }) {
			const page = await getPage(pageId);
			await page.click(selector);
			return { pageId, clicked: selector };
		},
	};
}

export function buildBrowserDragTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({
			fromSelector: z.string(),
			toSelector: z.string(),
			pageId: pageIdSchema,
		}),
		permissions: { network: [], filesystem: [] },
		async run({ fromSelector, toSelector, pageId }) {
			const page = await getPage(pageId);
			await page.dragAndDrop(fromSelector, toSelector);
			return { pageId, from: fromSelector, to: toSelector };
		},
	};
}

export function buildBrowserHoverTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ selector: z.string(), pageId: pageIdSchema }),
		permissions: { network: [], filesystem: [] },
		async run({ selector, pageId }) {
			const page = await getPage(pageId);
			await page.hover(selector);
			return { pageId, hovered: selector };
		},
	};
}

export function buildBrowserTypeTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ selector: z.string(), text: z.string(), pageId: pageIdSchema }),
		permissions: { network: [], filesystem: [] },
		async run({ selector, text, pageId }) {
			const page = await getPage(pageId);
			await page.fill(selector, text);
			return { pageId, selector, typed: text.length };
		},
	};
}

export function buildBrowserHandleDialogTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({
			action: z.enum(["accept", "dismiss"]),
			promptText: z.string().optional(),
			pageId: pageIdSchema,
		}),
		permissions: { network: [], filesystem: [] },
		async run({ action, promptText, pageId }) {
			pendingDialogAction.set(pageId, { accept: action === "accept", promptText });
			return { pageId, queued: action };
		},
	};
}

export function buildBrowserScreenshotTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ pageId: pageIdSchema }),
		permissions: { network: [], filesystem: [] },
		async run({ pageId }) {
			const page = await getPage(pageId);
			const buffer = await page.screenshot({ type: "png" });
			return { pageId, mimeType: "image/png", base64: buffer.toString("base64") };
		},
	};
}

export function buildBrowserReadPageTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ pageId: pageIdSchema }),
		permissions: { network: [], filesystem: [] },
		async run({ pageId }) {
			const page = await getPage(pageId);
			const text = await page.innerText("body").catch(() => "");
			return { pageId, url: page.url(), text: text.slice(0, 20_000) };
		},
	};
}

/** The most sensitive browser tool — arbitrary code against a live page,
 * same in-process trust model as custom_code (ADR-0007): the approval
 * workflow (sensitive: true by default) is the safety net for what it's
 * allowed to *do*, not a sandbox around what it can *see*. */
export function buildBrowserRunPlaywrightCodeTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ code: z.string(), pageId: pageIdSchema }),
		permissions: { network: [], filesystem: [] },
		async run({ code, pageId }) {
			const page = await getPage(pageId);
			const fn = new Function(
				"page",
				`return (async () => { ${code} })();`,
			) as (page: Page) => Promise<unknown>;
			return fn(page);
		},
	};
}
