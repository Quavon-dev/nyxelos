"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageHeaderSkeleton, TableSkeleton } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { CONNECTOR_ICONS } from "@/components/connector-icons";
import {
	type McpConnectorCatalogEntry,
	type McpServerSummary,
	type McpTransportKind,
	trpcClient,
} from "@/lib/trpc";

function openAuthorizationWindow(authorizationUrl: string) {
	const popup = window.open(authorizationUrl, "_blank", "noopener,noreferrer");
	if (!popup) {
		window.location.href = authorizationUrl;
	}
}

function connectorInitial(name: string) {
	return name.slice(0, 1).toUpperCase();
}

/** Identity used to match a catalog entry against an already-configured
 * server — http connectors match by url, stdio ones by command+args since
 * they have no url at all. */
function catalogIdentity(entry: Pick<McpConnectorCatalogEntry, "url" | "command" | "args">) {
	if (entry.url) return entry.url;
	if (entry.command) return `${entry.command} ${(entry.args ?? []).join(" ")}`;
	return null;
}

function serverIdentity(server: Pick<McpServerSummary, "url" | "command" | "args">) {
	if (server.url) return server.url;
	if (server.command) return `${server.command} ${(server.args ?? []).join(" ")}`;
	return null;
}

type ConnectorFilter = "all" | "connected" | "not_connected";

