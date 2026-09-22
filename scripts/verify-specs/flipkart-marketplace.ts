/**
 * Verification spec for the flipkart-marketplace dataset.
 *
 * Consumed by scripts/verify-dataset.ts. Provides:
 *  - structural: deterministic SQL (no LLM) covering every table/join/boolean.
 *  - L1/L2/L3:   natural-language prompts at three complexity tiers.
 *  - playbooks:  complex multi-step playbook requests (generated via the real
 *                runPlaybookGeneration core).
 *
 * L1 = single-table aggregate / simple group-by.
 * L2 = one join, time series, filtered ratio, or two-dimension group-by.
 * L3 = multi-table joins, CTEs, window functions, cohorts, funnels, diagnostics.
 */
import type { VerifySpec } from "../verify-dataset";

// ── dimension / metric vocabulary for template expansion ──
const ORDER_DIMS = ["order status", "channel", "payment method", "device", "city", "state"];
const CUST_DIMS = ["segment", "acquisition channel", "city tier", "age band", "gender", "Plus membership"];
const SELLER_DIMS = ["seller tier", "fulfilment model", "status", "primary category"];
const CATS = ["Mobiles", "Fashion", "Grocery", "Electronics", "Beauty & Grooming", "Home & Kitchen", "Large Appliances"];

// ── L1: single-table aggregates and simple group-bys ──
const L1: string[] = [
  "How many orders are in the dataset?",
  "How many customers do we have?",
  "How many sellers are on the marketplace?",
  "How many products are listed?",
  "How many returns have been filed?",
  "How many product reviews are there?",
  "How many browsing sessions were recorded?",
  "How many ad campaigns ran?",
  "What is the total GMV across all orders?",
  "What is the total commission revenue?",
  "What is the total refund value from returns?",
  "What is the average order value?",
  "What is the average product rating?",
  "What is the average number of items per order?",
  "What is the average delivery time in days?",
  "What is the average seller rating?",
  "What is the highest single order value?",
  "What is the average discount per order?",
  "How many orders used a coupon?",
  "How many orders were the customer's first order?",
  "How many Plus members do we have?",
  "How many Flipkart Assured sellers are there?",
  "What share of sessions resulted in an order?",
  "What share of sessions added something to cart?",
  ...ORDER_DIMS.map((d) => `How many orders are there by ${d}?`),
  ...ORDER_DIMS.map((d) => `What is the total GMV by ${d}?`),
  ...CUST_DIMS.map((d) => `How many customers are there by ${d}?`),
  ...SELLER_DIMS.map((d) => `How many sellers are there by ${d}?`),
  ...["category", "brand", "item status"].map((d) => `How many order items by ${d}?`),
  ...["method", "gateway", "payment status"].map((d) => `How many payments by ${d}?`),
  ...["reason", "return type", "resolution"].map((d) => `How many returns by ${d}?`),
  "What is the distribution of review ratings from 1 to 5?",
  "How many orders are delivered, cancelled, or in transit?",
  "What is the total ad spend?",
  "What is the total attributed GMV from ads?",
  "How many distinct cities do we ship to?",
  "How many distinct brands are sold?",
  "What is the median order value?",
  "What is the average refund amount on returns?",
  "How many products are Flipkart Assured?",
  "What is the average commission rate across sellers?",
];

