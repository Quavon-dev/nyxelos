"use client";

import { useQuery } from "@tanstack/react-query";
import type { Node } from "@xyflow/react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpcClient, type VideoEditOperation, type WorkflowNodeKind } from "@/lib/trpc";
import { NODE_KIND_META } from "./node-meta";

const EDIT_OPERATIONS: { value: VideoEditOperation; label: string }[] = [
  { value: "trim", label: "Trim" },
  { value: "mute", label: "Mute" },
  { value: "volume", label: "Adjust volume" },
  { value: "speed", label: "Change speed" },
  { value: "extractFrame", label: "Extract frame" },
  { value: "toGif", label: "Render GIF" },
];

export function NodeInspector({
  workspaceId,
  node,
  onChange,
  onClose,
}: {
  workspaceId: string;
  node: Node;
  onChange: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const kind = node.type as WorkflowNodeKind;
  const meta = NODE_KIND_META[kind];
  const data = node.data as Record<string, unknown>;

  const libraryQuery = useQuery({
    queryKey: ["library", "list", workspaceId],
    queryFn: () => trpcClient.library.list.query({ workspaceId }),
    enabled: kind === "image_upload" || kind === "video_upload",
  });
  const imageModelsQuery = useQuery({
    queryKey: ["models", "generationCatalog"],
    queryFn: () => trpcClient.models.generationCatalog.query(),
    enabled: kind === "generate_image",
  });
  const videoModelsQuery = useQuery({
    queryKey: ["video", "models"],
    queryFn: () => trpcClient.video.models.query(),
    enabled: kind === "generate_video",
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", "list", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId }),
    enabled: kind === "agent",
  });

  function set(patch: Record<string, unknown>) {
    onChange({ ...data, ...patch });
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-l bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <meta.icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{meta.label}</span>
        <Button variant="ghost" size="icon" className="ml-auto size-6" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-4 p-3">
        {kind === "text_prompt" && (
          <div className="space-y-1.5">
            <Label>Prompt</Label>
            <Textarea
              value={(data.prompt as string) ?? ""}
              onChange={(e) => set({ prompt: e.target.value })}
              rows={5}
              placeholder="Text this node feeds to whatever it connects to."
            />
          </div>
        )}

        {(kind === "image_upload" || kind === "video_upload") && (
          <div className="space-y-1.5">
            <Label>File from Library</Label>
            <Select
              value={(data.libraryFileId as string) ?? ""}
              onValueChange={(v) => set({ libraryFileId: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a file" />
              </SelectTrigger>
              <SelectContent>
                {(libraryQuery.data?.files ?? [])
                  .filter((f) => f.kind === (kind === "image_upload" ? "image" : "video"))
                  .map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Upload files from the Library page first — this picks from what's already there.
            </p>
          </div>
        )}

        {(kind === "generate_image" || kind === "generate_video") && (
          <>
            <div className="space-y-1.5">
              <Label>Prompt</Label>
              <Textarea
                value={(data.prompt as string) ?? ""}
                onChange={(e) => set({ prompt: e.target.value })}
                rows={4}
                placeholder="Leave blank to use whatever text/image is connected as input."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Select
                value={(data.model as string) ?? "__auto"}
                onValueChange={(v) => set({ model: v === "__auto" ? undefined : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">Auto</SelectItem>
                  {kind === "generate_image"
                    ? imageModelsQuery.data?.image.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))
                    : videoModelsQuery.data?.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Size (optional)</Label>
              <Input
                value={(data.size as string) ?? ""}
                onChange={(e) => set({ size: e.target.value || undefined })}
                placeholder="e.g. 1024x1024"
              />
            </div>
            {kind === "generate_video" && (
              <div className="space-y-1.5">
                <Label>Length in seconds (optional)</Label>
                <Input
                  type="number"
                  value={(data.seconds as number) ?? ""}
                  onChange={(e) =>
                    set({ seconds: e.target.value ? Number(e.target.value) : undefined })
                  }
                  placeholder="e.g. 8"
                />
              </div>
            )}
          </>
        )}

        {kind === "edit_video" && (
          <>
            <div className="space-y-1.5">
              <Label>Operation</Label>
              <Select
                value={(data.operation as string) ?? "trim"}
                onValueChange={(v) => set({ operation: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDIT_OPERATIONS.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(data.operation === "trim" || data.operation === "toGif") && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Start (s)</Label>
                  <Input
                    type="number"
                    value={(data.startSeconds as number) ?? ""}
                    onChange={(e) =>
                      set({ startSeconds: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>End (s)</Label>
                  <Input
                    type="number"
                    value={(data.endSeconds as number) ?? ""}
                    onChange={(e) =>
                      set({ endSeconds: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                </div>
              </div>
            )}
            {data.operation === "volume" && (
              <div className="space-y-1.5">
                <Label>Volume multiplier</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={(data.volume as number) ?? 1}
                  onChange={(e) => set({ volume: Number(e.target.value) })}
                />
              </div>
            )}
            {data.operation === "speed" && (
              <div className="space-y-1.5">
                <Label>Speed multiplier</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={(data.speed as number) ?? 1}
                  onChange={(e) => set({ speed: Number(e.target.value) })}
                />
              </div>
            )}
            {data.operation === "extractFrame" && (
              <div className="space-y-1.5">
                <Label>Timestamp (s)</Label>
                <Input
                  type="number"
                  value={(data.timestampSeconds as number) ?? 0}
                  onChange={(e) => set({ timestampSeconds: Number(e.target.value) })}
                />
              </div>
            )}
            {data.operation === "toGif" && (
              <div className="space-y-1.5">
                <Label>Frames per second</Label>
                <Input
                  type="number"
                  value={(data.fps as number) ?? 10}
                  onChange={(e) => set({ fps: Number(e.target.value) })}
                />
              </div>
            )}
          </>
        )}

        {kind === "agent" && (
          <>
            <div className="space-y-1.5">
              <Label>Agent</Label>
              <Select
                value={(data.agentId as string) ?? ""}
                onValueChange={(v) => set({ agentId: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose an agent" />
                </SelectTrigger>
                <SelectContent>
                  {(agentsQuery.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Instruction</Label>
              <Textarea
                value={(data.instruction as string) ?? ""}
                onChange={(e) => set({ instruction: e.target.value })}
                rows={4}
                placeholder="Leave blank to use whatever text is connected as input."
              />
            </div>
          </>
        )}

        {kind === "http_request" && (
          <>
            <div className="space-y-1.5">
              <Label>URL</Label>
              <Input
                value={(data.url as string) ?? ""}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="https://example.com/webhook"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select
                value={(data.method as string) ?? "GET"}
                onValueChange={(v) => set({ method: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Whatever's connected as input is sent as the request body (POST/PUT/PATCH) or ignored
              (GET). The response body becomes this node's text output.
            </p>
          </>
        )}

        {kind === "delay" && (
          <div className="space-y-1.5">
            <Label>Seconds to wait</Label>
            <Input
              type="number"
              min={0}
              value={(data.seconds as number) ?? 5}
              onChange={(e) => set({ seconds: Number(e.target.value) })}
            />
          </div>
        )}

        {kind === "condition" && (
          <div className="space-y-1.5">
            <Label>If the connected text contains</Label>
            <Input
              value={(data.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              placeholder="e.g. portrait"
            />
            <p className="text-xs text-muted-foreground">
              Case-insensitive. Connect this node's "True" handle to what should run when it
              matches, and "False" to what should run otherwise.
            </p>
          </div>
        )}

        {kind === "output" && (
          <div className="space-y-1.5">
            <Label>Label (optional)</Label>
            <Input
              value={(data.label as string) ?? ""}
              onChange={(e) => set({ label: e.target.value })}
              placeholder="e.g. Final video"
            />
          </div>
        )}
      </div>
    </div>
  );
}
