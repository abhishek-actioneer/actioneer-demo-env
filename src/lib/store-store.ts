import type {
  SKU,
  Transaction,
  Player,
  StoreKPI,
  RevenueDataPoint,
  Offer,
  Campaign,
  StoreInsight,
} from "./store-types";
import {
  MOCK_SKUS,
  MOCK_TRANSACTIONS,
  MOCK_PLAYERS,
  MOCK_STORE_KPIS,
  MOCK_REVENUE_CHART,
  MOCK_OFFERS,
  MOCK_CAMPAIGNS,
} from "./store-data";

const skus = new Map<string, SKU>();
const transactions = new Map<string, Transaction>();
const players = new Map<string, Player>();
const offers = new Map<string, Offer>();
const campaigns = new Map<string, Campaign>();
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  MOCK_SKUS.forEach((s) => skus.set(s.id, s));
  MOCK_TRANSACTIONS.forEach((t) => transactions.set(t.id, t));
  MOCK_PLAYERS.forEach((p) => players.set(p.id, p));
  MOCK_OFFERS.forEach((o) => offers.set(o.id, o));
  MOCK_CAMPAIGNS.forEach((c) => campaigns.set(c.id, c));
}

// ── SKU CRUD ──

export function getAllSKUs(): SKU[] {
  ensureInitialized();
  return Array.from(skus.values()).sort(
    (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
  );
}

export function getSKU(id: string): SKU | undefined {
  ensureInitialized();
  return skus.get(id);
}

export function createSKU(sku: SKU): boolean {
  try {
    ensureInitialized();
    skus.set(sku.id, sku);
    return true;
  } catch {
    return false;
  }
}

export function updateSKU(id: string, changes: Partial<Omit<SKU, "id">>): boolean {
  try {
    ensureInitialized();
    const existing = skus.get(id);
    if (!existing) return false;
    skus.set(id, { ...existing, ...changes, lastModified: new Date().toISOString().split("T")[0] });
    return true;
  } catch {
    return false;
  }
}

export function deleteSKU(id: string): boolean {
  try {
    ensureInitialized();
    return skus.delete(id);
  } catch {
    return false;
  }
}

// ── Transaction CRUD ──

export function getAllTransactions(): Transaction[] {
  ensureInitialized();
  return Array.from(transactions.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getTransaction(id: string): Transaction | undefined {
  ensureInitialized();
  return transactions.get(id);
}

export function updateTransaction(
  id: string,
  changes: Partial<Omit<Transaction, "id">>
): boolean {
  try {
    ensureInitialized();
    const existing = transactions.get(id);
    if (!existing) return false;
    transactions.set(id, { ...existing, ...changes });
    return true;
  } catch {
    return false;
  }
}

// ── Player CRUD ──

export function getAllPlayers(): Player[] {
  ensureInitialized();
  return Array.from(players.values()).sort((a, b) => b.ltv - a.ltv);
}

export function getPlayer(id: string): Player | undefined {
  ensureInitialized();
  return players.get(id);
}

export function updatePlayer(
  id: string,
  changes: Partial<Omit<Player, "id">>
): boolean {
  try {
    ensureInitialized();
    const existing = players.get(id);
    if (!existing) return false;
    players.set(id, { ...existing, ...changes });
    return true;
  } catch {
    return false;
  }
}

// ── Aggregates ──

export function getStoreKPIs(): StoreKPI {
  return MOCK_STORE_KPIS;
}

export function getRevenueChartData(): RevenueDataPoint[] {
  return MOCK_REVENUE_CHART;
}

export function getPlayerTransactions(playerId: string): Transaction[] {
  ensureInitialized();
  return Array.from(transactions.values())
    .filter((t) => t.playerId === playerId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ── Offer CRUD ──

export function getAllOffers(): Offer[] {
  ensureInitialized();
  return Array.from(offers.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getOffer(id: string): Offer | undefined {
  ensureInitialized();
  return offers.get(id);
}

export function createOffer(offer: Offer): boolean {
  try {
    ensureInitialized();
    offers.set(offer.id, offer);
    return true;
  } catch {
    return false;
  }
}

export function updateOffer(id: string, changes: Partial<Omit<Offer, "id">>): boolean {
  try {
    ensureInitialized();
    const existing = offers.get(id);
    if (!existing) return false;
    offers.set(id, { ...existing, ...changes });
    return true;
  } catch {
    return false;
  }
}

export function deleteOffer(id: string): boolean {
  try {
    ensureInitialized();
    return offers.delete(id);
  } catch {
    return false;
  }
}

export function getOffersByCampaign(campaignId: string): Offer[] {
  ensureInitialized();
  return Array.from(offers.values()).filter((o) => o.campaignId === campaignId);
}

// ── Campaign CRUD ──

export function getAllCampaigns(): Campaign[] {
  ensureInitialized();
  return Array.from(campaigns.values());
}

export function getCampaign(id: string): Campaign | undefined {
  ensureInitialized();
  return campaigns.get(id);
}

// ── Store Insights ──

export function getStoreInsights(): StoreInsight[] {
  ensureInitialized();
  const allPlayers = Array.from(players.values()).sort((a, b) => b.ltv - a.ltv);
  const allTxs = Array.from(transactions.values());
  const allSkus = Array.from(skus.values());
  const insights: StoreInsight[] = [];

  // 1. Revenue concentration
  const topPlayer = allPlayers[0];
  const totalLTV = allPlayers.reduce((s, p) => s + p.ltv, 0);
  const topPct = Math.round((topPlayer.ltv / totalLTV) * 100);
  insights.push({
    id: "ins-concentration",
    title: "Revenue concentration risk",
    body: `${topPlayer.name} accounts for ${topPct}% of total player LTV. Heavy dependency on a single spender.`,
    severity: "warning",
    actionLabel: "View Player",
    actionType: "view-player",
    actionPayload: { playerId: topPlayer.id },
  });

  // 2. Discount conversion uplift
  const discountedSku = allSkus.find((s) => s.discounts.length > 0);
  if (discountedSku) {
    insights.push({
      id: "ins-discount-uplift",
      title: `${discountedSku.name} conversion up 18%`,
      body: `Since the ${discountedSku.discounts[0].value}% discount started, conversions have increased. Discount is effective.`,
      severity: "opportunity",
      actionLabel: "View SKU",
      actionType: "view-sku",
      actionPayload: { skuId: discountedSku.id },
    });
  }

  // 3. Banned players + refund rate
  const bannedCount = allPlayers.filter((p) => p.status === "banned").length;
  const refundedTxs = allTxs.filter((t) => t.status === "refunded").length;
  const refundRate = Math.round((refundedTxs / allTxs.length) * 100);
  insights.push({
    id: "ins-banned",
    title: `${bannedCount} players banned in last 14 days`,
    body: `Refund rate at ${refundRate}%. Review flagged accounts for suspicious activity.`,
    severity: "warning",
    actionLabel: "View Transactions",
    actionType: "view-transactions",
  });

  // 4. Inventory velocity
  const limitedSku = allSkus.find((s) => s.trackInventory && s.inventoryCount != null && s.inventoryCount < 300);
  if (limitedSku) {
    insights.push({
      id: "ins-inventory",
      title: `${limitedSku.name} inventory running low`,
      body: `${limitedSku.inventoryCount} units remaining, selling ~5/day. ~${Math.round((limitedSku.inventoryCount ?? 0) / 5)} days of stock left.`,
      severity: "info",
      actionLabel: "View SKU",
      actionType: "view-sku",
      actionPayload: { skuId: limitedSku.id },
    });
  }

  // 5. JP localization gap
  const activeSkus = allSkus.filter((s) => s.status === "active");
  const jpMissing = activeSkus.filter((s) => !s.territoryPricing.some((tp) => tp.territory === "JP")).length;
  if (jpMissing > 0) {
    insights.push({
      id: "ins-jp-pricing",
      title: "JP players underserved",
      body: `${jpMissing} of ${activeSkus.length} active SKUs have no JPY pricing. JP players pay base USD price.`,
      severity: "opportunity",
      actionLabel: "Create Offer",
      actionType: "create-offer",
      actionPayload: { audienceType: "segment", audienceValue: "JP Players" },
    });
  }

  // 6. New player cohort
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newPlayers = allPlayers.filter((p) => new Date(p.createdAt).getTime() > weekAgo);
  if (newPlayers.length > 0) {
    const avgAov = newPlayers.reduce((s, p) => s + p.aov, 0) / newPlayers.length;
    insights.push({
      id: "ins-new-players",
      title: `${newPlayers.length} new players this week`,
      body: `Average first-purchase AOV of $${avgAov.toFixed(2)}. Consider a welcome offer to boost conversion.`,
      severity: "opportunity",
      actionLabel: "Create Offer",
      actionType: "create-offer",
      actionPayload: { audienceType: "segment", audienceValue: "New Players" },
    });
  }

  return insights;
}
