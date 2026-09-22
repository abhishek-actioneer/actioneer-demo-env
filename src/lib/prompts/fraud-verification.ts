import type { DatasetConfig } from "@/lib/datasets";

export interface VerificationCallContext {
  datasetId: string;
  datasetLabel?: string;
  companyName?: string;
  entityName?: string;
  alertId?: string;
  subjectId?: string;
  customerId?: string;
  subjectName?: string;
  phone?: string | null;
  gender?: string | null;
  amountAtRisk?: number | null;
  verificationReason?: string | null;
  riskSignals?: string[];
  verificationItems?: string[];
  transaction?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export type FraudCallContext = VerificationCallContext;

function clean(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || undefined;
}

function money(value: number | null | undefined, currency: string): string | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  return `${currency}${value.toLocaleString("en-IN")}`;
}

function firstName(fullName: string | undefined): string {
  return fullName?.split(/\s+/)[0] || "there";
}

function genderNote(gender: string | null | undefined): string {
  if (!gender) return "unknown gender";
  const normalized = gender.toLowerCase();
  if (normalized === "male" || normalized === "m") return "male customer - use masculine address if the language requires it";
  if (normalized === "female" || normalized === "f") return "female customer - use feminine address if the language requires it";
  return "unknown gender";
}

function transactionLine(label: string, value: unknown): string | undefined {
  const text = clean(value);
  return text ? `- ${label}: ${text}` : undefined;
}

function compactLines(lines: Array<string | undefined>): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function datasetCompany(dataset: Pick<DatasetConfig, "label" | "companyName"> | undefined, ctx: VerificationCallContext): string {
  return ctx.companyName || dataset?.companyName || dataset?.label || ctx.datasetLabel || "the company";
}

function datasetEntity(dataset: Pick<DatasetConfig, "entityName"> | undefined, ctx: VerificationCallContext): string {
  return ctx.entityName || dataset?.entityName || "customer";
}

export function verificationContextFromDatasetRow(
  dataset: Pick<DatasetConfig, "id" | "label" | "companyName" | "entityName" | "currency">,
  row: Record<string, unknown>,
): VerificationCallContext {
  const amount = Number(row.amount_inr ?? row.amount_at_risk_inr ?? row.amount ?? 0);
  const riskSignals = [
    clean(row.trigger_reasons),
    row.rule_fp_rate != null ? `Rule false-positive rate: ${row.rule_fp_rate}%` : undefined,
    clean(row.trigger_rule_description),
    row.device_risk_tier != null ? `Device risk tier: ${row.device_risk_tier}` : undefined,
    row.device_risk_score != null ? `Device risk score: ${row.device_risk_score}` : undefined,
    row.deviation_factor != null ? `Amount deviation: ${row.deviation_factor}x usual pattern` : undefined,
    row.txn_city && row.home_city && String(row.txn_city).toLowerCase() !== String(row.home_city).toLowerCase()
      ? `Location mismatch: home ${row.home_city}, event ${row.txn_city}`
      : undefined,
  ].filter((item): item is string => Boolean(item));

  const verificationItems = [
    transactionLine("Amount", money(amount, dataset.currency || "₹")),
    transactionLine("Merchant", row.merchant_name),
    transactionLine("City", row.txn_city),
    transactionLine("Time", row.txn_ts),
    transactionLine("Channel", row.channel),
    transactionLine("Card ending", clean(row.masked_pan)?.slice(-4)),
  ].filter((item): item is string => Boolean(item));

  return {
    datasetId: dataset.id,
    datasetLabel: dataset.label,
    companyName: dataset.companyName,
    entityName: dataset.entityName,
    alertId: clean(row.alert_id),
    subjectId: clean(row.customer_id),
    customerId: clean(row.customer_id),
    subjectName: clean(row.full_name),
    phone: clean(row.demo_phone) ?? null,
    gender: clean(row.gender) ?? null,
    amountAtRisk: Number.isFinite(amount) ? amount : null,
    verificationReason: clean(row.trigger_reasons) || clean(row.typology) || "risk verification",
    riskSignals,
    verificationItems,
    transaction: {
      deviation_factor: row.deviation_factor != null ? Number(row.deviation_factor) : undefined,
      device_risk_score: row.device_risk_score != null ? Number(row.device_risk_score) : undefined,
      geo_mismatch: Boolean(
        row.txn_city && row.home_city && String(row.txn_city).toLowerCase() !== String(row.home_city).toLowerCase(),
      ),
      rule_fp_rate: row.rule_fp_rate != null ? Number(row.rule_fp_rate) : undefined,
    },
    raw: row,
  };
}

