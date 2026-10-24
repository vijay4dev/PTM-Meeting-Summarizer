# PTM Meeting Summarizer

A local-first parent–teacher meeting workspace for multilingual transcription, careful transcript review, student confirmation, and editable meeting notes.

## Run & Operate

- `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/ptm-summarizer run dev` — run the web app
- `pnpm --filter @workspace/api-server run dev` — run the optional API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Local transcription needs no API server, database, or secret. To use optional cloud transcription in development, start the API server and set `VITE_API_BASE_URL=http://localhost:5000/api` for the web app.
- Optional cloud server settings: `ENABLE_CLOUD_TRANSCRIPTION=true` plus `GROQ_API_KEY` and/or `XAI_API_KEY` in Replit Secrets. Keep the feature disabled on a public deployment unless authentication and abuse controls are added.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ptm-summarizer/src/components/ptm-workspace.tsx` — meeting, roster, review, and settings UI
- `artifacts/ptm-summarizer/src/lib/local-transcription.ts` and `src/workers/whisper.worker.ts` — local audio preparation and browser Whisper
- `artifacts/ptm-summarizer/src/index.css` — app styles
- `artifacts/api-server/src/routes/transcription.ts` — optional Groq and xAI transcription routes
- `lib/api-spec/openapi.yaml` — API contract source of truth; run codegen after editing it
- `artifacts/ptm-summarizer/testdata/` — fictional sample roster and synthetic PTM script

## Architecture decisions

- Audio stays in browser IndexedDB; meeting notes and roster stay in localStorage. The PTM product does not use the workspace database.
- Browser Whisper is the default; model files download from Hugging Face on first use and are cached by the browser. Audio itself is not uploaded by local transcription.
- Summary drafts extract exact transcript sentences only after the user marks the transcript reviewed. They are not generative paraphrases and remain editable.
- A student match requires explicit user confirmation. Local Whisper does not provide speaker identities or reliable confidence scores.
- Cloud transcription is off unless both an enable flag and server-side provider secret are configured. The user must confirm each upload; roster hints are separately opt-in.

## Product

Import or drop a meeting recording, transcribe locally in the browser or explicitly send it to a configured cloud transcription provider, review timestamped segments against the audio, edit/export transcript and summary, maintain a local student roster, and delete stored records. The local extractive summary is a starting draft, not a verified account of the meeting.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
