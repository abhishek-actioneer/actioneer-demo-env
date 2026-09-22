"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { Loader2, Info, Check, ChevronDown, X, Copy, Mail, KeyRound, Link2, RotateCcw, Send, Ban, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Industry → label. Mirrors the onboarding sample options; the id is the dataset
// a prospect's workspace is scoped to. A prospect can be granted one or more.
const INDUSTRIES: { id: string; label: string }[] = [
  { id: "vastu-hfc", label: "Banking & Lending" },
  { id: "hdfc-creditfraud", label: "Cards & Risk" },
  { id: "yesbank-cards", label: "Cards & Payments" },
  { id: "fundsindia", label: "Wealth & AMC" },
  { id: "absli-life", label: "Life Insurance" },
  { id: "flipkart-marketplace", label: "E-commerce" },
  { id: "presto", label: "Consumer Apps & Gaming" },
  { id: "quickhelp", label: "Consumer Services" },
  { id: "healthians", label: "Diagnostics" },
  { id: "healthplus", label: "E-Pharmacy & Health" },
  { id: "suvidha-capital", label: "Consumer Finance" },
];

// Our team. Selecting one CCs their Actioneer address and names them in the body.
const DEAL_OWNERS: { name: string; email: string }[] = [
  { name: "Taha", email: "taha@actioneer.com" },
  { name: "Vivek", email: "vivek@actioneer.com" },
  { name: "Divyansh", email: "divyansh@actioneer.com" },
  { name: "Vik", email: "vik@actioneer.com" },
];

interface Cred {
  id: string;
  clerkUserId: string;
  loginEmail: string;
  password: string;
  company: string;
  industries: string[];
  championName: string;
  championEmail: string;
  dealOwnerName: string;
  dealOwnerEmail: string;
  cc: string[];
  bcc: string[];
  magicLink: string;
  magicLinkExpiresAt: string;
  status: "active" | "revoked";
  lastEmailStatus: "sent" | "failed" | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function industryLabel(id: string): string {
  return INDUSTRIES.find((i) => i.id === id)?.label ?? id;
}

/** A short, readable form of the magic link for display (the full link is copied). */
function shortMagicLink(url: string): string {
  try {
    const u = new URL(url);
    const ticket = u.searchParams.get("ticket");
    const suffix = ticket ? `?ticket=${ticket.slice(0, 8)}…` : "";
    return `${u.host}${u.pathname}${suffix}`;
  } catch {
    return url;
  }
}

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
}

