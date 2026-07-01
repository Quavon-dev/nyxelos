"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpcClient } from "@/lib/trpc";

type AuthState =
  | { status: "working"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export default function McpAuthCallbackPage() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<AuthState>({
    status: "working",
    message: "Completing MCP sign-in…",
  });

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const serverId = searchParams.get("serverId");
    const workspaceId = searchParams.get("workspaceId");

    if (error) {
      setState({ status: "error", message: `MCP sign-in was rejected: ${error}` });
      return;
    }
    if (!code || !serverId) {
      setState({
        status: "error",
        message: "Missing authorization code or MCP server id in the callback URL.",
      });
      return;
    }

    let cancelled = false;

    void trpcClient.mcpServers.finishAuth
      .mutate({ id: serverId, code })
      .then(() => {
        if (cancelled) return;
        window.opener?.postMessage({ type: "nyxel:mcp-auth-complete", serverId }, window.location.origin);
        setState({
          status: "success",
          message: "MCP sign-in is complete. This window can close now.",
        });
        window.setTimeout(() => {
          if (window.opener) {
            window.close();
            return;
          }
          if (workspaceId) {
            window.location.replace(`/workspace/${workspaceId}/mcp-servers`);
          }
        }, 900);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err.message || "Failed to finish MCP sign-in.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          MCP Authentication
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">{state.message}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {state.status === "working"
            ? "Nyxel is exchanging the authorization code for a usable session."
            : state.status === "success"
              ? "Return to Nyxel if this tab does not close automatically."
              : "Retry the connection from Nyxel after fixing the provider or endpoint settings."}
        </p>
      </div>
    </main>
  );
}