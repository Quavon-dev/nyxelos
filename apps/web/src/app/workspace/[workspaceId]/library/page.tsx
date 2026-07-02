"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  HardDrive,
  House,
  Image as ImageIcon,
  Images,
  MoreVertical,
  Move,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useParams } from "next/navigation";
import { type DragEvent, useMemo, useRef, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type LibraryFileSummary,
  type LibraryFolderSummary,
  type LibraryItemKind,
  libraryDownloadUrl,
  libraryFileUrl,
  libraryUploadUrl,
  trpcClient,
} from "@/lib/trpc";
import { cn } from "@/lib/utils";

type MoveTarget =
  | { kind: "file"; id: string; name: string }
  | { kind: "folder"; id: string; name: string };

type RenameTarget = MoveTarget;
type DeleteTarget = MoveTarget;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleString();
}

function iconForFile(file: LibraryFileSummary) {
  if (file.kind === "image") return ImageIcon;
  if (file.mimeType === "application/pdf" || file.kind === "document") return FileText;
  return FileIcon;
}

function folderPath(folders: LibraryFolderSummary[], id: string | null): LibraryFolderSummary[] {
  const path: LibraryFolderSummary[] = [];
  let current = id;
  while (current) {
    const folder = folders.find((f) => f.id === current);
    if (!folder) break;
    path.unshift(folder);
    current = folder.parentId;
  }
  return path;
}

function collectDescendantIds(folders: LibraryFolderSummary[], rootId: string): Set<string> {
  const byParent = new Map<string | null, LibraryFolderSummary[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  const ids = new Set<string>();
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

type FolderOption = { id: string | null; name: string; depth: number };

function buildFolderOptions(
  folders: LibraryFolderSummary[],
  excludeIds: Set<string>,
): FolderOption[] {
  const byParent = new Map<string | null, LibraryFolderSummary[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name));
  }
  const options: FolderOption[] = [{ id: null, name: "Library", depth: 0 }];
  function walk(parentId: string | null, depth: number) {
    for (const folder of byParent.get(parentId) ?? []) {
      if (excludeIds.has(folder.id)) continue;
      options.push({ id: folder.id, name: folder.name, depth });
      walk(folder.id, depth + 1);
    }
  }
  walk(null, 1);
  return options;
}

const KIND_FILTERS: { value: LibraryItemKind | "all"; label: string }[] = [
  { value: "all", label: "All files" },
  { value: "image", label: "Images" },
  { value: "document", label: "Documents" },
  { value: "other", label: "Other" },
];

