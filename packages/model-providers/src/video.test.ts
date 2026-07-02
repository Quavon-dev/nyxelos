import { describe, expect, it } from "bun:test";
import {
	DEFAULT_VIDEO_MODEL_ID,
	DEFAULT_VIDEO_SECONDS,
	DEFAULT_VIDEO_SIZE,
	getVideoModel,
	resolveVideoProvider,
	selectVideoModelForPrompt,
} from "./video";

describe("selectVideoModelForPrompt", () => {
	it("defaults to the standard model, landscape size, and 8 seconds for a plain prompt", () => {
		const plan = selectVideoModelForPrompt("a cat playing piano");
		expect(plan.modelId).toBe(DEFAULT_VIDEO_MODEL_ID);
		expect(plan.size).toBe(DEFAULT_VIDEO_SIZE);
		expect(plan.seconds).toBe(DEFAULT_VIDEO_SECONDS);
		expect(plan.auto).toBe(true);
	});

	it("picks the pro model for cinematic/photoreal wording", () => {
		const plan = selectVideoModelForPrompt("a cinematic, photorealistic shot of a mountain range");
		expect(plan.modelId).toBe("sora-2-pro");
	});

	it("picks a portrait size for vertical/social wording", () => {
		const plan = selectVideoModelForPrompt("a vertical tiktok video of a dancing robot");
		expect(plan.size).toBe("720x1280");
	});

	it("picks a shorter clip for 'short'/'quick' wording and a longer one for 'long'/'extended'", () => {
		expect(selectVideoModelForPrompt("a quick clip of rain falling").seconds).toBe(4);
		expect(selectVideoModelForPrompt("an extended scene of a sunset").seconds).toBe(12);
	});

	it("respects explicit overrides and reports auto: false when everything is pinned", () => {
		const plan = selectVideoModelForPrompt("a cinematic vertical short clip", {
			model: "sora-2",
			size: "1280x720",
			seconds: 8,
		});
		expect(plan).toEqual({ modelId: "sora-2", size: "1280x720", seconds: 8, auto: false });
	});

	it("snaps an out-of-range explicit duration to the nearest value the model supports", () => {
		const plan = selectVideoModelForPrompt("anything", { seconds: 100 });
		expect(plan.seconds).toBe(12);
	});

	it("falls back to a model's first supported size when an explicit size isn't valid for it", () => {
		const plan = selectVideoModelForPrompt("anything", { size: "9999x9999" });
		expect(getVideoModel(plan.modelId).sizes).toContain(plan.size);
	});
});

describe("resolveVideoProvider", () => {
	it("throws a user-facing error when no OpenAI provider is installed and no env key is set", () => {
		const originalKey = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = undefined;
		try {
			expect(() => resolveVideoProvider([])).toThrow(/OpenAI provider/);
		} finally {
			process.env.OPENAI_API_KEY = originalKey;
		}
	});

	it("prefers an installed, enabled OpenAI provider's key and label over the env var", () => {
		const originalKey = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = "env-key";
		try {
			const resolved = resolveVideoProvider([
				{
					id: "install-1",
					label: "My OpenAI",
					providerKind: "openai",
					baseUrl: "",
					apiKey: "installed-key",
					modelIds: [],
					disabledModelIds: [],
					enabled: true,
				},
			]);
			expect(resolved).toEqual({ apiKey: "installed-key", providerLabel: "My OpenAI" });
		} finally {
			process.env.OPENAI_API_KEY = originalKey;
		}
	});

	it("ignores a disabled OpenAI provider and falls back to the env var", () => {
		const originalKey = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = "env-key";
		try {
			const resolved = resolveVideoProvider([
				{
					id: "install-1",
					label: "Disabled",
					providerKind: "openai",
					baseUrl: "",
					apiKey: "installed-key",
					modelIds: [],
					disabledModelIds: [],
					enabled: false,
				},
			]);
			expect(resolved).toEqual({ apiKey: "env-key", providerLabel: "OpenAI" });
		} finally {
			process.env.OPENAI_API_KEY = originalKey;
		}
	});
});
