"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Database, Globe, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Spinner } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { SystemScreen } from "@/components/system-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
    description: "Single-user, SQLite, local-first. Fastest path for a workstation or laptop.",
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

const HIGHLIGHTS = [
  {
    icon: Database,
    title: "Mode-aware",
    body: "Recommends a deployment mode from the active database driver.",
  },
  {
    icon: Globe,
    title: "Caddy-ready",
    body: "Server mode assumes HTTPS termination and path routing through Caddy.",
  },
  {
    icon: ShieldCheck,
    title: "Own the first account",
    body: "Creates the initial Better-Auth account and primary workspace in one step.",
  },
];

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

  // ---- Loading: mirror the setup layout with skeletons so first paint
  // doesn't flash a bare screen or jump when data lands. ----
  if (installationQuery.isLoading) {
    return (
      <SystemScreen width="xl">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-14 w-full max-w-xl" />
            <Skeleton className="h-14 w-full max-w-lg" />
            <div className="grid gap-4 sm:grid-cols-3">
              {["a", "b", "c"].map((k) => (
                <Skeleton key={k} className="h-28 rounded-2xl" />
              ))}
            </div>
          </div>
          <Skeleton className="h-[32rem] rounded-2xl" />
        </div>
      </SystemScreen>
    );
  }

  if (!installationQuery.data?.isInstalled) {
    const selectedMode = MODE_COPY[form.mode];
    const recommended = installationQuery.data?.recommendedMode.toUpperCase() ?? "PC";

    return (
      <SystemScreen width="xl">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <section className="space-y-6">
            <BrandMark size="lg" subtitle="Self-hosted agentic OS" />
            <div className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                First-run setup
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
                Install Nyxel once, then run it like a product.
              </h1>
              <p className="max-w-xl text-base text-muted-foreground">
                The setup wizard writes the first account, workspace, mode, and app URL into the
                database so the stack boots consistently on a PC or a server.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="rounded-2xl border bg-card/60 p-4 shadow-xs backdrop-blur"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <p className="mt-3 text-sm font-medium">
                    {title === "Mode-aware" ? <>Recommends {recommended}</> : title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </section>

          <Card className="border shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg">Setup wizard</CardTitle>
              <p className="text-sm text-muted-foreground">
                Choose the deployment mode, then define the owner and workspace.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {(["pc", "server"] as const).map((mode) => {
                  const active = form.mode === mode;
                  const copy = MODE_COPY[mode];
                  return (
                    <button
                      key={mode}
                      aria-pressed={active}
                      className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border bg-background hover:border-primary/40 hover:bg-accent"
                      }`}
                      onClick={() => setForm((current) => ({ ...current, mode }))}
                      type="button"
                    >
                      <p className="text-sm font-medium">{copy.title}</p>
                      <p className="mt-1.5 text-xs text-muted-foreground">{copy.description}</p>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                <p className="font-medium">{selectedMode.title}</p>
                <dl className="mt-2 space-y-1 text-muted-foreground">
                  <div className="flex justify-between gap-4">
                    <dt>Database</dt>
                    <dd className="text-right text-foreground">{selectedMode.database}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Network</dt>
                    <dd className="text-right text-foreground">{selectedMode.network}</dd>
                  </div>
                </dl>
              </div>

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  install.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="owner-name">Owner name</Label>
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="owner-email">Owner email</Label>
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="owner-password">Owner password</Label>
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Primary workspace</Label>
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="app-url">Public app URL</Label>
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
                </div>

                <Button className="w-full" disabled={install.isPending} size="lg" type="submit">
                  {install.isPending && <Spinner className="mr-2" />}
                  {install.isPending ? "Installing…" : "Complete installation"}
                </Button>
                {install.isError && (
                  <p className="text-sm text-destructive">{(install.error as Error).message}</p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      </SystemScreen>
    );
  }

  const workspaceId = installationQuery.data.record?.primaryWorkspaceId;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Overview"
        description={
          <>
            {installationQuery.data.record?.mode === "server" ? "Server mode" : "PC mode"} · bound
            to{" "}
            <span className="font-medium text-foreground">
              {installationQuery.data.record?.appUrl ?? installationQuery.data.defaultAppUrl}
            </span>
          </>
        }
        actions={
          <>
            <Button onClick={() => router.push("/chat")}>Start first chat</Button>
            {workspaceId && (
              <Button asChild variant="outline">
                <Link href={`/workspace/${workspaceId}/settings`}>Workspace settings</Link>
              </Button>
            )}
          </>
        }
      />

      <section className="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle>Deployment summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Database driver: {installationQuery.data.driver}</p>
            <p className="truncate">Workspace id: {workspaceId}</p>
            <p className="truncate">Owner id: {installationQuery.data.record?.ownerUserId}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detected models</CardTitle>
          </CardHeader>
          <CardContent>
            {modelsQuery.isLoading && (
              <div className="space-y-2">
                {["a", "b", "c"].map((k) => (
                  <div
                    key={k}
                    className="flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            )}
            {modelsQuery.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No models detected. Start Ollama/LM Studio or set an API key for a cloud provider.
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
