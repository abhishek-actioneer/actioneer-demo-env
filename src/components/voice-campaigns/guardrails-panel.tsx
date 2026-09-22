"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  FileText,
  Loader2,
  Phone,
  Plus,
  Scale,
  Settings2,
  Shield,
  Target,
  Terminal,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type GuardrailsConfig,
  type GuardrailAction,
  type GuardrailSeverity,
  type CustomGuardrail,
  guardrailsConfigToAnnotatedRules,
  countEnabled,
  GUARDRAIL_ACTION_LABELS,
  GUARDRAIL_SEVERITY_LABELS,
  BUILTIN_GUARDRAIL_RULES,
} from "@/lib/voice-campaign-guardrails";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivePanel =
  | "system"
  | "compliance"
  | "escalation"
  | "content"
  | "custom"
  | "add-custom"
  | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ActionSelect({
  value,
  onChange,
  options = ["warn_continue", "end_conversation", "transfer_to_human", "dnc_end"] as GuardrailAction[],
}: {
  value: GuardrailAction;
  onChange: (v: GuardrailAction) => void;
  options?: GuardrailAction[];
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as GuardrailAction)}>
      <SelectTrigger className="h-8 w-fit min-w-[180px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt} className="text-xs">
            {GUARDRAIL_ACTION_LABELS[opt]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SeveritySelect({
  value,
  onChange,
}: {
  value: GuardrailSeverity;
  onChange: (v: GuardrailSeverity) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as GuardrailSeverity)}>
      <SelectTrigger className="h-7 w-[90px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(["low", "medium", "high"] as GuardrailSeverity[]).map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {GUARDRAIL_SEVERITY_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PanelRow({
  label,
  description,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-4 border-b border-border last:border-b-0">
      <div className="flex items-start gap-3">
        <Switch checked={enabled} onCheckedChange={onToggle} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          {enabled && children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel: System
// ---------------------------------------------------------------------------

function SystemPanel({
  config,
  onChange,
}: {
  config: GuardrailsConfig;
  onChange: (c: GuardrailsConfig) => void;
}) {
  return (
    <div className="space-y-0">
      <PanelRow
        label="Focus"
        description="Keeps the agent focused on the campaign's defined objective and script, preventing drift into unintended topics or off-topic discussions."
        enabled={config.system.focus}
        onToggle={(v) => onChange({ ...config, system: { ...config.system, focus: v } })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel: Compliance
// ---------------------------------------------------------------------------

function CompliancePanel({
  config,
  onChange,
}: {
  config: GuardrailsConfig;
  onChange: (c: GuardrailsConfig) => void;
}) {
  const c = config.compliance;
  const set = (patch: Partial<typeof c>) =>
    onChange({ ...config, compliance: { ...c, ...patch } });

  return (
    <div className="space-y-0">
      <PanelRow
        label="Return guarantees"
        description="Never promise fixed returns or quote specific percentages not explicitly stated in the approved script. Prevents regulatory violations under SEBI."
        enabled={c.returnClaims.enabled}
        onToggle={(v) => set({ returnClaims: { ...c.returnClaims, enabled: v } })}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Action:</span>
          <ActionSelect
            value={c.returnClaims.action}
            onChange={(v) => set({ returnClaims: { ...c.returnClaims, action: v } })}
            options={["warn_continue", "end_conversation"]}
          />
        </div>
      </PanelRow>

      <PanelRow
        label="Regulatory disclosure"
        description="Must disclose SEBI / IRDAI registration number before making any product pitch or investment recommendation."
        enabled={c.disclosure.enabled}
        onToggle={(v) => set({ disclosure: { ...c.disclosure, enabled: v } })}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Action:</span>
          <ActionSelect
            value={c.disclosure.action}
            onChange={(v) => set({ disclosure: { ...c.disclosure, action: v } })}
            options={["warn_continue", "end_conversation"]}
          />
        </div>
      </PanelRow>

      <PanelRow
        label="Risk-first"
        description="Must mention risks or potential downsides before stating any product benefits or projected returns. Required for SEBI-regulated investment products."
        enabled={c.riskFirst.enabled}
        onToggle={(v) => set({ riskFirst: { ...c.riskFirst, enabled: v } })}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Action:</span>
          <ActionSelect
            value={c.riskFirst.action}
            onChange={(v) => set({ riskFirst: { ...c.riskFirst, action: v } })}
            options={["warn_continue", "end_conversation"]}
          />
        </div>
      </PanelRow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel: Escalation
// ---------------------------------------------------------------------------

function EscalationPanel({
  config,
  onChange,
}: {
  config: GuardrailsConfig;
  onChange: (c: GuardrailsConfig) => void;
}) {
  const e = config.escalation;
  const set = (patch: Partial<typeof e>) =>
    onChange({ ...config, escalation: { ...e, ...patch } });

  return (
    <div className="space-y-0">
      <PanelRow
        label="Legal threat"
        description="Customer mentions court action, RBI ombudsman complaint, consumer forum, or other legal proceedings."
        enabled={e.legalThreat.enabled}
        onToggle={(v) => set({ legalThreat: { ...e.legalThreat, enabled: v } })}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Action:</span>
          <ActionSelect
            value={e.legalThreat.action}
            onChange={(v) => set({ legalThreat: { ...e.legalThreat, action: v } })}
            options={["transfer_to_human", "end_conversation"]}
          />
        </div>
      </PanelRow>

      <PanelRow
        label="Human requested"
        description='Customer explicitly asks to speak to a human agent, manager, or "real person".'
        enabled={e.humanRequest.enabled}
        onToggle={(v) => set({ humanRequest: { ...e.humanRequest, enabled: v } })}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Action:</span>
          <ActionSelect
            value={e.humanRequest.action}
            onChange={(v) => set({ humanRequest: { ...e.humanRequest, action: v } })}
            options={["transfer_to_human", "end_conversation"]}
          />
        </div>
      </PanelRow>

      <PanelRow
        label="Opt-out / DNC"
        description={"Customer says \"don't call me\", \"remove me from your list\", \"stop calling\", or similar opt-out language. Adds number to Do Not Call list."}
        enabled={e.optOut.enabled}
        onToggle={(v) => set({ optOut: { ...e.optOut, enabled: v } })}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Action:</span>
          <ActionSelect
            value={e.optOut.action}
            onChange={(v) => set({ optOut: { ...e.optOut, action: v } })}
            options={["dnc_end", "end_conversation"]}
          />
        </div>
      </PanelRow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel: Content
// ---------------------------------------------------------------------------

function ContentPanel({
  config,
  onChange,
}: {
  config: GuardrailsConfig;
  onChange: (c: GuardrailsConfig) => void;
}) {
  const ct = config.content;
  const set = (patch: Partial<typeof ct>) =>
    onChange({ ...config, content: { ...ct, ...patch } });

  const allEnabled = ct.profanity.enabled && ct.politicalReligious.enabled;

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => set({
            profanity: { ...ct.profanity, enabled: true },
            politicalReligious: { ...ct.politicalReligious, enabled: true },
          })}
          className={cn(
            "flex-1 rounded-md border py-1.5 text-sm transition-colors",
            allEnabled ? "border-foreground bg-muted text-foreground" : "border-border text-muted-foreground hover:border-foreground/50",
          )}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => set({
            profanity: { ...ct.profanity, enabled: false },
            politicalReligious: { ...ct.politicalReligious, enabled: false },
          })}
          className={cn(
            "flex-1 rounded-md border py-1.5 text-sm transition-colors",
            !ct.profanity.enabled && !ct.politicalReligious.enabled
              ? "border-foreground bg-muted text-foreground"
              : "border-border text-muted-foreground hover:border-foreground/50",
          )}
        >
          None
        </button>
      </div>

      <div className="space-y-0">
        <PanelRow
          label="Profanity"
          description="Prevents use of vulgar, offensive, or explicit language during the call."
          enabled={ct.profanity.enabled}
          onToggle={(v) => set({ profanity: { ...ct.profanity, enabled: v } })}
        >
          <SeveritySelect
            value={ct.profanity.severity}
            onChange={(v) => set({ profanity: { ...ct.profanity, severity: v } })}
          />
        </PanelRow>

        <PanelRow
          label="Political / religious"
          description="Avoids political and religious discussions — sensitive in the Indian context across diverse audiences."
          enabled={ct.politicalReligious.enabled}
          onToggle={(v) => set({ politicalReligious: { ...ct.politicalReligious, enabled: v } })}
        >
          <SeveritySelect
            value={ct.politicalReligious.severity}
            onChange={(v) => set({ politicalReligious: { ...ct.politicalReligious, severity: v } })}
          />
        </PanelRow>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel: Custom (list + add-custom sub-panel)
// ---------------------------------------------------------------------------

function AddCustomForm({
  onAdd,
  onBack,
}: {
  onAdd: (g: Omit<CustomGuardrail, "id">) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [action, setAction] = useState<GuardrailAction>("end_conversation");

  const canAdd = name.trim().length > 0 && prompt.trim().length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-6">
        <button
          type="button"
          onClick={onBack}
          className="flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <p className="text-sm font-semibold">Add custom guardrail</p>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 mb-5 flex items-start gap-2">
        <FileText className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">How it works:</span> A custom guardrail uses a lightweight LLM to monitor each response and block content that matches your criteria.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto">
        <div>
          <label className="block text-sm font-medium mb-1">
            Name <span className="text-destructive">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Financial advice guardrail"
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-border"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Prompt <span className="text-destructive">*</span>
          </label>
          <p className="text-xs text-muted-foreground mb-2">Describe what this guardrail should block. Be specific.</p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="e.g. Block any response that provides specific investment advice, names individual stocks, or compares our products against named competitors."
            className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/30 focus:ring-1 focus:ring-border"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Action on violation</label>
          <ActionSelect value={action} onChange={setAction} />
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => {
            onAdd({ name: name.trim(), prompt: prompt.trim(), action, enabled: true });
            onBack();
          }}
          className="flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-30 hover:opacity-90"
        >
          <Plus className="size-3.5" />
          Add guardrail
        </button>
      </div>
    </div>
  );
}

function CustomPanel({
  config,
  onChange,
  showAdd,
  onShowAdd,
  onHideAdd,
}: {
  config: GuardrailsConfig;
  onChange: (c: GuardrailsConfig) => void;
  showAdd: boolean;
  onShowAdd: () => void;
  onHideAdd: () => void;
}) {
  const customs = config.custom;

  function addCustom(g: Omit<CustomGuardrail, "id">) {
    const id = `custom-${Date.now()}`;
    onChange({ ...config, custom: [...customs, { ...g, id }] });
  }

  function toggleCustom(id: string, enabled: boolean) {
    onChange({
      ...config,
      custom: customs.map((g) => g.id === id ? { ...g, enabled } : g),
    });
  }

  function removeCustom(id: string) {
    onChange({ ...config, custom: customs.filter((g) => g.id !== id) });
  }

  if (showAdd) {
    return <AddCustomForm onAdd={addCustom} onBack={onHideAdd} />;
  }

  return (
    <div>
      {customs.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <Settings2 className="size-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No custom guardrails yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add rules specific to your use case or compliance requirements.</p>
        </div>
      ) : (
        <div className="space-y-0 mb-4">
          {customs.map((g) => (
            <div key={g.id} className="py-3.5 border-b border-border last:border-b-0">
              <div className="flex items-start gap-3">
                <Switch
                  checked={g.enabled}
                  onCheckedChange={(v) => toggleCustom(g.id, v)}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{g.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{g.prompt}</p>
                  {g.enabled && (
                    <p className="mt-1.5 text-[9.9px] text-muted-foreground/60">
                      Action: {GUARDRAIL_ACTION_LABELS[g.action]}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeCustom(g.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onShowAdd}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        <Plus className="size-3.5" />
        Add custom guardrail
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category row
// ---------------------------------------------------------------------------

const CATEGORY_META = {
  system:     { label: "System",     icon: Target,        total: 1 },
  compliance: { label: "Compliance", icon: Scale,         total: 3 },
  escalation: { label: "Escalation", icon: Phone,         total: 3 },
  content:    { label: "Content",    icon: AlertTriangle, total: 2 },
  custom:     { label: "Custom",     icon: Settings2,     total: null },
} as const;

function enabledLabel(category: keyof typeof CATEGORY_META, counts: ReturnType<typeof countEnabled>): string {
  const n = counts[category];
  const total = CATEGORY_META[category].total;
  if (category === "custom") return n === 0 ? "0 rules" : `${n} rule${n !== 1 ? "s" : ""} enabled`;
  if (n === 0) return "Not enabled";
  if (total && n === total) return "All enabled";
  return `${n} of ${total} enabled`;
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function DetailDrawer({
  open,
  category,
  config,
  onChange,
  onClose,
}: {
  open: boolean;
  category: ActivePanel;
  config: GuardrailsConfig;
  onChange: (c: GuardrailsConfig) => void;
  onClose: () => void;
}) {
  const [showAddCustom, setShowAddCustom] = useState(false);

  const meta = category && category !== "add-custom" ? CATEGORY_META[category as keyof typeof CATEGORY_META] : null;
  const Icon = meta?.icon;

  function panelTitle() {
    if (!category) return "";
    if (category === "add-custom") return "Add custom guardrail";
    return `${meta?.label} guardrails`;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-background/60 backdrop-blur-[2px] transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-[440px] flex-col bg-background border-l border-border transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <p className="flex-1 text-sm font-semibold">{panelTitle()}</p>
          <button
            type="button"
            onClick={() => { setShowAddCustom(false); onClose(); }}
            className="flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {category === "system" && (
            <SystemPanel config={config} onChange={onChange} />
          )}
          {category === "compliance" && (
            <CompliancePanel config={config} onChange={onChange} />
          )}
          {category === "escalation" && (
            <EscalationPanel config={config} onChange={onChange} />
          )}
          {category === "content" && (
            <ContentPanel config={config} onChange={onChange} />
          )}
          {category === "custom" && (
            <CustomPanel
              config={config}
              onChange={onChange}
              showAdd={showAddCustom}
              onShowAdd={() => setShowAddCustom(true)}
              onHideAdd={() => setShowAddCustom(false)}
            />
          )}
        </div>

        {/* Footer (not shown for add-custom sub-view) */}
        {!showAddCustom && (
          <div className="shrink-0 flex justify-end border-t border-border px-5 py-3">
            <Button type="button" size="sm" onClick={() => { setShowAddCustom(false); onClose(); }}>
              Done
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ActiveRulesPanel — shows exactly what gets injected into the model
// ---------------------------------------------------------------------------

function RuleRow({ badge, label, rule, dim = false }: { badge: string; label: string; rule: string; dim?: boolean }) {
  return (
    <div className={cn("flex items-start gap-3 px-4 py-3", dim && "opacity-50")}>
      <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        {badge}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
        <p className="text-sm text-foreground leading-relaxed">{rule}</p>
      </div>
    </div>
  );
}

function ActiveRulesPanel({ config }: { config: GuardrailsConfig }) {
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const configured = guardrailsConfigToAnnotatedRules(config);

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <Terminal className="size-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
          Applied to model
        </p>
        <span className="ml-auto text-xs text-muted-foreground">
          {configured.length} configured · {BUILTIN_GUARDRAIL_RULES.length} built-in
        </span>
      </div>

      {/* User-configured rules */}
      {configured.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center mb-3">
          <p className="text-sm text-muted-foreground">No guardrails configured yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Enable rules above — they&apos;ll appear here exactly as sent to the model.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden divide-y divide-border mb-3">
          {configured.map((r, i) => (
            <RuleRow key={i} badge={r.category} label={r.label} rule={r.rule} />
          ))}
        </div>
      )}

      {/* Built-in rules — collapsible */}
      <button
        type="button"
        onClick={() => setShowBuiltIn((v) => !v)}
        className="flex w-full items-center gap-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn("size-3 transition-transform", showBuiltIn && "rotate-90")} />
        {showBuiltIn ? "Hide" : "Show"} {BUILTIN_GUARDRAIL_RULES.length} built-in rules (always applied)
      </button>

      {showBuiltIn && (
        <div className="mt-2 rounded-lg border border-border/50 overflow-hidden divide-y divide-border/50">
          {BUILTIN_GUARDRAIL_RULES.map((r, i) => (
            <RuleRow key={i} badge={r.group} label={r.label} rule={r.rule} dim />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GuardrailsPanel — main export (controlled)
// ---------------------------------------------------------------------------

export function GuardrailsPanel({
  config,
  onChange,
  onSave,
  saving = false,
  canSave = false,
}: {
  config: GuardrailsConfig;
  onChange: (config: GuardrailsConfig) => void;
  onSave?: () => void;
  saving?: boolean;
  canSave?: boolean;
}) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  function handleConfigChange(next: GuardrailsConfig) {
    onChange(next);
  }

  const counts = countEnabled(config);
  const categories = Object.keys(CATEGORY_META) as Array<keyof typeof CATEGORY_META>;

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden">
      {/* Main list */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Guardrails</h2>
                <span className="rounded-full border border-border px-2 py-0.5 text-[9px] font-medium text-muted-foreground">Alpha</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Define boundaries for your agent&apos;s behavior. Control what the agent can say and do on every call to reduce risk and stay compliant.
              </p>
            </div>
            {canSave && onSave && (
              <Button type="button" size="sm" variant="outline" onClick={onSave} disabled={saving} className="shrink-0">
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </Button>
            )}
          </div>

          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {categories.map((cat) => {
              const { label, icon: CatIcon } = CATEGORY_META[cat];
              const statusLabel = enabledLabel(cat, counts);
              const hasEnabled = counts[cat] > 0;

              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActivePanel(cat)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/30"
                >
                  <CatIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-sm font-medium">{label}</span>
                  <span className={cn(
                    "shrink-0 text-xs",
                    hasEnabled ? "text-foreground font-medium" : "text-muted-foreground",
                  )}>
                    {statusLabel}
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>

          {/* Active rules — exactly what the model receives */}
          <ActiveRulesPanel config={config} />
        </div>
      </div>

      {/* Slide-in detail drawer */}
      <DetailDrawer
        open={activePanel !== null}
        category={activePanel}
        config={config}
        onChange={handleConfigChange}
        onClose={() => setActivePanel(null)}
      />
    </div>
  );
}
