import {
	getDb,
	type LibraryFileRecord,
	type VideoGenerationJobRecord,
} from "@nyxel/db";
import {
	getVideoModel,
	resolveVideoProvider,
	selectVideoModelForPrompt,
} from "@nyxel/model-providers";
import { getInstalledProvidersForWorkspace } from "./models";
import { saveLibraryUpload } from "./library";
import { notifyWorkspaceOwner } from "./push";

const OPENAI_VIDEOS_URL = "https://api.openai.com/v1/videos";

/** Generation typically takes 1-5 minutes; polling stops (and the job is
 * marked failed) past this wall-clock budget rather than hanging a chat tool
 * call forever. */
const MAX_POLL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OpenAiVideoObject {
	id: string;
	status: "queued" | "in_progress" | "completed" | "failed";
	progress?: number;
	error?: { message?: string } | null;
}

async function readOpenAiError(res: Response): Promise<string> {
	const body = await res.json().catch(() => null);
	const message =
		body && typeof body === "object" && body !== null
			? ((body as { error?: { message?: string } }).error?.message ?? null)
			: null;
	return message ?? `${res.status} ${res.statusText}`;
}

async function createOpenAiVideo(input: {
	apiKey: string;
	modelId: string;
	prompt: string;
	size: string;
	seconds: number;
	sourceImage?: { base64: string; mimeType: string } | null;
}): Promise<OpenAiVideoObject> {
	const form = new FormData();
	form.append("model", input.modelId);
	form.append("prompt", input.prompt);
	form.append("size", input.size);
	form.append("seconds", String(input.seconds));
	if (input.sourceImage) {
		const bytes = Uint8Array.from(atob(input.sourceImage.base64), (c) => c.charCodeAt(0));
		const ext = input.sourceImage.mimeType.split("/")[1] ?? "png";
		form.append(
			"input_reference",
			new Blob([bytes], { type: input.sourceImage.mimeType }),
			`reference.${ext}`,
		);
	}

	const res = await fetch(OPENAI_VIDEOS_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${input.apiKey}` },
		body: form,
	});
	if (!res.ok) {
		throw new Error(`Video generation failed to start: ${await readOpenAiError(res)}`);
	}
	return (await res.json()) as OpenAiVideoObject;
}

async function pollOpenAiVideo(
	videoId: string,
	apiKey: string,
	onProgress: (video: OpenAiVideoObject) => Promise<void>,
): Promise<OpenAiVideoObject> {
	const deadline = Date.now() + MAX_POLL_MS;
	while (true) {
		const res = await fetch(`${OPENAI_VIDEOS_URL}/${videoId}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) {
			throw new Error(`Failed to check video status: ${await readOpenAiError(res)}`);
		}
		const video = (await res.json()) as OpenAiVideoObject;
		await onProgress(video);
		if (video.status === "completed" || video.status === "failed") return video;
		if (Date.now() > deadline) {
			throw new Error(
				"Video generation is taking longer than expected (over 10 minutes) — check back later or try a shorter clip.",
			);
		}
		await sleep(POLL_INTERVAL_MS);
	}
}

async function downloadOpenAiVideoContent(
	videoId: string,
	apiKey: string,
	variant?: "thumbnail",
): Promise<Uint8Array | null> {
	const url = variant
		? `${OPENAI_VIDEOS_URL}/${videoId}/content?variant=${variant}`
		: `${OPENAI_VIDEOS_URL}/${videoId}/content`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
	if (!res.ok) {
		// A missing thumbnail variant shouldn't fail the whole generation — the
		// video itself (the caller's non-optional download) still throws.
		if (variant) return null;
		throw new Error(`Failed to download generated video: ${await readOpenAiError(res)}`);
	}
	return new Uint8Array(await res.arrayBuffer());
}

function slugForFile(prompt: string): string {
	const slug = prompt
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return slug || "video";
}

export interface GenerateVideoInput {
	workspaceId: string;
	chatId?: string | null;
	folderId?: string | null;
	prompt: string;
	/** "auto" (or omitted) lets selectVideoModelForPrompt infer everything
	 * below from the prompt's wording — see packages/model-providers/src/video.ts. */
	model?: string;
	size?: string;
	seconds?: number;
	sourceImage?: { base64: string; mimeType: string } | null;
}

export interface GenerateVideoResult {
	job: VideoGenerationJobRecord;
	file: LibraryFileRecord;
	poster: LibraryFileRecord | null;
}

/** Resolves the provider/model/size/duration and inserts the job row —
 * synchronous enough (no OpenAI call yet) to await directly from a tRPC
 * mutation before returning, so callers get a real job id back immediately
 * instead of waiting on the minutes-long generation itself. */
async function createVideoJob(
	input: GenerateVideoInput,
): Promise<{ job: VideoGenerationJobRecord; apiKey: string; modelId: string }> {
	const installedProviders = await getInstalledProvidersForWorkspace(input.workspaceId);
	const { apiKey, providerLabel } = resolveVideoProvider(installedProviders);
	const plan = selectVideoModelForPrompt(input.prompt, {
		model: input.model && input.model !== "auto" ? input.model : undefined,
		size: input.size,
		seconds: input.seconds,
	});
	const model = getVideoModel(plan.modelId);

	const job = await getDb().createVideoGenerationJob({
		workspaceId: input.workspaceId,
		chatId: input.chatId ?? null,
		prompt: input.prompt,
		model: model.id,
		provider: providerLabel,
		size: plan.size,
		seconds: plan.seconds,
		auto: plan.auto,
	});
	return { job, apiKey, modelId: model.id };
}

