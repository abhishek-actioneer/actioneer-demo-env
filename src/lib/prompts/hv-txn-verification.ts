export interface HVTxnContext {
  customer_id: string;
  full_name: string;
  home_city: string;
  segment: string;
  income_band: string | null;
  occupation: string | null;
  gender: string | null;
  relationship_since: string | null;

  txn_id: string;
  amount_inr: number;
  txn_ts: string;
  txn_city: string;
  txn_country: string;
  channel: string;
  auth_method: string | null;
  merchant_name: string;
  merchant_category: string | null;

  avg_amt_90d: number | null;
  p95_amt_90d: number | null;
  deviation_x: number | null;
}

const AGENT_NAME = "Priya";

function formatAmountInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatTxnTsIst(txnTs: string): string {
  try {
    const date = new Date(txnTs);
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return txnTs;
  }
}

function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}

function genderAddressNote(gender: string | null): string {
  if (gender?.toLowerCase() === "female") return "female — use aap/ji";
  if (gender?.toLowerCase() === "male") return "male — use aap/sahab";
  return "gender unknown — use ji";
}

export function buildHVTxnPrompt(ctx: HVTxnContext): string {
  const amount = formatAmountInr(ctx.amount_inr);
  const txnTime = formatTxnTsIst(ctx.txn_ts);
  const fname = firstName(ctx.full_name);
  const geoMismatch = ctx.txn_city.toLowerCase() !== ctx.home_city.toLowerCase();
  const highDeviation = ctx.deviation_x != null && ctx.deviation_x > 10;

  const txnNotes: string[] = [
    `- Amount: ${amount}`,
    `- Merchant: ${ctx.merchant_name}`,
    `- City: ${ctx.txn_city}${ctx.txn_country !== "India" ? `, ${ctx.txn_country}` : ""}`,
    `- Date/Time: ${txnTime}`,
    `- Channel: ${ctx.channel}`,
  ];

  if (geoMismatch) {
    txnNotes.push(`- Note: Customer lives in ${ctx.home_city}, transaction in ${ctx.txn_city}`);
  }

  if (highDeviation && ctx.deviation_x != null && ctx.avg_amt_90d != null) {
    txnNotes.push(
      `- This is ${ctx.deviation_x}x larger than their usual spend (avg ${formatAmountInr(ctx.avg_amt_90d)})`
    );
  }

  const customerLine = [
    ctx.full_name,
    ctx.segment,
    ctx.home_city,
    ctx.occupation ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `You are ${AGENT_NAME}, a phone advisor from HDFC Bank's card security team.

You are calling ${ctx.full_name} about a recent card transaction. Your job is to understand whether this transaction was made by the customer. You don't know the answer — explore gently with them.

TONE: Always calm, warm, unhurried. One question at a time. Give the customer space to respond. Never assume fraud. Never assume it's genuine.

TRANSACTION:
${txnNotes.join("\n")}

CUSTOMER: ${customerLine}

LANGUAGE: Hinglish by default. Mirror whatever language the customer speaks.
Address as "${fname} ji" — ${genderAddressNote(ctx.gender)}.

FLOW:
1. Ask if they can speak briefly
2. Mention the specific transaction naturally: "Aapke card par ${ctx.merchant_name} mein ${amount} ka transaction hua tha — kya yeh aapne kiya tha?"
3. Follow their response:
   - If YES: ask one natural follow-up to confirm genuine knowledge (e.g. "Aap ${ctx.txn_city} mein the us waqt?")
   - If NO: express concern, say you'll flag it for review
   - If UNSURE: help them recall, offer a callback if they want to check
4. Call the appropriate tool and close warmly.

BOT DISCLOSURE: If asked — confirm you are an AI assistant from HDFC Bank.

RESPONSE STYLE: 1–2 short sentences per turn. Sound like a calm bank advisor.

TOOLS: After you have enough to decide, call exactly one:
- confirm_transaction(verification_method, customer_statement)
- flag_for_review(reason, customer_statement)
- schedule_callback(preferred_time)`;
}

export function buildHVTxnOpeningLine(ctx: HVTxnContext): string {
  const fname = firstName(ctx.full_name);
  // Priya is female
  return `${fname} ji, HDFC Bank se ${AGENT_NAME} bol rahi hoon. Kya abhi ek minute baat ho sakti hai?`;
}
