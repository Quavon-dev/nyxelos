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
    const attemptKey = `nyxel:mcp-auth-attempt:${serverId}:${code}`;

    // Next dev runs effects twice under Strict Mode; do not exchange the same
    // single-use OAuth code more than once.
    if (window.sessionStorage.getItem(attemptKey)) {
      return;
    }
    window.sessionStorage.setItem(attemptKey, "pending");

    void trpcClient.mcpServers.finishAuth
      .mutate({ id: serverId, code })
      .then(() => {
        if (cancelled) return;
        window.sessionStorage.setItem(attemptKey, "done");
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
        if (cancelled) return;
        window.sessionStorage.removeItem(attemptKey);
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
