export const WHISPER_MODELS = {
  tiny: {
    id: "onnx-community/whisper-tiny",
    label: "Tiny · lowest memory",
  },
  base: {
    id: "onnx-community/whisper-base",
    label: "Base · recommended for 8 GB",
  },
  small: {
    id: "onnx-community/whisper-small",
    label: "Small · higher memory",
  },
} as const;

export type WhisperModelKey = keyof typeof WHISPER_MODELS;
export type LocalTranscriptionProgress = {
  phase: "preparing" | "loading_model" | "transcribing";
  message: string;
  percent?: number;
};

export type LocalTranscriptionResult = {
  text: string;
  durationSeconds: number;
  language: null;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    confidence: null;
    speakerId: null;
  }>;
};

type WorkerMessage =
  | { type: "progress"; progress: LocalTranscriptionProgress }
  | { type: "result"; result: LocalTranscriptionResult }
  | { type: "error"; message: string };

function getAudioContextConstructor(): typeof AudioContext {
  if (typeof AudioContext === "undefined") {
    throw new Error("This browser does not support local audio decoding. Try a current version of Chrome, Edge, or Safari.");
  }
  return AudioContext;
}

async function decodeAndResample(file: File): Promise<{
  samples: Float32Array;
  durationSeconds: number;
}> {
  const AudioContextConstructor = getAudioContextConstructor();
  const context = new AudioContextConstructor();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
      throw new Error("The recording has no readable audio track.");
    }

    const sampleRate = 16_000;
    const frameCount = Math.ceil(decoded.duration * sampleRate);
    const offline = new OfflineAudioContext(1, frameCount, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const resampled = await offline.startRendering();
    return {
      samples: resampled.getChannelData(0),
      durationSeconds: decoded.duration,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("readable audio track")) {
      throw error;
    }
    throw new Error(
      "This browser could not decode the recording. Try a WAV or MP3 file, or re-encode the audio and retry.",
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function transcribeLocally(
  file: File,
  model: WhisperModelKey,
  onProgress: (progress: LocalTranscriptionProgress) => void,
): Promise<LocalTranscriptionResult> {
  onProgress({
    phase: "preparing",
    message: "Preparing audio in this browser. The recording is not uploaded.",
  });
  const { samples, durationSeconds } = await decodeAndResample(file);
  if (samples.length === 0) {
    throw new Error("No audio samples could be decoded from this recording.");
  }

  const worker = new Worker(
    new URL("../workers/whisper.worker.ts", import.meta.url),
    { type: "module" },
  );

  return new Promise<LocalTranscriptionResult>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      callback();
    };

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress(message.progress);
      } else if (message.type === "result") {
        finish(() => resolve({
          ...message.result,
          durationSeconds,
        }));
      } else {
        finish(() => reject(new Error(message.message)));
      }
    };
    worker.onerror = () => finish(() => reject(
      new Error("Local transcription stopped unexpectedly. The recording is still saved on this device."),
    ));

    const buffer = samples.buffer as ArrayBuffer;
    worker.postMessage(
      {
        type: "transcribe",
        model: WHISPER_MODELS[model].id,
        samples: buffer,
      },
      [buffer],
    );
  });
}
