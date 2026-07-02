"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clapperboard,
  Clock,
  Film,
  Loader2,
  Scissors,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeaderSkeleton, StatCardsSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  libraryFileUrl,
  trpcClient,
  type VideoEditOperation,
  type VideoGenerationJobSummary,
  type VideoModelSummary,
} from "@/lib/trpc";

const SIZE_LABELS: Record<string, string> = {
  "1280x720": "Landscape (1280×720)",
  "720x1280": "Portrait (720×1280)",
  "1792x1024": "Landscape HD (1792×1024)",
  "1024x1792": "Portrait HD (1024×1792)",
};

const EDIT_OPERATIONS: { value: VideoEditOperation; label: string }[] = [
  { value: "trim", label: "Trim" },
  { value: "mute", label: "Mute" },
  { value: "volume", label: "Adjust volume" },
  { value: "speed", label: "Change speed" },
  { value: "extractFrame", label: "Extract frame" },
  { value: "toGif", label: "Render GIF" },
];

const ACTIVE_STATUSES = new Set(["queued", "in_progress"]);

function statusBadgeVariant(status: VideoGenerationJobSummary["status"]) {
  if (status === "completed") return "default" as const;
  if (status === "failed") return "destructive" as const;
  return "outline" as const;
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleString();
}

export default function VideoStudioPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [autoMode, setAutoMode] = useState(true);
  const [model, setModel] = useState<string>("sora-2");
  const [size, setSize] = useState<string>("1280x720");
  const [seconds, setSeconds] = useState(8);
  const [editTarget, setEditTarget] = useState<VideoGenerationJobSummary | null>(null);

  // Video-capable models only — the fixed Sora catalog from
  // packages/model-providers/src/video.ts, same source the server's "auto"
  // heuristic and generate() validate against, fetched instead of duplicated
  // as a frontend constant so the picker can't drift out of sync with it.
  const modelsQuery = useQuery({
    queryKey: ["video", "models"],
    queryFn: () => trpcClient.video.models.query(),
  });
  const videoModels = modelsQuery.data ?? [];
  const selectedModel: VideoModelSummary | undefined =
    videoModels.find((m) => m.id === model) ?? videoModels[0];
  const sizeOptions = selectedModel?.sizes ?? ["1280x720", "720x1280"];
  const durationOptions = selectedModel?.durations ?? [4, 8, 12];

  // Keep aspect ratio/length valid whenever the chosen model changes (or the
  // catalog finishes its first load) — a model like Sora 2 (non-pro) doesn't
  // support every size Sora 2 Pro does.
  useEffect(() => {
    const current = videoModels.find((m) => m.id === model) ?? videoModels[0];
    if (!current) return;
    setSize((prev) => (current.sizes.includes(prev) ? prev : (current.sizes[0] ?? prev)));
    setSeconds((prev) =>
      current.durations.includes(prev)
        ? prev
        : current.durations.reduce((closest, candidate) =>
            Math.abs(candidate - prev) < Math.abs(closest - prev) ? candidate : closest,
          ),
    );
  }, [model, videoModels]);

  const jobsQuery = useQuery({
    queryKey: ["video", "list", workspaceId],
    queryFn: () => trpcClient.video.list.query({ workspaceId }),
    // Poll quickly while anything is still generating (queued/in_progress),
    // same "faster while active" idea as the task detail page — otherwise a
    // 10-30s default interval makes a several-minute generation feel frozen.
    refetchInterval: (query) => {
      const jobs = query.state.data ?? [];
      return jobs.some((job) => ACTIVE_STATUSES.has(job.status)) ? 3_000 : 15_000;
    },
  });

  const jobs = jobsQuery.data ?? [];
  const completedJobs = jobs.filter((job) => job.status === "completed");
  const activeJobs = jobs.filter((job) => ACTIVE_STATUSES.has(job.status));
  const failedJobs = jobs.filter((job) => job.status === "failed");

  const generate = useMutation({
    mutationFn: () =>
      trpcClient.video.generate.mutate({
        workspaceId,
        prompt: prompt.trim(),
        model: autoMode ? "auto" : model,
        size: autoMode ? undefined : size,
        seconds: autoMode ? undefined : seconds,
      }),
    onSuccess: () => {
      setPrompt("");
      queryClient.invalidateQueries({ queryKey: ["video", "list", workspaceId] });
    },
  });

  if (jobsQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton actions={0} />
        <StatCardsSkeleton count={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Video Studio"
        description="Describe a clip, let Nyxel pick the right model automatically (or choose one yourself), then play back, edit, and organize everything it generates — every result lands in the Library too."
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Generated" value={completedJobs.length} icon={<Film className="size-4" />} />
        <StatCard label="In progress" value={activeJobs.length} icon={<Loader2 className="size-4" />} />
        <StatCard label="Failed" value={failedJobs.length} icon={<AlertCircle className="size-4" />} />
        <StatCard label="Total requests" value={jobs.length} icon={<Clapperboard className="size-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="size-4" />
            Generate a video
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <VideoModelDropdown
            models={videoModels}
            modelId={selectedModel?.id ?? model}
            onModelChange={(id) => {
              setModel(id);
              setAutoMode(false);
            }}
          />

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='Describe the video, e.g. "A cinematic drone shot flying over a foggy mountain forest at sunrise"'
            rows={3}
          />

          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
            <Switch id="auto-mode" checked={autoMode} onCheckedChange={setAutoMode} />
            <Label htmlFor="auto-mode" className="flex cursor-pointer items-center gap-1.5 text-sm">
              <Sparkles className="size-3.5 text-muted-foreground" />
              Auto mode — pick model, aspect ratio, and length from the prompt
            </Label>
          </div>

          {!autoMode && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Aspect ratio</Label>
                <Select value={size} onValueChange={setSize}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sizeOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SIZE_LABELS[s] ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Length</Label>
                <Select value={String(seconds)} onValueChange={(v) => setSeconds(Number(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {durationOptions.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} seconds
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {generate.isError && (
            <p className="text-sm text-destructive">{(generate.error as Error).message}</p>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => generate.mutate()}
              disabled={!prompt.trim() || generate.isPending}
            >
              {generate.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Clapperboard className="size-4" />
              )}
              Generate video
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">History</h2>
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-16 text-center">
            <Film className="size-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">No videos yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Describe a clip above and click Generate video — it'll show up here as it renders.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <VideoJobCard key={job.id} job={job} onEdit={() => setEditTarget(job)} />
            ))}
          </div>
        )}
      </div>

      <EditVideoDialog
        workspaceId={workspaceId}
        job={editTarget}
        completedJobs={completedJobs}
        onClose={() => setEditTarget(null)}
      />
    </div>
  );
}

