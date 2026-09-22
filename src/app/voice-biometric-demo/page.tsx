"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic2, ShieldCheck, Trash2, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

const DATASET_ID = "hdfc-creditfraud";

type Enrollment = {
  subjectId: string;
  displayName: string;
  consentedAt: string;
  active: boolean;
  profile: { balanceInr: number; accountNumberMasked: string };
};

type IdentifyResponse = {
  status: string;
  duration_s: number;
  gallery_size?: number;
  matches: Array<{ subjectId: string | null; displayName: string | null; similarity: number }>;
  identifiedProfile: null | {
    displayName: string;
    balanceInr: number;
    accountNumberMasked: string;
    recentTransactions: Array<{ label: string; amountInr: number }>;
  };
};

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const block = 0x8000;
  for (let index = 0; index < bytes.length; index += block) {
    binary += String.fromCharCode(...bytes.subarray(index, index + block));
  }
  return btoa(binary);
}

function pcmToWav(chunks: Float32Array[], sampleRate: number): Blob {
  const sampleCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export default function VoiceBiometricDemoPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [balance, setBalance] = useState("125000");
  const [files, setFiles] = useState<File[]>([]);
  const [testFile, setTestFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IdentifyResponse | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<"enroll" | "test" | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const recordingChunksRef = useRef<Float32Array[]>([]);

  const refresh = useCallback(async () => {
    const data = await apiFetch<{ enrollments: Enrollment[] }>("/api/voice-biometric/enrollments", {
      datasetId: DATASET_ID,
      skipModel: true,
    });
    setEnrollments(data.enrollments);
  }, []);

  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);
  useEffect(() => () => {
    processorRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close();
  }, []);

  async function startRecording(target: "enroll" | "test") {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      recordingChunksRef.current = [];
      processor.onaudioprocess = (event) => {
        recordingChunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(context.destination);
      audioContextRef.current = context;
      mediaStreamRef.current = stream;
      processorRef.current = processor;
      setRecordingTarget(target);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Microphone access failed");
    }
  }

  async function stopRecording() {
    const target = recordingTarget;
    const context = audioContextRef.current;
    processorRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (context) await context.close();
    const blob = pcmToWav(recordingChunksRef.current, context?.sampleRate ?? 48000);
    const file = new File([blob], `${target ?? "voice"}-${Date.now()}.wav`, { type: "audio/wav" });
    if (target === "enroll") setFiles((current) => [...current, file].slice(0, 5));
    if (target === "test") setTestFile(file);
    audioContextRef.current = null;
    mediaStreamRef.current = null;
    processorRef.current = null;
    setRecordingTarget(null);
  }

  async function enroll() {
    setBusy("enroll");
    setError(null);
    try {
      const wavBase64List = await Promise.all(files.map(fileToBase64));
      await apiFetch("/api/voice-biometric/enrollments", {
        method: "POST",
        datasetId: DATASET_ID,
        skipModel: true,
        body: {
          subjectId: subjectId.trim(),
          displayName: displayName.trim(),
          consented: true,
          wavBase64List,
          balanceInr: Number(balance),
        },
      });
      setSubjectId("");
      setDisplayName("");
      setFiles([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enrollment failed");
    } finally {
      setBusy(null);
    }
  }

  async function identify() {
    if (!testFile) return;
    setBusy("identify");
    setError(null);
    setResult(null);
    try {
      const response = await apiFetch<IdentifyResponse>("/api/voice-biometric/identify", {
        method: "POST",
        datasetId: DATASET_ID,
        skipModel: true,
        body: { wavBase64: await fileToBase64(testFile) },
      });
      setResult(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Identification failed");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(subject: string) {
    setBusy(`delete:${subject}`);
    setError(null);
    try {
      await apiFetch("/api/voice-biometric/enrollments", {
        method: "DELETE",
        datasetId: DATASET_ID,
        skipModel: true,
        body: { subjectId: subject },
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Deletion failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div>
            <p className="text-sm text-muted-foreground">Voice / Biometrics</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Banking voice identification demo</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Enroll consented WAV recordings, then test open-set identification against the active gallery.
              The profile below is synthetic and this page does not claim production-grade authentication.
            </p>
          </div>
          <div className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">
            {enrollments.filter((row) => row.active).length} active profiles
          </div>
        </div>

        {error && <div className="mb-5 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="border border-border bg-card p-5">
            <div className="mb-5 flex items-center gap-2">
              <Upload className="size-4" />
              <h2 className="font-medium">1. Enroll a speaker</h2>
            </div>
            <div className="grid gap-4">
              <label className="text-sm">Subject ID
                <input value={subjectId} onChange={(event) => setSubjectId(event.target.value)} placeholder="demo-user-01" className="mt-1.5 h-10 w-full border border-border bg-background px-3 outline-none focus:border-foreground/50" />
              </label>
              <label className="text-sm">Display name
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Aarav" className="mt-1.5 h-10 w-full border border-border bg-background px-3 outline-none focus:border-foreground/50" />
              </label>
              <label className="text-sm">Mock balance (₹)
                <input type="number" value={balance} onChange={(event) => setBalance(event.target.value)} className="mt-1.5 h-10 w-full border border-border bg-background px-3 outline-none focus:border-foreground/50" />
              </label>
              <label className="text-sm">Two to five WAV recordings
                <input type="file" accept="audio/wav,.wav" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} className="mt-1.5 block w-full text-sm text-muted-foreground file:mr-3 file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-foreground" />
              </label>
              <button type="button" onClick={() => recordingTarget ? void stopRecording() : void startRecording("enroll")} disabled={recordingTarget === "test"} className="h-10 border border-border px-4 text-sm disabled:opacity-40">
                {recordingTarget === "enroll" ? "Stop and add recording" : `Record enrollment sample (${files.length}/5)`}
              </button>
              <p className="text-xs leading-5 text-muted-foreground">By enrolling, you confirm the participant consented to this demo. Use separate recordings with at least a few seconds of clear speech each.</p>
              <button type="button" onClick={() => void enroll()} disabled={busy !== null || !/^[a-zA-Z0-9_-]{2,64}$/.test(subjectId) || !displayName.trim() || files.length < 2 || files.length > 5} className="flex h-10 items-center justify-center gap-2 bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40">
                {busy === "enroll" && <Loader2 className="size-4 animate-spin" />} Enroll voice
              </button>
            </div>
          </section>

          <section className="border border-border bg-card p-5">
            <div className="mb-5 flex items-center gap-2">
              <Mic2 className="size-4" />
              <h2 className="font-medium">2. Identify a test recording</h2>
            </div>
            <label className="text-sm">Fresh WAV recording
              <input type="file" accept="audio/wav,.wav" onChange={(event) => setTestFile(event.target.files?.[0] ?? null)} className="mt-1.5 block w-full text-sm text-muted-foreground file:mr-3 file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-foreground" />
            </label>
            <button type="button" onClick={() => recordingTarget ? void stopRecording() : void startRecording("test")} disabled={recordingTarget === "enroll"} className="mt-3 h-10 w-full border border-border px-4 text-sm disabled:opacity-40">
              {recordingTarget === "test" ? "Stop test recording" : testFile ? "Replace with microphone recording" : "Record from microphone"}
            </button>
            <button type="button" onClick={() => void identify()} disabled={busy !== null || !testFile || enrollments.length === 0} className="mt-4 flex h-10 w-full items-center justify-center gap-2 bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40">
              {busy === "identify" && <Loader2 className="size-4 animate-spin" />} Identify speaker
            </button>

            {result && (
              <div className="mt-5 border-t border-border pt-4 text-sm">
                <div className="flex items-center gap-2"><ShieldCheck className="size-4" /><span className="font-medium">Result: {result.status}</span></div>
                <p className="mt-1 text-xs text-muted-foreground">{result.duration_s}s analyzed · gallery {result.gallery_size ?? enrollments.length}</p>
                {result.matches.slice(0, 3).map((match, index) => (
                  <div key={`${match.subjectId}-${index}`} className="mt-2 flex justify-between border-b border-border/60 pb-2">
                    <span>{match.displayName ?? "Unknown enrollment"}</span><span className="font-mono">{match.similarity.toFixed(3)}</span>
                  </div>
                ))}
                {result.identifiedProfile && (
                  <div className="mt-4 bg-muted/40 p-4">
                    <p className="font-medium">{result.identifiedProfile.displayName}</p>
                    <p className="mt-1 text-muted-foreground">Account {result.identifiedProfile.accountNumberMasked}</p>
                    <p className="mt-3 text-xl font-semibold">₹{result.identifiedProfile.balanceInr.toLocaleString("en-IN")}</p>
                    <p className="text-xs text-muted-foreground">Mock available balance</p>
                    <div className="mt-4 border-t border-border pt-3">
                      {result.identifiedProfile.recentTransactions.map((transaction) => (
                        <div key={`${transaction.label}-${transaction.amountInr}`} className="flex justify-between gap-3 py-1 text-xs">
                          <span className="text-muted-foreground">{transaction.label}</span>
                          <span className="font-mono">{transaction.amountInr < 0 ? "−" : "+"}₹{Math.abs(transaction.amountInr).toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="mt-6 border border-border bg-card">
          <div className="border-b border-border px-5 py-4"><h2 className="font-medium">Enrollment gallery</h2></div>
          {enrollments.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No consented speakers enrolled yet.</p> : enrollments.map((row) => (
            <div key={row.subjectId} className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3 last:border-b-0">
              <div><p className="text-sm font-medium">{row.displayName}</p><p className="text-xs text-muted-foreground">{row.subjectId} · {row.profile.accountNumberMasked}</p></div>
              <button type="button" aria-label={`Delete ${row.displayName}`} onClick={() => void revoke(row.subjectId)} disabled={busy !== null} className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-40">
                {busy === `delete:${row.subjectId}` ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </button>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