export function buildFraudVerificationPrompt(
  ctx: VerificationCallContext,
  dataset?: Pick<DatasetConfig, "label" | "companyName" | "entityName" | "currency">,
): string {
  const company = datasetCompany(dataset, ctx);
  const entity = datasetEntity(dataset, ctx);
  const subject = ctx.subjectName || ctx.customerId || ctx.subjectId || `this ${entity}`;
  const first = firstName(ctx.subjectName);
  const amount = money(ctx.amountAtRisk ?? null, dataset?.currency || "₹");
  const reason = ctx.verificationReason || "a risk signal";
  const verificationItems = ctx.verificationItems?.length
    ? ctx.verificationItems.join("\n")
    : compactLines([
        transactionLine("Customer or entity", subject),
        transactionLine("Amount at risk", amount),
        transactionLine("Reason", reason),
      ]);
  const riskSignals = ctx.riskSignals?.length
    ? ctx.riskSignals.map((signal) => `- ${signal}`).join("\n")
    : "- No additional risk signals were provided.";

  return `You are Priya, an AI verification specialist calling on behalf of ${company}. You are in a live outbound call with ${subject} because ${reason}.

CALL OBJECTIVE:
Verify whether the ${entity} recognizes and authorizes the activity. Classify the call into exactly one outcome:
- clear_transaction: the customer confirms and passes one natural follow-up check
- block_card: the customer denies the activity, reports compromise, or confirms it is unsafe
- escalate_to_specialist: the customer is uncertain, hesitant, coached, distressed, or the situation requires human review

DETAILS TO VERIFY NATURALLY:
${verificationItems || "- Use the private context available for this call."}

PRIVATE RISK CONTEXT - do not read this section aloud:
${riskSignals}
- Gender note: ${genderNote(ctx.gender)}

CONVERSATION FLOW:
1. Open calmly, identify ${company}, and ask if you are speaking with ${first}.
2. State the minimum necessary details of the activity and ask whether they recognize it.
3. If they say yes, ask one follow-up that only a genuine customer would answer naturally.
4. If they say no, say you will mark it unsafe and arrange the next protective step.
5. If they hesitate, sound coached, need someone else to answer, or give vague one-word responses, escalate.

DURESS AND COACHING SIGNALS:
- Long delay before simple answers
- Repeating your wording instead of answering naturally
- One-word answers when detail is expected
- Background voice prompting them
- They mention being told what to say or sound like they are reading

LANGUAGE POLICY:
- Mirror the customer's language. Hinglish is acceptable for Indian customers.
- Use short, calm sentences. One question at a time.
- If asked whether you are AI, answer transparently.

OUTCOME RECORDING:
If tool calls are available, call exactly one terminal tool: clear_transaction, block_card, or escalate_to_specialist. If tool calls are not available, say the outcome plainly in the final assistant turn using one of these exact words: clear, block, or escalate.`;
}

export function buildFraudOpeningLine(
  ctx: VerificationCallContext,
  dataset?: Pick<DatasetConfig, "label" | "companyName" | "currency">,
): string {
  const company = datasetCompany(dataset, ctx);
  const first = firstName(ctx.subjectName);
  const amount = money(ctx.amountAtRisk ?? null, dataset?.currency || "₹");
  const reason = ctx.verificationReason || "a risk signal";
  const amountText = amount ? ` involving ${amount}` : "";
  return `${first} ji, ${company} verification team se Priya bol rahi hoon. We noticed ${reason}${amountText}. Kya main aapse isko quickly verify kar sakti hoon?`;
}