/** Model switcher for video generation — same dropdown-pill pattern as
 * chat's ChatTopBar model switcher, sourced from trpcClient.video.models
 * (packages/model-providers/src/video.ts's OPENAI_VIDEO_MODELS) so only
 * video-capable models ever show up here. */
function VideoModelDropdown({
  models,
  modelId,
  onModelChange,
}: {
  models: VideoModelSummary[];
  modelId: string;
  onModelChange: (modelId: string) => void;
}) {
  const activeModel = models.find((m) => m.id === modelId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-fit max-w-full items-center gap-1.5 rounded-full border bg-background py-1.5 pl-1.5 pr-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-primary-foreground"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--primary), var(--chart-2))",
            }}
          >
            <Film className="size-3" />
          </span>
          <span className="truncate">{activeModel?.label ?? "Select model"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {models.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No video-capable models available.
          </div>
        )}
        {models.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => onModelChange(m.id)}>
            <span className="truncate">{m.label}</span>
            {m.tier === "pro" && (
              <Badge variant="outline" className="ml-auto border-0 bg-muted text-muted-foreground">
                pro
              </Badge>
            )}
            {m.id === modelId && <Check className="ml-1 size-3.5 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VideoJobCard({
  job,
  onEdit,
}: {
  job: VideoGenerationJobSummary;
  onEdit: () => void;
}) {
  return (
    <Card className="overflow-hidden py-0">
      <div className="flex aspect-video items-center justify-center bg-muted">
        {job.status === "completed" && job.libraryFileId ? (
          // biome-ignore lint/a11y/useMediaCaption: generated clips have no caption track to attach
          <video
            src={libraryFileUrl(job.libraryFileId)}
            poster={job.posterLibraryFileId ? libraryFileUrl(job.posterLibraryFileId) : undefined}
            controls
            className="size-full object-contain"
          />
        ) : job.status === "failed" ? (
          <AlertCircle className="size-8 text-destructive/60" />
        ) : (
          <Loader2 className="size-8 animate-spin text-muted-foreground/50" />
        )}
      </div>
      <CardContent className="space-y-2.5 p-3.5">
        <p className="line-clamp-2 text-sm font-medium">{job.prompt}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={statusBadgeVariant(job.status)} className="capitalize">
            {job.status.replace("_", " ")}
          </Badge>
          <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
            {job.model}
          </Badge>
          <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
            {job.size}
          </Badge>
          <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
            <Clock className="size-3" />
            {job.seconds}s
          </Badge>
          {job.auto && (
            <Badge variant="outline" className="gap-1 border-0 bg-muted text-muted-foreground">
              <Sparkles className="size-3" />
              auto
            </Badge>
          )}
        </div>
        {ACTIVE_STATUSES.has(job.status) && <Progress value={job.progress} />}
        {job.status === "failed" && job.errorMessage && (
          <p className="text-xs text-destructive">{job.errorMessage}</p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-muted-foreground">{formatDate(job.createdAt)}</span>
          {job.status === "completed" && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Scissors className="size-3.5" />
              Edit
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EditVideoDialog({
  workspaceId,
  job,
  completedJobs,
  onClose,
}: {
  workspaceId: string;
  job: VideoGenerationJobSummary | null;
  completedJobs: VideoGenerationJobSummary[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [operation, setOperation] = useState<VideoEditOperation>("trim");
  const [secondSourceId, setSecondSourceId] = useState<string>("");
  const [startSeconds, setStartSeconds] = useState("");
  const [endSeconds, setEndSeconds] = useState("");
  const [volume, setVolume] = useState("1");
  const [speed, setSpeed] = useState("1");
  const [timestampSeconds, setTimestampSeconds] = useState("0");
  const [fps, setFps] = useState("10");

  const edit = useMutation({
    mutationFn: () => {
      if (!job?.libraryFileId) throw new Error("No source video.");
      const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
      return trpcClient.video.edit.mutate({
        workspaceId,
        operation,
        libraryFileId: job.libraryFileId,
        libraryFileIds:
          operation === "concat" && secondSourceId
            ? [job.libraryFileId, secondSourceId]
            : undefined,
        startSeconds: num(startSeconds),
        endSeconds: num(endSeconds),
        volume: num(volume),
        speed: num(speed),
        timestampSeconds: num(timestampSeconds),
        fps: num(fps),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library", "list", workspaceId] });
    },
  });

  return (
    <Dialog
      open={Boolean(job)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          edit.reset();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit video</DialogTitle>
          <DialogDescription>
            Runs locally via ffmpeg and saves the result as a new file in the Library — the
            original clip is left untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Operation</Label>
            <Select value={operation} onValueChange={(v) => setOperation(v as VideoEditOperation)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDIT_OPERATIONS.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
                {completedJobs.length > 1 && (
                  <SelectItem value="concat">Concatenate with another video</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {operation === "concat" && (
            <div className="space-y-1.5">
              <Label>Join with</Label>
              <Select value={secondSourceId} onValueChange={setSecondSourceId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a video" />
                </SelectTrigger>
                <SelectContent>
                  {completedJobs
                    .filter((j) => j.libraryFileId && j.id !== job?.id)
                    .map((j) => (
                      <SelectItem key={j.id} value={j.libraryFileId as string}>
                        {j.prompt.slice(0, 60)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(operation === "trim" || operation === "toGif") && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start (seconds)</Label>
                <Input
                  type="number"
                  value={startSeconds}
                  onChange={(e) => setStartSeconds(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>End (seconds)</Label>
                <Input
                  type="number"
                  value={endSeconds}
                  onChange={(e) => setEndSeconds(e.target.value)}
                  placeholder={String(job?.seconds ?? "")}
                />
              </div>
            </div>
          )}

          {operation === "volume" && (
            <div className="space-y-1.5">
              <Label>Volume multiplier</Label>
              <Input type="number" step="0.1" value={volume} onChange={(e) => setVolume(e.target.value)} />
            </div>
          )}

          {operation === "speed" && (
            <div className="space-y-1.5">
              <Label>Speed multiplier</Label>
              <Input type="number" step="0.1" value={speed} onChange={(e) => setSpeed(e.target.value)} />
            </div>
          )}

          {operation === "extractFrame" && (
            <div className="space-y-1.5">
              <Label>Timestamp (seconds)</Label>
              <Input
                type="number"
                value={timestampSeconds}
                onChange={(e) => setTimestampSeconds(e.target.value)}
              />
            </div>
          )}

          {operation === "toGif" && (
            <div className="space-y-1.5">
              <Label>Frames per second</Label>
              <Input type="number" value={fps} onChange={(e) => setFps(e.target.value)} />
            </div>
          )}

          {edit.isError && <p className="text-sm text-destructive">{(edit.error as Error).message}</p>}
          {edit.isSuccess && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              Saved "{edit.data.name}" to the Library.
            </p>
          )}
        </div>

        <DialogFooter showCloseButton>
          <Button
            onClick={() => edit.mutate()}
            disabled={edit.isPending || (operation === "concat" && !secondSourceId)}
          >
            {edit.isPending && <Loader2 className="size-4 animate-spin" />}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
