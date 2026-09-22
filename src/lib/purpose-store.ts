import type { Purpose } from "./purpose-types";
import { getDb } from "@/lib/meta-db";

const DEFAULT_PURPOSES: Purpose[] = [
  {
    purposeId: "GENERIC_CALLBACK",
    sku: "GENERIC-CALLBACK",
    name: "Personalized Callback",
    category: "support",
    tagline: "A short follow-up from the right team",
    description: "A generic callback offer for datasets that do not yet have a configured campaign catalog.",
    valueProp: "Route interested customers to a human follow-up",
    priceDisplay: "No pricing configured",
    cta: "Say yes and our team will call you back with details",
  },
];

const QUICKHELP_PURPOSES: Purpose[] = [
  {
    purposeId: "QH_PRIORITY_CLEANING",
    sku: "QH-PRIORITY-CLEANING",
    name: "Priority Home Cleaning",
    category: "home-services",
    tagline: "Faster slots for repeat home-help customers",
    description: "Priority scheduling for customers who recently searched or booked home cleaning services.",
    valueProp: "Preferred slots with a verified home-help professional",
    priceDisplay: "Final price depends on service and slot",
    cta: "Say yes and the Quick Help team will help book a slot",
  },
  {
    purposeId: "QH_ANNUAL_CARE",
    sku: "QH-ANNUAL-CARE",
    name: "Annual Home Care Plan",
    category: "subscription",
    tagline: "Scheduled cleaning and maintenance help",
    description: "A recurring home-care plan for customers who use Quick Help for frequent household services.",
    valueProp: "Convenient repeat bookings and service reminders",
    priceDisplay: "Plan pricing shared by the Quick Help team",
    cta: "Say yes and the team will explain plan options",
  },
  {
    purposeId: "QH_APPLIANCE_REPAIR",
    sku: "QH-APPLIANCE-REPAIR",
    name: "Appliance Repair Visit",
    category: "repair",
    tagline: "Verified technician callback",
    description: "A technician callback for customers with recent appliance repair interest or incomplete bookings.",
    valueProp: "Quick troubleshooting and convenient appointment booking",
    priceDisplay: "Inspection and repair charges confirmed before booking",
    cta: "Say yes and a Quick Help specialist will call back",
  },
];

const GAME_PURPOSES: Purpose[] = [
  {
    purposeId: "GAME_STARTER_PACK",
    sku: "GAME-STARTER-PACK",
    name: "Starter Pack",
    category: "game-offer",
    tagline: "Boost early progress with bonus currency",
    description: "A limited starter pack for players who recently installed or returned to the game.",
    valueProp: "Bonus currency and useful items for faster progression",
    priceDisplay: "In-app price shown before purchase",
    cta: "Say yes and we will send the offer link",
  },
  {
    purposeId: "GAME_SEASON_PASS",
    sku: "GAME-SEASON-PASS",
    name: "Season Pass",
    category: "game-offer",
    tagline: "Unlock premium season rewards",
    description: "Premium season rewards for engaged players who are likely to continue playing.",
    valueProp: "More rewards from normal gameplay",
    priceDisplay: "In-app price shown before purchase",
    cta: "Say yes and we will send the season pass details",
  },
  {
    purposeId: "GAME_COMEBACK_BONUS",
    sku: "GAME-COMEBACK-BONUS",
    name: "Comeback Bonus",
    category: "retention",
    tagline: "A bonus for returning players",
    description: "A reactivation bonus for players who have not played recently.",
    valueProp: "Free bonus to make returning easier",
    priceDisplay: "Free bonus, subject to account eligibility",
    cta: "Say yes and we will send the comeback link",
  },
];