// ── L2: one join, time series, filtered ratios, two-dim group-bys ──
const L2: string[] = [
  "What is the monthly GMV trend across the window?",
  "What is the monthly order count trend?",
  "How many new buyers signed up each month?",
  "What is the monthly average order value trend?",
  "What is the overall return rate against delivered items?",
  "What is the payment success rate?",
  "What is the on-time delivery (SLA) rate for delivered orders?",
  "What is the overall cart-abandonment rate?",
  "What is the browse-to-order conversion rate?",
  "What share of orders are placed by repeat buyers versus first-time buyers?",
  "What is the average order value for Plus members versus non-members?",
  "What is GMV by category?",
  "What is commission revenue by category?",
  "What is the return rate by category?",
  "What is the average rating by category?",
  "What is GMV by seller tier?",
  "What is the on-time delivery rate by fulfilment model?",
  "What is the average seller rating by seller tier?",
  "What is GMV by customer segment?",
  "What is the average order value by acquisition channel?",
  "How many orders come from each city tier?",
  "What is the conversion rate by channel?",
  "What is the add-to-cart rate by device?",
  "What is the payment method mix as a share of orders?",
  "What share of orders are Cash on Delivery?",
  "What is the cancellation rate by payment method?",
  "What is GMV by month for each sales channel?",
  "What is the return rate by category and return type?",
  "How does average order value differ between app and web?",
  "What is the refund value as a percentage of GMV?",
  "What is the average delivery time by city tier?",
  "Which months had the highest GMV?",
  "What is the repeat-purchase rate among buyers who ordered?",
  "What is the average number of orders per active buyer?",
  "What is GMV by state?",
  "What share of GMV comes from Flipkart Assured products?",
  "What is the average basket size by category?",
  "How many active versus churned sellers are there, and what GMV do they hold?",
  "What is the discount as a percentage of GMV by category?",
  "What is the EMI usage rate by order value band?",
  "What is the review rate (reviews per delivered item) by category?",
  ...CATS.map((c) => `What is the monthly GMV trend for ${c}?`),
  ...CUST_DIMS.slice(0, 4).map((d) => `What is total GMV by ${d}?`),
  ...["seller tier", "fulfilment model"].map((d) => `What is the return rate by ${d}?`),
  "What is the average rating for Flipkart Assured versus non-Assured products?",
  "What is the order cancellation rate by month?",
  "What is the new-buyer GMV versus repeat-buyer GMV each month?",
  "What is the average resolution time for returns by category?",
];

// ── L3: multi-table joins, CTEs, windows, cohorts, funnels, diagnostics ──
const L3: string[] = [
  "Show signup-cohort retention: for each monthly cohort, the share still ordering by months-since-signup.",
  "What is the median time-to-second-order for new buyers, and what share convert to a second order within 30, 60, and 90 days?",
  "Build the browse-to-order funnel (session → cart → checkout → order) with stage-to-stage conversion, split by channel.",
  "Compute return-adjusted margin by category: GMV, commission, refund leakage, and net contribution.",
  "Rank the top 20 sellers by GMV, showing their return rate, average rating, and on-time delivery rate.",
  "Quantify the Big Billion Days lift: compare daily average GMV and order count inside the sale windows versus the trailing baseline.",
  "What is the GMV concentration — what share of GMV comes from the top 10% of sellers?",
  "For buyers who purchased Mobiles, what other categories do they buy most, by GMV?",
  "Compare cohort retention curves across acquisition channels over the first six months.",
  "Which categories have the worst return-rate-to-rating ratio, signalling quality problems?",
  "Show the relationship between discount depth bands and return rate by category.",
  "Compute customer lifetime value by segment: average GMV, order count, and tenure.",
  "Which seller tier and fulfilment-model combination delivers the best on-time rate and lowest return rate?",
  "What share of each monthly cohort's GMV is realized in months 0, 1-3, and 4+ after signup?",
  "Identify the top 15 products by GMV with their seller tier, rating, and return rate.",
  "Do Plus members differ from non-members on order frequency, AOV, return rate, and category mix?",
  "What is the ad ROAS by campaign type and seller tier, and which combination is most efficient?",
  "Compute the month-over-month GMV growth rate for each category and rank by fastest growth.",
  "What share of new buyers acquired in each channel become repeat buyers within 90 days?",
  "Break GMV into new-buyer versus repeat-buyer contribution by month and category.",
  "Which cities have the highest GMV but also the worst delivery SLA — the at-risk growth markets?",
  "For each seller tier, what is the average days-from-onboarding to first sale?",
  "Compute the effective take-rate (commission / GMV) by category and seller tier.",
  "Rank acquisition channels by blended value: buyers acquired, repeat rate, AOV, and total GMV.",
  "How does on-time delivery correlate with review rating at the order level?",
  "What is the festival-period share of annual GMV by category?",
  "Show the cart-abandonment rate by channel and device, and the GMV left in abandoned carts.",
  "Which categories see the biggest demand spike during Diwali versus their baseline?",
  "Compute repeat-purchase rate by first-order category — which entry category retains buyers best?",
  "What is the distribution of orders-per-buyer, and what share of GMV does each frequency band drive?",
  "Identify sellers whose return rate is more than double their tier average.",
  "What is the average order value trend for Plus members versus non-members over the window?",
  "Compute the payment-failure rate by method and its correlation with cancellation.",
  "Which brands have the highest GMV but below-average ratings — reputation risks?",
  "Show monthly active buyers and the new-versus-returning split.",
  "What is the refund-leakage rate by seller tier and category combined?",
  "Rank states by GMV per buyer, joining orders to customers.",
  "For the top 5 categories by GMV, show the month-by-month order trend in one result.",
  "What share of delivered items are reviewed, by category and seller tier?",
  "Compute a seller scorecard: GMV, orders, return rate, rating, on-time rate, and ad ROAS per seller for the top 30 sellers.",
];

