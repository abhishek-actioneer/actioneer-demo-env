"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  SUCCESS_PRESETS,
  SUCCESS_METRIC_TYPES,
  SUCCESS_CALL_OUTCOMES,
  SUCCESS_BASELINE_SOURCES,
  SUCCESS_WINDOW_OPTIONS,
  EXPERIMENT_PRESETS,
  baselineRateInputValue,
  parseBaselineRatePercent,
  secondarySuccessMetric,
  successPresetId,
  applySuccessPreset,
  successMetricTrackingLabel,
  successWindowLabel,
  successBaselineDescription,
} from "@/lib/voice-campaign-studio-utils";
import type {
  VoiceCampaignExperimentSplit,
  VoiceCampaignSuccessDefinition,
  VoiceCampaignSuccessBaselineSource,
  VoiceCampaignSuccessCallOutcome,
  VoiceCampaignSuccessMetricType,
  VoiceCampaignSuccessMetric,
} from "@/lib/voice-campaign-types";
import { normalizeVoiceCampaignExperimentSplit } from "@/lib/voice-campaign-experiment";

export function ExperimentSplitEditor({
  value,
  onChange,
}: {
  value: VoiceCampaignExperimentSplit;
  onChange: (next: VoiceCampaignExperimentSplit) => void;
}) {
  const updateTestPercent = (nextValue: string) => {
    const testPercent = Math.max(1, Math.min(99, Math.round(Number(nextValue) || 0)));
    onChange(normalizeVoiceCampaignExperimentSplit({
      ...value,
      enabled: true,
      testPercent,
      controlPercent: 100 - testPercent,
    }, { defaultEnabled: true }));
  };
  const applyPreset = (testPercent: number) => {
    onChange(normalizeVoiceCampaignExperimentSplit({
      ...value,
      enabled: true,
      testPercent,
      controlPercent: 100 - testPercent,
    }, { defaultEnabled: true }));
  };

  return (
    <section className="rounded-lg bg-background p-4 shadow-[0_0_0_1px_var(--color-border)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Run as an experiment?</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Decide whether part of the audience should stay untouched as the control baseline.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border p-1">
          <button
            type="button"
            onClick={() => onChange(normalizeVoiceCampaignExperimentSplit({ ...value, enabled: true }, { defaultEnabled: true }))}
            className={cn(
              "rounded px-3 py-1.5 text-sm transition-colors",
              value.enabled ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Split
          </button>
          <button
            type="button"
            onClick={() => onChange(normalizeVoiceCampaignExperimentSplit({ ...value, enabled: false }))}
            className={cn(
              "rounded px-3 py-1.5 text-sm transition-colors",
              !value.enabled ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            No holdout
          </button>
        </div>
      </div>

      {value.enabled ? (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {EXPERIMENT_PRESETS.map((preset) => {
              const selected = value.testPercent === preset.testPercent;
              return (
                <button
                  key={preset.testPercent}
                  type="button"
                  onClick={() => applyPreset(preset.testPercent)}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors",
                    selected
                      ? "border-foreground bg-muted/50 text-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/60 hover:text-foreground",
                  )}
                >
                  <span className="block text-sm font-semibold">{preset.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed">{preset.description}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-md border border-border p-3 text-sm leading-relaxed">
            <span className="font-medium">{value.testPercent}% test</span>
            <span className="text-muted-foreground"> gets the campaign. </span>
            <span className="font-medium">{value.controlPercent}% control</span>
            <span className="text-muted-foreground"> stays untouched and becomes the baseline for lift.</span>
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-md border border-border p-3 text-sm leading-relaxed text-muted-foreground">
          Everyone in the selected audience can be called. Lift can still use a manual or historical baseline later, but there is no same-audience holdout.
        </div>
      )}

      <details className="mt-4 rounded-md border border-border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-foreground">Advanced experiment settings</summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Test group label</label>
            <Input
              value={value.testLabel}
              onChange={(event) => onChange(normalizeVoiceCampaignExperimentSplit({ ...value, testLabel: event.target.value }, { defaultEnabled: true }))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Control group label</label>
            <Input
              value={value.controlLabel}
              onChange={(event) => onChange(normalizeVoiceCampaignExperimentSplit({ ...value, controlLabel: event.target.value }, { defaultEnabled: true }))}
              disabled={!value.enabled}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Test allocation</label>
            <Input
              type="number"
              min={1}
              max={99}
              value={value.testPercent}
              onChange={(event) => updateTestPercent(event.target.value)}
              disabled={!value.enabled}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Control allocation</label>
            <Input
              type="number"
              value={value.controlPercent}
              disabled
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Randomize by</label>
            <Select
              value={value.randomizationUnit}
              onValueChange={(nextValue) => onChange(normalizeVoiceCampaignExperimentSplit({
                ...value,
                randomizationUnit: nextValue === "phone_number" ? "phone_number" : "recipient",
              }, { defaultEnabled: true }))}
            >
              <SelectTrigger className="h-10 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recipient">Recipient</SelectItem>
                <SelectItem value="phone_number">Phone number</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Baseline source</label>
            <Input value={value.enabled ? "Control holdout" : "No holdout"} disabled />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium">Notes</label>
            <Textarea
              rows={3}
              value={value.notes ?? ""}
              onChange={(event) => onChange(normalizeVoiceCampaignExperimentSplit({ ...value, notes: event.target.value }, { defaultEnabled: true }))}
              className="resize-none text-sm"
            />
          </div>
        </div>
      </details>
    </section>
  );
}

export function CampaignSuccessDefinitionEditor({
  value,
  onChange,
  onSave,
  saving,
  canSave,
  experimentSplit,
}: {
  value: VoiceCampaignSuccessDefinition;
  onChange: (next: VoiceCampaignSuccessDefinition) => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
  experimentSplit?: VoiceCampaignExperimentSplit;
}) {
  const primary = value.primary;
  const secondary = secondarySuccessMetric(value);
  const selectedPreset = successPresetId(value);
  const [advancedOpen, setAdvancedOpen] = useState(selectedPreset === "custom");
  const updatePrimary = (patch: Partial<VoiceCampaignSuccessMetric>) => {
    onChange({ ...value, primary: { ...primary, ...patch } });
  };
  const updateSecondary = (patch: Partial<VoiceCampaignSuccessMetric>) => {
    onChange({ ...value, secondary: [{ ...secondary, ...patch }] });
  };

  return (
    <section className="rounded-lg bg-background p-4 shadow-[0_0_0_1px_var(--color-border)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">What counts as success?</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Pick the main outcome. The baseline comes from the control holdout when the experiment is enabled.
          </p>
        </div>
        {canSave && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={saving}
            className="shrink-0"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save definition
          </Button>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {SUCCESS_PRESETS.map((preset) => {
          const selected = selectedPreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                if (preset.id === "custom") {
                  setAdvancedOpen(true);
                  return;
                }
                setAdvancedOpen(false);
                onChange(applySuccessPreset(value, preset.id));
              }}
              className={cn(
                "rounded-md border p-3 text-left transition-colors",
                selected
                  ? "border-foreground bg-muted/50 text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/60 hover:text-foreground",
              )}
            >
              <span className="block text-sm font-semibold">{preset.title}</span>
              <span className="mt-1 block text-xs leading-relaxed">{preset.description}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Primary outcome</p>
          <p className="mt-1 text-sm font-semibold">{primary.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{successMetricTrackingLabel(primary)}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Baseline</p>
          <p className="mt-1 text-sm font-semibold">
            {experimentSplit?.enabled ? "Automatic control holdout" : "Not required to launch"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{successBaselineDescription(value, experimentSplit)}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <label className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Count results for</label>
          <Select
            value={String(value.attributionWindowDays)}
            onValueChange={(nextValue) => onChange({
              ...value,
              attributionWindowDays: Math.max(0, Math.min(365, Number(nextValue) || 0)),
            })}
          >
            <SelectTrigger className="mt-2 h-9 w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUCCESS_WINDOW_OPTIONS.map((option) => (
                <SelectItem key={option.days} value={String(option.days)}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">{successWindowLabel(value.attributionWindowDays)} after call start.</p>
        </div>
      </div>

      <details
        className="mt-4 rounded-md border border-border px-3 py-2"
        open={advancedOpen || selectedPreset === "custom"}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-foreground">Advanced tracking settings</summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Primary success</label>
            <Input
              value={primary.label}
              onChange={(event) => updatePrimary({ label: event.target.value })}
              placeholder="KYC completed"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Track as</label>
            <Select
              value={primary.type}
              onValueChange={(nextValue) => {
                const type = nextValue as VoiceCampaignSuccessMetricType;
                updatePrimary({
                  type,
                  outcome: type === "call_outcome" ? primary.outcome ?? "positive" : undefined,
                  eventName: type === "dataset_event" ? primary.eventName ?? "" : undefined,
                  sql: type === "sql" ? primary.sql ?? "" : undefined,
                });
              }}
            >
              <SelectTrigger className="h-10 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUCCESS_METRIC_TYPES.map((option) => (
                  <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {primary.type === "call_outcome" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">Call outcome</label>
              <Select
                value={primary.outcome ?? "positive"}
                onValueChange={(nextValue) => updatePrimary({ outcome: nextValue as VoiceCampaignSuccessCallOutcome })}
              >
                <SelectTrigger className="h-10 w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUCCESS_CALL_OUTCOMES.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {primary.type === "dataset_event" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">Event name</label>
              <Input
                value={primary.eventName ?? ""}
                onChange={(event) => updatePrimary({ eventName: event.target.value })}
                placeholder="kyc_completed"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium">Attribution window</label>
            <Input
              type="number"
              min={0}
              max={365}
              value={value.attributionWindowDays}
              onChange={(event) => onChange({
                ...value,
                attributionWindowDays: Math.max(0, Math.min(365, Number(event.target.value) || 0)),
              })}
            />
          </div>

          {primary.type === "sql" && (
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-medium">Success SQL</label>
              <Textarea
                value={primary.sql ?? ""}
                onChange={(event) => updatePrimary({ sql: event.target.value })}
                rows={5}
                placeholder="SELECT customer_id FROM events WHERE event_name = 'kyc_completed'"
                className="font-mono text-xs"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium">Baseline source</label>
            <Select
              value={value.baseline.source}
              onValueChange={(nextValue) => onChange({
                ...value,
                baseline: { ...value.baseline, source: nextValue as VoiceCampaignSuccessBaselineSource },
              })}
            >
              <SelectTrigger className="h-10 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUCCESS_BASELINE_SOURCES.map((option) => (
                  <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Baseline rate</label>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={baselineRateInputValue(value)}
              onChange={(event) => onChange({
                ...value,
                baseline: {
                  ...value.baseline,
                  rate: parseBaselineRatePercent(event.target.value),
                  label: event.target.value.trim() ? `${event.target.value.trim()}% baseline` : "Baseline unavailable",
                },
              })}
              placeholder="12"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Secondary success</label>
            <Input
              value={secondary.label}
              onChange={(event) => updateSecondary({ label: event.target.value })}
              placeholder="Callback scheduled"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Secondary outcome</label>
            <Select
              value={secondary.outcome ?? "callback_scheduled"}
              onValueChange={(nextValue) => updateSecondary({
                type: "call_outcome",
                outcome: nextValue as VoiceCampaignSuccessCallOutcome,
              })}
            >
              <SelectTrigger className="h-10 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUCCESS_CALL_OUTCOMES.map((option) => (
                  <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium">Guardrails</label>
            <Textarea
              rows={3}
              value={value.guardrails.join("\n")}
              onChange={(event) => onChange({
                ...value,
                guardrails: event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
              })}
              placeholder={"negative_response\nwrong_number\nopt_out"}
              className="resize-none text-sm"
            />
          </div>
        </div>
      </details>

      {!canSave && (
        <p className="mt-3 text-xs text-muted-foreground">
          This will be saved when the campaign is created.
        </p>
      )}
    </section>
  );
}
