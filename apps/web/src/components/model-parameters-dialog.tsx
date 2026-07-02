"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { trpcClient } from "@/lib/trpc";

type ReasoningEffort = "low" | "medium" | "high";

const DEFAULT_FORM = {
  customName: "",
  customInstructions: "",
  maxOutputTokens: "",
  temperature: 1,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  reasoningEffort: "auto" as "auto" | ReasoningEffort,
};

/** Editor for how one installed model should generate by default —
 * sampling knobs plus a per-model instructions addendum. One row per
 * (workspace, modelId); "Reset" deletes it so the model falls back to
 * provider defaults instead of leaving stale overrides behind. */
export function ModelParametersDialog({
  workspaceId,
  modelId,
  modelLabel,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  modelId: string;
  modelLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [stopSequences, setStopSequences] = useState<string[]>([]);
  const [stopInput, setStopInput] = useState("");

  const query = useQuery({
    queryKey: ["models", "parameters", workspaceId, modelId],
    queryFn: () => trpcClient.models.getParameters.query({ workspaceId, modelId }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const saved = query.data;
    setForm({
      customName: saved?.customName ?? "",
      customInstructions: saved?.customInstructions ?? "",
      maxOutputTokens: saved?.maxOutputTokens?.toString() ?? "",
      temperature: saved?.temperature ?? 1,
      topP: saved?.topP ?? 1,
      frequencyPenalty: saved?.frequencyPenalty ?? 0,
      presencePenalty: saved?.presencePenalty ?? 0,
      reasoningEffort: saved?.reasoningEffort ?? "auto",
    });
    setStopSequences(saved?.stopSequences ?? []);
  }, [open, query.data]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["models", "parameters", workspaceId, modelId] });

  const save = useMutation({
    mutationFn: () =>
      trpcClient.models.saveParameters.mutate({
        workspaceId,
        modelId,
        customName: form.customName.trim() || null,
        customInstructions: form.customInstructions.trim() || null,
        maxOutputTokens: form.maxOutputTokens.trim() ? Number(form.maxOutputTokens) : null,
        temperature: form.temperature,
        topP: form.topP,
        frequencyPenalty: form.frequencyPenalty,
        presencePenalty: form.presencePenalty,
        stopSequences,
        reasoningEffort: form.reasoningEffort === "auto" ? null : form.reasoningEffort,
      }),
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
    },
  });

  const reset = useMutation({
    mutationFn: () => trpcClient.models.resetParameters.mutate({ workspaceId, modelId }),
    onSuccess: () => {
      setForm(DEFAULT_FORM);
      setStopSequences([]);
      invalidate();
    },
  });

  const addStopSequence = () => {
    const value = stopInput.trim();
    if (!value || stopSequences.includes(value)) return;
    setStopSequences((prev) => [...prev, value]);
    setStopInput("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Model parameters</DialogTitle>
          <DialogDescription>
            How <span className="font-medium text-foreground">{modelLabel}</span> should generate
            by default. Leave a field alone to keep the provider's own default.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="model-param-name">
              Custom name
            </label>
            <Input
              id="model-param-name"
              placeholder="Give this model a display name"
              value={form.customName}
              onChange={(e) => setForm((f) => ({ ...f, customName: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="model-param-instructions">
              Custom instructions
            </label>
            <Textarea
              id="model-param-instructions"
              placeholder="Extra instructions added to the system prompt whenever this model is used"
              rows={3}
              value={form.customInstructions}
              onChange={(e) => setForm((f) => ({ ...f, customInstructions: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="model-param-max-tokens">
                Max output tokens
              </label>
              <Input
                id="model-param-max-tokens"
                type="number"
                min={1}
                placeholder="Provider default"
                value={form.maxOutputTokens}
                onChange={(e) => setForm((f) => ({ ...f, maxOutputTokens: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Reasoning effort</label>
              <Select
                value={form.reasoningEffort}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, reasoningEffort: value as typeof f.reasoningEffort }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <SliderField
              label="Temperature"
              value={form.temperature}
              min={0}
              max={2}
              step={0.01}
              onChange={(temperature) => setForm((f) => ({ ...f, temperature }))}
            />
            <SliderField
              label="Top P"
              value={form.topP}
              min={0}
              max={1}
              step={0.01}
              onChange={(topP) => setForm((f) => ({ ...f, topP }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <SliderField
              label="Frequency penalty"
              value={form.frequencyPenalty}
              min={-2}
              max={2}
              step={0.01}
              onChange={(frequencyPenalty) => setForm((f) => ({ ...f, frequencyPenalty }))}
            />
            <SliderField
              label="Presence penalty"
              value={form.presencePenalty}
              min={-2}
              max={2}
              step={0.01}
              onChange={(presencePenalty) => setForm((f) => ({ ...f, presencePenalty }))}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="model-param-stop">
              Stop sequences
            </label>
            <Input
              id="model-param-stop"
              placeholder="Type a sequence and press Enter"
              value={stopInput}
              onChange={(e) => setStopInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addStopSequence();
                }
              }}
            />
            {stopSequences.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {stopSequences.map((seq) => (
                  <Badge key={seq} variant="outline" className="gap-1 font-mono">
                    {seq}
                    <button
                      type="button"
                      aria-label={`Remove ${seq}`}
                      onClick={() => setStopSequences((prev) => prev.filter((s) => s !== seq))}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {save.isError && (
            <p className="text-xs text-destructive">{(save.error as Error).message}</p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={() => reset.mutate()}
            disabled={reset.isPending || (!query.data && stopSequences.length === 0)}
          >
            <RotateCcw />
            Reset to default
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <Badge variant="secondary" className="font-mono tabular-nums">
          {value.toFixed(2)}
        </Badge>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => next !== undefined && onChange(next)}
      />
    </div>
  );
}