const FUNDSINDIA_PURPOSES: Purpose[] = [
  {
    purposeId: "FI_SIP_STARTER",
    sku: "FI-SIP-STARTER",
    name: "SIP Starter Consultation",
    category: "investment-advisory",
    tagline: "Start or restart SIP investing with guidance",
    description: "A callback for investors who may benefit from starting, increasing, or restarting SIPs.",
    valueProp: "Advisor-led SIP planning based on investment goals",
    priceDisplay: "No consultation fee configured",
    cta: "Say yes and a FundsIndia advisor will call back",
  },
  {
    purposeId: "FI_PORTFOLIO_REVIEW",
    sku: "FI-PORTFOLIO-REVIEW",
    name: "Portfolio Review",
    category: "investment-advisory",
    tagline: "Review funds, risk, and goals",
    description: "A portfolio review callback for investors with dormant, under-diversified, or high-value portfolios.",
    valueProp: "Personalized review from the advisory team",
    priceDisplay: "No consultation fee configured",
    cta: "Say yes and an advisor will schedule a review",
  },
  {
    purposeId: "FI_TAX_SAVER",
    sku: "FI-TAX-SAVER",
    name: "ELSS Tax Saver Discussion",
    category: "tax-saving",
    tagline: "Discuss tax-saving mutual fund options",
    description: "A tax-saving investment discussion for eligible investors before the tax planning window closes.",
    valueProp: "Explore ELSS options with advisory support",
    priceDisplay: "Investment amount chosen by customer",
    cta: "Say yes and the team will explain ELSS options",
  },
];

const VASTU_PURPOSES: Purpose[] = [
  {
    purposeId: "VASTU_TOPUP",
    sku: "VASTU-TOPUP",
    name: "Existing Customer Top-Up Loan",
    category: "housing-finance",
    tagline: "Additional finance for trusted borrowers",
    description: "Top-up finance for eligible existing customers who may need funds for home, business, education, medical, or family expenses.",
    valueProp: "Existing relationship review with a Vastu advisor",
    priceDisplay: "Eligibility and rate shared after advisor review",
    cta: "Say yes and a Vastu advisor will call you back with eligibility details",
  },
  {
    purposeId: "VASTU_HOME_IMPROVEMENT",
    sku: "VASTU-HIL",
    name: "Home Improvement Loan",
    category: "housing-finance",
    tagline: "Renovation, repair, and extension support",
    description: "Finance option for existing housing customers planning renovation, repair, extension, furnishing, or home upgrade work.",
    valueProp: "Support for planned home upgrades without a hard-sell conversation",
    priceDisplay: "Amount and rate based on eligibility",
    cta: "Say yes and the nearest Vastu branch team will call you back",
  },
  {
    purposeId: "VASTU_LAP",
    sku: "VASTU-LAP",
    name: "Loan Against Property",
    category: "business-finance",
    tagline: "Property-backed finance for business needs",
    description: "Loan against property conversation for self-employed customers considering working capital, stock, equipment, or business expansion.",
    valueProp: "A loan officer can explain property-backed finance options",
    priceDisplay: "Eligibility, amount, and rate depend on property and profile review",
    cta: "Say yes and a Vastu loan officer will call you back",
  },
  {
    purposeId: "VASTU_BALANCE_TRANSFER",
    sku: "VASTU-BT",
    name: "Loan Review Callback",
    category: "housing-finance",
    tagline: "Review EMI and rate options with an advisor",
    description: "A neutral callback for borrowers who may want to review EMI, rate, or balance transfer options based on eligibility.",
    valueProp: "Advisor-led loan review without guaranteed claims",
    priceDisplay: "Final options depend on eligibility review",
    cta: "Say yes and an advisor will call you back to review options",
  },
  {
    purposeId: "VASTU_EMI_SUPPORT",
    sku: "VASTU-EMI-SUPPORT",
    name: "EMI Support Follow-up",
    category: "servicing",
    tagline: "Respectful payment help and branch follow-up",
    description: "Soft reminder and support workflow for customers with bounced or early bucket EMI follow-up.",
    valueProp: "Capture payment intent or route genuine support needs to the branch",
    priceDisplay: "No product pricing",
    cta: "Confirm the next payment step or request branch support",
  },
];

const STATIC_PURPOSES_BY_DATASET: Record<string, Purpose[]> = {
  "vastu-hfc": VASTU_PURPOSES,
  quickhelp: QUICKHELP_PURPOSES,
  alpha: GAME_PURPOSES,
  fundsindia: FUNDSINDIA_PURPOSES,
};

/**
 * Sentinel user_id for dataset-level catalogs generated from dataset config
 * (see src/lib/server/purpose-generation.ts). Kept in custom_purposes so a
 * catalog is generated once per dataset and shared across users; never
 * collides with Clerk user ids.
 */
const GENERATED_CATALOG_USER_ID = "__dataset_generated__";

export function hasCuratedPurposes(datasetId: string): boolean {
  return Boolean(STATIC_PURPOSES_BY_DATASET[datasetId]);
}

export function getGeneratedPurposes(datasetId: string): Purpose[] {
  return uploadedPurposes(datasetId, GENERATED_CATALOG_USER_ID);
}