// ── 50 complex playbook requests (multi-step, multi-table) ──
const PLAYBOOKS: string[] = [
  "Build a marketplace GMV health dashboard: monthly GMV, AOV, order volume, and the new-vs-repeat split, with festival periods flagged.",
  "Create a buyer retention playbook: signup-cohort retention curves, repeat-purchase rate, time-to-second-order, and the segments most at risk of churn.",
  "Analyze category performance end to end: GMV, commission, return rate, ratings, and return-adjusted margin, flagging the worst categories.",
  "Build a conversion-funnel diagnostic: session → cart → checkout → order by channel and device, with the biggest drop-off points and abandoned-cart GMV.",
  "Create a seller performance scorecard: GMV, on-time delivery, return rate, rating, and ad ROAS by seller tier and fulfilment model.",
  "Analyze the Big Billion Days sale: lift versus baseline, category mix during the sale, new-buyer acquisition, and post-sale retention.",
  "Build a returns and refund-leakage analysis: return rate and refund value by category, reason, seller tier, and resolution outcome.",
  "Create an acquisition-channel value playbook: buyers, CAC proxy, repeat rate, AOV, and lifetime GMV by acquisition channel.",
  "Analyze Plus membership impact: order frequency, AOV, return behavior, category mix, and retention versus non-members.",
  "Build a take-rate and monetization analysis: commission revenue and effective take-rate by category and seller tier, plus ad revenue.",
  "Create a geographic growth playbook: GMV by state and city tier, delivery SLA by region, and at-risk high-GMV-low-SLA markets.",
  "Analyze payment behavior: method mix, success and failure rates, COD versus prepaid cancellation, and EMI adoption.",
  "Build a product-quality monitor: products and brands with high GMV but poor ratings or high return rates.",
  "Create a cohort LTV playbook: lifetime GMV and order count by signup cohort and segment, with retention decay.",
  "Analyze cross-sell opportunities: for buyers of each top category, the next categories they buy and the GMV upside.",
  "Build a delivery-performance playbook: on-time rate by seller tier, fulfilment model, and region, and its effect on ratings.",
  "Create an ad-efficiency analysis: spend, attributed GMV, ROAS, and CTR by campaign type and seller tier, with the best and worst performers.",
  "Analyze discount effectiveness: discount depth versus AOV, return rate, and repeat purchase, by category.",
  "Build a new-seller ramp playbook: time from onboarding to first sale and GMV trajectory in the first 90 days by tier.",
  "Create a marketplace concentration analysis: GMV share of the top sellers and top products, and dependency risk.",
  "Analyze festive-season demand by category across both Diwali periods versus baseline, with inventory implications.",
  "Build a repeat-purchase driver analysis: how first-order category, channel, and delivery experience affect the second purchase.",
  "Create a buyer-segmentation playbook: New/Casual/Core/VIP sizing, GMV share, category preferences, and movement between segments.",
  "Analyze cancellation drivers: cancellation rate by payment method, category, channel, and delivery promise.",
  "Build a seller-churn early-warning playbook: GMV decline, rising return rate, and rating drop among at-risk sellers.",
  "Create a category margin waterfall: from GMV to commission to refund leakage to net contribution, ranked by category.",
  "Analyze mobile-app versus web behavior: conversion, AOV, category mix, and retention by platform.",
  "Build a review-and-rating analysis: rating distribution by category and seller tier, review rate, and rating versus return correlation.",
  "Create a high-value-buyer (VIP) playbook: who they are, what they buy, their channels, and their retention.",
  "Analyze the relationship between delivery speed and customer outcomes: ratings, returns, and repeat rate by delivery-days band.",
  "Build a monthly executive summary: GMV, orders, AOV, conversion, return rate, new buyers, and top categories in one playbook.",
  "Create a coupon-effectiveness playbook: redemption by code, incremental AOV, return rate, and repeat behavior of coupon users.",
  "Analyze grocery versus fashion versus electronics economics: frequency, AOV, margin, and return profile side by side.",
  "Build a buyer-activation playbook: signup-to-first-order conversion by acquisition channel and the time it takes.",
  "Create a returns-cost playbook: total refund value, replacement versus refund split, and the categories and sellers driving cost.",
  "Analyze GMV seasonality: month-by-month index, festival peaks, and the categories most and least seasonal.",
  "Build a top-seller dependency report: GMV, category, return rate, and what share of marketplace GMV the top 50 sellers control.",
  "Create a funnel-by-segment playbook: conversion funnel split by buyer segment and the stages each segment drops at.",
  "Analyze price-point performance: AOV bands by category and their return and repeat rates.",
  "Build a city-level growth scorecard: GMV, buyers, AOV, conversion, and delivery SLA for the top 15 cities.",
  "Create a commission-revenue forecast input: monthly take-rate revenue trend by category and seller tier.",
  "Analyze the impact of Flipkart Assured: GMV, return rate, rating, and conversion for Assured versus non-Assured.",
  "Build a wallet-and-EMI adoption playbook: usage by order value, category, and buyer segment.",
  "Create a first-order-experience playbook: how delivery, returns, and ratings on the first order affect retention.",
  "Analyze cross-category buyers versus single-category buyers: GMV, frequency, and retention differences.",
  "Build a seller-tier upgrade analysis: GMV and quality differences across Bronze/Silver/Gold/Platinum and what separates them.",
  "Create a demand-concentration playbook: how much GMV the top 1% of products and buyers each represent.",
  "Analyze channel-shift over time: how the app/web/mweb mix and their conversion have changed month over month.",
  "Build a refund-and-replacement SLA playbook: resolution time by category and outcome, and the pending-return backlog.",
  "Create a marketplace KPI tree: decompose GMV into buyers × orders-per-buyer × AOV and attribute monthly change to each driver.",
];

