"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  File,
  Folder,
  GitBranch,
  Loader2,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { WorkingDirectoryPicker } from "@/components/chat/working-directory-picker";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type GitFileStatus, trpcClient } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<GitFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  unknown: "?",
};

const STATUS_COLOR: Record<GitFileStatus, string> = {
  modified: "text-amber-600 dark:text-amber-400",
  added: "text-green-600 dark:text-green-400",
  deleted: "text-rose-600 dark:text-rose-400",
  renamed: "text-blue-600 dark:text-blue-400",
  untracked: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

export default function CodingWorkspacePage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [rootDir, setRootDir] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const repoInfoQuery = useQuery({
    queryKey: ["coding", "repoInfo", workspaceId, rootDir],
    queryFn: () => trpcClient.coding.repoInfo.query({ workspaceId, rootDir }),
    enabled: Boolean(rootDir),
  });

  const statusQuery = useQuery({
    queryKey: ["coding", "status", workspaceId, rootDir],
    queryFn: () => trpcClient.coding.status.query({ workspaceId, rootDir }),
    enabled: Boolean(rootDir) && repoInfoQuery.data?.isGitRepo === true,
    refetchInterval: 10_000,
  });

  const diffQuery = useQuery({
    queryKey: ["coding", "diff", workspaceId, rootDir, selectedFile],
    queryFn: () =>
      trpcClient.coding.diff.query({
        workspaceId,
        rootDir,
        filePath: selectedFile ?? undefined,
      }),
    enabled: Boolean(rootDir) && repoInfoQuery.data?.isGitRepo === true,
  });

  const status = statusQuery.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Coding"
        description="Open a local repository to browse its files and review git status/diffs before an agent touches anything — writes still go through the normal approval-gated file tools, diff-first."
        actions={<WorkingDirectoryPicker value={rootDir} onChange={setRootDir} />}
      />

      {!rootDir ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Open a folder to get started.
          </CardContent>
        </Card>
      ) : repoInfoQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking repository…
        </div>
      ) : repoInfoQuery.data && !repoInfoQuery.data.isGitRepo ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {repoInfoQuery.data.error ?? "Not a git repository."} You can still browse files below.
          </CardContent>
        </Card>
      ) : repoInfoQuery.data?.isGitRepo ? (
        <div className="flex items-center gap-2 text-sm">
          <GitBranch className="size-4 text-muted-foreground" />
          <span className="font-medium">{repoInfoQuery.data.branch}</span>
          <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
            {status.length} changed
          </Badge>
        </div>
      ) : null}

      {rootDir && (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Files
                </p>
                <FileTree workspaceId={workspaceId} rootDir={rootDir} />
              </CardContent>
            </Card>

            {status.length > 0 && (
              <Card>
                <CardContent className="pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Changes
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setSelectedFile(null)}
                    >
                      Full diff
                    </Button>
                  </div>
                  <ul className="space-y-1">
                    {status.map((entry) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          onClick={() => setSelectedFile(entry.path)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted",
                            selectedFile === entry.path && "bg-muted",
                          )}
                        >
                          <span className={cn("w-3 font-mono font-bold", STATUS_COLOR[entry.status])}>
                            {STATUS_LABEL[entry.status]}
                          </span>
                          <span className="truncate">{entry.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardContent className="pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {selectedFile ?? "Full diff"}
              </p>
              {diffQuery.data ? (
                <pre className="max-h-[70vh] overflow-auto rounded bg-muted p-3 text-xs">
                  <DiffView diff={diffQuery.data} />
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">No changes to show.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <>
      {diff.split("\n").map((line, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no stable id
          key={i}
          className={cn(
            line.startsWith("+") && !line.startsWith("+++") && "text-green-600 dark:text-green-400",
            line.startsWith("-") && !line.startsWith("---") && "text-rose-600 dark:text-rose-400",
            line.startsWith("@@") && "text-blue-600 dark:text-blue-400",
          )}
        >
          {line || " "}
        </div>
      ))}
    </>
  );
}

function FileTree({ workspaceId, rootDir }: { workspaceId: string; rootDir: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rootQuery = useQuery({
    queryKey: ["coding", "listDirectory", workspaceId, rootDir, ""],
    queryFn: () => trpcClient.coding.listDirectory.query({ workspaceId, rootDir, relativePath: "" }),
  });

  const entries = rootQuery.data ?? [];
  const sorted = [...entries].sort((a, b) =>
    a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1,
  );

  return (
    <ul className="space-y-0.5 text-xs">
      {sorted.map((entry) => (
        <TreeNode
          key={entry.name}
          workspaceId={workspaceId}
          rootDir={rootDir}
          relativePath={entry.name}
          name={entry.name}
          isDirectory={entry.isDirectory}
          depth={0}
          expanded={expanded}
          setExpanded={setExpanded}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  workspaceId,
  rootDir,
  relativePath,
  name,
  isDirectory,
  depth,
  expanded,
  setExpanded,
}: {
  workspaceId: string;
  rootDir: string;
  relativePath: string;
  name: string;
  isDirectory: boolean;
  depth: number;
  expanded: Set<string>;
  setExpanded: (updater: (prev: Set<string>) => Set<string>) => void;
}) {
  const isOpen = expanded.has(relativePath);
  const childrenQuery = useQuery({
    queryKey: ["coding", "listDirectory", workspaceId, rootDir, relativePath],
    queryFn: () =>
      trpcClient.coding.listDirectory.query({ workspaceId, rootDir, relativePath }),
    enabled: isDirectory && isOpen,
  });

  function toggle() {
    if (!isDirectory) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  }

  const children = childrenQuery.data ?? [];
  const sortedChildren = [...children].sort((a, b) =>
    a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1,
  );

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        style={{ paddingLeft: `${depth * 12}px` }}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted"
      >
        {isDirectory ? (
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-90")} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDirectory ? (
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <File className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{name}</span>
      </button>
      {isDirectory && isOpen && (
        <ul>
          {sortedChildren.map((child) => (
            <TreeNode
              key={child.name}
              workspaceId={workspaceId}
              rootDir={rootDir}
              relativePath={`${relativePath}/${child.name}`}
              name={child.name}
              isDirectory={child.isDirectory}
              depth={depth + 1}
              expanded={expanded}
              setExpanded={setExpanded}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
