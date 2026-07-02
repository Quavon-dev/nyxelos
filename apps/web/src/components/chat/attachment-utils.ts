import { useEffect, useRef } from "react";
import type { ChatAttachment } from "@/lib/chat-message";
import { type LibraryFileSummary, libraryFileUrl, libraryUploadUrl } from "@/lib/trpc";

/** One file staged in the composer — a superset of `ChatAttachment` (the
 * wire shape actually sent to the model) with client-only bookkeeping:
 * `id` for stable list keys/removal, `libraryFileId` once the background
 * upload to the workspace Library resolves, and `broken` for attachments
 * whose data URL a browser can't decode (e.g. HEIC on Chrome) so the UI can
 * fall back to a plain file card instead of a broken-image glyph. */
export interface AttachedFile {
	id: string;
	name: string;
	kind: ChatAttachment["kind"];
	mimeType: string;
	content: string;
	libraryFileId?: string;
	uploading?: boolean;
	broken?: boolean;
}

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"svg",
	"heic",
	"heif",
	"avif",
	"tiff",
]);

/** `File.type` goes empty for HEIC/HEIF on a lot of iOS/macOS browser +
 * Chrome combinations, which used to make these fall through to the "text"
 * branch and get read as raw binary via `readAsText` — garbled content and a
 * broken-image card. Falling back to the file extension when the MIME type
 * is missing or generic fixes the classification; whether the browser can
 * actually *decode* that image afterwards is a separate, unfixable-client-side
 * concern handled by the `onError` fallback in AttachmentPreviewCard. */
export function detectAttachmentKind(file: File): ChatAttachment["kind"] {
	if (file.type.startsWith("image/")) return "image";
	if (file.type === "application/pdf") return "pdf";
	const ext = file.name.toLowerCase().split(".").pop() ?? "";
	if (IMAGE_EXTENSIONS.has(ext)) return "image";
	if (ext === "pdf") return "pdf";
	return "text";
}

function readFile(file: File, asDataUrl: boolean): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
		reader.onload = () => resolve(String(reader.result ?? ""));
		if (asDataUrl) reader.readAsDataURL(file);
		else reader.readAsText(file);
	});
}

export async function fileToAttachedFile(file: File): Promise<AttachedFile> {
	const kind = detectAttachmentKind(file);
	const content = await readFile(file, kind === "image" || kind === "pdf");
	return {
		id: crypto.randomUUID(),
		name: file.name,
		kind,
		mimeType:
			file.type || (kind === "image" ? "image/*" : kind === "pdf" ? "application/pdf" : "text/plain"),
		content,
	};
}

/** Persists a staged attachment's bytes into the workspace Library in the
 * background so it survives past this one chat message and shows up under
 * Library — reuses the same multipart endpoint the Library page's own
 * upload button posts to (apps/server/src/routes/library.ts), rather than
 * inventing a second upload path just for chat. Failures are swallowed: the
 * attachment already has its data URL and can still be sent to the model
 * even if the Library copy didn't save. */
export async function uploadAttachmentToLibrary(
	file: File,
	workspaceId: string,
): Promise<LibraryFileSummary | null> {
	try {
		const formData = new FormData();
		formData.append("workspaceId", workspaceId);
		formData.append("files", file);
		const res = await fetch(libraryUploadUrl(), {
			method: "POST",
			body: formData,
			credentials: "include",
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { files: LibraryFileSummary[] };
		return body.files[0] ?? null;
	} catch {
		return null;
	}
}

/** Loads an existing Library file's bytes back into an inline attachment so
 * it can be sent to the model the same way a freshly-picked file is —
 * `libraryFileToAttachedFile` is the "attach from Library" counterpart to
 * `fileToAttachedFile` ("attach from disk"). */
export async function libraryFileToAttachedFile(file: LibraryFileSummary): Promise<AttachedFile> {
	const kind: ChatAttachment["kind"] =
		file.kind === "image" ? "image" : file.mimeType === "application/pdf" ? "pdf" : "text";
	const res = await fetch(libraryFileUrl(file.id), { credentials: "include" });
	const blob = await res.blob();
	const content = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
		reader.onload = () => resolve(String(reader.result ?? ""));
		if (kind === "text") reader.readAsText(blob);
		else reader.readAsDataURL(blob);
	});
	return {
		id: crypto.randomUUID(),
		name: file.name,
		kind,
		mimeType: file.mimeType,
		content,
		libraryFileId: file.id,
	};
}

/** Shared "stage files, then persist them to the Library in the background"
 * pipeline — used by the file picker, drag & drop, and paste-to-attach, all
 * three of which just need to hand this a `FileList`/`File[]` and get the
 * staged attachments appended (with an `uploading` flag that clears once
 * each one's Library copy resolves). Kept as one hook instead of duplicating
 * the ref/patch bookkeeping in every composer that wants attach-by-drop. */
export function useAttachmentStaging(
	attachedFiles: AttachedFile[],
	onAttachedFilesChange: (files: AttachedFile[]) => void,
	workspaceId: string | undefined,
) {
	const attachedFilesRef = useRef(attachedFiles);
	useEffect(() => {
		attachedFilesRef.current = attachedFiles;
	}, [attachedFiles]);

	function patchAttachment(id: string, patch: Partial<AttachedFile>) {
		onAttachedFilesChange(
			attachedFilesRef.current.map((f) => (f.id === id ? { ...f, ...patch } : f)),
		);
	}

	async function addFiles(fileList: FileList | File[]) {
		const files = Array.from(fileList);
		if (files.length === 0) return;
		const staged = await Promise.all(files.map((file) => fileToAttachedFile(file)));
		onAttachedFilesChange([
			...attachedFilesRef.current,
			...staged.map((file) => ({ ...file, uploading: Boolean(workspaceId) })),
		]);
		if (!workspaceId) return;
		files.forEach((file, index) => {
			const attachment = staged[index];
			if (!attachment) return;
			void uploadAttachmentToLibrary(file, workspaceId).then((record) => {
				patchAttachment(attachment.id, { uploading: false, libraryFileId: record?.id });
			});
		});
	}

	return { addFiles };
}

/** Pulls the `File`s a user is trying to attach out of a paste event —
 * covers both "copied an actual file" (clipboardData.files) and "copied an
 * image from a screenshot/browser" (clipboardData.items with kind "file"). */
export function filesFromClipboard(clipboardData: DataTransfer | null): File[] {
	if (!clipboardData) return [];
	if (clipboardData.files.length > 0) return Array.from(clipboardData.files);
	const files: File[] = [];
	for (const item of Array.from(clipboardData.items)) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file) files.push(file);
	}
	return files;
}
