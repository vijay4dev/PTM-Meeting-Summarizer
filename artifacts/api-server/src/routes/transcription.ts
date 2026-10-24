import { Router, type IRouter } from "express";
import multer from "multer";
import {
  GetTranscriptionProvidersResponse,
  TranscribeWithProviderParams,
  TranscribeWithProviderResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const GROQ_MODEL = "whisper-large-v3";
const XAI_MODEL = "grok-voice-transcribe-2.0";
const GROQ_PRICING_URL = "https://console.groq.com/docs/speech-to-text";
const XAI_PRICING_URL = "https://docs.x.ai/developers/models/speech-to-text";
const ALLOWED_EXTENSIONS = new Set([
  ".flac",
  ".m4a",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".ogg",
  ".wav",
  ".webm",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 104 },
});

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  confidence: number | null;
  speakerId: string | null;
};

function isCloudTranscriptionEnabled(): boolean {
  return process.env.ENABLE_CLOUD_TRANSCRIPTION === "true";
}

function getProviderKey(provider: "groq" | "xai"): string | undefined {
  return provider === "groq"
    ? process.env.GROQ_API_KEY
    : process.env.XAI_API_KEY;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeGroqSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const segment = asRecord(item);
    const start = asNumber(segment.start);
    const end = asNumber(segment.end);
    const text = asString(segment.text);
    if (start === null || end === null || text === null) return [];
    return [{ start, end, text, confidence: null, speakerId: null }];
  });
}

function normalizeGroqWords(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const word = asRecord(item);
    const start = asNumber(word.start);
    const end = asNumber(word.end);
    const text = asString(word.word) ?? asString(word.text);
    if (start === null || end === null || text === null) return [];
    return [{ start, end, text, confidence: null, speakerId: null }];
  });
}

function normalizeXaiWords(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const word = asRecord(item);
    const start = asNumber(word.start);
    const end = asNumber(word.end);
    const text = asString(word.text);
    if (start === null || end === null || text === null) return [];
    const speaker = word.speaker;
    const speakerId =
      typeof speaker === "string" || typeof speaker === "number"
        ? String(speaker)
        : null;
    return [{ start, end, text, confidence: null, speakerId }];
  });
}

function validExtension(filename: string): boolean {
  const extension = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return Boolean(extension && ALLOWED_EXTENSIONS.has(extension));
}

router.get("/transcription/providers", (_req, res) => {
  const enabled = isCloudTranscriptionEnabled();
  const providers = [
    {
      id: "groq" as const,
      name: "Groq · Whisper Large v3",
      model: GROQ_MODEL,
      configured: enabled && Boolean(process.env.GROQ_API_KEY),
      maxUploadBytes: MAX_UPLOAD_BYTES,
      supportsWordTimestamps: true,
      supportsDiarization: false,
      pricingUrl: GROQ_PRICING_URL,
    },
    {
      id: "xai" as const,
      name: "xAI · Grok Voice Transcribe",
      model: XAI_MODEL,
      configured: enabled && Boolean(process.env.XAI_API_KEY),
      maxUploadBytes: MAX_UPLOAD_BYTES,
      supportsWordTimestamps: true,
      supportsDiarization: true,
      pricingUrl: XAI_PRICING_URL,
    },
  ];

  res.json(GetTranscriptionProvidersResponse.parse({ providers }));
});

router.post(
  "/transcription/:provider",
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: "Recording exceeds the 24 MB cloud upload limit." });
          return;
        }
        res.status(400).json({ error: "The upload could not be read. Choose one supported audio file." });
        return;
      }
      if (error) {
        next(error);
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const parsedParams = TranscribeWithProviderParams.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({ error: "Choose Groq or xAI as the transcription provider." });
      return;
    }

    const provider = parsedParams.data.provider;
    const apiKey = getProviderKey(provider);
    if (!isCloudTranscriptionEnabled() || !apiKey) {
      res.status(503).json({
        error: "This cloud provider is not configured. Local transcription remains available.",
      });
      return;
    }

    const file = req.file;
    if (!file || !validExtension(file.originalname)) {
      res.status(400).json({
        error: "Choose an MP3, M4A, WAV, FLAC, MP4, OGG, MPEG, MPGA, or WebM recording.",
      });
      return;
    }
    if (
      req.body.confirmExternalProcessing !== "true" &&
      req.body.confirmExternalProcessing !== true
    ) {
      res.status(400).json({
        error: "Confirm external processing before uploading a recording.",
      });
      return;
    }

    const language =
      typeof req.body.language === "string" &&
      ["hi", "en"].includes(req.body.language)
        ? req.body.language
        : undefined;
    const studentNames = Array.isArray(req.body.studentNames)
      ? req.body.studentNames
          .filter((name: unknown): name is string => typeof name === "string")
          .map((name: string) => name.trim().slice(0, 50))
          .filter(Boolean)
          .slice(0, 100)
      : typeof req.body.studentNames === "string"
        ? [req.body.studentNames.trim().slice(0, 50)].filter(Boolean)
        : [];
    const diarize = req.body.diarize === "true";
    const form = new FormData();
    let endpoint: string;

    if (provider === "groq") {
      endpoint = "https://api.groq.com/openai/v1/audio/transcriptions";
      form.append("model", GROQ_MODEL);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");
      form.append("timestamp_granularities[]", "word");
      form.append("temperature", "0");
      if (language) form.append("language", language);
      if (studentNames.length > 0) {
        form.append(
          "prompt",
          `Possible student-name spellings (do not infer a name unless clearly spoken): ${studentNames.join(", ")}`.slice(
            0,
            800,
          ),
        );
      }
    } else {
      endpoint = "https://api.x.ai/v1/stt";
      form.append("model", XAI_MODEL);
      form.append("format", "false");
      form.append("diarize", String(diarize));
      if (language) form.append("language", language);
      for (const name of studentNames) form.append("keyterm", name);
    }

    form.append(
      "file",
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
    } catch {
      req.log.warn({ provider }, "External transcription request could not connect");
      res.status(502).json({
        error: "The transcription provider could not be reached. Try again or use local transcription.",
      });
      return;
    }

    if (!response.ok) {
      req.log.warn(
        { provider, status: response.status },
        "External transcription request failed",
      );
      res.status(response.status === 413 ? 413 : 502).json({
        error:
          response.status === 413
            ? "The selected provider rejected this recording because it is too large."
            : "The selected provider could not transcribe this recording. Check its account limits and try again.",
      });
      return;
    }

    let raw: Record<string, unknown>;
    try {
      raw = asRecord(await response.json());
    } catch {
      req.log.warn({ provider }, "External transcription returned an invalid response");
      res.status(502).json({ error: "The selected provider returned an unreadable response." });
      return;
    }

    const durationSeconds = asNumber(raw.duration);
    const result = {
      provider,
      model: provider === "groq" ? GROQ_MODEL : XAI_MODEL,
      text: asString(raw.text) ?? "",
      language: asString(raw.language),
      durationSeconds,
      segments:
        provider === "groq"
          ? normalizeGroqWords(raw.words).length > 0
            ? normalizeGroqWords(raw.words)
            : normalizeGroqSegments(raw.segments)
          : normalizeXaiWords(raw.words),
      supportsDiarization:
        provider === "xai" &&
        diarize &&
        normalizeXaiWords(raw.words).some((segment) => segment.speakerId !== null),
      confidenceAvailable: false,
    };

    if (result.text.trim().length === 0) {
      res.status(502).json({
        error: "No transcript was returned. The recording may be silent or unsupported.",
      });
      return;
    }

    res.json(TranscribeWithProviderResponse.parse(result));
  },
);

export default router;
