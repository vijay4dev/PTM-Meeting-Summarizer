# PTM Meeting Summarizer

A browser-first workspace for transcribing parent–teacher meetings. Recordings and meeting notes stay in the current browser unless someone deliberately chooses a configured cloud transcription provider.

## Local workflow

1. Install Node.js 24 and pnpm on macOS.
2. From the project root, run `pnpm install`.
3. Start the web app with:

   ```sh
   PORT=5173 BASE_PATH=/ pnpm --filter @workspace/ptm-summarizer run dev
   ```

4. Open the local Vite address shown by the command. The first local transcription downloads the selected multilingual Whisper model from Hugging Face into the browser cache; later runs can reuse that cache. Keep the browser tab open while decoding and transcription run.

Local transcription does not need an API key or the API server. The audio is decoded, resampled, and transcribed in the browser; it is not sent to Hugging Face. The app uses overlapping 30-second chunks for long recordings. On an 8 GB Apple-silicon Mac, start with Base; choose Tiny if memory or speed is a problem. Small is for devices with more headroom. Browser and file-format support can affect performance.

To use cloud transcription during local development, start the API server in a second terminal and point the frontend at it:

```sh
PORT=5000 pnpm --filter @workspace/api-server run dev
```

Then start the frontend with `VITE_API_BASE_URL=http://localhost:5000/api` in addition to the `PORT` and `BASE_PATH` values above. Cloud transcription is optional and off by default. Local transcription works even when the API is unavailable.

## Optional cloud transcription

Groq uses its multilingual `whisper-large-v3` transcription endpoint. xAI uses `grok-voice-transcribe-2.0`. These providers charge according to their current account pricing and usage limits; they are not represented as free. Supported model IDs, capabilities, and provider pricing links are shown in Settings.

To enable either adapter, set `ENABLE_CLOUD_TRANSCRIPTION=true` and configure `GROQ_API_KEY` and/or `XAI_API_KEY` in the API server's secret store. Never expose these values through a `VITE_` variable or commit them to a file. The API accepts recordings up to 24 MB. Cloud transcription is only sent after the user selects a provider and confirms the external upload. Sending roster hints is a separate opt-in.

The cloud endpoint is intentionally disabled unless explicitly enabled. Do not enable it on a public deployment without adding authentication and abuse controls. Cloud providers' retention and handling policies apply to recordings sent to them.

## Privacy and accuracy notes

- Meeting data and audio are stored in browser-local storage, not the project database. Clearing browser site data can remove locally saved meetings.
- Whisper in the browser does not provide reliable per-word confidence or speaker diarization. The app labels those capabilities as unavailable rather than inventing scores or speaker roles.
- Roster matches are suggestions only; users must confirm a student identity.
- The local summary is extractive: it selects exact transcript sentences after the user marks the transcript reviewed. It is not a generative AI summary. The user must check every sentence and fill action owners or deadlines only when explicit.
- Editing the transcript preserves the originally recognized text. Editing clears timed segment alignment because the timestamps no longer reliably match.
- The browser's available audio decoders determine which containers can be decoded locally. Unsupported or damaged files should fail with a clear message; re-encoding to WAV or MP3 is a workaround.

## Synthetic sample data

`testdata/sample-roster.csv` and `testdata/synthetic-ptm-script.md` use only fictional names and content. The script can be read aloud to make a local English, Hindi, or Hinglish sample recording.
