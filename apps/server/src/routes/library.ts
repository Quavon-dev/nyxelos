import type { Hono } from "hono";
import { getSessionUser } from "../hono-auth";
import { getLibraryFileForDownload, saveLibraryUpload } from "../library";
import { requireWorkspaceOwner } from "../trpc/workspace-guard";

/** Builds a Content-Disposition header value that degrades gracefully for
 * non-ASCII file names — `filename` is an ASCII-safe fallback for older
 * clients, `filename*` (RFC 5987) carries the exact UTF-8 name. */
function contentDisposition(disposition: "inline" | "attachment", fileName: string): string {
	const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
	const encoded = encodeURIComponent(fileName);
	return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Plain Hono routes rather than tRPC procedures for the two operations that
 * move raw bytes — multipart upload and file streaming don't fit tRPC's
 * JSON request/response shape well. Metadata CRUD (rename/move/delete/list)
 * stays on the `library` tRPC router (trpc/router.ts); these two routes only
 * handle bytes in and bytes out. See routes/chat-stream.ts for the same
 * "plain fetch route alongside tRPC" pattern used for streaming.
 */
export function registerLibraryRoutes(app: Hono) {
	app.post("/api/library/upload", async (c) => {
		const user = await getSessionUser(c);
		if (!user) return c.json({ error: "Sign in required." }, 401);

		const body = await c.req.parseBody({ all: true }).catch(() => null);
		if (!body) return c.json({ error: "Invalid upload payload." }, 400);

		const workspaceId = body.workspaceId;
		if (typeof workspaceId !== "string" || !workspaceId) {
			return c.json({ error: "workspaceId is required." }, 400);
		}
		try {
			await requireWorkspaceOwner(user.id, workspaceId);
		} catch {
			return c.json({ error: "Not authorized for this workspace." }, 403);
		}
		const folderIdRaw = body.folderId;
		const folderId = typeof folderIdRaw === "string" && folderIdRaw ? folderIdRaw : null;

		const rawFiles = body.files;
		const files = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
		const uploads = files.filter((entry): entry is File => entry instanceof File);
		if (uploads.length === 0) {
			return c.json({ error: "No files in upload." }, 400);
		}

		const saved: Awaited<ReturnType<typeof saveLibraryUpload>>[] = [];
		const errors: { fileName: string; message: string }[] = [];
		for (const upload of uploads) {
			try {
				const bytes = new Uint8Array(await upload.arrayBuffer());
				const record = await saveLibraryUpload({
					workspaceId,
					folderId,
					fileName: upload.name,
					mimeType: upload.type,
					bytes,
				});
				saved.push(record);
			} catch (err) {
				errors.push({
					fileName: upload.name,
					message: err instanceof Error ? err.message : "Upload failed.",
				});
			}
		}

		return c.json({ files: saved, errors });
	});

	app.get("/api/library/files/:id/content", async (c) => {
		const user = await getSessionUser(c);
		if (!user) return c.json({ error: "Sign in required." }, 401);

		const id = c.req.param("id");
		const result = await getLibraryFileForDownload(id);
		if (!result) return c.json({ error: `Unknown file: ${id}` }, 404);
		try {
			await requireWorkspaceOwner(user.id, result.file.workspaceId);
		} catch {
			return c.json({ error: "Not authorized for this file." }, 403);
		}

		const bunFile = Bun.file(result.diskPath);
		if (!(await bunFile.exists())) {
			return c.json({ error: "File is missing from disk." }, 404);
		}

		const download = c.req.query("download") === "1";
		return new Response(bunFile.stream(), {
			headers: {
				"Content-Type": result.file.mimeType || "application/octet-stream",
				"Content-Length": String(result.file.sizeBytes),
				"Content-Disposition": contentDisposition(
					download ? "attachment" : "inline",
					result.file.name,
				),
				"Cache-Control": "private, max-age=0, must-revalidate",
			},
		});
	});
}
