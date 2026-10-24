import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useGetTranscriptionProviders, useTranscribeWithProvider } from '@workspace/api-client-react';
import type { TranscriptionResult } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, AudioLines, BookOpen, CheckCircle2, ChevronRight, CircleHelp, Download, FileAudio, FileText, HardDrive, Headphones, LockKeyhole, Pencil, Plus, Save, Search, Settings2, ShieldCheck, Trash2, Upload, Users, X } from 'lucide-react';
import { transcribeLocally, WHISPER_MODELS, type LocalTranscriptionProgress, type WhisperModelKey } from '@/lib/local-transcription';

export type TranscriptSegment = { start: number; end: number; text: string; confidence: number | null; speakerId: string | null; reviewStatus?: 'needs_review' | 'reviewed' };
export type ActionItem = { id: string; text: string; owner: string; deadline: string };
export type MeetingSummary = { student: string; meetingSummary: string; academicPerformance: string; strengths: string; concerns: string; agreedActions: ActionItem[]; followUp: string };
export type Meeting = { id: string; createdAt: string; filename: string; mimeType: string; sizeBytes: number; durationSeconds: number | null; provider: string; transcript: string; originalTranscript?: string; segments: TranscriptSegment[]; summary: MeetingSummary; studentVerification: string; speakerRoles: Record<string, string>; reviewStatus: 'needs_review' | 'reviewed'; language?: string | null };
export type Student = { id: string; fullName: string; classSection: string; rollNumber: string; aliases: string[] };
type WorkspaceData = { meetings: Meeting[]; students: Student[]; saveMeeting: (m: Meeting) => void; deleteMeeting: (id: string) => void; saveStudent: (s: Student) => void; deleteStudent: (id: string) => void; clearAll: () => void; notice: (text: string) => void };

const Context = createContext<WorkspaceData | null>(null);
const read = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const savedWhisperModel = (): WhisperModelKey => {
  const value = read<string>('ptm-whisper-model-v1', 'base');
  return value in WHISPER_MODELS ? value as WhisperModelKey : 'base';
};
const dbOpen = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('ptm-local-recordings', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('audio');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const storeAudio = async (id: string, file: Blob) => {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(file, id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
};
const getAudio = async (id: string) => {
  const db = await dbOpen();
  const value = await new Promise<Blob | undefined>((resolve, reject) => { const req = db.transaction('audio').objectStore('audio').get(id); req.onsuccess = () => resolve(req.result as Blob | undefined); req.onerror = () => reject(req.error); });
  db.close(); return value;
};
const removeAudio = async (id: string) => {
  const db = await dbOpen();
  await new Promise<void>((resolve) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
  db.close();
};
const emptySummary = (): MeetingSummary => ({ student: '', meetingSummary: '', academicPerformance: '', strengths: '', concerns: '', agreedActions: [], followUp: '' });
const bytes = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const timeLabel = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
const startMeeting = (file: File): Meeting => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), filename: file.name, mimeType: file.type || 'audio/*', sizeBytes: file.size, durationSeconds: null, provider: 'Local — not transcribed', transcript: '', originalTranscript: '', segments: [], summary: emptySummary(), studentVerification: '', speakerRoles: {}, reviewStatus: 'needs_review' });

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [meetings, setMeetings] = useState<Meeting[]>(() => read('ptm-meetings-v1', []));
  const [students, setStudents] = useState<Student[]>(() => read('ptm-students-v1', []));
  const [toast, setToast] = useState('');
  useEffect(() => localStorage.setItem('ptm-meetings-v1', JSON.stringify(meetings)), [meetings]);
  useEffect(() => localStorage.setItem('ptm-students-v1', JSON.stringify(students)), [students]);
  const notice = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 2600); };
  const ctx: WorkspaceData = {
    meetings, students, saveMeeting: (m) => setMeetings((all) => [m, ...all.filter((item) => item.id !== m.id)]),
    deleteMeeting: (id) => { setMeetings((all) => all.filter((m) => m.id !== id)); void removeAudio(id); },
    saveStudent: (s) => setStudents((all) => [s, ...all.filter((v) => v.id !== s.id)]),
    deleteStudent: (id) => setStudents((all) => all.filter((s) => s.id !== id)),
    clearAll: () => { meetings.forEach((meeting) => void removeAudio(meeting.id)); setMeetings([]); setStudents([]); localStorage.removeItem('ptm-meetings-v1'); localStorage.removeItem('ptm-students-v1'); },
    notice,
  };
  return <Context.Provider value={ctx}>{children}{toast && <div className="toast-note" role="status">{toast}</div>}</Context.Provider>;
}
const useWorkspace = () => {
  const context = useContext(Context);
  if (!context) throw new Error('WorkspaceProvider is required');
  return context;
};

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const active = loc.startsWith('/meeting/') ? 'meetings' : loc.slice(1) || 'home';
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand"><span className="brand-mark"><AudioLines size={19} /></span><span><span className="brand-name">Good Record</span><span className="brand-sub">PTM notes, kept local</span></span></Link>
      <div className="nav-label">Workspace</div>
      <nav className="side-nav" aria-label="Main navigation">
        <Link href="/" className={`nav-link ${active === 'home' ? 'active' : ''}`} data-testid="link-dashboard"><BookOpen size={16} />Overview</Link>
        <Link href="/" className={`nav-link ${active === 'meetings' ? 'active' : ''}`} data-testid="link-meetings"><FileText size={16} />Meetings</Link>
        <Link href="/roster" className={`nav-link ${active === 'roster' ? 'active' : ''}`} data-testid="link-roster"><Users size={16} />Student roster</Link>
        <Link href="/settings" className={`nav-link ${active === 'settings' ? 'active' : ''}`} data-testid="link-settings"><Settings2 size={16} />Privacy & settings</Link>
      </nav>
      <div className="sidebar-note"><div className="privacy-mark"><LockKeyhole size={14} />Your records stay yours</div>Audio and notes are stored in this browser. Nothing is uploaded unless you choose a cloud provider.</div>
    </aside>
    <div className="workspace"><header className="topbar"><span className="top-context">Family meetings · private workspace</span><span className="local-chip"><span className="local-dot" />LOCAL STORAGE</span></header>{children}</div>
  </div>;
}

