import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LibraryFileRecord } from "@nyxel/db";
import { getLibraryFileForDownload, saveLibraryUpload } from "./library";

export type VideoEditOperation =
	| "trim"
	| "concat"
	| "mute"
	| "volume"
	| "speed"
	| "extractFrame"
	| "toGif";

export interface EditVideoInput {
	workspaceId: string;
	folderId?: string | null;
	operation: VideoEditOperation;
	/** Source video for every operation except "concat". */
	libraryFileId?: string;
	/** Ordered source videos for "concat" — at least two. */
	libraryFileIds?: string[];
	/** "trim": clip bounds. "toGif": optional clip bounds before sampling frames. */
	startSeconds?: number;
	endSeconds?: number;
	/** "volume": multiplier, e.g. 0.5 = half, 2 = double. */
	volume?: number;
	/** "speed": playback-rate multiplier, e.g. 0.5 = half speed, 2 = double. */
	speed?: number;
	/** "extractFrame": timestamp to grab, in seconds. */
	timestampSeconds?: number;
	/** "toGif": sampling rate for the output GIF. */
	fps?: number;
}

export interface EditVideoResult {
	file: LibraryFileRecord;
}

function ffmpegBinary(): string {
	const bin = Bun.which("ffmpeg");
	if (!bin) {
		throw new Error(
			"Video editing needs ffmpeg installed on the server host — it isn't bundled with Nyxel. Install ffmpeg and restart the server.",
		);
	}
	return bin;
}

async function runFfmpeg(args: string[]): Promise<void> {
	const proc = Bun.spawn([ffmpegBinary(), "-y", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stderr, exitCode] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`ffmpeg failed (exit ${exitCode}): ${stderr.trim().slice(-2000)}`);
	}
}

async function requireVideoFile(
	libraryFileId: string | undefined,
): Promise<{ file: LibraryFileRecord; diskPath: string }> {
	if (!libraryFileId) throw new Error("libraryFileId is required for this operation.");
	const result = await getLibraryFileForDownload(libraryFileId);
	if (!result) throw new Error(`Unknown library file: ${libraryFileId}`);
	if (result.file.kind !== "video") {
		throw new Error(`"${result.file.name}" isn't a video in the library (kind: ${result.file.kind}).`);
	}
	return result;
}

function baseNameFor(file: LibraryFileRecord): string {
	return file.name.replace(/\.[^./]+$/, "");
}

/**
 * Cheap, synchronous shape checks for each operation — kept separate from
 * `editVideo` (and run before it touches ffmpeg or the library) so a
 * malformed request fails with a specific, useful message instead of
 * "ffmpeg is missing" or a library-file-not-found error, and so this logic
 * is unit-testable without ffmpeg installed or a database configured.
 */
export function validateEditInput(input: EditVideoInput): void {
	if (input.operation === "concat") {
		if ((input.libraryFileIds ?? []).length < 2) {
			throw new Error("concat needs at least two libraryFileIds.");
		}
		return;
	}
	if (!input.libraryFileId) {
		throw new Error("libraryFileId is required for this operation.");
	}
	if (input.endSeconds != null) {
		const duration = input.endSeconds - (input.startSeconds ?? 0);
		if (duration <= 0) throw new Error("endSeconds must be greater than startSeconds.");
	}
	if (input.operation === "volume" && input.volume != null && input.volume < 0) {
		throw new Error("volume must be 0 or greater.");
	}
	if (input.operation === "speed" && input.speed != null && input.speed <= 0) {
		throw new Error("speed must be greater than 0.");
	}
}

/** ffmpeg's `atempo` filter only accepts 0.5-2.0 per instance — chain
 * multiple to reach speeds outside that range (e.g. 4x = atempo=2,atempo=2). */
function atempoChain(speed: number): string {
	const filters: string[] = [];
	let remaining = speed;
	while (remaining > 2) {
		filters.push("atempo=2.0");
		remaining /= 2;
	}
	while (remaining < 0.5) {
		filters.push("atempo=0.5");
		remaining /= 0.5;
	}
	filters.push(`atempo=${remaining.toFixed(6)}`);
	return filters.join(",");
}

/**
 * Runs one ffmpeg-backed edit against a video already saved in the workspace
 * library and writes the result back as a new library file (edits are
 * non-destructive — the source clip is untouched). Shared by the
 * `edit_video` chat tool and the Video Studio page's edit panel.
 */
