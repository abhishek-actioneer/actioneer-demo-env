/**
 * Public inbound router destinations for the TVS demo.
 * IVR host is Vani; spoken route soft-swaps into a campaign agent (Ananya).
 */

import {
  TVS_COLLECTION_CAMPAIGN_NAME,
  TVS_COLLECTION_COMPANY,
  TVS_COLLECTION_EDITABLE_SCRIPT,
  TVS_COLLECTION_FIRST_MESSAGE,
  TVS_COLLECTION_VOICE_NAME,
} from "./tvs-collection-script";
import {
  TVS_LEAD_QUAL_CAMPAIGN_NAME,
  TVS_LEAD_QUAL_COMPANY,
  TVS_LEAD_QUAL_EDITABLE_SCRIPT,
  TVS_LEAD_QUAL_FIRST_MESSAGE,
  TVS_LEAD_QUAL_VOICE_NAME,
} from "./tvs-lead-qualification-script";

export type PublicDemoPersonaId = "collection" | "lead-qualification";

export interface PublicDemoPersona {
  id: PublicDemoPersonaId;
  label: string;
  spokenBlurb: string;
  selectionHints: string[];
  campaignName: string;
  companyName: string;
  voiceName: string;
  firstMessage: string;
  /** Campaign Studio editableScript body. */
  editableScript: string;
  /** Optional live campaign id once seeded into voice-campaigns.json. */
  campaignIdEnv: string;
}

export const PUBLIC_DEMO_PERSONAS: readonly PublicDemoPersona[] = [
  {
    id: "collection",
    label: "Home loan collection",
    spokenBlurb: "TVS Finance home-loan disbursement and EMI welcome / collection conversation",
    selectionHints: [
      "collection",
      "collections",
      "emi",
      "disbursement",
      "home loan",
      "home-loan",
      "homeloan",
      "enquiry",
      "inquiry",
      "repayment",
      "welcome",
      "refund",
      "one",
      "first",
      "कलेक्शन",
      "कम्यून",
      "ईएमआई",
      "होम लोन",
    ],
    campaignName: TVS_COLLECTION_CAMPAIGN_NAME,
    companyName: TVS_COLLECTION_COMPANY,
    voiceName: TVS_COLLECTION_VOICE_NAME,
    firstMessage: TVS_COLLECTION_FIRST_MESSAGE,
    editableScript: TVS_COLLECTION_EDITABLE_SCRIPT,
    campaignIdEnv: "PUBLIC_DEMO_CAMPAIGN_COLLECTION_ID",
  },
  {
    id: "lead-qualification",
    label: "Two-wheeler finance",
    spokenBlurb: "TVS Credit two-wheeler finance lead qualification conversation",
    selectionHints: [
      "lead",
      "qualification",
      "two wheeler",
      "two-wheeler",
      "bike",
      "finance",
      "sales",
      "raider",
      "tvs credit",
      "two",
      "second",
      "बाइक",
      "फाइनेंस",
      "लीड",
    ],
    campaignName: TVS_LEAD_QUAL_CAMPAIGN_NAME,
    companyName: TVS_LEAD_QUAL_COMPANY,
    voiceName: TVS_LEAD_QUAL_VOICE_NAME,
    firstMessage: TVS_LEAD_QUAL_FIRST_MESSAGE,
    editableScript: TVS_LEAD_QUAL_EDITABLE_SCRIPT,
    campaignIdEnv: "PUBLIC_DEMO_CAMPAIGN_LEAD_ID",
  },
] as const;

export function getPublicDemoPersona(id: PublicDemoPersonaId): PublicDemoPersona {
  const found = PUBLIC_DEMO_PERSONAS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown public demo persona: ${id}`);
  return found;
}

export const PUBLIC_DEMO_DATASET_ID = "vastu-hfc";
export const PUBLIC_DEMO_CAMPAIGN_ID = "public-demo-inbound-router";
/** IVR / welcome host on the public demo DID (routes to campaign agents). */
export const PUBLIC_DEMO_ROUTER_AGENT_NAME = "Vani";
/** @deprecated Use PUBLIC_DEMO_ROUTER_AGENT_NAME — router is Vani; campaigns keep their own voiceName. */
export const PUBLIC_DEMO_AGENT_NAME = PUBLIC_DEMO_ROUTER_AGENT_NAME;
