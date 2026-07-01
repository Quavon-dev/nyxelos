"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Wrench } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import { type ToolKind, trpcClient } from "@/lib/trpc";

const TOOL_KINDS: { value: ToolKind; label: string; description: string }[] = [
	{
		value: "http_fetch",
		label: "HTTP fetch",
		description:
			"GET a URL from an allow-listed set of hosts and return the response text.",
	},
	{
		value: "file_read",
		label: "Read files",
		description:
			"Read a file's contents from an allow-listed set of directories.",
	},
	{
		value: "file_list",
		label: "List directory",
		description:
			"List the contents of a directory from an allow-listed set of directories.",
	},
	{
		value: "file_write",
		label: "Write files",
		description:
			"Write/overwrite a file under an allow-listed set of directories.",
	},
	{
		value: "file_delete",
		label: "Delete files",
		description: "Delete a file under an allow-listed set of directories.",
	},
	{
		value: "kb_search",
		label: "Knowledge-base search",
		description:
			"Search this workspace's knowledge-base vault by title/path.",
	},
	{
		value: "custom_code",
		label: "Custom code",
		description:
			"Run a short JavaScript function with a permission-scoped fetch/file context.",
	},
];

const DEFAULT_SENSITIVE_KINDS = new Set<ToolKind>([
	"file_write",
	"file_delete",
	"custom_code",
]);
const NEEDS_HOSTS = new Set<ToolKind>(["http_fetch", "custom_code"]);
const NEEDS_DIRS = new Set<ToolKind>([
	"file_read",
	"file_list",
	"file_write",
	"file_delete",
	"custom_code",
]);

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
	const [sensitiveOverride, setSensitiveOverride] = useState<boolean | null>(
		null,
	);

	const sensitive = sensitiveOverride ?? DEFAULT_SENSITIVE_KINDS.has(kind);

	const createTool = useMutation({
		mutationFn: () => {
			const config: Record<string, unknown> = {};
			if (NEEDS_HOSTS.has(kind)) config.allowedHosts = splitList(allowedHosts);
			if (NEEDS_DIRS.has(kind)) config.allowedDirs = splitList(allowedDirs);
			if (kind === "custom_code") config.code = code;

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
	const kindMeta = TOOL_KINDS.find((k) => k.value === kind);

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 p-8">
			<PageHeader
				title="Tools"
				description="Workspace-configured tools agents can use — HTTP fetch, file access, knowledge-base search, or custom code — with a declared permission profile. For built-in runtime skills, see an agent's skill picker."
			/>

			<div className="grid gap-4 sm:grid-cols-1">
				<StatCard
					label="Total tools"
					value={tools.length}
					icon={<Wrench className="size-4" />}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Tool selection</CardTitle>
					<CardDescription>
						Tools can be disabled or deleted here — agents that reference a
						disabled tool simply skip it.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{tools.length === 0 ? (
						<p className="text-sm text-muted-foreground">No tools yet.</p>
					) : (
						<div className="rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow className="hover:bg-transparent">
										<TableHead>Name</TableHead>
										<TableHead>Kind</TableHead>
										<TableHead>Description</TableHead>
										<TableHead>Permissions</TableHead>
										<TableHead className="w-[160px]">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{tools.map((toolItem) => (
										<TableRow key={toolItem.id}>
											<TableCell className="font-medium">
												{toolItem.name}
												{toolItem.sensitive && (
													<Lock className="ml-1.5 inline size-3 text-muted-foreground" />
												)}
											</TableCell>
											<TableCell>
												<Badge
													variant="outline"
													className="border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
												>
													{toolItem.kind}
												</Badge>
											</TableCell>
											<TableCell className="max-w-[240px] truncate text-muted-foreground">
												{toolItem.description}
											</TableCell>
											<TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
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
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Create a tool</CardTitle>
					<CardDescription>
						Pick a kind, describe what it does, and declare exactly which hosts
						or directories it may touch. New tools default to needing approval
						before they run unless you turn that off below.
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
								{TOOL_KINDS.map((k) => (
									<SelectItem key={k.value} value={k.value}>
										{k.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{kindMeta && (
							<p className="text-xs text-muted-foreground">
								{kindMeta.description}
							</p>
						)}
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
							<p className="text-xs text-muted-foreground">
								Comma-separated hostnames.
							</p>
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
								Comma-separated absolute directory paths. Reads/writes outside
								these are rejected.
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
								The body of an async function{" "}
								<code>(input, ctx) =&gt; {"{ ... }"}</code>. Runs in-process
								with the same permission checks as other tools (ADR-0007) — it
								can still reach other APIs directly, so keep sensitive on unless
								you're sure.
							</p>
						</div>
					)}

					<div className="flex items-center justify-between rounded-lg border p-3">
						<div className="space-y-0.5">
							<Label htmlFor="tool-sensitive">
								Requires approval before running
							</Label>
							<p className="text-xs text-muted-foreground">
								Recommended for anything that writes, sends, or runs code.
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
							<p className="text-sm text-destructive">
								{(createTool.error as Error).message}
							</p>
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
