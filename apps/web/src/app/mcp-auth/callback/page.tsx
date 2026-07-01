"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SystemPanel, SystemScreen } from "@/components/system-screen";
import { Button } from "@/components/ui/button";
import { trpcClient } from "@/lib/trpc";

type AuthState =
  | { status: "working"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const DETAIL: Record<AuthState["status"], string> = {
  working: "Nyxel is exchanging the authorization code for a usable session.",
  success: "Return to Nyxel if this tab does not close automatically.",
  error: "Retry the connection from Nyxel after fixing the provider or endpoint settings.",
};

// Module-level so the in-flight exchange survives React Strict Mode's
// mount -> cleanup -> remount cycle in dev. Without this, the first effect
// instance starts the mutation and gets torn down (cancelled = true) before
// it resolves, the second instance sees the attempt already recorded and
// skips starting a new one, and nobody left with cancelled === false is
// around to move the UI out of "working" — the spinner hangs forever even
// though the exchange actually succeeded server-side.
const pendingAuthExchanges = new Map<string, ReturnType<typeof trpcClient.mcpServers.finishAuth.mutate>>();

export default function McpAuthCallbackPage() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const serverId = searchParams.get("serverId");
  const workspaceId = searchParams.get("workspaceId");
  const [state, setState] = useState<AuthState>({
    status: "working",
    message: "Completing MCP sign-in…",
  });

  useEffect(() => {
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
    const attemptKey = `${serverId}:${code}`;

    // Reuse the same in-flight (or already-settled) exchange across Strict
    // Mode's double effect invocation instead of starting a second one.
    let exchange = pendingAuthExchanges.get(attemptKey);
    if (!exchange) {
      exchange = trpcClient.mcpServers.finishAuth.mutate({ id: serverId, code });
      pendingAuthExchanges.set(attemptKey, exchange);
    }

    exchange
      .then(() => {
        if (cancelled) return;
        window.opener?.postMessage(
          { type: "nyxel:mcp-auth-complete", serverId },
          window.location.origin,
        );
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
        pendingAuthExchanges.delete(attemptKey);
        if (cancelled) return;
        setState({
          status: "error",
          message: err.message || "Failed to finish MCP sign-in.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [code, error, serverId, workspaceId]);

  return (
    <SystemScreen width="sm">
      <SystemPanel
        title={
          <span className="flex items-center gap-2.5">
            <StatusIcon status={state.status} />
            <span>{state.message}</span>
          </span>
        }
        description={DETAIL[state.status]}
        footer="MCP Authentication · Nyxel"
      >
        {state.status === "error" && workspaceId && (
          <Button asChild variant="outline" className="w-full">
            <a href={`/workspace/${workspaceId}/mcp-servers`}>Back to MCP servers</a>
          </Button>
        )}
      </SystemPanel>
    </SystemScreen>
  );
}

function StatusIcon({ status }: { status: AuthState["status"] }) {
  if (status === "working") {
    return <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (status === "success") {
    return <CheckCircle2 className="size-5 shrink-0 text-primary" />;
  }
  return <XCircle className="size-5 shrink-0 text-destructive" />;
}
