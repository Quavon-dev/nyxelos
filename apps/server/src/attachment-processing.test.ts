import { describe, expect, it } from "bun:test";
import { prepareMessageContentForModel } from "./attachment-processing";

const installedProviders = [
	{
		id: "provider-1",
		label: "Anthropic Cloud",
		providerKind: "anthropic" as const,
		baseUrl: "https://api.anthropic.com",
		apiKey: null,
		modelIds: ["claude-sonnet-5"],
		disabledModelIds: [],
		enabled: true,
	},
];

describe("prepareMessageContentForModel", () => {
	it("passes image attachments through natively when the model supports vision", async () => {
		const rawContent = JSON.stringify({
			text: "Inspect this image",
			attachments: [
				{
					name: "diagram.png",
					kind: "image",
					mimeType: "image/png",
					content: "data:image/png;base64,aGVsbG8=",
				},
			],
		});
		const prepared = await prepareMessageContentForModel({
			rawContent,
			modelId: "anthropic/claude-sonnet-5",
			installedProviders,
		});
		expect(Array.isArray(prepared)).toBe(true);
		expect(prepared).toEqual([
			{ type: "text", text: "Inspect this image" },
			{
				type: "image",
				image: "data:image/png;base64,aGVsbG8=",
				mediaType: "image/png",
			},
		]);
	});

	it("falls back to extracted text for pdfs on non-native models", async () => {
		const rawContent = JSON.stringify({
			text: "Read this PDF",
			attachments: [
				{
					name: "spec.pdf",
					kind: "pdf",
					mimeType: "application/pdf",
					content: "data:application/pdf;base64,JVBERi0xLjQKSGVsbG8gUERGCg==",
				},
			],
		});
		const prepared = await prepareMessageContentForModel({
			rawContent,
			modelId: "ollama/llama3",
			installedProviders: [],
		});
		expect(Array.isArray(prepared)).toBe(true);
		expect(prepared[1]).toMatchObject({
			type: "text",
		});
	});
});