/** Runs an already-created job to completion: calls the OpenAI Videos API,
 * polls until done, and saves the result (plus a best-effort poster frame)
 * into the workspace library, updating the job row throughout. */
async function runVideoJob(
	initialJob: VideoGenerationJobRecord,
	input: GenerateVideoInput,
	apiKey: string,
	modelId: string,
): Promise<GenerateVideoResult> {
	const db = getDb();
	let job = initialJob;
	try {
		const created = await createOpenAiVideo({
			apiKey,
			modelId,
			prompt: input.prompt,
			size: job.size,
			seconds: job.seconds,
			sourceImage: input.sourceImage,
		});
		job = await db.updateVideoGenerationJob(job.id, {
			status: "in_progress",
			externalJobId: created.id,
		});

		const finished = await pollOpenAiVideo(created.id, apiKey, async (video) => {
			job = await db.updateVideoGenerationJob(job.id, {
				progress: Math.round(video.progress ?? job.progress),
			});
		});

		if (finished.status !== "completed") {
			const message = finished.error?.message ?? "Video generation failed.";
			job = await db.updateVideoGenerationJob(job.id, { status: "failed", errorMessage: message });
			throw new Error(message);
		}

		const videoBytes = await downloadOpenAiVideoContent(finished.id, apiKey);
		if (!videoBytes) throw new Error("Video generation completed but returned no content.");

		const baseName = slugForFile(input.prompt);
		const file = await saveLibraryUpload({
			workspaceId: input.workspaceId,
			folderId: input.folderId ?? null,
			fileName: `${baseName}.mp4`,
			mimeType: "video/mp4",
			bytes: videoBytes,
		});

		let poster: LibraryFileRecord | null = null;
		const posterBytes = await downloadOpenAiVideoContent(finished.id, apiKey, "thumbnail");
		if (posterBytes) {
			poster = await saveLibraryUpload({
				workspaceId: input.workspaceId,
				folderId: input.folderId ?? null,
				fileName: `${baseName}-poster.webp`,
				mimeType: "image/webp",
				bytes: posterBytes,
			});
		}

		job = await db.updateVideoGenerationJob(job.id, {
			status: "completed",
			progress: 100,
			libraryFileId: file.id,
			posterLibraryFileId: poster?.id ?? null,
		});

		await notifyWorkspaceOwner(input.workspaceId, {
			title: "Video ready",
			body: input.prompt,
			url: `/workspace/${input.workspaceId}/video-studio`,
			tag: `video-${job.id}`,
		});

		return { job, file, poster };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Video generation failed.";
		if (job.status !== "failed") {
			job = await db
				.updateVideoGenerationJob(job.id, { status: "failed", errorMessage: message })
				.catch(() => job);
		}
		await notifyWorkspaceOwner(input.workspaceId, {
			title: "Video generation failed",
			body: message,
			url: `/workspace/${input.workspaceId}/video-studio`,
			tag: `video-${job.id}`,
		});
		throw err;
	}
}

/**
 * Runs one full text-to-video generation and blocks until it's done —
 * resolves the model/provider, records a job row, calls the OpenAI Videos
 * API, polls to completion, and saves the finished clip (plus a best-effort
 * poster frame) into the workspace library. Used by the `generate_video`
 * chat tool, which needs the final result as its return value before the
 * agent can continue the conversation.
 */
export async function generateVideo(input: GenerateVideoInput): Promise<GenerateVideoResult> {
	const { job, apiKey, modelId } = await createVideoJob(input);
	return runVideoJob(job, input, apiKey, modelId);
}

/**
 * Starts a text-to-video generation without waiting for it to finish —
 * returns as soon as the job row exists (a single DB insert, no network
 * call yet) and keeps running/updating that job in the background. Used by
 * the `video.generate` tRPC mutation so the Video Studio page gets a job id
 * back immediately instead of holding an HTTP request open for however long
 * generation takes (up to ~10 minutes); the page polls `video.get`/
 * `video.list` to watch progress.
 */
export async function queueVideoGeneration(
	input: GenerateVideoInput,
): Promise<VideoGenerationJobRecord> {
	const { job, apiKey, modelId } = await createVideoJob(input);
	void runVideoJob(job, input, apiKey, modelId).catch((err) => {
		console.error(`Video generation job ${job.id} failed:`, err);
	});
	return job;
}

export async function listVideoGenerationJobsForWorkspace(
	workspaceId: string,
): Promise<VideoGenerationJobRecord[]> {
	return getDb().listVideoGenerationJobsByWorkspace(workspaceId);
}

export async function getVideoGenerationJobById(
	id: string,
): Promise<VideoGenerationJobRecord | null> {
	return getDb().getVideoGenerationJob(id);
}
