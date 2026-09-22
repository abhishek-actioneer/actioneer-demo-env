"use client";

import { useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

interface CallResponse {
  callId: string;
  providerRequestId: string;
  toNumber: string;
  prewarmMs?: number;
  prewarmError?: string;
}

type Scenario = "vkyc-pending" | "pan-rejected";

const SCENARIOS = {
  "vkyc-pending": {
    label: "Video KYC Pending",
    subtitle: "Priya · Rohan · Aadhaar + PAN done · Video KYC remaining",
    description: "Dials via Plivo · Gemini Live · Hinglish / English",
    endpoint: "/api/voice/kyc-test-call",
  },
  "pan-rejected": {
    label: "PAN Image Rejected — Full Guide",
    subtitle: "Priya · Arjun · PAN blurry · Guides PAN → Selfie → Video KYC → E-sign",
    description: "Dials via Plivo · Gemini Live · Live concierge on call",
    endpoint: "/api/voice/pan-kyc-guide-call",
  },
} as const;

export default function VoiceKycDemoPage() {
  const [scenario, setScenario] = useState<Scenario>("pan-rejected");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<CallResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCall() {
    if (calling) return;
    setCalling(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiFetch<CallResponse>(SCENARIOS[scenario].endpoint, {
        method: "POST",
        body: { phoneNumber },
        skipModel: true,
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start call");
    } finally {
      setCalling(false);
    }
  }

  const active = SCENARIOS[scenario];

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-10">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">Voice / KYC Demo</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            Credit Bank — KYC Demo
          </h1>
        </div>

        {/* Scenario picker */}
        <div className="mb-4 flex gap-2">
          {(Object.entries(SCENARIOS) as [Scenario, typeof SCENARIOS[Scenario]][]).map(([key, s]) => (
            <button
              key={key}
              onClick={() => { setScenario(key); setResult(null); setError(null); }}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                scenario === key
                  ? "border-foreground bg-foreground/5 text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              <p className="text-xs font-medium">{s.label}</p>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-3xl border border-border/70 bg-background/75 text-foreground shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="px-5 pt-4 pb-1">
            <p className="text-sm font-medium text-foreground">{active.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{active.subtitle}</p>
          </div>

          <div className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="min-w-0">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Phone number
              </span>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && phoneNumber.trim().length >= 8 && !calling) void startCall();
                }}
                placeholder="+91..."
                className="mt-2 h-12 w-full rounded-2xl border border-border bg-background px-4 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/50"
              />
            </label>
            <button
              type="button"
              onClick={() => void startCall()}
              disabled={calling || phoneNumber.trim().length < 8}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition-[opacity,transform] active:scale-[0.98] disabled:cursor-default disabled:opacity-50"
            >
              {calling ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
              {calling ? "Calling…" : "Call"}
            </button>
          </div>

          <div className="border-t border-border/60 px-5 py-4 text-sm text-muted-foreground">
            {result ? (
              <div className="space-y-1">
                <p className="text-foreground">Call started to {result.toNumber}</p>
                {result.prewarmMs !== undefined && <p>Gemini prewarm: {result.prewarmMs}ms</p>}
                {result.prewarmError && <p className="text-yellow-600">Prewarm warning: {result.prewarmError}</p>}
              </div>
            ) : error ? (
              <p className="text-destructive">{error}</p>
            ) : (
              <p>{active.description}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