function ConnectorCatalog({
	workspaceId,
	servers,
	onConnected,
}: {
	workspaceId: string;
	servers: McpServerSummary[];
	onConnected: (id: string) => void;
}) {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<ConnectorFilter>("all");

	const catalogQuery = useQuery({
		queryKey: ["mcpConnectorCatalog"],
		queryFn: () => trpcClient.mcpServers.catalog.query(),
	});

	const connectedByIdentity = useMemo(() => {
		const map = new Map<string, McpServerSummary>();
		for (const server of servers) {
			const identity = serverIdentity(server);
			if (identity) map.set(identity, server);
		}
		return map;
	}, [servers]);

	const connectMutation = useMutation({
		mutationFn: (entry: McpConnectorCatalogEntry) =>
			trpcClient.mcpServers.create.mutate(
				entry.transport === "stdio"
					? {
							workspaceId,
							name: entry.name,
							transport: "stdio",
							command: entry.command,
							args: entry.args,
						}
					: {
							workspaceId,
							name: entry.name,
							transport: "http",
							url: entry.url,
						},
			),
		onSuccess: (server) => {
			queryClient.invalidateQueries({ queryKey: ["mcpServers", workspaceId] });
			onConnected(server.id);
		},
	});

	const catalog = catalogQuery.data ?? [];
	const filtered = catalog.filter((entry) => {
		const identity = catalogIdentity(entry);
		const connected = identity !== null && connectedByIdentity.has(identity);
		if (filter === "connected" && !connected) return false;
		if (filter === "not_connected" && connected) return false;
		if (!search.trim()) return true;
		const q = search.trim().toLowerCase();
		return (
			entry.name.toLowerCase().includes(q) ||
			entry.category.toLowerCase().includes(q)
		);
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Connectors</CardTitle>
				<CardDescription>
					One-click connections to popular services. Each connector is a remote
					MCP server — connecting one adds it to the configured servers below,
					and any agent can use its tools.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="relative w-full sm:max-w-xs">
						<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							className="pl-8"
							placeholder="Search connectors"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>
					<div className="flex gap-1 rounded-lg border p-1">
						{(
							[
								{ value: "all", label: "All" },
								{ value: "connected", label: "Connected" },
								{ value: "not_connected", label: "Not connected" },
							] as const
						).map((tab) => (
							<Button
								key={tab.value}
								type="button"
								size="sm"
								variant={filter === tab.value ? "secondary" : "ghost"}
								onClick={() => setFilter(tab.value)}
							>
								{tab.label}
							</Button>
						))}
					</div>
				</div>

				{catalogQuery.isLoading ? (
					<p className="text-sm text-muted-foreground">Loading connectors…</p>
				) : filtered.length === 0 ? (
					<p className="text-sm text-muted-foreground">No connectors match.</p>
				) : (
					<div className="grid gap-3 sm:grid-cols-2">
						{filtered.map((entry) => {
							const identity = catalogIdentity(entry);
							const existing = identity !== null ? connectedByIdentity.get(identity) : undefined;
							const isConnecting =
								connectMutation.isPending &&
								connectMutation.variables?.key === entry.key;
							const Logo = CONNECTOR_ICONS[entry.key];
							return (
								<div
									key={entry.key}
									className="flex items-start justify-between gap-3 rounded-lg border p-3"
								>
									<div className="flex items-start gap-3">
										<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white p-1.5 shadow-sm ring-1 ring-black/5">
											{Logo ? (
												<Logo className="h-full w-full" />
											) : (
												<span className="text-sm font-semibold text-foreground">
													{connectorInitial(entry.name)}
												</span>
											)}
										</div>
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<p className="text-sm font-medium">{entry.name}</p>
												<Badge variant="outline" className="text-[10px]">
													{entry.category}
												</Badge>
											</div>
											<p className="text-xs text-muted-foreground">
												{entry.description}
											</p>
										</div>
									</div>
									{existing ? (
										<Badge variant="secondary" className="shrink-0">
											Connected
										</Badge>
									) : (
										<Button
											size="sm"
											variant="outline"
											className="shrink-0"
											onClick={() => connectMutation.mutate(entry)}
											disabled={isConnecting}
										>
											{isConnecting ? "Connecting…" : "Connect"}
										</Button>
									)}
								</div>
							);
						})}
					</div>
				)}
				{connectMutation.isError && (
					<p className="text-sm text-destructive">
						{(connectMutation.error as Error).message}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

export default function McpServersPage() {
	const params = useParams<{ workspaceId: string }>();
	const workspaceId = params.workspaceId;
	const queryClient = useQueryClient();

	const serversQuery = useQuery({
		queryKey: ["mcpServers", workspaceId],
		queryFn: () => trpcClient.mcpServers.list.query({ workspaceId }),
	});

	const [name, setName] = useState("");
	const [transport, setTransport] = useState<McpTransportKind>("stdio");
	const [command, setCommand] = useState("");
	const [args, setArgs] = useState("");
	const [url, setUrl] = useState("");

	const createServer = useMutation({
		mutationFn: () =>
			trpcClient.mcpServers.create.mutate({
				workspaceId,
				name,
				transport,
				command: transport === "stdio" ? command : undefined,
				args:
					transport === "stdio" && args.trim()
						? args.trim().split(/\s+/)
						: undefined,
				url: transport === "http" ? url : undefined,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mcpServers", workspaceId] });
			setName("");
			setCommand("");
			setArgs("");
			setUrl("");
		},
	});

	const deleteServer = useMutation({
		mutationFn: (id: string) => trpcClient.mcpServers.delete.mutate({ id }),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["mcpServers", workspaceId] }),
	});

	const [deleteConfirmTarget, setDeleteConfirmTarget] =
		useState<McpServerSummary | null>(null);

	const [testedServerId, setTestedServerId] = useState<string | null>(null);
	const testConnection = useMutation({
		mutationFn: (id: string) => trpcClient.mcpServers.listTools.query({ id }),
		onMutate: (id) => setTestedServerId(id),
		onSuccess: (result) => {
			if (result.status === "auth_required") {
				openAuthorizationWindow(result.authorizationUrl);
			}
		},
	});

	useEffect(() => {
		function handleMessage(event: MessageEvent) {
			if (event.origin !== window.location.origin) return;
			if (event.data?.type !== "nyxel:mcp-auth-complete") return;
			if (typeof event.data.serverId !== "string") return;
			void testConnection.mutate(event.data.serverId);
		}

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [testConnection]);

	const servers = serversQuery.data ?? [];

	if (serversQuery.isLoading) {
		return (
			<div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
				<PageHeaderSkeleton actions={1} />
				<TableSkeleton rows={4} cols={4} />
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
			<PageHeader
				title="Connectors"
				description="Connected tool servers, reachable by any agent that lists them. Nyxel connects on demand — nothing here is kept running until an agent actually needs it."
			/>

			<ConnectorCatalog
				workspaceId={workspaceId}
				servers={servers}
				onConnected={(id) => testConnection.mutate(id)}
			/>

			<Card>
				<CardHeader>
					<CardTitle>Configured servers</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					{servers.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No MCP servers configured yet.
						</p>
					) : (
						<div className="rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow className="hover:bg-transparent">
										<TableHead>Name</TableHead>
										<TableHead>Transport</TableHead>
										<TableHead>Endpoint</TableHead>
										<TableHead className="w-[280px]">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{servers.map((server) =>
										(() => {
											const testedResult =
												testedServerId === server.id && testConnection.isSuccess
													? testConnection.data
													: null;
											const authRequired =
												testedResult?.status === "auth_required"
													? {
															authorizationUrl: testedResult.authorizationUrl,
															message: testedResult.message,
														}
													: null;
											const invalidConfig =
												testedResult?.status === "invalid_config"
													? { message: testedResult.message }
													: null;

											return (
												<TableRow key={server.id}>
													<TableCell className="font-medium">
														{server.name}
													</TableCell>
													<TableCell>
														<Badge variant="outline" className="uppercase">
															{server.transport}
														</Badge>
													</TableCell>
													<TableCell className="max-w-[260px] truncate text-muted-foreground">
														{server.transport === "stdio"
															? server.command
															: server.url}
													</TableCell>
													<TableCell>
														<div className="flex flex-col gap-2">
															<div className="flex gap-2">
																<Button
																	variant="outline"
																	size="sm"
																	onClick={() =>
																		testConnection.mutate(server.id)
																	}
																	disabled={
																		testConnection.isPending &&
																		testedServerId === server.id
																	}
																>
																	{testConnection.isPending &&
																	testedServerId === server.id
																		? "Connecting…"
																		: "Test connection"}
																</Button>
																<Button
																	variant="ghost"
																	size="sm"
																	onClick={() => setDeleteConfirmTarget(server)}
																>
																	Delete
																</Button>
															</div>
															{testedResult?.status === "ready" && (
																<p className="text-xs text-muted-foreground">
																	{testedResult.tools.length === 0
																		? "Connected, but exposes no tools."
																		: `Tools: ${testedResult.tools.map((t) => t.name).join(", ")}`}
																</p>
															)}
															{authRequired && (
																<div className="space-y-1 text-xs text-muted-foreground">
																	<p>{authRequired.message}</p>
																	<button
																		type="button"
																		className="font-medium text-foreground underline underline-offset-2"
																		onClick={() =>
																			openAuthorizationWindow(
																				authRequired.authorizationUrl,
																			)
																		}
																	>
																		Continue sign-in
																	</button>
																</div>
															)}
															{invalidConfig && (
																<p className="text-xs text-destructive">
																	{invalidConfig.message}
																</p>
															)}
															{testedServerId === server.id &&
																testConnection.isError && (
																	<p className="text-xs text-destructive">
																		{(testConnection.error as Error).message}
																	</p>
																)}
														</div>
													</TableCell>
												</TableRow>
											);
										})(),
									)}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Add custom connector</CardTitle>
					<CardDescription>
						Not in the catalog above? Register any stdio or HTTP MCP server
						directly. For remote servers, use the actual MCP endpoint URL, not
						the provider's documentation page.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-2">
						<Label htmlFor="mcp-name">Name</Label>
						<Input
							id="mcp-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>

					<div className="grid gap-2">
						<Label>Transport</Label>
						<RadioGroup
							value={transport}
							onValueChange={(v) => setTransport(v as McpTransportKind)}
							className="grid-cols-2"
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem value="stdio" id="transport-stdio" />
								<Label htmlFor="transport-stdio" className="font-normal">
									stdio (local command)
								</Label>
							</div>
							<div className="flex items-center gap-2">
								<RadioGroupItem value="http" id="transport-http" />
								<Label htmlFor="transport-http" className="font-normal">
									http (remote URL)
								</Label>
							</div>
						</RadioGroup>
					</div>

					{transport === "stdio" ? (
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="mcp-command">Command</Label>
								<Input
									id="mcp-command"
									placeholder="e.g. npx"
									value={command}
									onChange={(e) => setCommand(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="mcp-args">Arguments</Label>
								<Input
									id="mcp-args"
									placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
									value={args}
									onChange={(e) => setArgs(e.target.value)}
								/>
							</div>
						</div>
					) : (
						<div className="grid gap-2">
							<Label htmlFor="mcp-url">MCP endpoint URL</Label>
							<Input
								id="mcp-url"
								placeholder="https://example.com/mcp"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								Example: use https://api.notion.com/mcp or another direct MCP
								endpoint, not a docs URL.
							</p>
						</div>
					)}

					<div className="flex items-center gap-3 border-t pt-4">
						<Button
							onClick={() => createServer.mutate()}
							disabled={
								createServer.isPending ||
								!name ||
								(transport === "stdio" ? !command : !url)
							}
						>
							{createServer.isPending ? "Adding…" : "Add server"}
						</Button>
						{createServer.isError && (
							<p className="text-sm text-destructive">
								{(createServer.error as Error).message}
							</p>
						)}
					</div>
				</CardContent>
			</Card>

			<Dialog
				open={Boolean(deleteConfirmTarget)}
				onOpenChange={(open) => !open && setDeleteConfirmTarget(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete MCP server</DialogTitle>
						<DialogDescription>
							This permanently removes &quot;{deleteConfirmTarget?.name}&quot;.
							Agents will no longer be able to reach it. This action cannot be
							undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter showCloseButton>
						<Button
							variant="destructive"
							onClick={() => {
								if (deleteConfirmTarget) {
									deleteServer.mutate(deleteConfirmTarget.id);
									setDeleteConfirmTarget(null);
								}
							}}
							disabled={deleteServer.isPending}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
