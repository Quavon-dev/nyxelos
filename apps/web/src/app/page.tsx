"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type InstallationMode, trpcClient } from "@/lib/trpc";

type InstallForm = {
	mode: InstallationMode;
	ownerName: string;
	ownerEmail: string;
	ownerPassword: string;
	workspaceName: string;
	appUrl: string;
};

const MODE_COPY: Record<
	InstallationMode,
	{ title: string; description: string; database: string; network: string }
> = {
	pc: {
		title: "PC mode",
		description:
			"Single-user, SQLite, local-first. Fastest path for a workstation or laptop.",
		database: "SQLite file on disk",
		network: "Direct web/server ports on localhost",
	},
	server: {
		title: "Server mode",
		description:
			"Shared deployment with a domain, PostgreSQL, TLS, and reverse proxying via Caddy.",
		database: "PostgreSQL container",
		network: "HTTPS via Caddy on your own domain",
	},
};

export default function HomePage() {
	const router = useRouter();
	const installationQuery = useQuery({
		queryKey: ["installation", "status"],
		queryFn: () => trpcClient.installation.status.query(),
	});
	const modelsQuery = useQuery({
		queryKey: ["models", "list"],
		queryFn: () =>
			trpcClient.models.list.query({
				workspaceId: installationQuery.data?.record?.primaryWorkspaceId,
			}),
		enabled: installationQuery.data?.isInstalled === true,
	});

	const [form, setForm] = useState<InstallForm>({
		mode: "pc",
		ownerName: "",
		ownerEmail: "",
		ownerPassword: "",
		workspaceName: "Personal",
		appUrl: "http://localhost:3000",
	});

	useEffect(() => {
		if (!installationQuery.data) return;
		setForm((current) => ({
			...current,
			mode: installationQuery.data.recommendedMode,
			appUrl: installationQuery.data.defaultAppUrl,
		}));
	}, [installationQuery.data]);

	const install = useMutation({
		mutationFn: () => trpcClient.installation.complete.mutate(form),
		onSuccess: async () => {
			await installationQuery.refetch();
			router.refresh();
		},
	});

	if (installationQuery.isLoading) {
		return (
			<main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(178,245,234,0.45),_transparent_30%),linear-gradient(180deg,_#f8faf7_0%,_#eef4ef_100%)] p-6">
				<div className="mx-auto max-w-5xl">
					<Card className="border-0 bg-white/80 p-8 backdrop-blur">
						<p className="text-sm text-muted-foreground">
							Loading installation state…
						</p>
					</Card>
				</div>
			</main>
		);
	}

	if (!installationQuery.data?.isInstalled) {
		const selectedMode = MODE_COPY[form.mode];

		return (
			<main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,214,153,0.45),_transparent_25%),radial-gradient(circle_at_top_right,_rgba(178,245,234,0.4),_transparent_30%),linear-gradient(180deg,_#f6f3eb_0%,_#eef4ef_100%)] p-6 md:p-10">
				<div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
					<section className="space-y-5">
						<div className="space-y-3">
							<p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
								Phase 5
							</p>
							<h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
								Install Nyxel once, then run it like a product.
							</h1>
							<p className="max-w-2xl text-base text-muted-foreground md:text-lg">
								The setup wizard writes the first account, workspace, mode, and
								app URL into the database so the stack can boot consistently on
								a PC or a server.
							</p>
						</div>

						<div className="grid gap-4 md:grid-cols-3">
							<Card className="border-white/60 bg-white/75 p-5 backdrop-blur">
								<p className="text-sm font-medium">Mode-aware</p>
								<p className="mt-2 text-sm text-muted-foreground">
									Recommends{" "}
									{installationQuery.data?.recommendedMode.toUpperCase()} from
									the active database driver.
								</p>
							</Card>
							<Card className="border-white/60 bg-white/75 p-5 backdrop-blur">
								<p className="text-sm font-medium">Caddy-ready</p>
								<p className="mt-2 text-sm text-muted-foreground">
									Server mode assumes HTTPS termination and path routing through
									Caddy.
								</p>
							</Card>
							<Card className="border-white/60 bg-white/75 p-5 backdrop-blur">
								<p className="text-sm font-medium">Own the first account</p>
								<p className="mt-2 text-sm text-muted-foreground">
									Creates the initial Better-Auth account and the primary
									workspace in one step.
								</p>
							</Card>
						</div>
					</section>

					<Card className="border-white/60 bg-white/88 p-6 shadow-xl backdrop-blur">
						<div className="mb-5 space-y-1">
							<h2 className="text-xl font-semibold">Setup wizard</h2>
							<p className="text-sm text-muted-foreground">
								Choose the deployment mode, then define the owner and workspace.
							</p>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							{(["pc", "server"] as const).map((mode) => {
								const active = form.mode === mode;
								const copy = MODE_COPY[mode];
								return (
									<button
										key={mode}
										className={`rounded-xl border p-4 text-left transition ${
											active
												? "border-foreground bg-foreground text-background"
												: "border-border bg-background/70 hover:border-foreground/40"
										}`}
										onClick={() => setForm((current) => ({ ...current, mode }))}
										type="button"
									>
										<p className="font-medium">{copy.title}</p>
										<p
											className={`mt-2 text-sm ${
												active ? "text-background/80" : "text-muted-foreground"
											}`}
										>
											{copy.description}
										</p>
									</button>
								);
							})}
						</div>

						<div className="mt-4 rounded-xl border bg-background/60 p-4 text-sm">
							<p className="font-medium">{selectedMode.title}</p>
							<p className="mt-1 text-muted-foreground">
								{selectedMode.description}
							</p>
							<p className="mt-3">Database: {selectedMode.database}</p>
							<p className="text-muted-foreground">
								Network: {selectedMode.network}
							</p>
						</div>

						<form
							className="mt-5 space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								install.mutate();
							}}
						>
							<label className="block space-y-2 text-sm" htmlFor="owner-name">
								<span>Owner name</span>
								<Input
									id="owner-name"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											ownerName: event.target.value,
										}))
									}
									placeholder="Jane Admin"
									required
									value={form.ownerName}
								/>
							</label>

							<label className="block space-y-2 text-sm" htmlFor="owner-email">
								<span>Owner email</span>
								<Input
									id="owner-email"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											ownerEmail: event.target.value,
										}))
									}
									placeholder="owner@example.com"
									required
									type="email"
									value={form.ownerEmail}
								/>
							</label>

							<label
								className="block space-y-2 text-sm"
								htmlFor="owner-password"
							>
								<span>Owner password</span>
								<Input
									id="owner-password"
									minLength={8}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											ownerPassword: event.target.value,
										}))
									}
									placeholder="At least 8 characters"
									required
									type="password"
									value={form.ownerPassword}
								/>
							</label>

							<label
								className="block space-y-2 text-sm"
								htmlFor="workspace-name"
							>
								<span>Primary workspace</span>
								<Input
									id="workspace-name"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											workspaceName: event.target.value,
										}))
									}
									required
									value={form.workspaceName}
								/>
							</label>

							<label className="block space-y-2 text-sm" htmlFor="app-url">
								<span>Public app URL</span>
								<Input
									id="app-url"
									onChange={(event) =>
										setForm((current) => ({
											...current,
											appUrl: event.target.value,
										}))
									}
									placeholder="https://nyxel.example.com"
									required
									type="url"
									value={form.appUrl}
								/>
							</label>

							<Button
								className="w-full"
								disabled={install.isPending}
								size="lg"
								type="submit"
							>
								{install.isPending ? "Installing…" : "Complete installation"}
							</Button>
							{install.isError && (
								<p className="text-sm text-destructive">
									{(install.error as Error).message}
								</p>
							)}
						</form>
					</Card>
				</div>
			</main>
		);
	}

	const workspaceId = installationQuery.data.record?.primaryWorkspaceId;

	return (
		<div className="mx-auto w-full max-w-5xl space-y-6 p-8">
			<PageHeader
				title="Overview"
				description={
					<>
						{installationQuery.data.record?.mode === "server"
							? "Server mode"
							: "PC mode"}{" "}
						· bound to{" "}
						<span className="font-medium text-foreground">
							{installationQuery.data.record?.appUrl ??
								installationQuery.data.defaultAppUrl}
						</span>
					</>
				}
				actions={
					<>
						<Button onClick={() => router.push("/chat")}>
							Start first chat
						</Button>
						{workspaceId && (
							<Button asChild variant="outline">
								<Link href={`/workspace/${workspaceId}/settings`}>
									Workspace settings
								</Link>
							</Button>
						)}
					</>
				}
			/>

			<section className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
				<Card>
					<CardHeader>
						<CardTitle>Deployment summary</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3 text-sm">
						<p>Database driver: {installationQuery.data.driver}</p>
						<p className="truncate">Workspace id: {workspaceId}</p>
						<p className="truncate">
							Owner id: {installationQuery.data.record?.ownerUserId}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Detected models</CardTitle>
					</CardHeader>
					<CardContent>
						{modelsQuery.isLoading && (
							<p className="text-sm text-muted-foreground">
								Checking for local and cloud models…
							</p>
						)}
						{modelsQuery.data?.length === 0 && (
							<p className="text-sm text-muted-foreground">
								No models detected. Start Ollama/LM Studio or set an API key for
								a cloud provider.
							</p>
						)}
						<ul className="space-y-2">
							{modelsQuery.data?.map((model) => (
								<li
									key={model.id}
									className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm"
								>
									<span>{model.label}</span>
									<span className="text-muted-foreground">{model.kind}</span>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			</section>
		</div>
	);
}