// ── template expansion to widen coverage to the 300-400 NL range ──
const L1_METRICS = ["total GMV", "order count", "average order value", "total commission revenue", "total discount given"];
const L1_DIMS = ["channel", "payment method", "device", "city tier", "order status", "month"];
for (const m of L1_METRICS) for (const d of L1_DIMS) L1.push(`What is ${m} by ${d}?`);
for (const d of CUST_DIMS) L1.push(`What is total GMV by customer ${d}?`);
for (const c of CATS) L1.push(`How many orders included a ${c} item?`);

const L2_METRICS = ["GMV", "order count", "average order value", "number of active buyers"];
const L2_DIMS = ["category", "channel", "city tier", "customer segment", "seller tier"];
for (const m of L2_METRICS) for (const d of L2_DIMS) L2.push(`What is the monthly ${m} trend by ${d}?`);
for (const c of CATS) L2.push(`What is the return rate and average rating for ${c}?`);
for (const d of ["seller tier", "fulfilment model", "city tier", "channel"]) L2.push(`What is the on-time delivery rate by ${d}?`);

for (const c of CATS)
  L3.push(`For ${c}, show monthly GMV, return rate, average rating, and the repeat-purchase rate of buyers whose first order was in this category.`);
for (const ch of ["Organic", "Google Ads", "Meta Ads", "Referral"])
  L3.push(`For buyers acquired via ${ch}, show their 6-month retention, AOV, repeat rate, and top categories.`);
