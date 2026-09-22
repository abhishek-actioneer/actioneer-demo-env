"use client";

import { useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

interface DirectFundsCallResponse {
  callId: string;
  providerRequestId: string;
  toNumber: string;
  prewarmMs?: number;
  prewarmError?: string;
}

export default function VoiceFundsTestPage() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<DirectFundsCallResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCall() {
    if (calling) return;
    setCalling(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiFetch<DirectFundsCallResponse>("/api/voice/funds-test-call", {
        method: "POST",
        body: { phoneNumber },
        datasetId: "fundsindia",
        skipModel: true,
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start call");
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-10">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">Voice / FundsIndia</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            Direct Plivo funds call
          </h1>
        </div>

        <div className="overflow-hidden rounded-3xl border border-border/70 bg-background/75 text-foreground shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="min-w-0">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Phone number
              </span>
              <input
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
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
              {calling ? "Calling" : "Call Phone"}
            </button>
          </div>

          <div className="border-t border-border/60 px-5 py-4 text-sm text-muted-foreground">
            {result ? (
              <div className="space-y-1">
                <p className="text-foreground">Plivo call started to {result.toNumber}.</p>
                <p>callId: {result.callId}</p>
                <p>providerRequestId: {result.providerRequestId}</p>
                {result.prewarmMs !== undefined && <p>Gemini setup prewarm: {result.prewarmMs}ms</p>}
                {result.prewarmError && <p>Prewarm warning: {result.prewarmError}</p>}
              </div>
            ) : error ? (
              <p className="text-destructive">{error}</p>
            ) : (
              <p>
                This dials a real Plivo phone call with Gemini Live and FundsIndia fund lookup tools enabled.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
