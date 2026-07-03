import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
	getDb,
	type LibraryFileRecord,
	type LibraryFolderRecord,
	type LibraryItemKind,
} from "@nyxel/db";
import { emitNyxelEvent } from "./event-bus";
import { NyxelEvent } from "./events";
import { workspaceRootDir } from "./skills-registry";

/**
 * Root directory every uploaded library file's bytes are written under,
 * nested under the shared workspace root the same way plugins.ts nests
 * PLUGINS_ROOT — one dedicated env var lets a self-hosted install point
 * library storage somewhere else (e.g. a mounted volume) without touching
 * the workspace file-tools root.
 */
const LIBRARY_ROOT = path.resolve(
	process.env.NYXEL_LIBRARY_DIR ?? path.join(workspaceRootDir, ".nyxel-library"),
);

/** Resource backstop, not a curation choice — mirrors plugins.ts's
 * MAX_FILE_BYTES pattern, just sized for hand-uploaded docs/images rather
 * than an arbitrary GitHub repo file. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Mime types that read as "a document" even though they don't start with
 * `text/` — everything else outside `image/*` falls back to "other". */
const DOCUMENT_MIME_TYPES = new Set([
	"application/pdf",
	"application/json",
	"application/rtf",
	"application/zip",
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function classifyLibraryItemKind(mimeType: string): LibraryItemKind {
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType.startsWith("video/")) return "video";
	if (mimeType.startsWith("text/") || DOCUMENT_MIME_TYPES.has(mimeType)) return "document";
	return "other";
}

function workspaceLibraryDir(workspaceId: string): string {
	return path.join(LIBRARY_ROOT, workspaceId);
}

export function libraryFileDiskPath(workspaceId: string, storageKey: string): string {
	return path.join(workspaceLibraryDir(workspaceId), storageKey);
}

function sanitizeFileName(name: string): string {
	const base = path.basename(name).trim();
	return base.slice(0, 200) || "untitled";
}

async function assertFolderInWorkspace(workspaceId: string, folderId: string | null) {
	if (!folderId) return;
	const folder = await getDb().getLibraryFolder(folderId);
	if (!folder || folder.workspaceId !== workspaceId) {
		throw new Error(`Unknown folder: ${folderId}`);
	}
}

/** A folder's full descendant subtree (root included), used to keep a
 * move from creating a cycle and to gather everything a delete needs to
 * clean up — computed from one full-workspace folder list rather than a
 * recursive SQL query since the driver-agnostic repo layer has no CTE support. */
async function collectFolderSubtreeIds(workspaceId: string, rootId: string): Promise<Set<string>> {
	const allFolders = await getDb().listLibraryFoldersByWorkspace(workspaceId);
	const byParent = new Map<string | null, LibraryFolderRecord[]>();
	for (const folder of allFolders) {
		const siblings = byParent.get(folder.parentId) ?? [];
		siblings.push(folder);
		byParent.set(folder.parentId, siblings);
	}
	const ids = new Set<string>([rootId]);
	const queue = [rootId];
	while (queue.length > 0) {
		const current = queue.pop();
		if (current === undefined) break;
		for (const child of byParent.get(current) ?? []) {
			if (ids.has(child.id)) continue;
			ids.add(child.id);
			queue.push(child.id);
		}
	}
	return ids;
}

export interface LibraryListing {
	folders: LibraryFolderRecord[];
	files: LibraryFileRecord[];
}

export async function listLibrary(workspaceId: string): Promise<LibraryListing> {
	const db = getDb();
	const [folders, files] = await Promise.all([
		db.listLibraryFoldersByWorkspace(workspaceId),
		db.listLibraryFilesByWorkspace(workspaceId),
	]);
	return { folders, files };
}

export async function createLibraryFolder(input: {
	workspaceId: string;
	parentId: string | null;
	name: string;
}): Promise<LibraryFolderRecord> {
	await assertFolderInWorkspace(input.workspaceId, input.parentId);
	const name = input.name.trim().slice(0, 120);
	if (!name) throw new Error("Folder name can't be empty.");
	return getDb().createLibraryFolder({
		workspaceId: input.workspaceId,
		parentId: input.parentId,
		name,
	});
}

export async function renameLibraryFolder(id: string, name: string): Promise<LibraryFolderRecord> {
	const trimmed = name.trim().slice(0, 120);
	if (!trimmed) throw new Error("Folder name can't be empty.");
	return getDb().renameLibraryFolder(id, trimmed);
}

export async function moveLibraryFolder(
	id: string,
	parentId: string | null,
): Promise<LibraryFolderRecord> {
	const folder = await getDb().getLibraryFolder(id);
	if (!folder) throw new Error(`Unknown folder: ${id}`);
	if (parentId === id) throw new Error("A folder can't be moved into itself.");
	if (parentId) {
		await assertFolderInWorkspace(folder.workspaceId, parentId);
		const subtree = await collectFolderSubtreeIds(folder.workspaceId, id);
		if (subtree.has(parentId)) {
			throw new Error("A folder can't be moved into one of its own subfolders.");
		}
	}
	return getDb().moveLibraryFolder(id, parentId);
}

/** Deletes a folder along with every subfolder and file nested inside it,
 * on disk and in the DB — folders are removed leaves-first so a mid-failure
 * never leaves a folder row pointing at an already-deleted parentId. */
export async function deleteLibraryFolder(id: string): Promise<void> {
	const db = getDb();
	const folder = await db.getLibraryFolder(id);
	if (!folder) return;

	const subtree = await collectFolderSubtreeIds(folder.workspaceId, id);
	const files = await db.listLibraryFilesByWorkspace(folder.workspaceId);
	const filesToDelete = files.filter((file) => file.folderId && subtree.has(file.folderId));
	for (const file of filesToDelete) {
		await deleteLibraryFile(file.id);
	}

	const foldersToDelete = (await db.listLibraryFoldersByWorkspace(folder.workspaceId)).filter((f) =>
		subtree.has(f.id),
	);
	const depthOf = (folderId: string): number => {
		let depth = 0;
		let current = foldersToDelete.find((f) => f.id === folderId);
		while (current?.parentId) {
			depth++;
			current = foldersToDelete.find((f) => f.id === current?.parentId);
		}
		return depth;
	};
	for (const f of [...foldersToDelete].sort((a, b) => depthOf(b.id) - depthOf(a.id))) {
		await db.deleteLibraryFolder(f.id);
	}
}

export async function saveLibraryUpload(input: {
	workspaceId: string;
	folderId: string | null;
	fileName: string;
	mimeType: string;
	bytes: Uint8Array;
}): Promise<LibraryFileRecord> {
	if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
		throw new Error(
			`"${input.fileName}" is ${(input.bytes.byteLength / (1024 * 1024)).toFixed(1)}MB, over the ${
				MAX_UPLOAD_BYTES / (1024 * 1024)
			}MB per-file limit.`,
		);
	}
	await assertFolderInWorkspace(input.workspaceId, input.folderId);

	const id = randomUUID();
	const name = sanitizeFileName(input.fileName);
	const dir = workspaceLibraryDir(input.workspaceId);
	await mkdir(dir, { recursive: true });
	const storageKey = `${id}-${name}`;
	await Bun.write(path.join(dir, storageKey), input.bytes);

	const mimeType = input.mimeType || "application/octet-stream";
	const kind = classifyLibraryItemKind(mimeType);
	const file = await getDb().createLibraryFile({
		workspaceId: input.workspaceId,
		folderId: input.folderId,
		name,
		mimeType,
		sizeBytes: input.bytes.byteLength,
		kind,
		storageKey,
	});
	await emitNyxelEvent({
		workspaceId: input.workspaceId,
		type: NyxelEvent.LibraryFileCreated,
		entityType: "library_file",
		entityId: file.id,
		payload: { kind, mimeType, sizeBytes: input.bytes.byteLength },
	});
	return file;
}

export async function renameLibraryFile(id: string, name: string): Promise<LibraryFileRecord> {
	const trimmed = sanitizeFileName(name);
	return getDb().renameLibraryFile(id, trimmed);
}

export async function moveLibraryFile(
	id: string,
	folderId: string | null,
): Promise<LibraryFileRecord> {
	const file = await getDb().getLibraryFile(id);
	if (!file) throw new Error(`Unknown file: ${id}`);
	await assertFolderInWorkspace(file.workspaceId, folderId);
	return getDb().moveLibraryFile(id, folderId);
}

export async function deleteLibraryFile(id: string): Promise<void> {
	const db = getDb();
	const file = await db.getLibraryFile(id);
	if (!file) return;
	await rm(libraryFileDiskPath(file.workspaceId, file.storageKey), { force: true });
	await db.deleteLibraryFile(id);
}

export async function getLibraryFileForDownload(
	id: string,
): Promise<{ file: LibraryFileRecord; diskPath: string } | null> {
	const file = await getDb().getLibraryFile(id);
	if (!file) return null;
	return { file, diskPath: libraryFileDiskPath(file.workspaceId, file.storageKey) };
}