export function saveGeneratedPurposes(datasetId: string, purposes: Purpose[]): void {
  upsertPurposes(purposes, datasetId, GENERATED_CATALOG_USER_ID);
}

let purposesStoreReady = false;

function ensurePurposesStoreReady(): void {
  if (purposesStoreReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_purposes (
      user_id TEXT NOT NULL,
      dataset_id TEXT NOT NULL,
      purpose_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, dataset_id, purpose_id)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_purposes_scope
      ON custom_purposes(user_id, dataset_id, updated_at DESC);
  `);
  purposesStoreReady = true;
}

function uploadedPurposes(datasetId: string, userId?: string): Purpose[] {
  if (!userId) return [];
  ensurePurposesStoreReady();
  const rows = getDb()
    .prepare(`
      SELECT payload_json
      FROM custom_purposes
      WHERE user_id = ? AND dataset_id = ?
      ORDER BY updated_at DESC
    `)
    .all(userId, datasetId) as Array<{ payload_json: string }>;
  return rows
    .map((row) => {
      try {
        return JSON.parse(row.payload_json) as Purpose;
      } catch {
        return null;
      }
    })
    .filter((purpose): purpose is Purpose => Boolean(purpose));
}

export function listPurposes(datasetId?: string, userId?: string): Purpose[] {
  if (!datasetId) return DEFAULT_PURPOSES;
  const curated = STATIC_PURPOSES_BY_DATASET[datasetId];
  const generated = curated ? [] : getGeneratedPurposes(datasetId);
  const base = curated ?? (generated.length > 0 ? generated : DEFAULT_PURPOSES);
  return [...base, ...uploadedPurposes(datasetId, userId)];
}

export function getPurpose(purposeId: string, datasetId?: string, userId?: string): Purpose | undefined {
  if (datasetId) return listPurposes(datasetId, userId).find((purpose) => purpose.purposeId === purposeId);
  for (const datasetPurposes of Object.values(STATIC_PURPOSES_BY_DATASET)) {
    const purpose = datasetPurposes.find((item) => item.purposeId === purposeId);
    if (purpose) return purpose;
  }
  return DEFAULT_PURPOSES.find((purpose) => purpose.purposeId === purposeId);
}

export function parsePurposesCsv(csvText: string): { purposes: Purpose[]; errors: string[] } {
  const lines = csvText.trim().split("\n").map((l) => l.trim());
  if (lines.length < 2) return { purposes: [], errors: ["CSV must have a header row and at least one data row"] };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  const required = ["offer_id", "sku", "name", "category", "tagline", "description", "value_prop", "price_display", "cta"];
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length > 0) return { purposes: [], errors: [`Missing columns: ${missing.join(", ")}`] };

  const purposes: Purpose[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const values = splitCsvLine(lines[i]);
    if (values.length < required.length) {
      errors.push(`Row ${i + 1}: expected ${required.length} columns, got ${values.length}`);
      continue;
    }
    const get = (col: string) => values[header.indexOf(col)]?.trim().replace(/^"|"$/g, "") ?? "";
    purposes.push({
      purposeId: get("offer_id"),
      sku: get("sku"),
      name: get("name"),
      category: get("category"),
      tagline: get("tagline"),
      description: get("description"),
      valueProp: get("value_prop"),
      priceDisplay: get("price_display"),
      cta: get("cta"),
    });
  }

  return { purposes, errors };
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (char === "," && !inQuotes) { result.push(current); current = ""; continue; }
    current += char;
  }
  result.push(current);
  return result;
}

export function upsertPurposes(purposes: Purpose[], datasetId = "default", userId?: string): void {
  if (!userId) return;
  ensurePurposesStoreReady();
  const now = new Date().toISOString();
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO custom_purposes (user_id, dataset_id, purpose_id, payload_json, created_at, updated_at)
    VALUES (@user_id, @dataset_id, @purpose_id, @payload_json, @created_at, @updated_at)
    ON CONFLICT(user_id, dataset_id, purpose_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const tx = db.transaction((items: Purpose[]) => {
    for (const purpose of items) {
      upsert.run({
        user_id: userId,
        dataset_id: datasetId,
        purpose_id: purpose.purposeId,
        payload_json: JSON.stringify(purpose),
        created_at: now,
        updated_at: now,
      });
    }
  });
  tx(purposes);
}
