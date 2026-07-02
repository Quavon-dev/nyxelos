/// <reference lib="webworker" />

/**
 * Local speech-to-text worker — runs OpenAI Whisper fully in the browser via
 * transformers.js (ONNX Runtime, WebGPU when available, WASM otherwise). No
 * audio ever leaves the machine, matching NyxelOS's local-first principle.
 *
 * Protocol (postMessage):
 *   in:  { type: "load" }
 *   in:  { type: "transcribe", audio: Float32Array (16 kHz mono), language?: string }
 *   out: { type: "progress", file: string, loaded: number, total: number }
 *   out: { type: "ready", device: "webgpu" | "wasm" }
 *   out: { type: "result", text: string }
 *   out: { type: "error", message: string }
 */
import {
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
  pipeline,
} from "@huggingface/transformers";

/** whisper-base is the sweet spot for multilingual dictation (German
 * included): ~4x more accurate than tiny while still loading in seconds on a
 * normal connection and transcribing a voice memo in well under real time. */
const MODEL_ID = "onnx-community/whisper-base";

let transcriberPromise: Promise<{
  transcriber: AutomaticSpeechRecognitionPipeline;
  device: "webgpu" | "wasm";
}> | null = null;

function reportProgress(info: ProgressInfo) {
  if (info.status !== "progress") return;
  self.postMessage({
    type: "progress",
    file: info.file,
    loaded: info.loaded ?? 0,
    total: info.total ?? 0,
  });
}

async function loadTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
      try {
        const device = hasWebGpu ? ("webgpu" as const) : ("wasm" as const);
        const transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
          device,
          // WebGPU: fp32 encoder + q4 decoder is the recommended split for
          // whisper ONNX exports; WASM sticks to q8 to keep the download and
          // memory footprint small.
          dtype: hasWebGpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
          progress_callback: reportProgress,
        });
        return { transcriber, device };
      } catch (error) {
        // WebGPU exists but initialization failed (driver/adapter quirks) —
        // retry once on plain WASM before giving up.
        if (!hasWebGpu) throw error;
        const transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
          device: "wasm",
          dtype: "q8",
          progress_callback: reportProgress,
        });
        return { transcriber, device: "wasm" as const };
      }
    })();
    transcriberPromise.catch(() => {
      // Allow a later attempt to retry instead of caching the rejection.
      transcriberPromise = null;
    });
  }
  return transcriberPromise;
}

self.addEventListener("message", async (event: MessageEvent) => {
  const data = event.data as
    | { type: "load" }
    | { type: "transcribe"; audio: Float32Array; language?: string };

  try {
    if (data.type === "load") {
      const { device } = await loadTranscriber();
      self.postMessage({ type: "ready", device });
      return;
    }

    if (data.type === "transcribe") {
      const { transcriber } = await loadTranscriber();
      const output = await transcriber(data.audio, {
        // undefined → Whisper's own language auto-detection
        language: data.language,
        task: "transcribe",
        // Voice-memo-sized input; chunking keeps longer recordings working.
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = (Array.isArray(output) ? output[0]?.text : output.text) ?? "";
      self.postMessage({ type: "result", text: text.trim() });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
