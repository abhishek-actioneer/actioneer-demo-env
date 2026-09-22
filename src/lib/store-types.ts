// ── SKU Types ──

export type SKUType = "consumable" | "non_consumable" | "subscription";
export type SKUStatus = "active" | "draft" | "archived";

export const SKU_TYPES: SKUType[] = ["consumable", "non_consumable", "subscription"];
export const SKU_STATUSES: SKUStatus[] = ["active", "draft", "archived"];

export const SKU_TYPE_LABELS: Record<SKUType, string> = {
  consumable: "Consumable",
  non_consumable: "Non-Consumable",
  subscription: "Subscription",
};

export const SKU_STATUS_LABELS: Record<SKUStatus, string> = {
  active: "Active",
  draft: "Draft",
  archived: "Archived",
};

export interface TerritoryPricing {
  territory: string;
  price: number;
  currency: string;
}

export interface SKUDiscount {
  id: string;
  type: "percentage" | "fixed";
  value: number;
  startDate: string;
  endDate: string;
  badge?: string;
}

export interface BundleItem {
  skuId: string;
  skuName: string;
  quantity: number;
}

export interface SKU {
  id: string;
  name: string;
  description: string;
  type: SKUType;
  status: SKUStatus;
  basePrice: number;
  currency: string;
  territoryPricing: TerritoryPricing[];
  discounts: SKUDiscount[];
  contents?: BundleItem[];
  purchaseLimit?: number;
  inventoryCount?: number;
  trackInventory: boolean;
  limitPerUser: boolean;
  tags: string[];
  effectiveDate?: string;
  expirationDate?: string;
  badge?: string;
  renewalPeriodDays?: number;
  createdAt: string;
  lastModified: string;
}

// ── Transaction Types ──

export type TransactionStatus =
  | "completed"
  | "pending"
  | "refunded"
  | "cancelled"
  | "failed";

export const TRANSACTION_STATUSES: TransactionStatus[] = [
  "completed",
  "pending",
  "refunded",
  "cancelled",
  "failed",
];

export interface Transaction {
  id: string;
  playerId: string;
  playerName: string;
  skuId: string;
  skuName: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  paymentMethod: string;
  createdAt: string;
  settledAt?: string;
  refundedAt?: string;
  gatewayRef: string;
  ipAddress: string;
  deviceType: string;
  settlementAmount?: number;
  fees?: number;
}

// ── Player Types ──

export type PlayerStatus = "active" | "banned";

export interface PlayerTopItem {
  skuId: string;
  skuName: string;
  count: number;
  totalSpent: number;
}

export interface PlayerActivity {
  date: string;
  action: string;
  detail: string;
}

export interface Player {
  id: string;
  name: string;
  email: string;
  status: PlayerStatus;
  ltv: number;
  aov: number;
  purchaseCount: number;
  firstPurchaseAt: string;
  lastActiveAt: string;
  createdAt: string;
  country: string;
  topItems: PlayerTopItem[];
  activityLog: PlayerActivity[];
}

// ── Store KPI Types ──

export interface StoreKPI {
  grossRevenue: number;
  grossRevenueChange: number;
  transactions: number;
  transactionsChange: number;
  arpu: number;
  arpuChange: number;
  aov: number;
  aovChange: number;
  refunds: number;
  refundsChange: number;
}

export interface RevenueDataPoint {
  date: string;
  revenue: number;
  transactions: number;
}

// ── Offer Types ──

export type OfferType = "discount_percentage" | "discount_fixed" | "price_override" | "bundle_deal";
export type OfferAudienceType = "all" | "segment" | "player_list";
export type OfferStatus = "draft" | "active" | "scheduled" | "expired" | "paused";

export const OFFER_TYPES: OfferType[] = ["discount_percentage", "discount_fixed", "price_override", "bundle_deal"];
export const OFFER_STATUSES: OfferStatus[] = ["draft", "active", "scheduled", "expired", "paused"];

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  discount_percentage: "% Discount",
  discount_fixed: "Fixed Discount",
  price_override: "Price Override",
  bundle_deal: "Bundle Deal",
};

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  draft: "Draft",
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  paused: "Paused",
};

export interface OfferPerformance {
  views: number;
  conversions: number;
  revenue: number;
  dailyRevenue: number[]; // last 14 days, most recent last
}

export interface Offer {
  id: string;
  name: string;
  skuId: string;
  skuName: string;
  type: OfferType;
  value: number;
  audienceType: OfferAudienceType;
  audienceValue?: string;
  startDate: string;
  endDate: string;
  status: OfferStatus;
  campaignId?: string;
  createdAt: string;
  createdBy: "sentinel" | "manual";
  performance: OfferPerformance;
}

// ── Campaign Types ──

export type CampaignStatus = "draft" | "active" | "completed";

export interface Campaign {
  id: string;
  name: string;
  description: string;
  goal: string;
  status: CampaignStatus;
  offerIds: string[];
  startDate: string;
  endDate: string;
  createdAt: string;
}

// ── Store Insight Types ──

export type InsightSeverity = "info" | "warning" | "opportunity";
export type InsightActionType = "create-offer" | "view-player" | "view-sku" | "view-transactions";

export interface StoreInsight {
  id: string;
  title: string;
  body: string;
  severity: InsightSeverity;
  actionLabel: string;
  actionType: InsightActionType;
  actionPayload?: Record<string, string>;
}