for (const t of ["Bronze", "Silver", "Gold", "Platinum"])
  L3.push(`Profile ${t} sellers: GMV, on-time rate, return rate, rating, ad ROAS, and GMV share of the marketplace.`);

// second expansion wave to clear 300+ NL prompts
const TOP_CITIES = ["Mumbai", "Delhi NCR", "Bengaluru", "Hyderabad", "Chennai", "Pune", "Kolkata"];
for (const c of CATS) L1.push(`What is the total GMV for the ${c} category?`);
for (const ct of ["Tier 1", "Tier 2", "Tier 3"]) L1.push(`How many orders come from ${ct} cities?`);
for (const d of ["channel", "payment method", "city tier", "segment"]) L2.push(`What is the conversion rate by ${d}?`);
for (const d of ["category", "seller tier", "city tier"]) L2.push(`What is the average review rating by ${d}?`);
for (const c of TOP_CITIES) L2.push(`What is the GMV, order count, and average order value for ${c}?`);
for (const pm of ["UPI", "Card", "COD", "EMI"]) L2.push(`What is the average order value and cancellation rate for ${pm} orders?`);
for (const city of TOP_CITIES)
  L3.push(`Build a ${city} market scorecard: GMV, buyers, AOV, conversion rate, top categories, and delivery SLA.`);
for (const seg of ["New", "Casual", "Core", "VIP"])
  L3.push(`Profile the ${seg} buyer segment: size, GMV share, category mix, channel mix, return rate, and retention.`);

// ── persona / dimension-slicing wave (channel × device × browser × tier × CAC × time) ──
const BROWSERS = ["Chrome", "Safari", "Samsung Internet"];
const DEVICES = ["Android", "iOS", "Desktop"];
const TIERS = ["1", "2", "3", "4"];

// L1 persona
for (const b of BROWSERS) L1.push(`How many orders came from the ${b} browser?`);
for (const d of DEVICES) L1.push(`How many orders came from ${d} devices?`);
for (const t of TIERS) L1.push(`How many orders came from tier-${t} cities?`);
L1.push("What is the total buyer-acquisition marketing spend?");
L1.push("How many new buyers were acquired by each channel?");
L1.push("What is the blended customer acquisition cost (CAC)?");
L1.push("What is the CAC by acquisition channel?");
for (const b of BROWSERS) L1.push(`How many sessions came from ${b}?`);

// L2 persona
L2.push("What is the conversion rate by browser?");
L2.push("What is the conversion rate by device?");
L2.push("What is the average order value by browser?");
L2.push("What is the average order value by city tier?");
L2.push("What is the monthly CAC trend?");
L2.push("What is the monthly buyer-acquisition spend by channel?");
L2.push("How many new buyers were acquired each month by channel?");
L2.push("Android app versus iPhone app: order volume, AOV, and conversion rate.");
L2.push("Safari versus Chrome: conversion rate and average order value.");
L2.push("How does average order value compare across city tiers 1 to 4?");
L2.push("How do tier-4 town buyers compare to metro buyers on AOV and order frequency?");
L2.push("What is the order trend across January, February, and March each year?");
L2.push("What is GMV by device and channel combined?");
for (const t of TIERS) L2.push(`What are the top categories by GMV in tier-${t} cities?`);