export async function editVideo(input: EditVideoInput): Promise<EditVideoResult> {
	validateEditInput(input);
	ffmpegBinary(); // fail fast, before touching any library files, if ffmpeg is missing
	const tmpDir = await mkdtemp(path.join(os.tmpdir(), "nyxel-video-edit-"));
	try {
		const isImageOutput = input.operation === "extractFrame" || input.operation === "toGif";
		const ext = input.operation === "extractFrame" ? "png" : input.operation === "toGif" ? "gif" : "mp4";
		const outputPath = path.join(tmpDir, `output.${ext}`);
		const save = async (fileName: string) => {
			const bytes = new Uint8Array(await Bun.file(outputPath).arrayBuffer());
			return saveLibraryUpload({
				workspaceId: input.workspaceId,
				folderId: input.folderId ?? null,
				fileName,
				mimeType: isImageOutput ? (input.operation === "toGif" ? "image/gif" : "image/png") : "video/mp4",
				bytes,
			});
		};

		switch (input.operation) {
			case "trim": {
				const { file, diskPath } = await requireVideoFile(input.libraryFileId);
				const args = ["-i", diskPath];
				if (input.startSeconds != null) args.push("-ss", String(input.startSeconds));
				if (input.endSeconds != null) {
					const duration = input.endSeconds - (input.startSeconds ?? 0);
					if (duration <= 0) throw new Error("endSeconds must be greater than startSeconds.");
					args.push("-t", String(duration));
				}
				// Stream-copy (no re-encode) — fast, but the cut snaps to the
				// nearest keyframe rather than being frame-exact.
				args.push("-c", "copy", outputPath);
				await runFfmpeg(args);
				return { file: await save(`${baseNameFor(file)}-trimmed.mp4`) };
			}

			case "concat": {
				const ids = input.libraryFileIds ?? [];
				if (ids.length < 2) throw new Error("concat needs at least two libraryFileIds.");
				const sources = await Promise.all(ids.map((id) => requireVideoFile(id)));
				const listPath = path.join(tmpDir, "concat.txt");
				await Bun.write(
					listPath,
					sources.map((s) => `file '${s.diskPath.replace(/'/g, "'\\''")}'`).join("\n"),
				);
				await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
				return { file: await save("concatenated.mp4") };
			}

			case "mute": {
				const { file, diskPath } = await requireVideoFile(input.libraryFileId);
				await runFfmpeg(["-i", diskPath, "-c:v", "copy", "-an", outputPath]);
				return { file: await save(`${baseNameFor(file)}-muted.mp4`) };
			}

			case "volume": {
				const { file, diskPath } = await requireVideoFile(input.libraryFileId);
				const volume = input.volume ?? 1;
				if (volume < 0) throw new Error("volume must be 0 or greater.");
				await runFfmpeg(["-i", diskPath, "-c:v", "copy", "-af", `volume=${volume}`, outputPath]);
				return { file: await save(`${baseNameFor(file)}-volume.mp4`) };
			}

			case "speed": {
				const { file, diskPath } = await requireVideoFile(input.libraryFileId);
				const speed = input.speed ?? 1;
				if (speed <= 0) throw new Error("speed must be greater than 0.");
				await runFfmpeg([
					"-i",
					diskPath,
					"-filter:v",
					`setpts=${(1 / speed).toFixed(6)}*PTS`,
					"-filter:a",
					atempoChain(speed),
					outputPath,
				]);
				return { file: await save(`${baseNameFor(file)}-${speed}x.mp4`) };
			}

			case "extractFrame": {
				const { file, diskPath } = await requireVideoFile(input.libraryFileId);
				const timestamp = input.timestampSeconds ?? 0;
				await runFfmpeg(["-ss", String(timestamp), "-i", diskPath, "-frames:v", "1", outputPath]);
				return { file: await save(`${baseNameFor(file)}-frame.png`) };
			}

			case "toGif": {
				const { file, diskPath } = await requireVideoFile(input.libraryFileId);
				const fps = input.fps ?? 10;
				const args: string[] = [];
				if (input.startSeconds != null) args.push("-ss", String(input.startSeconds));
				args.push("-i", diskPath);
				if (input.endSeconds != null) {
					const duration = input.endSeconds - (input.startSeconds ?? 0);
					if (duration <= 0) throw new Error("endSeconds must be greater than startSeconds.");
					args.push("-t", String(duration));
				}
				args.push("-vf", `fps=${fps},scale=480:-1:flags=lanczos`, outputPath);
				await runFfmpeg(args);
				return { file: await save(`${baseNameFor(file)}.gif`) };
			}

			default:
				throw new Error(`Unsupported video edit operation: ${input.operation}`);
		}
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
}
