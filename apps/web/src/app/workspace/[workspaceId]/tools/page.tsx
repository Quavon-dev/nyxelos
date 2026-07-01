"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Wrench } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CardListSkeleton, PageHeaderSkeleton, StatCardsSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  TOOL_KIND_CATEGORY,
  type ToolCategory,
  type ToolKind,
  type ToolSummary,
  trpcClient,
} from "@/lib/trpc";

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  edit: "Edit",
  read: "Read",
  search: "Search",
  execute: "Execute",
  browser: "Browser",
  web: "Web",
};

const CATEGORY_ORDER: ToolCategory[] = ["edit", "read", "search", "execute", "browser", "web"];

const TOOL_KINDS: { value: ToolKind; label: string; description: string }[] = [
  {
    value: "http_fetch",
    label: "HTTP fetch",
    description: "GET a URL from an allow-listed set of hosts and return the response text.",
  },
  {
    value: "file_read",
    label: "Read files",
    description: "Read a file's contents from an allow-listed set of directories.",
  },
  {
    value: "file_list",
    label: "List directory",
    description: "List the contents of a directory from an allow-listed set of directories.",
  },
  {
    value: "file_write",
    label: "Write files",
    description: "Write/overwrite a file under an allow-listed set of directories.",
  },
  {
    value: "file_delete",
    label: "Delete files",
    description: "Delete a file under an allow-listed set of directories.",
  },
  {
    value: "kb_search",
    label: "Knowledge-base search",
    description: "Search this workspace's knowledge-base vault by title/path.",
  },
  {
    value: "custom_code",
    label: "Custom code",
    description: "Run a short JavaScript function with a permission-scoped fetch/file context.",
  },
  {
    value: "file_create",
    label: "Create file",
    description: "Create a new file; fails if it already exists unless overwrite is set.",
  },
  {
    value: "file_patch",
    label: "Edit files",
    description: "Apply targeted search/replace or line-range edits to a file.",
  },
  {
    value: "file_move",
    label: "Rename/move file",
    description: "Move or rename a file.",
  },
  {
    value: "directory_create",
    label: "Create directory",
    description: "Create a new directory (and any missing parents).",
  },
  {
    value: "notebook_edit",
    label: "Edit notebook",
    description: "Add, remove, or edit cells in a Jupyter notebook (.ipynb) file.",
  },
  {
    value: "file_stat",
    label: "Inspect file",
    description: "Get size, type, and modification time for a file or directory.",
  },
  {
    value: "file_view_image",
    label: "View image",
    description: "Read an image file and return it as base64.",
  },
  {
    value: "notebook_summary",
    label: "Get notebook summary",
    description: "List a notebook's cells with their type and first line.",
  },
  {
    value: "notebook_cell_output",
    label: "Read notebook cell output",
    description: "Read the stored output of one notebook cell.",
  },
  {
    value: "terminal_last_command",
    label: "Get last terminal command",
    description: "Return the most recently run terminal command.",
  },
  {
    value: "terminal_output",
    label: "Get terminal output",
    description: "Read the buffered output/status of a terminal session.",
  },
  {
    value: "problems",
    label: "Check for problems",
    description: "Run a type-checker/linter and list reported problems.",
  },
  {
    value: "file_search",
    label: "Search files by name",
    description: "Find files by a glob-style filename pattern.",
  },
  {
    value: "text_search",
    label: "Search file contents",
    description: "Search file contents by regex/text across the workspace.",
  },
  {
    value: "usages",
    label: "Find usages",
    description: "Find occurrences of an identifier (regex-based).",
  },
  {
    value: "codebase_search",
    label: "Search codebase",
    description: "Broad text search across the workspace (heuristic).",
  },
  {
    value: "changes",
    label: "Get git changes",
    description: "Show git status/diff for the workspace.",
  },
  {
    value: "terminal_run",
    label: "Run in terminal",
    description: "Run a shell command in a new terminal session.",
  },
  {
    value: "terminal_send_input",
    label: "Send terminal input",
    description: "Send text input to a running terminal session.",
  },
  {
    value: "terminal_kill",
    label: "Kill terminal",
    description: "Terminate a running terminal session.",
  },
  {
    value: "task_run",
    label: "Run task",
    description: "Run a fixed, pre-configured command (set below).",
  },
  {
    value: "test_run",
    label: "Run tests",
    description: "Run a fixed, pre-configured test command (set below).",
  },
  {
    value: "browser_navigate",
    label: "Navigate browser",
    description: "Navigate the shared headless browser to a URL.",
  },
  {
    value: "browser_click",
    label: "Click element",
    description: "Click an element on the current browser page.",
  },
  {
    value: "browser_drag",
    label: "Drag element",
    description: "Drag an element over another element.",
  },
  {
    value: "browser_hover",
    label: "Hover element",
    description: "Hover the pointer over an element.",
  },
  {
    value: "browser_type",
    label: "Type into element",
    description: "Type text into a form field.",
  },
  {
    value: "browser_handle_dialog",
    label: "Handle browser dialog",
    description: "Accept or dismiss the next alert/confirm/prompt dialog.",
  },
  {
    value: "browser_screenshot",
    label: "Screenshot page",
    description: "Take a screenshot of the current browser page.",
  },
  {
    value: "browser_read_page",
    label: "Read page",
    description: "Read the visible text content of the current browser page.",
  },
  {
    value: "browser_run_playwright_code",
    label: "Run Playwright code",
    description: "Run arbitrary Playwright code against the current browser page.",
  },
  {
    value: "github_repo_fetch",
    label: "Fetch GitHub repo",
    description: "Fetch repository metadata or file contents from the GitHub API.",
  },
  {
    value: "github_code_search",
    label: "Search GitHub code",
    description: "Search code on GitHub via the GitHub code search API.",
  },
];

