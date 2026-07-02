"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Bot,
	ChevronDown,
	ChevronRight,
	Download,
	ExternalLink,
	FileText,
	Lock,
	Package,
	Sparkles,
	Trash2,
	User,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { type PluginSummary, trpcClient } from "@/lib/trpc";

export default function PluginsPage() {
	const params = useParams<{ workspaceId: string }>();
	const workspaceId = params.workspaceId;
	const queryClient = useQueryClient();

	const pluginsQuery = useQuery({
		queryKey: ["plugins", "list", workspaceId],
		queryFn: () => trpcClient.plugins.list.query({ workspaceId }),
	});

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: ["plugins", "list", workspaceId] });

	const [repoUrl, setRepoUrl] = useState("");
	const [lastInstallSummary, setLastInstallSummary] = useState<string | null>(null);
	const installPlugin = useMutation({
		mutationFn: (url: string) => trpcClient.plugins.install.mutate({ workspaceId, repoUrl: url }),
		onSuccess: (result) => {
			invalidate();
			setRepoUrl("");
			const skipped = result.skippedFiles.length
				? `, skipped ${result.skippedFiles.length} oversized file(s)`
				: "";
			setLastInstallSummary(
				`Installed "${result.plugin.name}" — ${result.skills.length} skill(s), ${result.plugin.agentDefs.length} agent(s), ${result.plugin.fileCount} file(s)${skipped}.`,
			);
		},
	});

	const setEnabled = useMutation({
		mutationFn: (input: { id: string; enabled: boolean }) =>
			trpcClient.plugins.setEnabled.mutate(input),
		onSuccess: invalidate,
	});

	const uninstallPlugin = useMutation({
		mutationFn: (id: string) => trpcClient.plugins.uninstall.mutate({ id }),
		onSuccess: invalidate,
	});

	const [uninstallTarget, setUninstallTarget] = useState<PluginSummary | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	function toggleExpanded(id: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	const plugins = pluginsQuery.data ?? [];
	const totalSkills = plugins.reduce((sum, p) => sum + p.skillSlugs.length, 0);
	const totalAgents = plugins.reduce((sum, p) => sum + p.agentDefs.length, 0);

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 p-8">
			<PageHeader
				title="Plugins"
				description="Full folder-based bundles pulled from a GitHub repo — SKILL.md files, supporting scripts and references, sub-agents, and everything else the repo ships, not just a single markdown file. Matches the Claude Code plugin format (.claude-plugin/plugin.json + skills/ + agents/)."
			/>

			<div className="grid gap-4 sm:grid-cols-3">
				<StatCard
					label="Installed plugins"
					value={plugins.length}
					icon={<Package className="size-4" />}
				/>
				<StatCard
					label="Skills contributed"
					value={totalSkills}
					icon={<Sparkles className="size-4" />}
				/>
				<StatCard
					label="Sub-agents contributed"
					value={totalAgents}
					icon={<Bot className="size-4" />}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Install from GitHub</CardTitle>
					<CardDescription>
						Paste a repo URL (e.g. https://github.com/owner/repo). Every file in the repo is
						downloaded — skills/*/SKILL.md bundles (with their scripts and references), agents/*.md
						sub-agents, docs, everything — not flattened into a single skill body. Installing a slug
						that's already present replaces it, so pasting the same URL again updates the plugin.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex gap-2">
						<Input
							value={repoUrl}
							onChange={(e) => setRepoUrl(e.target.value)}
							placeholder="https://github.com/AgricIDaniel/claude-seo"
							onKeyDown={(e) => {
								if (e.key === "Enter" && repoUrl && !installPlugin.isPending) {
									installPlugin.mutate(repoUrl);
								}
							}}
						/>
						<Button
							onClick={() => installPlugin.mutate(repoUrl)}
							disabled={installPlugin.isPending || !repoUrl}
						>
							<Download className="size-4" />
							{installPlugin.isPending ? "Installing…" : "Install"}
						</Button>
					</div>
					{installPlugin.isError && (
						<p className="text-sm text-destructive">{(installPlugin.error as Error).message}</p>
					)}
					{lastInstallSummary && !installPlugin.isError && (
						<p className="text-sm text-muted-foreground">{lastInstallSummary}</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Installed plugins</CardTitle>
					<CardDescription>
						Disabling a plugin hides the skills it contributes from the workspace skill catalog
						without deleting its files; uninstalling removes both.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{plugins.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No plugins installed yet — paste a GitHub repo URL above to get started.
						</p>
					) : (
						<div className="space-y-3">
							{plugins.map((plugin) => {
								const isExpanded = expanded.has(plugin.id);
								return (
									<div key={plugin.id} className="rounded-lg border">
										<div className="flex items-start justify-between gap-3 p-4">
											<div className="flex min-w-0 flex-1 gap-3">
												<Button
													variant="ghost"
													size="icon"
													className="mt-0.5 size-6 shrink-0"
													onClick={() => toggleExpanded(plugin.id)}
												>
													{isExpanded ? (
														<ChevronDown className="size-4" />
													) : (
														<ChevronRight className="size-4" />
													)}
												</Button>
												<div className="min-w-0 space-y-1">
													<div className="flex flex-wrap items-center gap-2">
														<span className="font-medium">{plugin.name}</span>
														{plugin.version && (
															<Badge
																variant="outline"
																className="border-0 bg-muted text-muted-foreground"
															>
																v{plugin.version}
															</Badge>
														)}
														<Badge
															variant="outline"
															className="border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
														>
															{plugin.skillSlugs.length} skill
															{plugin.skillSlugs.length === 1 ? "" : "s"}
														</Badge>
														{plugin.agentDefs.length > 0 && (
															<Badge
																variant="outline"
																className="border-0 bg-muted text-muted-foreground"
															>
																{plugin.agentDefs.length} agent
																{plugin.agentDefs.length === 1 ? "" : "s"}
															</Badge>
														)}
													</div>
													<p className="truncate text-sm text-muted-foreground">
														{plugin.description}
													</p>
													<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
														{plugin.author && (
															<span className="inline-flex items-center gap-1">
																<User className="size-3" />
																{plugin.author}
															</span>
														)}
														<span className="inline-flex items-center gap-1">
															<FileText className="size-3" />
															{plugin.fileCount} files
														</span>
														<a
															href={plugin.repoUrl}
															target="_blank"
															rel="noreferrer"
															className="inline-flex items-center gap-1 hover:text-foreground"
														>
															<ExternalLink className="size-3" />
															Source
														</a>
													</div>
												</div>
											</div>
											<div className="flex shrink-0 items-center gap-3">
												<Switch
													checked={plugin.enabled}
													onCheckedChange={(checked) =>
														setEnabled.mutate({ id: plugin.id, enabled: checked })
													}
												/>
												<Button
													variant="destructive"
													size="sm"
													onClick={() => setUninstallTarget(plugin)}
												>
													<Trash2 className="size-4" />
													Uninstall
												</Button>
											</div>
										</div>
										{isExpanded && (
											<div className="space-y-4 border-t bg-muted/30 p-4">
												{plugin.skillSlugs.length > 0 && (
													<div className="space-y-2">
														<p className="text-xs font-medium text-muted-foreground uppercase">
															Skills
														</p>
														<ul className="space-y-1 text-sm">
															{plugin.skillSlugs.map((skillId) => (
																<li
																	key={skillId}
																	className="flex items-center gap-1.5 text-muted-foreground"
																>
																	<Sparkles className="size-3 shrink-0" />
																	<code className="text-xs">{skillId}</code>
																</li>
															))}
														</ul>
													</div>
												)}
												{plugin.agentDefs.length > 0 && (
													<div className="space-y-2">
														<p className="text-xs font-medium text-muted-foreground uppercase">
															Sub-agents (informational — not wired into NyxelOS's agent runtime)
														</p>
														<ul className="space-y-2 text-sm">
															{plugin.agentDefs.map((agent) => (
																<li key={agent.slug} className="flex items-start gap-1.5">
																	<Bot className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
																	<div>
																		<span className="font-medium">{agent.name}</span>
																		<span className="ml-1.5 text-muted-foreground">
																			{agent.description}
																		</span>
																	</div>
																</li>
															))}
														</ul>
													</div>
												)}
												<Separator />
												<p className="text-xs text-muted-foreground">
													Installed at <code>{plugin.installDir}</code>
												</p>
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog
				open={Boolean(uninstallTarget)}
				onOpenChange={(open) => !open && setUninstallTarget(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Uninstall plugin</DialogTitle>
						<DialogDescription>
							<Lock className="mr-1 inline size-3.5" />
							This permanently deletes &quot;{uninstallTarget?.name}&quot; and every file it
							downloaded, including its {uninstallTarget?.skillSlugs.length ?? 0} skill(s). This
							action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter showCloseButton>
						<Button
							variant="destructive"
							onClick={() => {
								if (uninstallTarget) {
									uninstallPlugin.mutate(uninstallTarget.id);
									setUninstallTarget(null);
								}
							}}
							disabled={uninstallPlugin.isPending}
						>
							Uninstall
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
