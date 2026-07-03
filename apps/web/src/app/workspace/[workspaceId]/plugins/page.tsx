"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Bot,
	ChevronDown,
	ChevronRight,
	Download,
	ExternalLink,
	FileText,
	GitCommitHorizontal,
	Lock,
	Package,
	ShieldAlert,
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
import { type PluginRiskSummary, type PluginSummary, trpcClient } from "@/lib/trpc";

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
	// Set when the static scan (docs/PLUGIN_SECURITY.md stage 4) finds risky
	// patterns — the install is paused (nothing written) until the user
	// explicitly confirms via the dialog below.
	const [pendingRisk, setPendingRisk] = useState<{
		repoUrl: string;
		riskSummary: PluginRiskSummary;
	} | null>(null);

	const installPlugin = useMutation({
		mutationFn: (input: { repoUrl: string; acknowledgeRisk?: boolean }) =>
			trpcClient.plugins.install.mutate({
				workspaceId,
				repoUrl: input.repoUrl,
				acknowledgeRisk: input.acknowledgeRisk,
			}),
		onSuccess: (result, variables) => {
			if (result.status === "needs_confirmation") {
				setPendingRisk({ repoUrl: variables.repoUrl, riskSummary: result.riskSummary });
				return;
			}
			setPendingRisk(null);
			invalidate();
			setRepoUrl("");
			const skipped = result.skippedFiles.length
				? `, skipped ${result.skippedFiles.length} oversized file(s)`
				: "";
			const pin = result.riskSummary.refPinned
				? `pinned to commit ${result.riskSummary.resolvedSha?.slice(0, 12)}`
				: result.riskSummary.resolvedSha
					? `from "${result.riskSummary.ref}" at commit ${result.riskSummary.resolvedSha.slice(0, 12)} — not pinned`
					: `from "${result.riskSummary.ref}" — not pinned, commit could not be resolved`;
			setLastInstallSummary(
				`Installed "${result.plugin.name}" (${pin}) — ${result.skills.length} skill(s), ${result.plugin.agentDefs.length} agent(s), ${result.plugin.fileCount} file(s)${skipped}.`,
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
					<div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
						<AlertTriangle className="mt-0.5 size-4 shrink-0" />
						<div className="space-y-1">
							<p className="font-medium">A plugin can run code with full server access.</p>
							<p className="text-amber-800/90 dark:text-amber-200/80">
								Only install plugins from sources you trust. Prefer a specific commit SHA or tag
								over a branch like <code>main</code>/<code>master</code>, which can change after you
								install. Review the skills/permissions it contributes before relying on it. See{" "}
								<code>docs/PLUGIN_SECURITY.md</code> — installed plugin code is not sandboxed.
							</p>
						</div>
					</div>
					<div className="flex gap-2">
						<Input
							value={repoUrl}
							onChange={(e) => setRepoUrl(e.target.value)}
							placeholder="https://github.com/AgricIDaniel/claude-seo"
							onKeyDown={(e) => {
								if (e.key === "Enter" && repoUrl && !installPlugin.isPending) {
									installPlugin.mutate({ repoUrl });
								}
							}}
						/>
						<Button
							onClick={() => installPlugin.mutate({ repoUrl })}
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
														{plugin.refPinned ? (
															<Badge
																variant="outline"
																className="gap-1 border-0 bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
															>
																<GitCommitHorizontal className="size-3" />
																pinned
															</Badge>
														) : (
															<Badge
																variant="outline"
																className="gap-1 border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
															>
																<AlertTriangle className="size-3" />
																not pinned ({plugin.ref || "branch"})
															</Badge>
														)}
														{plugin.riskFindings.length > 0 && (
															<Badge
																variant="outline"
																className="gap-1 border-0 bg-red-500/15 text-red-700 dark:bg-red-500/10 dark:text-red-300"
															>
																<ShieldAlert className="size-3" />
																{plugin.riskFindings.length} scan flag
																{plugin.riskFindings.length === 1 ? "" : "s"}
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
														{plugin.resolvedSha && (
															<span className="inline-flex items-center gap-1">
																<GitCommitHorizontal className="size-3" />
																<code>{plugin.resolvedSha.slice(0, 12)}</code>
															</span>
														)}
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
												{plugin.riskFindings.length > 0 && (
													<div className="space-y-2">
														<p className="text-xs font-medium text-red-700 uppercase dark:text-red-300">
															Static scan flags (docs/PLUGIN_SECURITY.md — not a sandbox, informational
															only)
														</p>
														<ul className="space-y-1 text-sm">
															{plugin.riskFindings.map((finding) => (
																<li
																	key={finding}
																	className="flex items-center gap-1.5 text-muted-foreground"
																>
																	<ShieldAlert className="size-3 shrink-0 text-red-600 dark:text-red-400" />
																	<code className="text-xs">{finding}</code>
																</li>
															))}
														</ul>
													</div>
												)}
												<Separator />
												<p className="text-xs text-muted-foreground">
													Installed at <code>{plugin.installDir}</code> — ref{" "}
													<code>{plugin.ref || "(unknown)"}</code>
													{plugin.resolvedSha && (
														<>
															{" "}
															at commit <code>{plugin.resolvedSha}</code>
														</>
													)}
													{!plugin.refPinned && " — not pinned to a commit"}
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

			<Dialog open={Boolean(pendingRisk)} onOpenChange={(open) => !open && setPendingRisk(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<ShieldAlert className="size-4 text-destructive" />
							Confirm risky plugin install
						</DialogTitle>
						<DialogDescription asChild>
							<div className="space-y-3 text-left">
								<p>
									The static scan found code patterns worth a second look before this plugin runs
									with the server's full access. This is a naive pattern scan, not a sandbox — a
									clean result never means "safe", and this can flag legitimate code too.
								</p>
								{pendingRisk?.riskSummary.branchWarning && (
									<p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-200">
										Installing from ref <code>{pendingRisk.riskSummary.ref}</code>
										{pendingRisk.riskSummary.isMovingBranch
											? " — a branch that can move, so a later reinstall may silently pull in different code."
											: " — not pinned to an exact commit."}
									</p>
								)}
								{pendingRisk && pendingRisk.riskSummary.findings.length > 0 && (
									<ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
										{pendingRisk.riskSummary.findings.map((f) => (
											<li key={`${f.file}:${f.pattern}`} className="flex items-center gap-1.5">
												<AlertTriangle className="size-3 shrink-0 text-destructive" />
												<code>{f.pattern}</code>
												<span className="text-muted-foreground">in {f.file}</span>
											</li>
										))}
									</ul>
								)}
								<p>Only continue if you trust this source and have reviewed what it ships.</p>
							</div>
						</DialogDescription>
					</DialogHeader>
					<DialogFooter showCloseButton>
						<Button
							variant="destructive"
							onClick={() => {
								if (pendingRisk) {
									installPlugin.mutate({ repoUrl: pendingRisk.repoUrl, acknowledgeRisk: true });
								}
							}}
							disabled={installPlugin.isPending}
						>
							Install anyway
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