const DEFAULT_SENSITIVE_KINDS = new Set<ToolKind>([
  "file_write",
  "file_delete",
  "custom_code",
  "file_create",
  "file_patch",
  "file_move",
  "directory_create",
  "notebook_edit",
  "terminal_run",
  "terminal_send_input",
  "terminal_kill",
  "task_run",
  "test_run",
  "browser_navigate",
  "browser_click",
  "browser_drag",
  "browser_hover",
  "browser_type",
  "browser_handle_dialog",
  "browser_run_playwright_code",
]);
const NEEDS_HOSTS = new Set<ToolKind>([
  "http_fetch",
  "custom_code",
  "github_repo_fetch",
  "github_code_search",
]);
const NEEDS_DIRS = new Set<ToolKind>([
  "file_read",
  "file_list",
  "file_write",
  "file_delete",
  "custom_code",
  "file_create",
  "file_patch",
  "file_move",
  "directory_create",
  "notebook_edit",
  "file_stat",
  "file_view_image",
  "notebook_summary",
  "notebook_cell_output",
  "file_search",
  "text_search",
  "usages",
  "codebase_search",
  "changes",
]);
const NEEDS_COMMAND = new Set<ToolKind>(["task_run", "test_run", "problems"]);

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export default function ToolsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const toolsQuery = useQuery({
    queryKey: ["tools", "list", workspaceId],
    queryFn: () => trpcClient.tools.list.query({ workspaceId }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["tools", "list", workspaceId],
    });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ToolKind>("http_fetch");
  const [allowedHosts, setAllowedHosts] = useState("");
  const [allowedDirs, setAllowedDirs] = useState("");
  const [code, setCode] = useState("");
  const [command, setCommand] = useState("");
  const [sensitiveOverride, setSensitiveOverride] = useState<boolean | null>(null);

  const sensitive = sensitiveOverride ?? DEFAULT_SENSITIVE_KINDS.has(kind);

  const createTool = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = {};
      if (NEEDS_HOSTS.has(kind)) config.allowedHosts = splitList(allowedHosts);
      if (NEEDS_DIRS.has(kind)) config.allowedDirs = splitList(allowedDirs);
      if (kind === "custom_code") config.code = code;
      if (NEEDS_COMMAND.has(kind)) config.command = command;

      return trpcClient.tools.create.mutate({
        workspaceId,
        name,
        description,
        kind,
        config,
        sensitive,
      });
    },
    onSuccess: () => {
      invalidate();
      setName("");
      setDescription("");
      setAllowedHosts("");
      setAllowedDirs("");
      setCode("");
      setCommand("");
      setSensitiveOverride(null);
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      trpcClient.tools.setEnabled.mutate(input),
    onSuccess: invalidate,
  });

  const deleteTool = useMutation({
    mutationFn: (id: string) => trpcClient.tools.delete.mutate({ id }),
    onSuccess: invalidate,
  });

  const tools = toolsQuery.data ?? [];
  const builtinCount = tools.filter((t) => t.builtin).length;
  const kindMeta = TOOL_KINDS.find((k) => k.value === kind);

  const toolsByCategory = new Map<ToolCategory, ToolSummary[]>();
  for (const toolItem of tools) {
    const category = TOOL_KIND_CATEGORY[toolItem.kind];
    const list = toolsByCategory.get(category) ?? [];
    list.push(toolItem);
    toolsByCategory.set(category, list);
  }

  if (toolsQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton />
        <StatCardsSkeleton count={2} />
        <CardListSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Tools"
        description="Workspace-configured tools agents can use — file editing, terminal, browser, search, and web access — with a declared permission profile. For real skills, see the Skills page."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total tools" value={tools.length} icon={<Wrench className="size-4" />} />
        <StatCard label="Built-in" value={builtinCount} icon={<Lock className="size-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tool selection</CardTitle>
          <CardDescription>
            Built-in tools are seeded into every workspace and can be disabled but not deleted.
            Custom tools can be disabled or deleted — agents that reference a disabled tool simply
            skip it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tools yet.</p>
          ) : (
            CATEGORY_ORDER.filter((category) => toolsByCategory.has(category)).map((category) => (
              <div key={category} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABEL[category]}
                </p>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Name</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Permissions</TableHead>
                        <TableHead className="w-[180px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(toolsByCategory.get(category) ?? []).map((toolItem) => (
                        <TableRow key={toolItem.id}>
                          <TableCell className="font-medium">
                            {toolItem.name}
                            {toolItem.sensitive && (
                              <Lock className="ml-1.5 inline size-3 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className="border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                              >
                                {toolItem.kind}
                              </Badge>
                              {toolItem.builtin && (
                                <Badge
                                  variant="outline"
                                  className="border-0 bg-muted text-muted-foreground"
                                >
                                  Built-in
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate text-muted-foreground">
                            {toolItem.description}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                            {toolItem.permissions.network.length > 0 &&
                              `net: ${toolItem.permissions.network.join(", ")}`}
                            {toolItem.permissions.network.length > 0 &&
                              toolItem.permissions.filesystem.length > 0 &&
                              " · "}
                            {toolItem.permissions.filesystem.length > 0 &&
                              `fs: ${toolItem.permissions.filesystem.join(", ")}`}
                            {toolItem.permissions.network.length === 0 &&
                              toolItem.permissions.filesystem.length === 0 &&
                              "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={toolItem.enabled}
                                onCheckedChange={(checked) =>
                                  toggleEnabled.mutate({
                                    id: toolItem.id,
                                    enabled: checked,
                                  })
                                }
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={toolItem.builtin}
                                title={
                                  toolItem.builtin ? "Built-in tools can't be deleted" : undefined
                                }
                                onClick={() => deleteTool.mutate(toolItem.id)}
                              >
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create a tool</CardTitle>
          <CardDescription>
            Pick a kind, describe what it does, and declare exactly which hosts or directories it
            may touch. New tools default to needing approval before they run unless you turn that
            off below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="tool-name">Name</Label>
            <Input
              id="tool-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Read project logs"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tool-description">Description</Label>
            <Textarea
              id="tool-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this tool does and when an agent should use it — shown to the model."
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ToolKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map((category) => (
                  <div key={category}>
                    {TOOL_KINDS.filter((k) => TOOL_KIND_CATEGORY[k.value] === category).map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {CATEGORY_LABEL[category]} — {k.label}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
            {kindMeta && <p className="text-xs text-muted-foreground">{kindMeta.description}</p>}
          </div>

          {NEEDS_HOSTS.has(kind) && (
            <div className="grid gap-2">
              <Label htmlFor="tool-hosts">Allowed hosts</Label>
              <Input
                id="tool-hosts"
                value={allowedHosts}
                onChange={(e) => setAllowedHosts(e.target.value)}
                placeholder="api.github.com, raw.githubusercontent.com"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Comma-separated hostnames.</p>
            </div>
          )}

          {NEEDS_DIRS.has(kind) && (
            <div className="grid gap-2">
              <Label htmlFor="tool-dirs">Allowed directories</Label>
              <Input
                id="tool-dirs"
                value={allowedDirs}
                onChange={(e) => setAllowedDirs(e.target.value)}
                placeholder="/absolute/path/to/a/directory"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated absolute directory paths. Reads/writes outside these are rejected.
              </p>
            </div>
          )}

          {NEEDS_COMMAND.has(kind) && (
            <div className="grid gap-2">
              <Label htmlFor="tool-command">Command</Label>
              <Input
                id="tool-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={kind === "problems" ? "tsc --noEmit" : "npm test"}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                The fixed shell command this tool runs every time it's called.
              </p>
            </div>
          )}

          {kind === "custom_code" && (
            <div className="grid gap-2">
              <Label htmlFor="tool-code">Code</Label>
              <Textarea
                id="tool-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={
                  'return { result: input.a + input.b };\n// "input" is the model-supplied JSON object; "ctx" exposes ctx.fetch / ctx.readFile / ctx.writeFile / ctx.readDir, scoped to the hosts/directories above.'
                }
                rows={6}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                The body of an async function <code>(input, ctx) =&gt; {"{ ... }"}</code>. Runs
                in-process with the same permission checks as other tools (ADR-0007) — it can still
                reach other APIs directly, so keep sensitive on unless you're sure.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="tool-sensitive">Requires approval before running</Label>
              <p className="text-xs text-muted-foreground">
                Recommended for anything that writes, sends, executes, or controls a browser.
                Read-only lookups can usually run without approval.
              </p>
            </div>
            <Switch
              id="tool-sensitive"
              checked={sensitive}
              onCheckedChange={(checked) => setSensitiveOverride(checked)}
            />
          </div>

          <div className="flex items-center gap-3 border-t pt-4">
            <Button
              onClick={() => createTool.mutate()}
              disabled={createTool.isPending || !name || !description}
            >
              {createTool.isPending ? "Creating…" : "Create tool"}
            </Button>
            {createTool.isError && (
              <p className="text-sm text-destructive">{(createTool.error as Error).message}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
