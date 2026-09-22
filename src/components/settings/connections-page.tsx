"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight, CheckCircle2, Eye, EyeOff, Loader2,
  MessageSquare, Globe, Mail, BarChart3, Database, XCircle, Trash2, RefreshCw, Search, Wrench,
  PhoneCall, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { TenantConnection, ConnectionType } from "@/lib/tenant-connections-store";

// ---------------------------------------------------------------------------
// Per-channel form config
// ---------------------------------------------------------------------------

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  options?: Array<{ label: string; value: string }>;
  secret?: boolean;
  optional?: boolean;
  multiline?: boolean;
  hint?: string;
  group?: "connection" | "send";
}

interface WhatsAppTemplateOption {
  id: string;
  name: string;
  status?: string;
  category?: string;
  type?: string;
  languageCode?: string;
  body?: string;
  parameterCount: number;
  defaultParams: string[];
}

interface WhatsAppMessageStatusRecord {
  status: string;
  updatedAt: string;
  errorCode?: string;
  errorReason?: string;
}

const CHANNEL_FIELDS: Partial<Record<ConnectionType, FieldDef[]>> = {
  cdp: [
    { key: "profileServiceUrl", label: "Base URL", placeholder: "http://10.2.0.192:8080" },
    { key: "tenantId", label: "Tenant ID", placeholder: "liquide", hint: "Must match the CDP tenant exactly" },
    { key: "appId", label: "App ID", placeholder: "115" },
    { key: "authenticatedHeader", label: "X-Authenticated", placeholder: "true", optional: true, hint: "Leave blank to send true" },
    { key: "apiToken", label: "API token", placeholder: "Optional bearer token", secret: true, optional: true },
  ],
  sms: [
    { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    { key: "authToken", label: "Auth Token", placeholder: "Your Twilio auth token", secret: true },
    { key: "from", label: "From number", placeholder: "+14155550123", hint: "Must be a Twilio-provisioned number" },
  ],
  whatsapp: [
    {
      key: "templateApiMode",
      label: "Template API",
      placeholder: "Account API",
      optional: true,
      options: [
        { label: "Account API (apikey)", value: "account" },
        { label: "Partner API (token)", value: "partner" },
      ],
      hint: "Use Partner API if template fetch with the account API key fails.",
    },
    { key: "appId", label: "Gupshup App ID", placeholder: "Gupshup app ID", hint: "Use the Gupshup app ID from the Gupshup app settings/API page. This is not the WABA ID, Phone Number ID, or Namespace." },
    { key: "apiKey", label: "API key", placeholder: "Gupshup API key", optional: true, secret: true, hint: "Required for Account API template fetch and for sending messages." },
    { key: "partnerToken", label: "Partner token", placeholder: "Gupshup partner token", optional: true, secret: true, hint: "Required only when Template API is Partner API." },
    { key: "source", label: "Source number", placeholder: "919876543210", optional: true, group: "send", hint: "Needed for sending. Use the WhatsApp Business number connected to the Gupshup app" },
    { key: "appName", label: "App name", placeholder: "Your Gupshup app name", optional: true, group: "send", hint: "Needed for sending templates through Gupshup" },
    {
      key: "templateParams",
      label: "Default params JSON",
      placeholder: "[\"{message}\"]",
      optional: true,
      multiline: true,
      group: "send",
      hint: "JSON array or object in the approved text template placeholder order. Use [\"{message}\"] when the template has one body variable.",
    },
  ],
  plivo: [
    { key: "authId", label: "Auth ID", placeholder: "Your Plivo Auth ID" },
    { key: "authToken", label: "Auth token", placeholder: "Your Plivo Auth token", secret: true },
    { key: "from", label: "Plivo number", placeholder: "+14155550123", hint: "The Plivo number used for outbound calls." },
  ],
  exotel: [
    { key: "accountSid", label: "Account SID", placeholder: "Your Exotel Account SID" },
    { key: "apiKey", label: "API key", placeholder: "Your Exotel API key", secret: true },
    { key: "apiToken", label: "API token", placeholder: "Your Exotel API token", secret: true },
    { key: "from", label: "ExoPhone", placeholder: "Your Exotel virtual number" },
    { key: "subdomain", label: "API subdomain", placeholder: "api.in.exotel.com", optional: true },
  ],
  zoho: [
    { key: "clientId", label: "Client ID", placeholder: "Zoho OAuth client ID" },
    { key: "clientSecret", label: "Client secret", placeholder: "Zoho OAuth client secret", secret: true },
    { key: "refreshToken", label: "Refresh token", placeholder: "Zoho OAuth refresh token", secret: true },
    { key: "apiDomain", label: "API domain", placeholder: "https://www.zohoapis.in", optional: true },
    { key: "accountsDomain", label: "Accounts domain", placeholder: "https://accounts.zoho.in", optional: true },
  ],
};

const CHANNEL_ICON: Record<ConnectionType, React.ComponentType<{ className?: string }>> = {
  cdp: Database,
  sms: MessageSquare,
  whatsapp: Globe,
  email: Mail,
  hubspot: BarChart3,
  plivo: PhoneCall,
  exotel: PhoneCall,
  zoho: Building2,
};

const CONNECTION_DESCRIPTION: Record<ConnectionType, string> = {
  cdp: "Use customer profiles and audience data across campaigns and analysis.",
  sms: "Send campaign follow-ups and transactional messages through Twilio.",
  whatsapp: "Send approved WhatsApp templates and post-call follow-ups with Gupshup.",
  email: "Send email follow-ups and campaign notifications from your workspace.",
  hubspot: "Sync contacts, campaign activity, and outcomes with your CRM.",
  plivo: "Place outbound campaign calls through the workspace's configured Plivo account.",
  exotel: "Connect an Exotel account for outbound calling and Indian telephony workflows.",
  zoho: "Sync call summaries, outcomes, notes, and follow-up tasks with Zoho CRM.",
};

function looksLikeGupshupNamespace(value: string | undefined): boolean {
  return /^[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$/i.test(value?.trim() ?? "");
}

// ---------------------------------------------------------------------------
// Credential form drawer
// ---------------------------------------------------------------------------

function CredentialDrawer({
  conn,
  open,
  onClose,
  onSaved,
}: {
  conn: TenantConnection;
  open: boolean;
  onClose: () => void;
  onSaved: (connections: TenantConnection[]) => void;
}) {
  const fields = CHANNEL_FIELDS[conn.type] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [templateState, setTemplateState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [templateMsg, setTemplateMsg] = useState("");
  const [templates, setTemplates] = useState<WhatsAppTemplateOption[]>([]);
  const [testRecipient, setTestRecipient] = useState("");
  const [testMessage, setTestMessage] = useState("Test message from Actioneer");
  const [sendState, setSendState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [sendMsg, setSendMsg] = useState("");
  const [lastTestMessageId, setLastTestMessageId] = useState("");
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const hasConfiguredSecret = (key: string) => conn.configuredSecretKeys?.includes(key) ?? false;
  const fieldHasValue = (key: string) => Boolean(values[key]?.trim() || hasConfiguredSecret(key));

  // Reset form when drawer opens for a new channel
  useEffect(() => {
    if (open) {
      setValues({
        ...(conn.type === "whatsapp" ? { templateApiMode: "account" } : {}),
        ...(conn.prefill ?? {}),
      });
      setShown({});
      setTestState("idle");
      setTestMsg("");
      setTemplateState("idle");
      setTemplateMsg("");
      setTemplates([]);
      setTestRecipient("");
      setTestMessage("Test message from Actioneer");
      setSendState("idle");
      setSendMsg("");
      setLastTestMessageId("");
      setTimeout(() => firstRef.current?.focus(), 80);
    }
  }, [open, conn.type, conn.prefill]);

  useEffect(() => {
    if (!lastTestMessageId || sendState !== "ok") return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pollStatus() {
      attempts += 1;
      try {
        const data = await apiFetch<{ status?: WhatsAppMessageStatusRecord }>(
          `/api/connections/whatsapp/test-message?messageId=${encodeURIComponent(lastTestMessageId)}`,
          { skipModel: true },
        );
        if (cancelled) return;
        const latest = data.status;
        if (latest) {
          const error = latest.errorReason
            ? ` — ${latest.errorCode ? `${latest.errorCode}: ` : ""}${latest.errorReason}`
            : "";
          setSendMsg(`Latest status — ${latest.status}${error}`);
          if (["failed", "delivered", "read"].includes(latest.status)) return;
        }
      } catch {
        // Keep the submitted state visible; polling is best-effort.
      }
      if (!cancelled && attempts < 20) {
        timer = setTimeout(pollStatus, 3000);
      }
    }

    timer = setTimeout(pollStatus, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [lastTestMessageId, sendState]);

  const templateApiMode = values.templateApiMode === "partner" ? "partner" : "account";
  const requiredConnectionFieldsFilled = conn.type === "whatsapp"
    ? Boolean(
        values.appId?.trim() &&
          (templateApiMode === "partner" ? fieldHasValue("partnerToken") : fieldHasValue("apiKey")),
      )
    : fields
        .filter((field) => field.group !== "send" && !field.optional)
        .every((field) => fieldHasValue(field.key));
  const canTestConnection = requiredConnectionFieldsFilled && ["cdp", "sms", "whatsapp", "plivo"].includes(conn.type);
  const canSave = requiredConnectionFieldsFilled;
  const canFetchTemplates = conn.type === "whatsapp" && requiredConnectionFieldsFilled;
  const canSendTestMessage = conn.type === "whatsapp" &&
    Boolean(
      fieldHasValue("apiKey") &&
        values.source?.trim() &&
        values.appName?.trim() &&
        values.templateId?.trim() &&
        testRecipient.trim(),
    );

  function validateWhatsAppParamsJson(): boolean {
    if (conn.type !== "whatsapp") return true;
    const raw = values.templateParams?.trim();
    if (!raw) return true;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) && (!parsed || typeof parsed !== "object")) {
        throw new Error("Params must be a JSON array or object");
      }
      return true;
    } catch (err) {
      setTestState("error");
      setTestMsg(err instanceof Error ? err.message : "Params must be valid JSON");
      return false;
    }
  }

  function validateWhatsAppTemplateFetchFields(): boolean {
    if (conn.type !== "whatsapp") return true;
    if (looksLikeGupshupNamespace(values.appId)) {
      const message = "This looks like the Gupshup Namespace, not the Gupshup App ID. Use the appId required by Gupshup's template API, or switch to Partner API with a partner token.";
      setTemplateState("error");
      setTemplateMsg(message);
      setTestState("error");
      setTestMsg(message);
      return false;
    }
    return true;
  }

  async function handleTest() {
    if (!validateWhatsAppParamsJson()) return;
    if (!validateWhatsAppTemplateFetchFields()) return;
    setTestState("testing");
    setTestMsg("");
    try {
      const data = await apiFetch<{ ok: boolean; accountName?: string; error?: string }>(`/api/connections/${conn.type}/test`, {
        method: "POST",
        body: values,
        skipModel: true,
      });
      if (data.ok) {
        setTestState("ok");
        setTestMsg(data.accountName ? `Connected — ${data.accountName}` : "Connection successful");
      } else {
        setTestState("error");
        setTestMsg(data.error ?? "Connection failed");
      }
    } catch {
      setTestState("error");
      setTestMsg("Network error — check your connection");
    }
  }

  async function handleFetchTemplates() {
    if (!validateWhatsAppTemplateFetchFields()) return;
    setTemplateState("loading");
    setTemplateMsg("");
    try {
      const data = await apiFetch<{ templates?: WhatsAppTemplateOption[] }>("/api/connections/whatsapp/templates", {
        method: "POST",
        body: values,
        skipModel: true,
      });
      const nextTemplates = data.templates ?? [];
      setTemplates(nextTemplates);
      setTemplateState("ok");
      setTemplateMsg(nextTemplates.length > 0
        ? `${nextTemplates.length} template${nextTemplates.length === 1 ? "" : "s"} found`
        : "No templates found");
    } catch (err) {
      setTemplates([]);
      setTemplateState("error");
      setTemplateMsg(err instanceof Error ? err.message : "Failed to fetch templates");
    }
  }

  function isSelectableWhatsAppTemplate(template: WhatsAppTemplateOption): boolean {
    const status = (template.status ?? "").toUpperCase();
    const type = (template.type ?? "").toUpperCase();
    return status === "APPROVED" && (!type || type === "TEXT");
  }

  function handleUseTemplate(template: WhatsAppTemplateOption) {
    if (!isSelectableWhatsAppTemplate(template)) {
      setTestState("error");
      setTestMsg("Only approved text templates can be selected for sending");
      return;
    }
    setValues((current) => ({
      ...current,
      templateId: template.id,
      templateParams: JSON.stringify(template.defaultParams),
    }));
    setTestState("idle");
    setTestMsg("");
    setSendState("idle");
    setSendMsg("");
  }

  async function handleSendTestMessage() {
    if (!validateWhatsAppParamsJson()) return;
    setSendState("sending");
    setSendMsg("");
    setLastTestMessageId("");
    try {
      const data = await apiFetch<{ ok: boolean; messageId?: string; status?: string; error?: string }>(
        "/api/connections/whatsapp/test-message",
        {
          method: "POST",
          body: {
            ...values,
            to: testRecipient,
            message: testMessage,
          },
          skipModel: true,
        },
      );
      if (data.ok) {
        const label = [data.status, data.messageId].filter(Boolean).join(" / ");
        setSendState("ok");
        setSendMsg(label ? `Submitted — ${label}` : "Submitted to Gupshup");
        setLastTestMessageId(data.messageId ?? "");
      } else {
        setSendState("error");
        setSendMsg(data.error ?? "Failed to send test message");
      }
    } catch (err) {
      setSendState("error");
      setSendMsg(err instanceof Error ? err.message : "Failed to send test message");
    }
  }

  async function handleSave() {
    if (!validateWhatsAppParamsJson()) return;
    setSaving(true);
    try {
      const data = await apiFetch<{ connections?: TenantConnection[] }>("/api/connections", {
        method: "POST",
        body: { type: conn.type, provider: conn.provider, credentials: values },
        skipModel: true,
      });
      if (data.connections) onSaved(data.connections);
      onClose();
    } catch {
      // noop — keep drawer open
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          "fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[100vw] flex-col border-l border-border bg-background sm:w-[560px] xl:w-[600px]",
          "transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-sm font-semibold">{conn.status === "connected" ? "Manage" : "Connect"} {conn.provider || conn.label}</p>
            {conn.provider !== conn.label && <p className="text-xs text-muted-foreground mt-0.5">{conn.label}</p>}
          </div>
          <button onClick={onClose} aria-label="Close connection settings" className="flex size-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground">
            <XCircle className="size-5" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {conn.source === "environment" && (conn.status === "connected" || Object.keys(conn.prefill ?? {}).length > 0) && (
            <div className="border border-border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
              Safe account details are prefilled from the workspace environment. Secret values stay server-side and are never sent to the browser.
            </div>
          )}
          {conn.type === "whatsapp" && (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Connect with API key and App ID first, fetch approved templates, then choose the template Actioneer should use for follow-ups.
            </div>
          )}

          {fields.map((field, i) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{field.label}</label>
              {field.options ? (
                <select
                  value={values[field.key] ?? field.options[0]?.value ?? ""}
                  onChange={(e) => {
                    setValues((current) => ({ ...current, [field.key]: e.target.value }));
                    setTestState("idle");
                    setTestMsg("");
                    setTemplateState("idle");
                    setTemplateMsg("");
                    setTemplates([]);
                  }}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.multiline ? (
                <textarea
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  rows={4}
                  className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                />
              ) : (
                <div className="relative">
                  <input
                    ref={i === 0 ? firstRef : undefined}
                    type={field.secret && !shown[field.key] ? "password" : "text"}
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    placeholder={field.secret && hasConfiguredSecret(field.key) ? "Configured securely" : field.placeholder}
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm pr-9 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                  />
                  {field.secret && values[field.key] && (
                    <button
                      type="button"
                      onClick={() => setShown((s) => ({ ...s, [field.key]: !s[field.key] }))}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {shown[field.key] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  )}
                </div>
              )}
              {field.hint && (
                <p className="text-[9.9px] text-muted-foreground">{field.hint}</p>
              )}
              {field.secret && hasConfiguredSecret(field.key) && !values[field.key] && (
                <p className="text-[9.9px] text-muted-foreground">Configured securely. Enter a new value only to replace it.</p>
              )}
            </div>
          ))}

          {conn.type === "whatsapp" && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-foreground">Templates</p>
                  <p className="text-[9.9px] text-muted-foreground">
                    Import templates from this Gupshup app. Only approved text templates can be used for sending.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!canFetchTemplates || templateState === "loading"}
                  onClick={handleFetchTemplates}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {templateState === "loading" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  Fetch
                </button>
              </div>

              {templateState !== "idle" && (
                <div className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs",
                  templateState === "ok" && "border-border text-foreground bg-muted/20",
                  templateState === "error" && "border-destructive/30 text-destructive bg-destructive/5",
                  templateState === "loading" && "border-border text-muted-foreground",
                )}>
                  {templateState === "loading" && <Loader2 className="size-3 animate-spin shrink-0" />}
                  {templateState === "ok" && <CheckCircle2 className="size-3 shrink-0" />}
                  {templateState === "error" && <XCircle className="size-3 shrink-0" />}
                  <span>{templateState === "loading" ? "Fetching templates…" : templateMsg}</span>
                </div>
              )}

              {templates.length > 0 && (
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      disabled={!isSelectableWhatsAppTemplate(template)}
                      onClick={() => handleUseTemplate(template)}
                      className={cn(
                        "w-full rounded-md border border-border px-3 py-2 text-left transition-colors",
                        values.templateId === template.id
                          ? "bg-foreground text-background border-foreground"
                          : "hover:border-foreground/40",
                        !isSelectableWhatsAppTemplate(template) && "opacity-60 cursor-not-allowed hover:border-border",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-medium">{template.name}</span>
                        {template.status && (
                          <span className={cn(
                            "shrink-0 rounded-full border px-1.5 py-0.5 text-[8.1px] uppercase",
                            values.templateId === template.id ? "border-background/30" : "border-border text-muted-foreground",
                          )}>
                            {template.status}
                          </span>
                        )}
                      </span>
                      <span className={cn(
                        "mt-1 block font-mono text-[9px] truncate",
                        values.templateId === template.id ? "text-background/70" : "text-muted-foreground",
                      )}>
                        {template.id}
                      </span>
                      <span className={cn(
                        "mt-1 block text-[9.9px] line-clamp-2",
                        values.templateId === template.id ? "text-background/80" : "text-muted-foreground",
                      )}>
                        {template.body || `${template.parameterCount} parameter${template.parameterCount === 1 ? "" : "s"}`}
                      </span>
                      <span className={cn(
                        "mt-1 block text-[9px]",
                        values.templateId === template.id ? "text-background/65" : "text-muted-foreground",
                      )}>
                        {[template.category, template.languageCode, template.type].filter(Boolean).join(" · ") || "Approved text template"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Selected template ID</label>
                <input
                  value={values.templateId ?? ""}
                  onChange={(e) => {
                    setValues((current) => ({ ...current, templateId: e.target.value }));
                    setSendState("idle");
                    setSendMsg("");
                  }}
                  placeholder="Choose an approved template"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                />
                <p className="text-[9.9px] text-muted-foreground">
                  Needed for sending. You can save the connection now and select an approved template after Gupshup approves one.
                </p>
              </div>

              <div className="space-y-3 border-t border-border pt-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Send test message</p>
                  <p className="text-[9.9px] text-muted-foreground">
                    Sends the selected template through Gupshup. The message value fills {"{message}"}, {"{body}"}, or {"{text}"} params.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Recipient number</label>
                  <input
                    value={testRecipient}
                    onChange={(e) => {
                      setTestRecipient(e.target.value);
                      setSendState("idle");
                      setSendMsg("");
                    }}
                    placeholder="919876543210"
                    inputMode="tel"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Message variable value</label>
                  <input
                    value={testMessage}
                    onChange={(e) => {
                      setTestMessage(e.target.value);
                      setSendState("idle");
                      setSendMsg("");
                    }}
                    placeholder="Test message from Actioneer"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                  />
                </div>

                <button
                  type="button"
                  disabled={!canSendTestMessage || sendState === "sending"}
                  onClick={handleSendTestMessage}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {sendState === "sending" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Sending…
                    </>
                  ) : (
                    <>
                      <MessageSquare className="size-3.5" /> Send test
                    </>
                  )}
                </button>

                {sendState !== "idle" && (
                  <div className={cn(
                    "flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs",
                    sendState === "ok" && "border-border text-foreground bg-muted/20",
                    sendState === "error" && "border-destructive/30 text-destructive bg-destructive/5",
                    sendState === "sending" && "border-border text-muted-foreground",
                  )}>
                    {sendState === "sending" && <Loader2 className="size-3 animate-spin shrink-0" />}
                    {sendState === "ok" && <CheckCircle2 className="size-3 shrink-0" />}
                    {sendState === "error" && <XCircle className="size-3 shrink-0" />}
                    <span>{sendState === "sending" ? "Sending test message…" : sendMsg}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Test result */}
          {testState !== "idle" && (
            <div className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
              testState === "ok" && "border-border text-foreground bg-muted/20",
              testState === "error" && "border-destructive/30 text-destructive bg-destructive/5",
              testState === "testing" && "border-border text-muted-foreground",
            )}>
              {testState === "testing" && <Loader2 className="size-3 animate-spin shrink-0" />}
              {testState === "ok" && <CheckCircle2 className="size-3 shrink-0" />}
              {testState === "error" && <XCircle className="size-3 shrink-0" />}
              <span>{testState === "testing" ? "Testing connection…" : testMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 space-y-2">
          <button
            type="button"
            disabled={!canTestConnection || testState === "testing"}
            onClick={handleTest}
            className="w-full rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            {testState === "testing" ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-3.5 animate-spin" /> Testing…
              </span>
            ) : "Test connection"}
          </button>
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={handleSave}
            className="w-full rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-3.5 animate-spin" /> Saving…
              </span>
            ) : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------

function ConnectionCard({
  conn,
  onConnect,
  onDisconnect,
}: {
  conn: TenantConnection;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const Icon = CHANNEL_ICON[conn.type];
  const isConnected = conn.status === "connected";
  const isComingSoon = conn.status === "coming_soon";
  const canConnect = CHANNEL_FIELDS[conn.type] !== undefined;

  return (
    <article className="group flex min-h-56 flex-col border border-border bg-background p-5 transition-colors hover:bg-muted/20">
      <div className="flex items-start justify-between gap-4">
        <div className="flex size-11 items-center justify-center border border-border bg-muted/30">
          <Icon className="size-5 text-foreground" aria-hidden="true" />
        </div>
        {isConnected ? (
          <span className="inline-flex items-center gap-1.5 border border-border px-2 py-1 text-[9.9px] font-medium text-foreground">
            <CheckCircle2 className="size-3" aria-hidden="true" />
            Connected
          </span>
        ) : isComingSoon ? (
          <span className="border border-border px-2 py-1 text-[9.9px] font-medium text-muted-foreground">Coming soon</span>
        ) : (
          <span className="border border-border px-2 py-1 text-[9.9px] font-medium text-muted-foreground">Available</span>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-foreground">{conn.provider || conn.label}</h3>
        {conn.provider && conn.provider !== conn.label && <p className="mt-0.5 text-xs text-muted-foreground">{conn.label}</p>}
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{CONNECTION_DESCRIPTION[conn.type]}</p>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
        {canConnect && !isComingSoon ? (
          <Button variant={isConnected ? "outline" : "default"} size="sm" onClick={onConnect}>
            {isConnected ? "Manage" : "Connect"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Not yet available</span>
        )}
        {isConnected && conn.source === "configured" && (
          <Button variant="ghost" size="sm" onClick={onDisconnect} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="size-3.5" aria-hidden="true" />
            Disconnect
          </Button>
        )}
        {isConnected && conn.source === "environment" && (
          <span className="ml-auto text-[9.9px] text-muted-foreground" title="Using platform-default credentials">
            Workspace default
          </span>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ConnectionsPage() {
  const [connections, setConnections] = useState<TenantConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [drawerConn, setDrawerConn] = useState<TenantConnection | null>(null);
  const [search, setSearch] = useState("");

  const loadConnections = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    apiFetch<{ connections?: TenantConnection[] }>("/api/connections", { skipModel: true })
      .then((d: { connections?: TenantConnection[] }) => {
        setConnections(d.connections ?? []);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  async function handleDisconnect(type: ConnectionType) {
    const data = await apiFetch<{ connections?: TenantConnection[] }>(`/api/connections/${type}`, {
      method: "DELETE",
      skipModel: true,
    });
    if (data.connections) setConnections(data.connections);
  }

  const filteredConnections = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return connections;
    return connections.filter((connection) => (
      connection.label.toLowerCase().includes(query) ||
      connection.provider.toLowerCase().includes(query) ||
      CONNECTION_DESCRIPTION[connection.type].toLowerCase().includes(query)
    ));
  }, [connections, search]);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-6 sm:py-8">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Connect the data sources and messaging channels used across your workspace.
          </p>
        </header>

        <section className="mt-6 flex flex-col justify-between gap-6 border border-border bg-muted/20 p-6 sm:flex-row sm:items-center">
          <div className="flex max-w-2xl items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center border border-border bg-background">
              <Wrench className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Request a tool</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Need a provider that is not listed below? Tell us what you want to connect and how you plan to use it.
              </p>
            </div>
          </div>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <a href="mailto:support@sentinel.app?subject=Integration%20request&body=Tool%20or%20provider%3A%0A%0AHow%20we%20would%20use%20it%3A%0A">
              Request a tool
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </section>

        <section className="mt-8" aria-labelledby="integration-catalog-title">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 id="integration-catalog-title" className="text-sm font-semibold">Out-of-the-box integrations</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {loading
                  ? "Loading integrations…"
                  : loadError
                    ? "Catalog unavailable"
                    : `${connections.length} integration${connections.length === 1 ? "" : "s"} in the catalog`}
              </p>
            </div>
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Search integrations</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search integrations"
                className="h-10 pl-9"
                disabled={loading || loadError}
              />
            </label>
          </div>

          {loadError ? (
            <div className="mt-4 flex flex-col items-center border border-border px-6 py-14 text-center">
              <p className="text-sm font-medium">Could not load integrations</p>
              <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={loadConnections}>Retry</Button>
            </div>
          ) : loading ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading integrations">
              {[1, 2, 3, 4, 5].map((item) => (
                <div key={item} className="h-56 animate-pulse border border-border bg-muted/20" />
              ))}
            </div>
          ) : filteredConnections.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredConnections.map((conn) => (
                <ConnectionCard
                  key={conn.type}
                  conn={conn}
                  onConnect={() => setDrawerConn(conn)}
                  onDisconnect={() => void handleDisconnect(conn.type)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4 border border-border px-6 py-14 text-center">
              <p className="text-sm font-medium">No integrations found</p>
              <p className="mt-1 text-sm text-muted-foreground">Try another search or request the tool you need.</p>
            </div>
          )}
        </section>
      </div>

      {/* Credential drawer */}
      {drawerConn && (
        <CredentialDrawer
          conn={drawerConn}
          open={drawerConn !== null}
          onClose={() => setDrawerConn(null)}
          onSaved={(updated) => { setConnections(updated); setDrawerConn(null); }}
        />
      )}
    </div>
  );
}
