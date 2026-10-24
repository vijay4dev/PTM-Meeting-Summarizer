import { pipeline } from "@huggingface/transformers";
import type {
  LocalTranscriptionProgress,
  LocalTranscriptionResult,
} from "../lib/local-transcription";

type WorkerRequest = {
  type: "transcribe";
  model: string;
  samples: ArrayBuffer;
};

type WorkerResponse =
  | { type: "progress"; progress: LocalTranscriptionProgress }
  | { type: "result"; result: LocalTranscriptionResult }
  | { type: "error"; message: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

type WhisperChunk = {
  timestamp: [number, number];
  text: string;
};

type WhisperOutput = {
  text?: string;
  chunks?: WhisperChunk[];
};

type WhisperPipeline = (
  audio: Float32Array,
  options: {
    chunk_length_s: number;
    stride_length_s: number;
    return_timestamps: boolean;
    task: string;
  },
) => Promise<WhisperOutput>;

const scope = self as unknown as WorkerScope;
const modelCache = new Map<string, Promise<WhisperPipeline>>();

function report(progress: LocalTranscriptionProgress): void {
  scope.postMessage({ type: "progress", progress });
}

async function loadPipeline(model: string, device: "webgpu" | "wasm"): Promise<WhisperPipeline> {
  const key = `${model}:${device}`;
  const existing = modelCache.get(key);
  if (existing) return existing;

  const pending = pipeline("automatic-speech-recognition", model, {
    device,
    progress_callback: (event: unknown) => {
      const update = event as {
        status?: string;
        file?: string;
        progress?: number;
      };
      if (update.status === "progress") {
        const percent = typeof update.progress === "number"
          ? Math.max(0, Math.min(100, Math.round(update.progress)))
          : undefined;
        report({
          phase: "loading_model",
          message: update.file
            ? `Downloading model file ${update.file}`
            : "Downloading the local speech model",
          percent,
        });
      } else if (update.status === "done" || update.status === "ready") {
        report({
          phase: "loading_model",
          message: "Speech model ready in this browser",
        });
      }
    },
  }) as unknown as Promise<WhisperPipeline>;
  modelCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    modelCache.delete(key);
    throw error;
  }
}

function normalizeChunks(chunks: WhisperChunk[] | undefined) {
  if (!Array.isArray(chunks)) return [];
  return chunks.flatMap((chunk) => {
    const [start, end] = chunk.timestamp ?? [];
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      !chunk.text?.trim()
    ) return [];
    return [{
      start,
      end,
      text: chunk.text.trim(),
      confidence: null,
      speakerId: null,
    }];
  });
}

scope.onmessage = async (event) => {
  const { model, samples: buffer } = event.data;
  try {
    report({
      phase: "loading_model",
      message: "Loading the multilingual Whisper model in your browser",
    });

    let transcriber: WhisperPipeline;
    let device: "webgpu" | "wasm" = "wasm";
    const supportsWebGpu =
      typeof navigator !== "undefined" && "gpu" in navigator;
    if (supportsWebGpu) {
      try {
        transcriber = await loadPipeline(model, "webgpu");
        device = "webgpu";
      } catch {
        report({
          phase: "loading_model",
          message: "This browser could not start WebGPU; switching to local CPU processing",
        });
        transcriber = await loadPipeline(model, "wasm");
      }
    } else {
      transcriber = await loadPipeline(model, "wasm");
    }

    report({
      phase: "transcribing",
      message: "Transcribing locally with overlapping 30-second audio chunks. This may take a while.",
    });
    const options = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      task: "transcribe",
    } as const;
    const audio = new Float32Array(buffer);
    let output: WhisperOutput;
    try {
      output = await transcriber(audio, options);
    } catch (error) {
      if (device !== "webgpu") throw error;
      report({
        phase: "transcribing",
        message: "WebGPU could not finish transcription; retrying on this device's CPU",
      });
      transcriber = await loadPipeline(model, "wasm");
      output = await transcriber(audio, options);
    }
    const text = output.text?.trim() ?? "";
    if (!text) {
      throw new Error("No speech was recognized. The recording may be silent or too unclear.");
    }

    scope.postMessage({
      type: "result",
      result: {
        text,
        durationSeconds: 0,
        language: null,
        segments: normalizeChunks(output.chunks),
      },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Local transcription failed. Your recording remains saved on this device.";
    scope.postMessage({
      type: "error",
      message: message.includes("No speech was recognized")
        ? message
        : `${message} Your recording remains saved on this device.`,
    });
  }
};