export default function LibraryPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const libraryQuery = useQuery({
    queryKey: ["library", "list", workspaceId],
    queryFn: () => trpcClient.library.list.query({ workspaceId }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["library", "list", workspaceId] });

  const folders = libraryQuery.data?.folders ?? [];
  const files = libraryQuery.data?.files ?? [];

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<LibraryItemKind | "all">("all");
  const [isDragging, setIsDragging] = useState(false);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [previewFile, setPreviewFile] = useState<LibraryFileSummary | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const isSearching = search.trim().length > 0;
  const query = search.trim().toLowerCase();

  const visibleFolders = useMemo(() => {
    const scoped = isSearching ? folders : folders.filter((f) => f.parentId === currentFolderId);
    const matched = isSearching
      ? scoped.filter((f) => f.name.toLowerCase().includes(query))
      : scoped;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, currentFolderId, isSearching, query]);

  const visibleFiles = useMemo(() => {
    const scoped = isSearching ? files : files.filter((f) => f.folderId === currentFolderId);
    const kindMatched = kindFilter === "all" ? scoped : scoped.filter((f) => f.kind === kindFilter);
    const nameMatched = isSearching
      ? kindMatched.filter((f) => f.name.toLowerCase().includes(query))
      : kindMatched;
    return [...nameMatched].sort((a, b) => a.name.localeCompare(b.name));
  }, [files, currentFolderId, isSearching, query, kindFilter]);

  const breadcrumbs = useMemo(
    () => folderPath(folders, currentFolderId),
    [folders, currentFolderId],
  );

  const totalStorageBytes = useMemo(() => files.reduce((sum, f) => sum + f.sizeBytes, 0), [files]);
  const imageCount = useMemo(() => files.filter((f) => f.kind === "image").length, [files]);

  const createFolder = useMutation({
    mutationFn: () =>
      trpcClient.library.createFolder.mutate({
        workspaceId,
        parentId: currentFolderId,
        name: newFolderName.trim(),
      }),
    onSuccess: () => {
      invalidate();
      setNewFolderOpen(false);
      setNewFolderName("");
    },
  });

  const renameFolder = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      trpcClient.library.renameFolder.mutate(input),
    onSuccess: invalidate,
  });
  const renameFile = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      trpcClient.library.renameFile.mutate(input),
    onSuccess: invalidate,
  });

  const moveFolder = useMutation({
    mutationFn: (input: { id: string; parentId: string | null }) =>
      trpcClient.library.moveFolder.mutate(input),
    onSuccess: invalidate,
  });
  const moveFile = useMutation({
    mutationFn: (input: { id: string; folderId: string | null }) =>
      trpcClient.library.moveFile.mutate(input),
    onSuccess: invalidate,
  });

  const deleteFolder = useMutation({
    mutationFn: (id: string) => trpcClient.library.deleteFolder.mutate({ id }),
    onSuccess: invalidate,
  });
  const deleteFile = useMutation({
    mutationFn: (id: string) => trpcClient.library.deleteFile.mutate({ id }),
    onSuccess: invalidate,
  });

  const uploadFiles = useMutation({
    mutationFn: async (fileList: FileList | File[]) => {
      const formData = new FormData();
      formData.append("workspaceId", workspaceId);
      if (currentFolderId) formData.append("folderId", currentFolderId);
      for (const file of Array.from(fileList)) formData.append("files", file);
      const res = await fetch(libraryUploadUrl(), {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${res.status}).`);
      }
      return res.json() as Promise<{
        files: LibraryFileSummary[];
        errors: { fileName: string; message: string }[];
      }>;
    },
    onSuccess: (result) => {
      invalidate();
      setUploadError(
        result.errors.length > 0
          ? result.errors.map((e) => `${e.fileName}: ${e.message}`).join(" · ")
          : null,
      );
    },
    onError: (err) => setUploadError((err as Error).message),
  });

  function handleFilesPicked(fileList: FileList | File[] | null) {
    if (!fileList || fileList.length === 0) return;
    // Snapshot into a plain array before the caller clears the <input>'s
    // value — a FileList from e.target.files is live-bound, so resetting
    // the input synchronously empties it before this mutation's async
    // mutationFn gets a chance to read it.
    uploadFiles.mutate(Array.from(fileList));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    handleFilesPicked(e.dataTransfer.files);
  }

  function openMoveDialog(target: MoveTarget) {
    setMoveTarget(target);
    setMoveDestination(
      target.kind === "folder"
        ? (folders.find((f) => f.id === target.id)?.parentId ?? null)
        : (files.find((f) => f.id === target.id)?.folderId ?? null),
    );
  }

  function submitMove() {
    if (!moveTarget) return;
    if (moveTarget.kind === "folder") {
      moveFolder.mutate({ id: moveTarget.id, parentId: moveDestination });
    } else {
      moveFile.mutate({ id: moveTarget.id, folderId: moveDestination });
    }
    setMoveTarget(null);
  }

  function submitRename() {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return;
    if (renameTarget.kind === "folder") {
      renameFolder.mutate({ id: renameTarget.id, name });
    } else {
      renameFile.mutate({ id: renameTarget.id, name });
    }
    setRenameTarget(null);
  }

  function submitDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "folder") {
      deleteFolder.mutate(deleteTarget.id);
      if (currentFolderId === deleteTarget.id) setCurrentFolderId(null);
    } else {
      deleteFile.mutate(deleteTarget.id);
    }
    setDeleteTarget(null);
  }

  const moveFolderOptions = useMemo(() => {
    if (!moveTarget) return [];
    const excludeIds =
      moveTarget.kind === "folder"
        ? new Set([moveTarget.id, ...collectDescendantIds(folders, moveTarget.id)])
        : new Set<string>();
    return buildFolderOptions(folders, excludeIds);
  }, [moveTarget, folders]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFilesPicked(e.target.files);
          e.target.value = "";
        }}
      />

      <PageHeader
        title="Library"
        description="Upload, organize, and preview documents and images in one place — folder them, rename, move, and open files right from the browser."
        actions={
          <>
            <Button variant="outline" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="size-4" />
              New folder
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploadFiles.isPending}>
              <Upload className="size-4" />
              {uploadFiles.isPending ? "Uploading…" : "Upload"}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Files" value={files.length} icon={<FileIcon className="size-4" />} />
        <StatCard label="Folders" value={folders.length} icon={<FolderIcon className="size-4" />} />
        <StatCard label="Images" value={imageCount} icon={<Images className="size-4" />} />
        <StatCard
          label="Storage used"
          value={formatBytes(totalStorageBytes)}
          icon={<HardDrive className="size-4" />}
        />
      </div>

      {uploadError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {uploadError}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => setCurrentFolderId(null)}
            disabled={isSearching}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground",
              !currentFolderId && !isSearching && "text-foreground font-medium",
            )}
          >
            <House className="size-3.5" />
            Library
          </button>
          {!isSearching &&
            breadcrumbs.map((folder) => (
              <span key={folder.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => setCurrentFolderId(folder.id)}
                  className={cn(
                    "truncate rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground",
                    currentFolderId === folder.id && "text-foreground font-medium",
                  )}
                >
                  {folder.name}
                </button>
              </span>
            ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search library…"
              className="w-56 pl-8"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {KIND_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setKindFilter(filter.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              kindFilter === filter.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <section
        aria-label="Library files — drag and drop to upload"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "relative min-h-[320px] rounded-xl border-2 border-dashed p-4 transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-transparent",
        )}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/80">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Upload className="size-8" />
              <p className="text-sm font-medium">
                Drop to upload{currentFolderId ? " into this folder" : ""}
              </p>
            </div>
          </div>
        )}

        {libraryQuery.isLoading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading library…</p>
        ) : visibleFolders.length === 0 && visibleFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-16 text-center">
            <Images className="size-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isSearching ? "No matches" : "This folder is empty"}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {isSearching
                ? "Try a different search term."
                : "Drag and drop files here, or use the Upload button above."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visibleFolders.map((folder) => (
              <div
                key={folder.id}
                className="group relative flex flex-col items-center gap-2 rounded-xl border bg-card p-3 text-center shadow-xs transition-colors hover:bg-muted/50"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCurrentFolderId(folder.id);
                  }}
                  className="flex w-full flex-col items-center gap-2"
                >
                  <FolderIcon className="size-10 fill-muted-foreground/15 text-muted-foreground" />
                  <span className="line-clamp-2 w-full break-words text-xs font-medium">
                    {folder.name}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100"
                    >
                      <MoreVertical className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setRenameTarget({ kind: "folder", id: folder.id, name: folder.name });
                        setRenameValue(folder.name);
                      }}
                    >
                      <Pencil className="size-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        openMoveDialog({ kind: "folder", id: folder.id, name: folder.name })
                      }
                    >
                      <Move className="size-4" />
                      Move
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() =>
                        setDeleteTarget({ kind: "folder", id: folder.id, name: folder.name })
                      }
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            {visibleFiles.map((file) => {
              const Icon = iconForFile(file);
              return (
                <div
                  key={file.id}
                  className="group relative flex flex-col items-center gap-2 rounded-xl border bg-card p-3 text-center shadow-xs transition-colors hover:bg-muted/50"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    className="flex w-full flex-col items-center gap-2"
                  >
                    <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {file.kind === "image" ? (
                        <img
                          src={libraryFileUrl(file.id)}
                          alt={file.name}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <Icon className="size-7 text-muted-foreground" />
                      )}
                    </div>
                    <span className="line-clamp-2 w-full break-words text-xs font-medium">
                      {file.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100"
                      >
                        <MoreVertical className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setPreviewFile(file)}>
                        <ExternalLink className="size-4" />
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href={libraryDownloadUrl(file.id)} download={file.name}>
                          <Download className="size-4" />
                          Download
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameTarget({ kind: "file", id: file.id, name: file.name });
                          setRenameValue(file.name);
                        }}
                      >
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          openMoveDialog({ kind: "file", id: file.id, name: file.name })
                        }
                      >
                        <Move className="size-4" />
                        Move
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() =>
                          setDeleteTarget({ kind: "file", id: file.id, name: file.name })
                        }
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* New folder */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Created inside {currentFolderId ? breadcrumbs.at(-1)?.name : "Library"}.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolderName.trim()) createFolder.mutate();
            }}
          />
          <DialogFooter showCloseButton>
            <Button
              onClick={() => createFolder.mutate()}
              disabled={!newFolderName.trim() || createFolder.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {renameTarget?.kind}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim()) submitRename();
            }}
          />
          <DialogFooter showCloseButton>
            <Button onClick={submitRename} disabled={!renameValue.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move */}
      <Dialog open={Boolean(moveTarget)} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move &quot;{moveTarget?.name}&quot;</DialogTitle>
            <DialogDescription>Choose a destination folder.</DialogDescription>
          </DialogHeader>
          <Select
            value={moveDestination ?? "__root__"}
            onValueChange={(value) => setMoveDestination(value === "__root__" ? null : value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {moveFolderOptions.map((option) => (
                <SelectItem key={option.id ?? "__root__"} value={option.id ?? "__root__"}>
                  {"  ".repeat(option.depth)}
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter showCloseButton>
            <Button onClick={submitMove}>Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.kind}</DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === "folder"
                ? `This permanently deletes "${deleteTarget?.name}" and everything inside it. This action cannot be undone.`
                : `This permanently deletes "${deleteTarget?.name}". This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="destructive" onClick={submitDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview */}
      <Dialog open={Boolean(previewFile)} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle className="min-w-0 truncate">{previewFile?.name}</DialogTitle>
              {previewFile && (
                <Badge
                  variant="outline"
                  className="shrink-0 border-0 bg-muted text-muted-foreground"
                >
                  {previewFile.kind}
                </Badge>
              )}
            </div>
            <DialogDescription>
              {previewFile && (
                <>
                  {formatBytes(previewFile.sizeBytes)} · {previewFile.mimeType} · uploaded{" "}
                  {formatDate(previewFile.createdAt)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {previewFile && (
            <div className="flex max-h-[60vh] flex-col items-center justify-center overflow-auto rounded-lg bg-muted/40">
              {previewFile.kind === "image" ? (
                <img
                  src={libraryFileUrl(previewFile.id)}
                  alt={previewFile.name}
                  className="max-h-[60vh] w-auto max-w-full object-contain"
                />
              ) : previewFile.mimeType === "application/pdf" ? (
                <iframe
                  src={libraryFileUrl(previewFile.id)}
                  title={previewFile.name}
                  className="h-[60vh] w-full"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 p-12 text-center">
                  <FileText className="size-12 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No inline preview available for this file type.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter showCloseButton>
            {previewFile && (
              <>
                <Button variant="outline" asChild>
                  <a href={libraryFileUrl(previewFile.id)} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    Open in new tab
                  </a>
                </Button>
                <Button asChild>
                  <a href={libraryDownloadUrl(previewFile.id)} download={previewFile.name}>
                    <Download className="size-4" />
                    Download
                  </a>
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
