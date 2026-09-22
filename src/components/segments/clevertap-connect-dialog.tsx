"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, X, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface MaskedConnection {
  accountId: string;
  apiBase: string;
  passcodeLast4: string;
  adminEmail?: string;
  testEmails?: string[];
  projectName?: string;
  region?: string;
  connectedAt: string;
}

interface Region {
  value: string;
  label: string;
  apiBase: string;
}

// Known CleverTap regional API hosts. User can override apiBase after picking.
const REGIONS: Region[] = [
  { value: "us",     label: "US (default)", apiBase: "https://api.clevertap.com" },
  { value: "eu1",    label: "EU1",          apiBase: "https://eu1-api.clevertap.com" },
  { value: "in1",    label: "IN1",          apiBase: "https://in1.api.clevertap.com" },
  { value: "sg1",    label: "SG1",          apiBase: "https://sg1.api.clevertap.com" },
  { value: "aus1",   label: "AU1",          apiBase: "https://aus1.api.clevertap.com" },
  { value: "mec1",   label: "ME1",          apiBase: "https://mec1.api.clevertap.com" },
  { value: "custom", label: "Custom",       apiBase: "" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (conn: MaskedConnection) => void;
}

export function CleverTapConnectDialog({ open, onOpenChange, onConnected }: Props) {
  const [existing, setExisting] = useState<MaskedConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [passcode, setPasscode] = useState("");
  const [region, setRegion] = useState<string>("us");
  const [apiBase, setApiBase] = useState(REGIONS[0].apiBase);
  const [adminEmail, setAdminEmail] = useState("");
  const [testEmailsText, setTestEmailsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setAccountId("");
    setPasscode("");
    setRegion("us");
    setApiBase(REGIONS[0].apiBase);
    setAdminEmail("");
    setTestEmailsText("");
    setError(null);
    setSuccess(null);
  }, []);

  // Fetch existing connection whenever dialog opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    apiFetch<{ connection: MaskedConnection | null }>("/api/integrations/clevertap", { skipModel: true })
      .then((res) => setExisting(res.connection))
      .catch(() => setExisting(null))
      .finally(() => setLoading(false));
  }, [open]);

  const handleRegionChange = (v: string) => {
    setRegion(v);
    const r = REGIONS.find((x) => x.value === v);
    if (r && r.value !== "custom") setApiBase(r.apiBase);
    else if (r && r.value === "custom" && !apiBase) setApiBase("https://");
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    const parsedTestEmails = testEmailsText
      .split(/[,\n]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    try {
      const res = await apiFetch<{ connection: MaskedConnection }>("/api/integrations/clevertap", {
        method: "POST",
        body: {
          accountId: accountId.trim(),
          passcode: passcode.trim(),
          apiBase: apiBase.trim(),
          adminEmail: adminEmail.trim() || undefined,
          testEmails: parsedTestEmails.length > 0 ? parsedTestEmails : undefined,
          region: region === "custom" ? undefined : region,
        },
        skipModel: true,
      });
      setExisting(res.connection);
      setSuccess(
        res.connection.projectName
          ? `Connected to ${res.connection.projectName}`
          : "Connected successfully",
      );
      resetForm();
      onConnected?.(res.connection);
    } catch (err) {
      setError((err as Error).message || "Failed to connect");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    setSubmitting(true);
    try {
      await apiFetch("/api/integrations/clevertap", { method: "DELETE", skipModel: true });
      setExisting(null);
      setSuccess("Disconnected");
    } catch (err) {
      setError((err as Error).message || "Failed to disconnect");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect CleverTap</DialogTitle>
          <DialogDescription>
            Your credentials are stored server-side, scoped to your account, and used only to push segments you create here.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : existing ? (
          <div className="space-y-4 text-sm">
            <div className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border">
              <Check className="h-3 w-3" />
              {existing.projectName
                ? `Connected to ${existing.projectName}`
                : "Connected"}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Account ID</dt>
              <dd className="font-mono">{existing.accountId}</dd>
              <dt className="text-muted-foreground">Passcode</dt>
              <dd className="font-mono">••••{existing.passcodeLast4}</dd>
              <dt className="text-muted-foreground">API base</dt>
              <dd className="font-mono break-all">{existing.apiBase}</dd>
              {existing.region && (
                <>
                  <dt className="text-muted-foreground">Region</dt>
                  <dd className="uppercase">{existing.region}</dd>
                </>
              )}
              {existing.adminEmail && (
                <>
                  <dt className="text-muted-foreground">Admin email</dt>
                  <dd>{existing.adminEmail}</dd>
                </>
              )}
              {existing.testEmails && existing.testEmails.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Test recipients</dt>
                  <dd className="break-all">{existing.testEmails.join(", ")}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Connected</dt>
              <dd>{new Date(existing.connectedAt).toLocaleString()}</dd>
            </dl>
            {success && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border">
                <Check className="h-3 w-3" /> {success}
              </div>
            )}
            {error && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-border text-foreground">
                <X className="h-3 w-3" /> {error}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Disconnect
              </button>
              <button
                type="button"
                onClick={() => {
                  setAccountId(existing.accountId);
                  setApiBase(existing.apiBase);
                  setAdminEmail(existing.adminEmail ?? "");
                  setTestEmailsText((existing.testEmails ?? []).join(", "));
                  setRegion(existing.region ?? "custom");
                  setPasscode("");
                  setError(null);
                  setSuccess(null);
                  setExisting(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted"
              >
                Reconfigure
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleConnect} className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Account ID</label>
              <Input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="Z44-Z49-677Z"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Passcode</label>
              <Input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Project passcode"
                required
              />
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Region</label>
                <Select value={region} onValueChange={handleRegionChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">API base</label>
                <Input
                  value={apiBase}
                  onChange={(e) => {
                    setApiBase(e.target.value);
                    setRegion("custom");
                  }}
                  placeholder="https://api.clevertap.com"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Admin email <span className="text-muted-foreground/70">(optional, required for Custom List Segment API)</span>
              </label>
              <Input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Test recipients <span className="text-muted-foreground/70">(comma or newline separated. These emails will be tagged into every pushed segment and receive campaign sends)</span>
              </label>
              <textarea
                value={testEmailsText}
                onChange={(e) => setTestEmailsText(e.target.value)}
                placeholder="alice@company.com, bob@company.com"
                rows={2}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {error && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-border text-foreground">
                <X className="h-3 w-3" /> {error}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border bg-foreground text-background hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Test &amp; Connect
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
