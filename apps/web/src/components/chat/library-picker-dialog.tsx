"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, File as FileIcon, FileText, Film, Image as ImageIcon, Loader2, Search, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type LibraryFileSummary, libraryFileUrl, libraryUploadUrl, trpcClient } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { libraryFileToAttachedFile, type AttachedFile } from "./attachment-utils";

function iconForFile(file: LibraryFileSummary) {
	if (file.kind === "image") return ImageIcon;
	if (file.kind === "video") return Film;
	if (file.mimeType === "application/pdf" || file.kind === "document") return FileText;
	return FileIcon;
}

/** "Choose from Library or upload from your computer" modal for the chat
 * composer — separate from the full Library page (app/workspace/[id]/library)
 * since this one is optimized for "pick files to attach right now" rather
 * than folder management, and it needs to work from any chat, not just the
 * Library route. */
export function LibraryPickerDialog({
	open,
	onOpenChange,
	workspaceId,
	onAttach,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string;
	onAttach: (files: AttachedFile[]) => void;
}) {
	const queryClient = useQueryClient();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [search, setSearch] = useState("");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [isUploading, setIsUploading] = useState(false);
	const [isAttaching, setIsAttaching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());

	const libraryQuery = useQuery({
		queryKey: ["library", "list", workspaceId],
		queryFn: () => trpcClient.library.list.query({ workspaceId }),
		enabled: open && Boolean(workspaceId),
	});

	const files = useMemo(() => {
		const all = libraryQuery.data?.files ?? [];
		const query = search.trim().toLowerCase();
		const matched = query ? all.filter((f) => f.name.toLowerCase().includes(query)) : all;
		return [...matched].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
	}, [libraryQuery.data, search]);

	function toggle(id: string) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function reset() {
		setSearch("");
		setSelectedIds(new Set());
		setError(null);
	}

	async function handleUpload(fileList: FileList | null) {
		if (!fileList || fileList.length === 0) return;
		setIsUploading(true);
		setError(null);
		try {
			const formData = new FormData();
			formData.append("workspaceId", workspaceId);
			for (const file of Array.from(fileList)) formData.append("files", file);
			const res = await fetch(libraryUploadUrl(), {
				method: "POST",
				body: formData,
				credentials: "include",
			});
			if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
			const body = (await res.json()) as { files: LibraryFileSummary[] };
			await queryClient.invalidateQueries({ queryKey: ["library", "list", workspaceId] });
			setSelectedIds((prev) => {
				const next = new Set(prev);
				for (const f of body.files) next.add(f.id);
				return next;
			});
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setIsUploading(false);
		}
	}

	async function handleAttach() {
		const chosen = files.filter((f) => selectedIds.has(f.id));
		if (chosen.length === 0) return;
		setIsAttaching(true);
		try {
			const attached = await Promise.all(chosen.map((f) => libraryFileToAttachedFile(f)));
			onAttach(attached);
			reset();
			onOpenChange(false);
		} catch {
			setError("Couldn't load one or more files from the library.");
		} finally {
			setIsAttaching(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-2xl">
				<input
					ref={fileInputRef}
					type="file"
					multiple
					className="hidden"
					onChange={(e) => {
						void handleUpload(e.target.files);
						e.target.value = "";
					}}
				/>
				<DialogHeader>
					<DialogTitle>Attach from Library</DialogTitle>
					<DialogDescription>
						Choose one or more files already in the workspace Library, or upload new ones.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-2">
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search library…"
							className="pl-8"
						/>
					</div>
					<Button
						type="button"
						variant="outline"
						onClick={() => fileInputRef.current?.click()}
						disabled={isUploading}
					>
						{isUploading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Upload className="size-4" />
						)}
						Upload
					</Button>
				</div>

				{error && <p className="text-sm text-destructive">{error}</p>}

				<div className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto py-1 sm:grid-cols-4">
					{libraryQuery.isLoading ? (
						<p className="col-span-full py-8 text-center text-sm text-muted-foreground">
							Loading library…
						</p>
					) : files.length === 0 ? (
						<p className="col-span-full py-8 text-center text-sm text-muted-foreground">
							{search ? "No matches." : "Library is empty — upload a file to get started."}
						</p>
					) : (
						files.map((file) => {
							const Icon = iconForFile(file);
							const selected = selectedIds.has(file.id);
							return (
								<button
									key={file.id}
									type="button"
									onClick={() => toggle(file.id)}
									className={cn(
										"relative flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-colors",
										selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
									)}
								>
									{selected && (
										<div className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
											<Check className="size-2.5" />
										</div>
									)}
									<div className="flex size-14 items-center justify-center overflow-hidden rounded-lg bg-muted">
										{file.kind === "image" && !brokenThumbs.has(file.id) ? (
											<img
												src={libraryFileUrl(file.id)}
												alt={file.name}
												className="size-full object-cover"
												loading="lazy"
												onError={() =>
													setBrokenThumbs((prev) => new Set(prev).add(file.id))
												}
											/>
										) : (
											<Icon className="size-6 text-muted-foreground" />
										)}
									</div>
									<span className="line-clamp-2 w-full break-words text-[11px] font-medium">
										{file.name}
									</span>
								</button>
							);
						})
					)}
				</div>

				<DialogFooter showCloseButton>
					<Button onClick={handleAttach} disabled={selectedIds.size === 0 || isAttaching}>
						{isAttaching ? <Loader2 className="size-4 animate-spin" /> : null}
						Attach {selectedIds.size > 0 ? selectedIds.size : ""}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