// L3 persona (rich multi-dimension)
L3.push("Build a CAC-to-LTV analysis by acquisition channel: CAC, the GMV those buyers generate, and the implied payback.");
L3.push("Compare buyer personas across city tiers 1 to 4: AOV, category mix, conversion, return rate, and repeat rate.");
L3.push("iPhone (iOS) versus Android app buyers: GMV, AOV, category mix, conversion, and retention.");
L3.push("Build a browser-level funnel: session-to-order conversion by browser and device, with drop-off stages.");
L3.push("How does CAC by channel compare to the AOV and repeat rate of the buyers acquired through that channel?");
L3.push("Profile tier-2 and tier-3 city growth: GMV trend, new buyers, AOV, and top categories versus metros.");
L3.push("Acquisition cohort quality: for each channel, CAC versus the GMV those buyers generate, ranked by efficiency.");
L3.push("Persona deep-dive: 18-24-year-old tier-2 Android buyers — size, top categories, AOV, channels, and retention.");
L3.push("Did CAC rise during the Big Billion Days window, and were buyers acquired then higher or lower value?");
L3.push("Build a channel × device × city-tier matrix of conversion rate and average order value.");
L3.push("Which acquisition channels have the worst CAC-to-LTV ratio and should be cut?");
L3.push("Compare the funnel (cart, checkout, order rates) for Chrome on Android versus Safari on iOS.");

// persona playbooks
PLAYBOOKS.push("Build a buyer-acquisition (CAC) playbook: marketing spend, new buyers, CAC, and CAC-to-LTV by channel and month, flagging inefficient channels.");
PLAYBOOKS.push("Create a device-and-browser experience playbook: conversion, AOV, and funnel drop-off by device (Android/iOS/Desktop) and browser (Chrome/Safari), highlighting the worst platform experience.");
PLAYBOOKS.push("Analyze tier-wise growth: a city-tier 1-4 scorecard of GMV, buyers, AOV, conversion, return rate, and delivery SLA, with the fastest-growing tier.");
PLAYBOOKS.push("Build a buyer-persona playbook: segment buyers by city tier × device × age band and profile GMV, category mix, channel, and retention for each persona.");
PLAYBOOKS.push("Create an acquisition-efficiency playbook: rank channels by CAC, payback, and the quality (repeat rate, AOV, return rate) of the buyers they bring.");

// ── buyer-journey wave: acquisition channel shapes conversion speed & quality ──
L2.push("What is the median time from signup to first order by acquisition channel?");
L2.push("Which acquisition channel converts buyers fastest from signup to first order?");
L2.push("What is the second-order conversion rate by acquisition channel?");
L2.push("How does AOV differ across acquisition channels?");
L3.push("Map the full buyer journey by acquisition channel: signup-to-first-order lag, share that ever order, repeat rate, AOV, and the GMV they generate — which channels bring the best buyers?");
L3.push("Do App Store buyers convert faster and retain better than Google Ads or Affiliate buyers? Compare days-to-first-order, repeat rate, and AOV.");
L3.push("Compare acquisition channels on speed (days to first order), quality (repeat rate, AOV), and cost (CAC) to find the most efficient channel.");
L3.push("For each acquisition channel, build the activation funnel: signups, share that place a first order, median days to first order, and second-order rate.");
L3.push("Which acquisition channels have fast activation but poor retention (quick to convert, quick to churn)?");
L3.push("Rank acquisition channels by CAC-to-LTV, factoring in activation speed and repeat behavior.");
PLAYBOOKS.push("Build an end-to-end buyer-journey playbook by acquisition channel: from CAC and signup, through activation speed and first order, to repeat rate, AOV, and lifetime GMV — ranking channels by overall quality and efficiency.");
PLAYBOOKS.push("Create a channel-conversion-velocity playbook: time-to-first-order, first-to-second-order lag, and how activation speed correlates with long-term value, by acquisition channel.");

// dedupe (template grids can overlap curated prompts)
const dedupe = (a: string[]) => Array.from(new Set(a));

export const spec: VerifySpec = {
  datasetId: "flipkart-marketplace",
  label: "Flipkart Marketplace",
  L1: dedupe(L1),
  L2: dedupe(L2),
  L3: dedupe(L3),
  playbooks: PLAYBOOKS,
};

export default spec;
