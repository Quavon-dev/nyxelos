"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LocalVoiceStatus =
  | "idle"
  | "recording"
  | "loading" // first use: Whisper model downloading/initializing
  | "transcribing"
  | "error";

const WHISPER_SAMPLE_RATE = 16_000;
/** Hard cap so a forgotten open mic can't queue minutes of audio into a
 * single decode+transcribe pass. */
const MAX_RECORDING_MS = 120_000;

/**
 * Local, private dictation: records the microphone with MediaRecorder and
 * transcribes it with a Whisper model running entirely in the browser (see
 * lib/whisper-worker.ts). Unlike the browser SpeechRecognition API this works
 * in every modern browser, supports any Whisper language, and never sends
 * audio to a cloud service.
 */
export function useLocalVoiceInput(onResult: (text: string) => void) {
  const [status, setStatus] = useState<LocalVoiceStatus>("idle");
  const [progress, setProgress] = useState(0); // 0-100 while loading
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelReadyRef = useRef(false);
  const progressRef = useRef<Map<string, { loaded: number; total: number }>>(new Map());
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof MediaRecorder !== "undefined" &&
        typeof Worker !== "undefined",
    );
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, []);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL("../lib/whisper-worker.ts", import.meta.url));
    worker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as
        | { type: "progress"; file: string; loaded: number; total: number }
        | { type: "ready"; device: "webgpu" | "wasm" }
        | { type: "result"; text: string }
        | { type: "error"; message: string };

      if (data.type === "progress") {
        progressRef.current.set(data.file, { loaded: data.loaded, total: data.total });
        let loaded = 0;
        let total = 0;
        for (const entry of progressRef.current.values()) {
          loaded += entry.loaded;
          total += entry.total;
        }
        if (total > 0) setProgress(Math.min(99, Math.round((loaded / total) * 100)));
        return;
      }
      if (data.type === "ready") {
        modelReadyRef.current = true;
        setProgress(100);
        return;
      }
      if (data.type === "result") {
        setStatus("idle");
        if (data.text) onResultRef.current(data.text);
        return;
      }
      if (data.type === "error") {
        setStatus("error");
        setError(data.message);
      }
    });
    // Kick off the model download immediately so it loads while the user is
    // still talking instead of serializing download + transcription.
    worker.postMessage({ type: "load" });
    workerRef.current = worker;
    return worker;
  }, []);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    recorderRef.current?.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const worker = ensureWorker();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        streamRef.current = null;
        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          chunksRef.current = [];
          if (blob.size === 0) {
            setStatus("idle");
            return;
          }
          setStatus(modelReadyRef.current ? "transcribing" : "loading");

          // Decode + resample to the 16 kHz mono Float32 stream Whisper wants.
          const arrayBuffer = await blob.arrayBuffer();
          const audioContext = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
          const decoded = await audioContext.decodeAudioData(arrayBuffer);
          let audio = decoded.getChannelData(0);
          if (decoded.numberOfChannels > 1) {
            const mixed = new Float32Array(decoded.length);
            for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
              const channelData = decoded.getChannelData(channel);
              for (let i = 0; i < decoded.length; i++) {
                mixed[i] = (mixed[i] ?? 0) + (channelData[i] ?? 0);
              }
            }
            for (let i = 0; i < decoded.length; i++) {
              mixed[i] = (mixed[i] ?? 0) / decoded.numberOfChannels;
            }
            audio = mixed;
          }
          await audioContext.close();

          const language =
            typeof navigator !== "undefined"
              ? navigator.language?.split("-")[0]?.toLowerCase()
              : undefined;
          worker.postMessage({ type: "transcribe", audio, language }, [audio.buffer]);
        } catch (decodeError) {
          setStatus("error");
          setError(decodeError instanceof Error ? decodeError.message : String(decodeError));
        }
      });

      recorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
      stopTimerRef.current = setTimeout(stopRecording, MAX_RECORDING_MS);
    } catch (micError) {
      setStatus("error");
      setError(
        micError instanceof DOMException && micError.name === "NotAllowedError"
          ? "Mikrofonzugriff wurde verweigert."
          : micError instanceof Error
            ? micError.message
            : String(micError),
      );
    }
  }, [ensureWorker, stopRecording]);

  const toggle = useCallback(() => {
    if (status === "recording") {
      stopRecording();
      return;
    }
    if (status === "loading" || status === "transcribing") return;
    void startRecording();
  }, [status, startRecording, stopRecording]);

  return { status, progress, error, supported, toggle };
}
