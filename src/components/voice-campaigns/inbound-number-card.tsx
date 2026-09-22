"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, PhoneIncoming } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";

/**
 * Inbound card on the campaign studio's right panel: point one of the account's
 * DIDs at THIS campaign, so a caller dialing it gets the same script and
 * workflow authored on this page (mode "campaign-script").
 *
 * Activation is a real product action — the API repoints the number at our XML
 * app in Plivo and remembers the app to roll back to on pause.
 */

interface InboundNumber {
  number: string;
  alias: string | null;
  live: boolean;
  mode: string | null;
  campaignId: string | null;
  campaignName: string | null;
  greeting: string | null;
}

/** E.164 for display: leading `+`, digits grouped in fours from the right. */
function formatNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 4) {
    groups.unshift(digits.slice(Math.max(0, end - 4), end));
  }
  return `+${groups.join(" ")}`;
}

export function InboundNumberCard({ campaignId }: { campaignId?: string }) {
  const [numbers, setNumbers] = useState<InboundNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [greeting, setGreeting] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ numbers: InboundNumber[] }>("/api/voice/numbers", { skipModel: true });
      setNumbers(data.numbers);
      // Preselect whichever number already answers as this campaign, else keep
      // the user's choice, else the first free number.
      setSelected((prev) => {
        const mine = data.numbers.find((n) => n.live && n.campaignId === campaignId);
        if (mine) {
          setGreeting(mine.greeting ?? "");
          return mine.number;
        }
        return prev ?? data.numbers[0]?.number ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load numbers");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedNumber = numbers.find((n) => n.number === selected);
  // "Already answering as this campaign" requires campaign-script mode too — a
  // legacy agent-mode binding for the same campaign runs the generic inbound
  // engine, so it still needs activating.
  const boundHere = Boolean(
    selectedNumber?.live &&
      selectedNumber.campaignId === campaignId &&
      selectedNumber.mode === "campaign-script",
  );
  const boundElsewhere = Boolean(
    selectedNumber?.live && selectedNumber.campaignId && selectedNumber.campaignId !== campaignId,
  );

  const submit = useCallback(
    async (action: "activate" | "deactivate") => {
      if (!campaignId || !selected) return;
      setBusy(true);
      try {
        await apiFetch("/api/inbound-agent", {
          method: "POST",
          skipModel: true,
          body: {
            action,
            number: selected,
            campaignId,
            mode: "campaign-script",
            ...(action === "activate" && greeting.trim() ? { greeting: greeting.trim() } : {}),
          },
        });
        toast.success(
          action === "activate"
            ? `${formatNumber(selected)} now answers as this campaign`
            : `${formatNumber(selected)} paused`,
        );
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Inbound update failed");
      } finally {
        setBusy(false);
      }
    },
    [campaignId, selected, greeting, load],
  );

  return (
    <section className="border-b border-border px-5 py-5">
      <div className="mb-3">
        <p className="text-[13.5px] font-semibold text-foreground">Inbound</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Answer calls to one of your numbers with this campaign&apos;s script and workflow.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading numbers…
        </div>
      ) : error ? (
        <p className="text-xs text-muted-foreground">{error}</p>
      ) : numbers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No numbers on this account.</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-none border border-input bg-background divide-y divide-border">
            {numbers.map((n) => {
              const isSelected = n.number === selected;
              const mine = n.live && n.campaignId === campaignId && n.mode === "campaign-script";
              return (
                <button
                  key={n.number}
                  type="button"
                  onClick={() => {
                    setSelected(n.number);
                    setGreeting(n.campaignId === campaignId ? (n.greeting ?? "") : "");
                  }}
                  className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/45"
                >
                  <PhoneIncoming className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{n.alias || formatNumber(n.number)}</span>
                    {n.alias && (
                      <span className="block truncate text-[9.9px] text-muted-foreground tabular-nums">
                        {formatNumber(n.number)}
                      </span>
                    )}
                  </span>
                  {n.live && (
                    <span className="shrink-0 truncate text-[9.9px] text-muted-foreground">
                      {mine ? "Live here" : n.campaignName || "In use"}
                    </span>
                  )}
                  {isSelected && <Check className="size-3.5 shrink-0 text-foreground" />}
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Opening line</label>
            <Input
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="Auto — greets in the campaign's language"
              className="h-9 rounded-none"
            />
            <p className="mt-1.5 text-[9.9px] leading-relaxed text-muted-foreground">
              The script&apos;s outbound opener asks who it is speaking to, which does not fit a caller. Leave
              blank to greet automatically, or write the exact first line.
            </p>
          </div>

          {boundElsewhere && (
            <p className="mt-3 text-[9.9px] leading-relaxed text-muted-foreground">
              This number currently answers as{" "}
              <span className="text-foreground">{selectedNumber?.campaignName || "another campaign"}</span>.
              Activating repoints it to this one.
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={boundHere ? "outline" : "default"}
              disabled={!campaignId || !selected || busy}
              onClick={() => void submit(boundHere ? "deactivate" : "activate")}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {boundHere ? "Pause inbound" : "Activate inbound"}
            </Button>
            {!campaignId && (
              <span className="text-[9.9px] text-muted-foreground">Save the campaign first.</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