export function AdminPanel() {
  const [creds, setCreds] = useState<Cred[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Form state
  const [championName, setChampionName] = useState("");
  const [championEmail, setChampionEmail] = useState("");
  const [ownerName, setOwnerName] = useState(DEAL_OWNERS[0].name);
  const [company, setCompany] = useState("");
  const [industries, setIndustries] = useState<string[]>([INDUSTRIES[0].id]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Cred | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  const owner = DEAL_OWNERS.find((o) => o.name === ownerName) ?? DEAL_OWNERS[0];

  const loadCreds = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/creds", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { creds: Cred[] };
      setCreds(data.creds);
    } catch {
      // List failing shouldn't block provisioning; leave whatever we have.
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadCreds();
  }, [loadCreds]);

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    });
  }

  function toggleIndustry(id: string) {
    setIndustries((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const canSubmit =
    championName.trim() &&
    championEmail.includes("@") &&
    company.trim() &&
    industries.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch("/api/admin/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          champion: { name: championName.trim(), email: championEmail.trim() },
          dealOwner: { name: owner.name, email: owner.email },
          company: company.trim(),
          industries,
          cc,
          bcc,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { cred?: Cred; error?: string };
      if (!res.ok || !data.cred) {
        setFormError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setCreds((prev) => [data.cred as Cred, ...prev]);
      setJustCreatedId(data.cred.id);
      // Reset prospect-specific fields; keep the deal owner for the next one.
      setChampionName("");
      setChampionEmail("");
      setCompany("");
      setCc([]);
      setBcc([]);
      setIndustries([INDUSTRIES[0].id]);
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setTestMsg("");
    try {
      const res = await fetch("/api/admin/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealOwner: { name: owner.name, email: owner.email },
          champion: { name: championName.trim(), email: championEmail.trim() },
          company: company.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setTestMsg(res.ok ? `Test invite sent to ${owner.email}.` : data.error || "Test could not be sent.");
    } catch {
      setTestMsg("Network error sending the test.");
    } finally {
      setTesting(false);
    }
  }

  async function patchCred(id: string, body: Record<string, unknown>) {
    setBusyRow(id);
    try {
      const res = await fetch(`/api/admin/creds/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { cred?: Cred; error?: string };
      if (res.ok && data.cred) {
        setCreds((prev) => prev.map((c) => (c.id === id ? (data.cred as Cred) : c)));
      } else {
        window.alert(data.error || "The action could not be completed.");
      }
    } catch {
      window.alert("Network error. Please try again.");
    } finally {
      setBusyRow(null);
    }
  }

  async function deleteCred(id: string) {
    setBusyRow(id);
    try {
      const res = await fetch(`/api/admin/creds/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCreds((prev) => prev.filter((c) => c.id !== id));
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(data.error || "Could not remove this cred.");
      }
    } catch {
      window.alert("Network error. Please try again.");
    } finally {
      setBusyRow(null);
    }
  }

  const inputCls =
    "w-full h-11 px-3.5 rounded-lg bg-background border border-border text-[13.5px] text-foreground placeholder:text-muted-foreground/70 focus:border-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/5 transition-colors";

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* Branded header — official Actioneer wordmark */}
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-8 h-16 flex items-center">
          <Image src="/actioneer-logo.svg" alt="actioneer" width={132} height={19} priority className="dark:hidden" />
          <Image src="/actioneer-logo-dark.svg" alt="actioneer" width={132} height={19} priority className="hidden dark:block" />
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Create Demo Creds</h1>
          <p className="text-[13.5px] text-muted-foreground mt-1">
            Generate a prospect workspace, credentials, and a 48-hour magic link.
          </p>
        </div>

        {/* Provision form */}
        <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card/40 p-8 mb-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            <Field label="Deal Champion Name" hint="The prospect you are sending the workspace to. We greet them by first name in the email.">
              <input className={inputCls} value={championName} onChange={(e) => setChampionName(e.target.value)} placeholder="Priya Sharma" />
            </Field>
            <Field label="Deal Champion Email" hint="Where the invite is sent. This is the prospect's own email, not their login.">
              <EmailChips
                value={championEmail ? [championEmail] : []}
                onChange={(v) => setChampionEmail(v[v.length - 1] ?? "")}
                placeholder="priya@company.com"
              />
            </Field>

            <Field label="Deal Owner" hint="Your teammate who owns this relationship. They are CC'd and named in the email as the prospect's point of contact.">
              <div className="relative">
                <select
                  className={`${inputCls} appearance-none pr-10 cursor-pointer`}
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                >
                  {DEAL_OWNERS.map((o) => (
                    <option key={o.name} value={o.name}>{o.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <p className="text-[10.8px] text-muted-foreground mt-1.5">CC: <span className="font-mono">{owner.email}</span></p>
            </Field>
            <Field label="Company Name" hint="Used to build the login address, e.g. analysis+acme@actioneer.com.">
              <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" />
            </Field>

            {/* Industry access — spans both columns */}
            <div className="md:col-span-2">
              <Label label="Industry Access" hint="Which industry workspaces the prospect can see. Pick one or more; everything else stays hidden for them." />
              <div className="flex flex-wrap gap-2 mt-2">
                {INDUSTRIES.map((i) => {
                  const active = industries.includes(i.id);
                  return (
                    <button
                      type="button"
                      key={i.id}
                      onClick={() => toggleIndustry(i.id)}
                      className={`h-10 px-4 rounded-lg text-[12.6px] font-bold border transition-colors flex items-center gap-1.5 ${
                        active
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background text-foreground border-border hover:bg-muted/50"
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5" />}
                      {i.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Field label="CC (Optional)" hint="Additional recipients on the visible To/CC line.">
              <EmailChips value={cc} onChange={setCc} placeholder="Type an email, press Enter" />
            </Field>
            <Field label="BCC (Optional)" hint="Hidden recipients. The champion and CC'd people cannot see these.">
              <EmailChips value={bcc} onChange={setBcc} placeholder="Type an email, press Enter" />
            </Field>
          </div>

          {formError && <p className="text-[12.6px] text-red-500 mt-5">{formError}</p>}

          <div className="flex flex-wrap items-center gap-3 mt-7">
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className={`h-11 px-6 rounded-lg text-[13.5px] font-bold flex items-center gap-2 transition-colors ${
                canSubmit && !submitting
                  ? "bg-foreground text-background hover:opacity-90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Generate &amp; Send Invite
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="h-11 px-5 rounded-lg text-[12.6px] font-bold border border-border text-foreground hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Send Test to {owner.name}
            </button>
          </div>

          <p className="text-[11.7px] text-muted-foreground mt-4">
            Login created as <span className="font-mono">analysis+company@actioneer.com</span>. Email sent from &quot;Divyansh from actioneer&quot;. The test goes only to the deal owner ({owner.email}) so you can preview it.
          </p>
          {testMsg && <p className="text-[11.7px] text-foreground/80 mt-2">{testMsg}</p>}
        </form>

        {/* Creds list */}
        <div className="flex items-center mb-4">
          <h2 className="text-[13.5px] font-bold">
            Provisioned Credentials{" "}
            <span className="font-normal text-muted-foreground">({creds.length})</span>
          </h2>
        </div>

        {loadingList ? (
          <div className="flex items-center gap-2 text-[12.6px] text-muted-foreground py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading
          </div>
        ) : creds.length === 0 ? (
          <div className="text-center text-[12.6px] text-muted-foreground border border-border rounded-2xl py-16">
            No credentials provisioned yet. Generate the first one above.
          </div>
        ) : (
          <div className="space-y-3">
            {creds.map((c) => (
              <div
                key={c.id}
                className={`rounded-2xl border p-5 transition-colors ${
                  c.id === justCreatedId ? "border-foreground/40 bg-card/60" : "border-border bg-card/30"
                } ${c.status === "revoked" ? "opacity-60" : ""}`}
              >
                {/* Header: company + status, then meta line */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14.4px] font-bold truncate">{c.company}</span>
                      {c.industries.map((id) => (
                        <span key={id} className="text-[9.9px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {industryLabel(id)}
                        </span>
                      ))}
                    </div>
                    <p className="text-[12.5px] text-muted-foreground mt-1.5">
                      {c.championName} · {c.championEmail} · Owner {c.dealOwnerName} · {new Date(c.createdAt).toLocaleString("en-US")}
                    </p>
                  </div>
                  <CredStatus revoked={c.status === "revoked"} email={c.lastEmailStatus} />
                </div>

                {/* Credentials: one grouped panel of copyable rows */}
                <div className="mt-4 rounded-xl border border-border bg-background divide-y divide-border overflow-hidden">
                  <CredRow icon={Mail} label="Login Email" value={c.loginEmail} onCopy={() => copy(c.loginEmail, `${c.id}-email`)} copied={copied === `${c.id}-email`} />
                  <CredRow icon={KeyRound} label="Password" value={c.password} mono onCopy={() => copy(c.password, `${c.id}-pw`)} copied={copied === `${c.id}-pw`} />
                  <CredRow
                    icon={Link2}
                    label={`Magic Link · expires ${new Date(c.magicLinkExpiresAt).toLocaleString("en-US")}`}
                    value={c.magicLink}
                    displayValue={shortMagicLink(c.magicLink)}
                    truncate
                    onCopy={() => copy(c.magicLink, `${c.id}-link`)}
                    copied={copied === `${c.id}-link`}
                  />
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <RowButton icon={RotateCcw} disabled={busyRow === c.id} onClick={() => patchCred(c.id, { action: "set-password" })}>Reset Password</RowButton>
                  <RowButton icon={Send} disabled={busyRow === c.id} onClick={() => patchCred(c.id, { action: "resend" })}>Resend Invite</RowButton>
                  {c.status === "active" ? (
                    <RowButton icon={Ban} disabled={busyRow === c.id} onClick={() => patchCred(c.id, { action: "revoke" })}>Revoke</RowButton>
                  ) : (
                    <RowButton icon={RotateCcw} disabled={busyRow === c.id} onClick={() => patchCred(c.id, { action: "reactivate" })}>Reactivate</RowButton>
                  )}
                  <RowButton icon={Trash2} disabled={busyRow === c.id} onClick={() => setDeleteTarget(c)}>Delete</RowButton>
                  {busyRow === c.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credentials?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the login for &ldquo;{deleteTarget?.company}&rdquo; and deletes the prospect&apos;s workspace access. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteCred(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InfoHint({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group/hint align-middle ml-1.5">
      <Info className="w-3.5 h-3.5 text-muted-foreground/70 cursor-help" />
      <span className="pointer-events-none absolute left-0 bottom-full mb-2 w-64 rounded-lg bg-foreground text-background text-[10.8px] leading-snug px-3 py-2 opacity-0 group-hover/hint:opacity-100 transition-opacity z-20 shadow-lg">
        {text}
      </span>
    </span>
  );
}

function Label({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="flex items-center text-[11.7px] font-bold text-foreground/80">
      {label}
      {hint && <InfoHint text={hint} />}
    </span>
  );
}

function EmailChips({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function addEmails(raw: string) {
    const next = parseEmails(raw).filter((e) => !value.includes(e));
    if (next.length) onChange([...value, ...next]);
  }
  function commit() {
    if (draft.trim()) {
      addEmails(draft);
      setDraft("");
    }
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="w-full min-h-11 px-2 py-1.5 rounded-lg bg-background border border-border flex flex-wrap items-center gap-1.5 focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-foreground/5 transition-colors">
      {value.map((email) => (
        <span
          key={email}
          className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-md bg-muted text-[11.7px] text-foreground"
        >
          {email}
          <button
            type="button"
            onClick={() => onChange(value.filter((e) => e !== email))}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${email}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (/[,;\s]/.test(t)) {
            e.preventDefault();
            addEmails(t);
          }
        }}
        placeholder={value.length ? "" : placeholder}
        className="flex-1 min-w-[140px] h-8 px-1.5 bg-transparent text-[13.5px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
      />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <Label label={label} hint={hint} />
      </div>
      {children}
    </div>
  );
}

function CredStatus({ revoked, email }: { revoked: boolean; email: "sent" | "failed" | null }) {
  let dot = "bg-muted-foreground/40";
  let text = "text-muted-foreground";
  let label = "Not Sent";
  if (revoked) {
    label = "Revoked";
  } else if (email === "failed") {
    dot = "bg-red-500";
    text = "text-red-500";
    label = "Email Failed";
  } else if (email === "sent") {
    dot = "bg-emerald-500";
    label = "Email Sent";
  }
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10.8px] font-medium px-3 py-1.5 rounded-lg border border-border ${text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function CredRow({
  icon: Icon,
  label,
  value,
  displayValue,
  mono,
  truncate,
  onCopy,
  copied,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /** Optional shorter text to show; `value` is still what gets copied. */
  displayValue?: string;
  mono?: boolean;
  truncate?: boolean;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[9.9px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-[12.6px] text-foreground ${mono ? "font-mono" : ""} ${truncate ? "truncate" : "break-all"}`}>{displayValue ?? value}</div>
      </div>
      <button
        onClick={onCopy}
        aria-label={`Copy ${label}`}
        className="shrink-0 inline-flex items-center gap-1.5 text-[10.8px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function RowButton({
  children,
  onClick,
  disabled,
  icon: Icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-9 px-3.5 rounded-lg text-[11.7px] font-bold border border-border text-foreground hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}