function FilePicker({ onFile, disabled = false }: { onFile: (file: File) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const acceptFile = (file?: File) => { if (file && !disabled) onFile(file); };
  return <><input ref={ref} type="file" accept="audio/*,video/mp4,.mp3,.m4a,.wav,.flac,.mp4,.mpeg,.mpga,.ogg,.webm" hidden disabled={disabled} data-testid="input-recording" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
    <section className={`upload-zone ${dragging ? 'is-dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files?.[0]); }}><div className="upload-icon"><Upload size={19} /></div><div><h3>Start with a recording</h3><p>Drop an audio file here or choose one to transcribe locally and create a private meeting record. Nothing leaves this browser by default.</p></div><button className="btn btn-primary" disabled={disabled} onClick={() => ref.current?.click()} data-testid="button-upload-recording"><Plus size={15} />{disabled ? 'Transcription in progress' : 'Add recording'}</button></section>
  </>;
}

export function Dashboard() {
  const { meetings, students, saveMeeting, notice } = useWorkspace();
  const [, navigate] = useLocation();
  const providersQuery = useGetTranscriptionProviders();
  const cloud = useTranscribeWithProvider();
  const [dialog, setDialog] = useState<Meeting | null>(null);
  const [provider, setProvider] = useState<'groq' | 'xai'>('groq');
  const [cloudError, setCloudError] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [includeRosterHints, setIncludeRosterHints] = useState(false);
  const [processing, setProcessing] = useState<{ filename: string; progress: LocalTranscriptionProgress } | null>(null);
  const selectedModel = savedWhisperModel();
  const configured = providersQuery.data?.providers?.filter((p) => p.configured) ?? [];
  const createLocal = async (file: File) => {
    const meeting = startMeeting(file);
    try { await storeAudio(meeting.id, file); saveMeeting(meeting); }
    catch { notice('Could not save this recording in browser storage. Check available space and try again.'); return; }
    setProcessing({ filename: file.name, progress: { phase: 'preparing', message: 'Preparing audio in this browser. The recording is not uploaded.' } });
    try {
      const result = await transcribeLocally(file, selectedModel, (progress) => setProcessing({ filename: file.name, progress }));
      meeting.provider = `Local Whisper · ${selectedModel}`;
      meeting.transcript = result.text;
      meeting.originalTranscript = result.text;
      meeting.durationSeconds = result.durationSeconds;
      meeting.language = result.language;
      meeting.segments = result.segments.map((segment) => ({ ...segment, reviewStatus: 'needs_review' }));
      meeting.reviewStatus = 'needs_review';
      saveMeeting(meeting);
      notice('Local transcript ready. Review names and uncertain words before creating a summary.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Local transcription failed.';
      notice(detail);
    } finally {
      setProcessing(null);
      navigate(`/meeting/${meeting.id}`);
    }
  };
  const askCloud = (file: File) => { setPendingFile(file); setCloudError(''); setDialog(startMeeting(file)); };
  const confirmCloud = async () => {
    if (!pendingFile) return;
    setCloudError('');
    try {
      const studentNames = includeRosterHints
        ? students.flatMap((student) => [student.fullName, ...student.aliases])
        : undefined;
      const result = await cloud.mutateAsync({
        provider,
        data: {
          file: pendingFile,
          confirmExternalProcessing: true,
          studentNames,
          diarize: provider === 'xai',
        },
      });
      const meeting = dialog!;
      applyTranscription(meeting, result);
      await storeAudio(meeting.id, pendingFile);
      saveMeeting(meeting); setDialog(null); setPendingFile(null); navigate(`/meeting/${meeting.id}`);
    } catch (error) { setCloudError(error instanceof Error ? error.message : 'The provider could not transcribe this file. Your recording remains on this device.'); }
  };
  return <main className="page">
    <div className="eyebrow">A careful record of what was said</div>
    <div className="split-head"><div><h1 className="page-title">Meeting notes,<br />with room to verify.</h1><p className="page-intro">Keep the conversation close, review uncertain words, and leave with a shared understanding. Your recordings are saved in this browser.</p></div></div>
      <div style={{ marginTop: 27 }}><FilePicker disabled={processing !== null} onFile={(f) => void createLocal(f)} /></div>
      {processing && <section className="card panel" role="status" aria-live="polite" style={{ marginTop: 12 }}>
        <div className="eyebrow">{processing.progress.phase === 'loading_model' ? 'Preparing local model' : processing.progress.phase === 'transcribing' ? 'Local transcription' : 'Preparing recording'}</div>
        <h3 style={{ margin: '6px 0' }}>{processing.filename}</h3>
        <p className="muted" style={{ fontSize: 12 }}>{processing.progress.message}</p>
        {typeof processing.progress.percent === 'number' && <p className="mono" style={{ fontSize: 11 }}>Current model file: {processing.progress.percent}% downloaded</p>}
      </section>}
    <section style={{ marginTop: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span className="muted" style={{ fontSize: 11 }}>Local handling is the default. Choose cloud processing only after reviewing its privacy notice.</span>
       <button className="btn btn-secondary" disabled={processing !== null} onClick={() => document.getElementById('cloud-file-input')?.click()} data-testid="button-cloud-transcribe"><AudioLines size={14} />Use a cloud provider</button>
       <input id="cloud-file-input" type="file" accept="audio/*,video/mp4,.mp3,.m4a,.wav,.flac,.mp4,.mpeg,.mpga,.ogg,.webm" hidden disabled={processing !== null} onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) askCloud(f); e.currentTarget.value = ''; }} />
    </section>
    <div className="section-heading"><h2>Recent meetings</h2><span className="eyebrow">{meetings.length} saved {meetings.length === 1 ? 'record' : 'records'}</span></div>
    {meetings.length ? <div className="card meeting-list">{[...meetings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((m) => <Link key={m.id} href={`/meeting/${m.id}`} className="meeting-row" data-testid={`meeting-row-${m.id}`}><div><div className="meeting-name">{m.studentVerification === 'confirmed' ? m.summary.student : m.filename}</div><div className="meeting-meta">{dateLabel(m.createdAt)} · {bytes(m.sizeBytes)}{m.durationSeconds ? ` · ${timeLabel(m.durationSeconds)}` : ''} · {m.provider}</div></div><span className={`status-pill ${m.reviewStatus === 'needs_review' ? 'review' : ''}`}>{m.reviewStatus === 'reviewed' ? 'Reviewed' : 'Needs review'}</span><span className="meeting-meta">{m.segments.length ? `${m.segments.length} timed lines` : m.transcript ? 'Transcript saved' : 'No transcript yet'}</span><ChevronRight size={16} className="muted" /></Link>)}</div> : <div className="card empty-state"><div className="empty-symbol"><FileAudio size={20} /></div><h3>No meetings saved here yet</h3><p>Add a recording to begin. Your local record will be ready for careful transcript editing and review.</p></div>}
    {dialog && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-title"><div className="eyebrow">Explicit cloud processing</div><h2 id="cloud-title">Send audio for transcription?</h2><p><strong>{pendingFile?.name}</strong> will be uploaded to the selected provider for processing. Audio and any transcript may be handled under that provider’s terms and may incur charges. This is not local processing. No provider key is shown or stored in this interface.</p>
      {providersQuery.isLoading ? <p>Checking which providers are available…</p> : providersQuery.isError ? <div className="uncertainty"><AlertCircle size={15} />Provider availability could not be checked. Retry in Privacy &amp; settings before sending audio.</div> : configured.length ? <div className="field"><label htmlFor="cloud-provider">Configured provider</label><select id="cloud-provider" className="select" value={provider} onChange={(e) => setProvider(e.target.value as 'groq' | 'xai')} data-testid="select-cloud-provider">{configured.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></div> : <div className="uncertainty">No cloud provider is currently configured. Your recording has not been sent.</div>}
      {students.length > 0 && <label className="check-row"><input type="checkbox" checked={includeRosterHints} onChange={(e) => setIncludeRosterHints(e.target.checked)} data-testid="checkbox-roster-hints" /><span>Also send {students.length} roster name{students.length === 1 ? '' : 's'} and aliases as optional vocabulary hints. These are never used to confirm student identity.</span></label>}
      {provider === 'xai' && <p className="meeting-meta">Speaker separation will be requested. Detected labels still need your review.</p>}
      {cloudError && <div className="uncertainty" role="alert">{cloudError}</div>}
      <div className="dialog-actions"><button className="btn btn-secondary" onClick={() => { setDialog(null); setPendingFile(null); }} data-testid="button-cancel-cloud">Cancel</button><button className="btn btn-primary" disabled={!configured.length || providersQuery.isError || cloud.isPending} onClick={() => void confirmCloud()} data-testid="button-confirm-cloud">{cloud.isPending ? 'Sending…' : 'I understand — send audio'}</button></div></section></div>}
  </main>;
}

function applyTranscription(meeting: Meeting, result: TranscriptionResult) {
  meeting.provider = `${result.provider} · ${result.model}`;
  meeting.transcript = result.text;
  meeting.originalTranscript = result.text;
  meeting.durationSeconds = result.durationSeconds;
  meeting.language = result.language;
  meeting.segments = result.segments.map((s) => ({ ...s, reviewStatus: 'needs_review' }));
  meeting.reviewStatus = 'needs_review';
}

function buildExtractiveSummary(transcript: string): Partial<MeetingSummary> {
  const sentences = transcript
    .replace(/\r/g, '')
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12);
  const hasAny = (sentence: string, terms: string[]) => {
    const normalized = sentence.toLocaleLowerCase();
    return terms.some((term) => normalized.includes(term));
  };
  const academicTerms = ['math', 'mathemat', 'science', 'reading', 'writing', 'homework', 'exam', 'गणित', 'विज्ञान', 'पढ़', 'पढ़', 'लिख', 'होमवर्क', 'परीक्षा'];
  const strengthTerms = ['progress', 'improv', 'strong', 'good', 'well', 'confident', 'contribut', 'participat', 'अच्छा', 'बेहतर', 'सुधार', 'मेहनत', 'भाग लिया', 'रुचि'];
  const concernTerms = ['difficult', 'struggl', 'challenge', 'concern', 'needs practice', 'missed', 'absent', 'late', 'मुश्किल', 'कठिन', 'चिंता', 'समस्या', 'अनुपस्थित', 'दिक्कत'];
  const isActionCommitment = (sentence: string) =>
    /\b(?:i(?:'ll| will)|we(?:'ll| will)|teacher will|parent will|we agreed|agreed to|will send|will review|i am going to|we are going to)\b/i.test(sentence) ||
    ['करेंगे', 'करूँगा', 'करूंगा', 'करूंगी', 'भेजूँगा', 'भेजूंगी', 'तय किया', 'हम करेंगे', 'मैं करूँगा', 'मैं करूंगी'].some((term) => sentence.includes(term));
  const followUpTerms = ['follow up', 'follow-up', 'check in', 'next meeting', 'next week', 'फिर बात', 'अगली बैठक', 'अगले हफ्ते', 'अगले सप्ताह'];

  const scored = sentences.map((text, index) => ({
    text,
    index,
    score:
      Number(hasAny(text, academicTerms)) +
      Number(hasAny(text, strengthTerms)) +
      Number(hasAny(text, concernTerms)) +
      Number(isActionCommitment(text)),
  }));
  const meetingSummary = [...scored]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.min(3, sentences.length))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.text)
    .join(' ');
  const extract = (terms: string[], limit = 3) =>
    sentences.filter((sentence) => hasAny(sentence, terms)).slice(0, limit).join('\n');
  const actionSentences = sentences
    .filter(isActionCommitment)
    .slice(0, 5);

  return {
    meetingSummary,
    academicPerformance: extract(academicTerms),
    strengths: extract(strengthTerms),
    concerns: extract(concernTerms),
    agreedActions: actionSentences.map((text) => ({
      id: crypto.randomUUID(),
      text,
      owner: '',
      deadline: '',
    })),
    followUp: extract(followUpTerms, 2),
  };
}

function srtTime(seconds: number) {
  const ms = Math.floor((seconds % 1) * 1000); const whole = Math.floor(seconds);
  return `${Math.floor(whole / 3600).toString().padStart(2, '0')}:${Math.floor((whole % 3600) / 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}
function downloadText(filename: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

async function copyText(text: string, label: string, notice: (text: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    notice(`${label} copied to clipboard.`);
  } catch {
    notice(`Clipboard access is unavailable. Use the download button for the ${label.toLowerCase()}.`);
  }
}

function formatSummary(meeting: Meeting): string {
  const summary = meeting.summary;
  const studentLabel = meeting.studentVerification === 'confirmed'
    ? summary.student
    : summary.student
      ? `Unconfirmed — ${summary.student}`
      : 'Not identified';
  const sections: Array<[string, string]> = [
    ['Student', studentLabel],
    ['Meeting summary', summary.meetingSummary],
    ['Academic performance', summary.academicPerformance],
    ['Strengths', summary.strengths],
    ['Concerns', summary.concerns],
    ['Agreed actions', summary.agreedActions.map((action) => [
      action.text,
      action.owner ? `Owner: ${action.owner}` : '',
      action.deadline ? `Deadline: ${action.deadline}` : '',
    ].filter(Boolean).join(' — ')).filter(Boolean).join('\n')],
    ['Important follow-up', summary.followUp],
  ];
  return sections
    .filter(([, content]) => content.trim())
    .map(([heading, content]) => `${heading}\n${content}`)
    .join('\n\n');
}

export function MeetingPage() {
  const params = useParams<{ id: string }>();
  const { meetings, students, saveMeeting, deleteMeeting, notice } = useWorkspace();
  const [, navigate] = useLocation();
  const meeting = meetings.find((m) => m.id === params.id);
  const [audioUrl, setAudioUrl] = useState('');
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [showNeedsReviewOnly, setShowNeedsReviewOnly] = useState(false);
  const [retryingLocal, setRetryingLocal] = useState(false);
  const [retryProgress, setRetryProgress] = useState<LocalTranscriptionProgress | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    let url = '';
    if (meeting) void getAudio(meeting.id).then((blob) => { if (blob) { url = URL.createObjectURL(blob); setAudioUrl(url); } });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [meeting?.id]);
  if (!meeting) return <main className="page"><Link href="/" className="nav-link" style={{ color: 'inherit' }}><ArrowLeft size={15} />Back to meetings</Link><div className="card empty-state" style={{ marginTop: 25 }}><h3>Meeting not found</h3><p>This record may have been deleted or was saved in a different browser.</p></div></main>;
  const patch = (changes: Partial<Meeting>) => saveMeeting({ ...meeting, ...changes });
  const patchSummary = (changes: Partial<MeetingSummary>) => patch({ summary: { ...meeting.summary, ...changes } });
  const retryLocalTranscription = async () => {
    setRetryingLocal(true);
    setRetryProgress({ phase: 'preparing', message: 'Loading the recording from this device.' });
    try {
      const storedAudio = await getAudio(meeting.id);
      if (!storedAudio) throw new Error('The local audio file is missing. Check browser storage or choose the recording again.');
      const file = new File([storedAudio], meeting.filename, { type: meeting.mimeType });
      const model = savedWhisperModel();
      const result = await transcribeLocally(file, model, setRetryProgress);
      patch({
        provider: `Local Whisper · ${model}`,
        transcript: result.text,
        originalTranscript: result.text,
        durationSeconds: result.durationSeconds,
        language: result.language,
        segments: result.segments.map((segment) => ({ ...segment, reviewStatus: 'needs_review' })),
        reviewStatus: 'needs_review',
      });
      notice('Local transcript ready. Review it before building a summary.');
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Local transcription failed. The recording remains saved on this device.');
    } finally {
      setRetryingLocal(false);
      setRetryProgress(null);
    }
  };
  const knownSpeakers = [...new Set(meeting.segments.map((s) => s.speakerId).filter((s): s is string => Boolean(s)))];
  const flagged = meeting.segments.filter((s) => s.reviewStatus !== 'reviewed');
  const visibleSegments = showNeedsReviewOnly ? flagged : meeting.segments;
  const seek = (time: number) => { if (audioRef.current) { audioRef.current.currentTime = time; void audioRef.current.play(); } };
  const saveTranscript = () => { patch({ transcript: transcriptDraft, segments: [], reviewStatus: 'needs_review' }); setEditingTranscript(false); notice('Transcript edits saved. Timed segments are cleared because their alignment is no longer reliable.'); };
  const exportSrt = () => {
    if (!meeting.segments.length) { notice('Timed segments are not available for this transcript.'); return; }
    downloadText(`${meeting.filename.replace(/\.[^.]+$/, '')}.srt`, meeting.segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}`).join('\n\n'), 'text/srt');
  };
  const markReviewed = () => { patch({ reviewStatus: 'reviewed', segments: meeting.segments.map((s) => ({ ...s, reviewStatus: 'reviewed' })) }); notice('Marked as reviewed. You can still edit this record.'); };
  const addAction = () => patchSummary({ agreedActions: [...meeting.summary.agreedActions, { id: crypto.randomUUID(), text: '', owner: '', deadline: '' }] });
  const patchAction = (id: string, key: keyof ActionItem, value: string) => patchSummary({ agreedActions: meeting.summary.agreedActions.map((a) => a.id === id ? { ...a, [key]: value } : a) });
  return <main className="page">
    <Link href="/" className="nav-link" style={{ color: 'hsl(var(--muted-foreground))', paddingLeft: 0, width: 'max-content' }}><ArrowLeft size={14} />All meetings</Link>
    <div className="split-head" style={{ marginTop: 17 }}><div><div className="eyebrow">{dateLabel(meeting.createdAt)} · {bytes(meeting.sizeBytes)} recording</div><h1 className="page-title" style={{ fontSize: 'clamp(30px,3.4vw,42px)' }}>{meeting.studentVerification === 'confirmed' ? meeting.summary.student : meeting.filename}</h1><div className="actions"><span className={`status-pill ${meeting.reviewStatus === 'needs_review' ? 'review' : ''}`}>{meeting.reviewStatus === 'reviewed' ? 'Reviewed by you' : 'Review needed'}</span><span className="meeting-meta">{meeting.provider}</span></div></div><div className="actions"><button className="btn btn-secondary" onClick={() => void copyText(meeting.transcript, 'Transcript', notice)} data-testid="button-copy-transcript"><FileText size={14} />Copy transcript</button><button className="btn btn-secondary" onClick={() => void copyText(formatSummary(meeting), 'Summary', notice)} data-testid="button-copy-summary"><BookOpen size={14} />Copy summary</button><button className="btn btn-secondary" onClick={() => downloadText(`${meeting.filename.replace(/\.[^.]+$/, '')}.txt`, meeting.transcript || 'No transcript has been added yet.')} data-testid="button-export-txt"><Download size={14} />TXT</button><button className="btn btn-secondary" onClick={exportSrt} data-testid="button-export-srt"><Download size={14} />SRT</button><button className="btn btn-secondary" onClick={() => window.print()} data-testid="button-print"><FileText size={14} />Print / PDF</button><button className="btn btn-danger" onClick={() => setShowDelete(true)} data-testid="button-delete-meeting"><Trash2 size={14} />Delete</button></div></div>
    <div className="meeting-layout">
      <section className="card panel">
        <div className="panel-head"><div><div className="eyebrow">Conversation record</div><h2 style={{ marginTop: 4 }}>Transcript</h2></div><div className="actions"><button className="btn btn-quiet" onClick={() => { setTranscriptDraft(meeting.transcript); setEditingTranscript((v) => !v); }} data-testid="button-edit-transcript"><Pencil size={14} />{editingTranscript ? 'Cancel edit' : 'Edit text'}</button></div></div>
        {audioUrl ? <div className="audio-player"><div className="audio-caption"><span><Headphones size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />Original recording · stored locally</span><span>{meeting.durationSeconds ? timeLabel(meeting.durationSeconds) : 'Duration not provided'}</span></div><audio ref={audioRef} src={audioUrl} controls data-testid="audio-recording" /></div> : <div className="uncertainty"><LockKeyhole size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Recording retained in this browser. {meeting.mimeType} · {bytes(meeting.sizeBytes)}</div>}
        {editingTranscript ? <><textarea className="transcript-editor" value={transcriptDraft} onChange={(e) => setTranscriptDraft(e.target.value)} aria-label="Transcript text" data-testid="textarea-transcript" /><div className="actions" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn btn-primary" onClick={saveTranscript} data-testid="button-save-transcript"><Save size={14} />Save transcript</button></div></> :
         meeting.segments.length ? <div>{visibleSegments.map((segment, i) => {
           const originalIndex = meeting.segments.indexOf(segment);
           return <div className="segment" key={`${segment.start}-${originalIndex}`}><button className="timestamp" onClick={() => seek(segment.start)} title={`Seek to ${timeLabel(segment.start)}`} data-testid={`button-seek-${originalIndex}`}>{timeLabel(segment.start)}</button><div className={`segment-text ${segment.reviewStatus !== 'reviewed' ? 'flagged' : ''}`}>{segment.text}{segment.speakerId && <span className="meeting-meta" style={{ display: 'block' }}>{meeting.speakerRoles[segment.speakerId] || segment.speakerId}</span>}</div><button className="btn btn-quiet" aria-label="Edit transcript" onClick={() => { setTranscriptDraft(meeting.transcript); setEditingTranscript(true); }}><Pencil size={13} /></button><button className="btn btn-quiet" aria-label={segment.reviewStatus === 'reviewed' ? 'Mark segment for review' : 'Mark segment reviewed'} onClick={() => patch({ segments: meeting.segments.map((item, index) => index === originalIndex ? { ...item, reviewStatus: item.reviewStatus === 'reviewed' ? 'needs_review' : 'reviewed' } : item) })}>{segment.reviewStatus === 'reviewed' ? 'Review' : 'Mark checked'}</button></div>;
         })}</div> :
         meeting.transcript ? <p className="segment-text" style={{ whiteSpace: 'pre-wrap' }}>{meeting.transcript}</p> : <div className="empty-state" style={{ padding: '28px 8px' }}><div className="empty-symbol"><CircleHelp size={18} /></div><h3>No transcript yet</h3><p>This recording is saved locally, but has not been transcribed. Add text with Edit text, or retry local transcription below.</p><div className="actions" style={{ justifyContent: 'center', marginTop: 16 }}><button className="btn btn-secondary" onClick={() => { setTranscriptDraft(''); setEditingTranscript(true); }} data-testid="button-add-transcript"><Pencil size={14} />Enter transcript</button><button className="btn btn-primary" disabled={retryingLocal} onClick={() => void retryLocalTranscription()} data-testid="button-retry-local">{retryingLocal ? 'Transcribing locally…' : 'Retry local transcription'}</button></div>{retryProgress && <p className="meeting-meta" role="status" style={{ marginTop: 12 }}>{retryProgress.message}{typeof retryProgress.percent === 'number' ? ` · ${retryProgress.percent}%` : ''}</p>}</div>}
         {meeting.originalTranscript && meeting.originalTranscript !== meeting.transcript && <details className="original-transcript"><summary>Original recognized transcript</summary><p>{meeting.originalTranscript}</p></details>}
      </section>
      <div style={{ display: 'grid', gap: 16 }}>
        <section className="card panel"><div className="panel-head"><div><div className="eyebrow">Your interpretation</div><h2 style={{ marginTop: 4 }}>Meeting summary</h2></div><button className="btn btn-quiet" onClick={() => setSummaryEditing((v) => !v)} data-testid="button-edit-summary"><Pencil size={14} />{summaryEditing ? 'Done' : 'Edit'}</button></div>
          <div className="student-confirm"><strong>Evidence-first local draft</strong><p>This selects exact sentences from the transcript. It does not paraphrase or add facts. Review the transcript and mark it reviewed before generating.</p><button className="btn btn-secondary" disabled={meeting.reviewStatus !== 'reviewed' || !meeting.transcript.trim()} onClick={() => {
            if ((meeting.summary.meetingSummary || meeting.summary.agreedActions.length) && !window.confirm('Replace the current summary draft with a new transcript-based draft?')) return;
            patchSummary(buildExtractiveSummary(meeting.transcript));
            setSummaryEditing(true);
            notice('Summary draft prepared from transcript sentences. Check every field before sharing.');
          }} data-testid="button-generate-summary"><BookOpen size={14} />Generate local draft</button>{meeting.reviewStatus !== 'reviewed' && <p className="meeting-meta" style={{ marginTop: 7 }}>Review the full transcript and mark it reviewed first.</p>}</div>
          <div className="student-confirm"><strong>Student match · {meeting.studentVerification === 'confirmed' ? 'confirmed by you' : meeting.studentVerification === 'not_identified' ? 'not identified' : 'not confirmed'}</strong><p>Names are never matched automatically. Select or enter a name only after checking the conversation.</p><select className="select" style={{ marginTop: 10 }} aria-label="Student name" value={meeting.summary.student} onChange={(e) => patch({ summary: { ...meeting.summary, student: e.target.value }, studentVerification: '' })} data-testid="select-student"><option value="">Choose a student (optional)</option>{students.map((s) => <option key={s.id} value={s.fullName}>{s.fullName}{s.classSection ? ` · ${s.classSection}` : ''}</option>)}</select><input className="input" style={{ marginTop: 8 }} placeholder="Or enter a name as heard" value={meeting.summary.student} onChange={(e) => patch({ summary: { ...meeting.summary, student: e.target.value }, studentVerification: '' })} data-testid="input-student-name" /><div className="actions" style={{ marginTop: 8 }}><button className="btn btn-secondary" disabled={!meeting.summary.student.trim()} onClick={() => patch({ studentVerification: 'confirmed' })} data-testid="button-confirm-student">Confirm name</button><button className="btn btn-quiet" onClick={() => patch({ summary: { ...meeting.summary, student: '' }, studentVerification: 'not_identified' })} data-testid="button-not-identified">Not identified</button></div></div>
          {summaryEditing ? <div>{([['meetingSummary','Meeting summary'],['academicPerformance','Academic performance'],['strengths','Strengths'],['concerns','Concerns'],['followUp','Follow-up']] as const).map(([key,label]) => <div className="field" key={key}><label>{label}</label><textarea className="textarea" value={meeting.summary[key]} onChange={(e) => patchSummary({ [key]: e.target.value })} data-testid={`textarea-summary-${key}`} /></div>)}</div> :
          <div>{([['meetingSummary','Summary'],['academicPerformance','Academic performance'],['strengths','Strengths'],['concerns','Concerns'],['followUp','Follow-up']] as const).map(([key,label]) => <div className="summary-block" key={key}><h3>{label}</h3><p>{meeting.summary[key] || <span className="muted">Not added yet.</span>}</p></div>)}</div>}
          <div className="summary-block"><div className="panel-head" style={{ margin: 0 }}><h3>Agreed actions</h3><button className="btn btn-quiet" onClick={addAction} data-testid="button-add-action"><Plus size={14} />Add action</button></div>
            {meeting.summary.agreedActions.map((action) => <div className="action-row" key={action.id}><input className="input" aria-label="Action" placeholder="What will be done?" value={action.text} onChange={(e) => patchAction(action.id, 'text', e.target.value)} /><input className="input" aria-label="Owner" placeholder="Owner" value={action.owner} onChange={(e) => patchAction(action.id, 'owner', e.target.value)} /><input className="input" aria-label="Deadline" type="date" value={action.deadline} onChange={(e) => patchAction(action.id, 'deadline', e.target.value)} /><button className="btn btn-quiet" aria-label="Remove action" onClick={() => patchSummary({ agreedActions: meeting.summary.agreedActions.filter((a) => a.id !== action.id) })}><X size={14} /></button></div>)}
          </div>
        </section>
         {(flagged.length > 0 || meeting.segments.length > 0) && <section className="card panel"><div className="panel-head"><div><div className="eyebrow">Careful review</div><h2 style={{ margin: '5px 0 12px' }}>Words &amp; speakers</h2></div>{meeting.segments.length > 0 && <button className="btn btn-quiet" onClick={() => setShowNeedsReviewOnly((value) => !value)} data-testid="button-filter-review">{showNeedsReviewOnly ? 'Show all segments' : `Needs review · ${flagged.length}`}</button>}</div>{flagged.length ? <><p className="muted" style={{ fontSize: 11 }}>Unreviewed transcript segments are shown here for listening. No confidence score is available from this transcript provider.</p>{flagged.map((s, i) => {
           const index = meeting.segments.indexOf(s);
           return <div key={`${s.start}-${i}`} className="uncertainty" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><button style={{ flex: 1, textAlign: 'left', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }} onClick={() => seek(s.start)} data-testid={`button-review-segment-${index}`}><span className="mono">{timeLabel(s.start)}</span> · “{s.text}”<span style={{ display: 'block', color: '#896847', fontSize: 10, marginTop: 4 }}>{typeof s.confidence === 'number' ? `Provider confidence ${Math.round(s.confidence * 100)}%` : 'Needs review · click to listen'}</span></button><button className="btn btn-quiet" onClick={() => patch({ segments: meeting.segments.map((segment, segmentIndex) => segmentIndex === index ? { ...segment, reviewStatus: 'reviewed' } : segment) })} data-testid={`button-mark-segment-reviewed-${index}`}>Mark checked</button></div>;
         })}</> : <p className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>No unreviewed segments remain. Listen again if a name or phrase still needs attention.</p>}
          {knownSpeakers.length > 0 && <div style={{ marginTop: 17 }}><div className="eyebrow">Speaker labels · assign only if known</div>{knownSpeakers.map((speaker) => <div className="speaker-row" key={speaker}><span>{speaker}</span><select className="select" aria-label={`Role for ${speaker}`} value={meeting.speakerRoles[speaker] || ''} onChange={(e) => patch({ speakerRoles: { ...meeting.speakerRoles, [speaker]: e.target.value } })}><option value="">Unassigned</option><option>Teacher</option><option>Parent / guardian</option><option>Student</option><option>Other adult</option></select></div>)}</div>}
        </section>}
        <section className="card panel"><div className="panel-head"><div><div className="eyebrow">Review status</div><h2 style={{ marginTop: 4 }}>Your verification</h2></div><ShieldCheck size={19} color="#54735f" /></div><p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>Mark reviewed only after checking the names, uncertain words, and action items against the conversation.</p><button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={markReviewed} data-testid="button-mark-reviewed"><CheckCircle2 size={15} />Mark as reviewed</button></section>
      </div>
    </div>
    {showDelete && <div className="dialog-backdrop"><section className="dialog" role="alertdialog" aria-modal="true"><div className="eyebrow">Remove local record</div><h2>Delete this meeting?</h2><p>The recording, transcript, and notes will be removed from this browser. This cannot be undone.</p><div className="dialog-actions"><button className="btn btn-secondary" onClick={() => setShowDelete(false)}>Keep meeting</button><button className="btn btn-danger" onClick={() => { deleteMeeting(meeting.id); setShowDelete(false); navigate('/'); notice('Meeting and local recording deleted.'); }} data-testid="button-confirm-delete"><Trash2 size={14} />Delete meeting</button></div></section></div>}
  </main>;
}

export function RosterPage() {
  const { students, saveStudent, deleteStudent, notice } = useWorkspace();
  const [editing, setEditing] = useState<Student | null>(null);
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [importError, setImportError] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => students.filter((s) => `${s.fullName} ${s.classSection} ${s.rollNumber} ${s.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [students, query]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    const fullName = String(data.get('fullName') || '').trim(); if (!fullName) return;
    saveStudent({ id: editing?.id || crypto.randomUUID(), fullName, classSection: String(data.get('classSection') || '').trim(), rollNumber: String(data.get('rollNumber') || '').trim(), aliases: String(data.get('aliases') || '').split(',').map((v) => v.trim()).filter(Boolean) });
    setEditing(null); notice('Student record saved locally.');
  };
  const importCsv = async (file?: File) => {
    setImportError(''); if (!file) return;
    try {
      const text = await file.text(); const rows = text.split(/\r?\n/).filter(Boolean);
      const start = rows[0]?.toLowerCase().includes('name') ? 1 : 0;
      const incoming = rows.slice(start).map((row) => row.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))).filter((cells) => cells[0]);
      if (!incoming.length) throw new Error('No student names were found. Use CSV columns: fullName, classSection, rollNumber, aliases.');
      incoming.forEach((cells) => saveStudent({ id: crypto.randomUUID(), fullName: cells[0], classSection: cells[1] || '', rollNumber: cells[2] || '', aliases: (cells[3] || '').split('|').map((v) => v.trim()).filter(Boolean) }));
      notice(`${incoming.length} student ${incoming.length === 1 ? 'record' : 'records'} imported.`); if (importRef.current) importRef.current.value = '';
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Could not read the CSV file.'); }
  };
  return <main className="page"><div className="eyebrow">Names are references, not automatic matches</div><div className="split-head"><div><h1 className="page-title">Student roster</h1><p className="page-intro">Keep a private list of student names and aliases for your own reference. A name is never confirmed from a transcript automatically.</p></div><div className="actions"><button className="btn btn-secondary" onClick={() => importRef.current?.click()} data-testid="button-import-roster"><Upload size={14} />Import CSV</button><input ref={importRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void importCsv(e.currentTarget.files?.[0])} /><button className="btn btn-primary" onClick={() => setEditing({ id: '', fullName: '', classSection: '', rollNumber: '', aliases: [] })} data-testid="button-add-student"><Plus size={15} />Add student</button></div></div>
    <div className="settings-grid" style={{ gridTemplateColumns: '1fr 280px' }}><section className="card panel"><div className="panel-head"><h2>Saved students</h2><div style={{ position: 'relative', width: 210 }}><Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#758279' }} /><input className="input" style={{ paddingLeft: 31 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a student" aria-label="Find a student" data-testid="input-search-students" /></div></div>
      {importError && <div className="uncertainty" role="alert">{importError}</div>}
      {filtered.length ? <div className="meeting-list">{filtered.map((student) => <div key={student.id} className="meeting-row" style={{ gridTemplateColumns: '1fr 100px 100px 80px', paddingLeft: 0, paddingRight: 0 }}><div><div className="meeting-name">{student.fullName}</div><div className="meeting-meta">{student.aliases.length ? `Also known as ${student.aliases.join(', ')}` : 'No aliases'}</div></div><span className="meeting-meta">{student.classSection || 'No class'}</span><span className="meeting-meta">{student.rollNumber || 'No roll no.'}</span><div className="actions"><button className="btn btn-quiet" aria-label={`Edit ${student.fullName}`} onClick={() => setEditing(student)}><Pencil size={14} /></button><button className="btn btn-quiet danger-link" aria-label={`Remove ${student.fullName}`} onClick={() => setConfirmId(student.id)}><Trash2 size={14} /></button></div></div>)}</div> : <div className="empty-state"><div className="empty-symbol"><Users size={20} /></div><h3>{query ? 'No matches' : 'No student records'}</h3><p>{query ? 'Try another name or clear your search.' : 'Add a student or import a CSV. This roster stays in this browser.'}</p></div>}</section>
      <aside className="card setting-card"><div className="privacy-mark" style={{ color: 'hsl(var(--primary))' }}><ShieldCheck size={15} />Import format</div><p>CSV columns: <span className="mono">fullName, classSection, rollNumber, aliases</span>. Separate aliases with a vertical bar. Imported names are not used to confirm identities.</p><div style={{ marginTop: 18, borderTop: '1px solid hsl(var(--border))', paddingTop: 15 }}><p>All student records are held in browser storage. Export or clear browser data to remove them.</p></div></aside></div>
    {editing && <div className="dialog-backdrop"><form className="dialog" onSubmit={submit}><div className="eyebrow">Stored only in this browser</div><h2>{editing.id ? 'Edit student' : 'Add a student'}</h2><div className="field"><label>Full name *</label><input name="fullName" className="input" required defaultValue={editing.fullName} autoFocus /></div><div className="field"><label>Class / section</label><input name="classSection" className="input" defaultValue={editing.classSection} placeholder="e.g. Year 4 · Cedar" /></div><div className="field"><label>Roll number</label><input name="rollNumber" className="input" defaultValue={editing.rollNumber} /></div><div className="field"><label>Aliases, separated by commas</label><input name="aliases" className="input" defaultValue={editing.aliases.join(', ')} placeholder="Only if helpful when reviewing" /></div><div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" type="submit"><Save size={14} />Save student</button></div></form></div>}
    {confirmId && <div className="dialog-backdrop"><section className="dialog" role="alertdialog"><h2>Remove this student?</h2><p>This removes the local roster entry. It does not change any meeting notes already saved.</p><div className="dialog-actions"><button className="btn btn-secondary" onClick={() => setConfirmId('')}>Cancel</button><button className="btn btn-danger" onClick={() => { deleteStudent(confirmId); setConfirmId(''); notice('Student removed from local roster.'); }}>Remove student</button></div></section></div>}
  </main>;
}

export function SettingsPage() {
  const { meetings, students, clearAll, notice } = useWorkspace();
  const providers = useGetTranscriptionProviders();
  const [confirmClear, setConfirmClear] = useState(false);
  const [model, setModel] = useState<WhisperModelKey>(savedWhisperModel);
  const providerRows = providers.data?.providers ?? [];
  const recordBytes = meetings.reduce((total, item) => total + item.sizeBytes, 0);
  return <main className="page"><div className="eyebrow">Control where information goes</div><h1 className="page-title">Privacy &amp; settings</h1><p className="page-intro">Local storage is the default. Cloud transcription is optional and only starts after you choose a provider and confirm the upload.</p>
    <div className="settings-grid"><section style={{ display: 'grid', gap: 16 }}>
      <div className="card setting-card"><div className="privacy-mark" style={{ color: 'hsl(var(--primary))' }}><LockKeyhole size={15} />Local by default</div><h3>Your browser is the workspace</h3><p>Audio recordings are held in IndexedDB; meeting notes and roster entries are held in this browser’s local storage. They are not synced to an account or sent to a server as you review them. Clearing browser data may remove them.</p><div className="field"><label htmlFor="whisper-model">Local multilingual Whisper model</label><select id="whisper-model" className="select" value={model} onChange={(e) => { const next = e.target.value as WhisperModelKey; setModel(next); localStorage.setItem('ptm-whisper-model-v1', JSON.stringify(next)); notice('Model saved. It will be used for the next local transcription.'); }} data-testid="select-whisper-model">{Object.entries(WHISPER_MODELS).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}</select><p>The first use downloads model files into this browser’s cache. Audio is processed on this device. Tiny is the lowest-memory option; Base is the starting point for an 8 GB Apple-silicon Mac. Larger models can use considerably more memory.</p></div><div className="setting-row"><div><strong style={{ fontSize: 12 }}>Local browser processing</strong><p>Whisper detects the spoken language and transcribes without translating. Local speaker labels and word-confidence scores are not provided.</p></div><span className="status-pill">On-device processing</span></div></div>
      <div className="card setting-card"><div className="panel-head"><div><div className="eyebrow">Optional · explicit upload</div><h3>Cloud providers</h3></div><button className="btn btn-secondary" onClick={() => void providers.refetch()} data-testid="button-refresh-providers">Refresh</button></div><p>Provider credentials remain server-side. This browser never displays or stores API keys. Review each provider’s privacy and retention terms before use.</p>
        {providers.isLoading ? <div className="setting-row"><div style={{ height: 12, width: 180, background: 'hsl(var(--muted))', borderRadius: 4 }} /><div style={{ height: 22, width: 70, background: 'hsl(var(--muted))', borderRadius: 20 }} /></div> : providers.isError ? <div className="uncertainty" role="alert"><AlertCircle size={15} />Could not load provider availability. Your local recordings are unaffected. <button className="btn btn-quiet" onClick={() => void providers.refetch()}>Retry</button></div> : providerRows.length ? providerRows.map((p) => <div className="setting-row" key={p.id}><div><strong style={{ fontSize: 12 }}>{p.name}</strong><p>{p.model} · {p.supportsWordTimestamps ? 'word timestamps available' : 'word timestamps not provided'} · {p.supportsDiarization ? 'speaker separation available' : 'no speaker separation'}</p><p>Upload limit: {bytes(p.maxUploadBytes)} · <a href={p.pricingUrl} target="_blank" rel="noreferrer">Provider model and pricing details</a></p></div><span className={`status-pill ${p.configured ? '' : 'review'}`}>{p.configured ? 'Available' : 'Not configured'}</span></div>) : <div className="empty-state" style={{ padding: 28 }}><h3>No providers reported</h3><p>Local notes and transcript editing remain available.</p></div>}
      </div>
    </section><aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}><div className="card setting-card"><div className="privacy-mark" style={{ color: 'hsl(var(--primary))' }}><HardDrive size={15} />Browser storage</div><h3>Stored on this device</h3><div className="setting-row"><span className="meeting-meta">Meeting records</span><strong className="mono" style={{ fontSize: 12 }}>{meetings.length}</strong></div><div className="setting-row"><span className="meeting-meta">Audio file sizes</span><strong className="mono" style={{ fontSize: 12 }}>{bytes(recordBytes)}</strong></div><div className="setting-row"><span className="meeting-meta">Roster entries</span><strong className="mono" style={{ fontSize: 12 }}>{students.length}</strong></div><p style={{ marginTop: 14 }}>Storage estimate covers file sizes, not browser database overhead.</p><button className="btn btn-danger" style={{ width: '100%', marginTop: 17 }} onClick={() => setConfirmClear(true)} data-testid="button-clear-storage"><Trash2 size={14} />Clear all local records</button></div><div className="card setting-card"><div className="privacy-mark" style={{ color: 'hsl(var(--primary))' }}><CircleHelp size={15} />Honest transcription</div><p>Confidence marks and timed segments appear only when the selected provider returns them. Speaker labels are never treated as verified identities. Review names against the recording.</p></div></aside></div>
    {confirmClear && <div className="dialog-backdrop"><section className="dialog" role="alertdialog"><div className="eyebrow">Permanent local deletion</div><h2>Clear all records?</h2><p>This removes every saved meeting, audio recording, summary, and student from this browser. This cannot be undone.</p><div className="dialog-actions"><button className="btn btn-secondary" onClick={() => setConfirmClear(false)}>Cancel</button><button className="btn btn-danger" onClick={() => { clearAll(); setConfirmClear(false); notice('All local meeting and roster data cleared.'); }}>Clear all records</button></div></section></div>}
  </main>;
}
