"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { DatasetCard } from "@/components/onboarding/dataset-card";
import { setSelectedDataset, setWizardStep, completeWizard, getWizardState } from "@/lib/onboarding-wizard-store";
import { DEFAULT_SAMPLE_DATASETS } from "@/lib/datasets/constants";
import { apiFetch } from "@/lib/api-client";

type SampleDatasetId = (typeof DEFAULT_SAMPLE_DATASETS)[number];

interface SampleOption {
  id: SampleDatasetId;
  name: string;
  category: string;
  description: string;
}

const SAMPLE_OPTIONS: SampleOption[] = [
  {
    id: "vastu-hfc",
    name: "Banking & Lending",
    category: "NBFC · Bank · Fintech",
    description: "Origination funnels, portfolio quality, collections, and book economics.",
  },
  {
    id: "fundsindia",
    name: "Wealth & AMC",
    category: "Wealth · AMC",
    description: "SIP book health, AUM and flows, the investor funnel, and distributor performance.",
  },
  {
    id: "absli-life",
    name: "Life Insurance",
    category: "Insurance · BFSI",
    description: "Policy persistency, premium collections, distribution performance, and claims analytics.",
  },
  {
    id: "presto",
    name: "Consumer Apps & Gaming",
    category: "Apps · Games · Subs",
    description: "Acquisition and CPI, LTV and RoAS, retention cohorts, and monetization.",
  },
  {
    id: "quickhelp",
    name: "Consumer Services",
    category: "Q&A · Bookings · Marketplace",
    description: "Booking funnels, partner supply and utilization, repeat rate, and category economics.",
  },
  {
    id: "healthians",
    name: "Diagnostics",
    category: "At-Home · Preventive",
    description: "Test booking funnels, operations, sample-to-report SLAs, and city economics.",
  },
  {
    id: "hdfc-creditfraud",
    name: "Credit Risk",
    category: "Cards · Fraud · Risk Ops",
    description: "Fraud detection and typologies, alert quality, analyst SLAs, and chargebacks.",
  },
  {
    id: "yesbank-cards",
    name: "Credit Cards",
    category: "Cards · Growth · Cross-sell",
    description: "Campaign conversion, cross-sell and upgrades, rewards, spend, and portfolio economics.",
  },
  {
    id: "flipkart-marketplace",
    name: "E-Commerce",
    category: "Retail · Buyers · Sellers",
    description: "GMV and AOV, buyer acquisition and retention, the order funnel, and seller performance.",
  },
  {
    id: "suvidha-capital",
    name: "Consumer Finance",
    category: "Dealer POS · 2W/Durables · Cross-sell",
    description: "Dealer-sourced lending, EMI collections, delinquency, and cross-sell conversion.",
  },
  {
    id: "healthplus",
    name: "E-Pharmacy & Health",
    category: "Pharmacy · Diagnostics · Teleconsult",
    description: "E-pharmacy GMV and delivery SLAs, prescription verification, diagnostics operations, and retention campaigns.",
  },
];

const DEFAULT_PICK: SampleDatasetId = DEFAULT_SAMPLE_DATASETS[0];

function isSampleId(id: string): id is SampleDatasetId {
  return (DEFAULT_SAMPLE_DATASETS as readonly string[]).includes(id);
}

export default function CompleteStep() {
  const router = useRouter();
  const wizardState = getWizardState();
  // If user uploaded a CSV, their dataset ID is set in the wizard store and is not a sample.
  const uploadedDatasetId =
    wizardState.selectedDataset && !isSampleId(wizardState.selectedDataset)
      ? wizardState.selectedDataset
      : null;

  // Restore previous pick if user is returning to this step, else default to Presto.
  const initialPick: SampleDatasetId = isSampleId(wizardState.selectedDataset)
    ? wizardState.selectedDataset
    : DEFAULT_PICK;
  const [selected, setSelected] = useState<SampleDatasetId>(initialPick);
  const [saving, setSaving] = useState(false);

  async function handleContinue() {
    setSaving(true);
    const activeId = uploadedDatasetId ?? selected;
    setSelectedDataset(activeId);

    // Bridge wizard → DatasetProvider so the app opens with the right dataset.
    localStorage.setItem("sentinel-dataset-id", activeId);

    try {
      await apiFetch("/api/onboarding/complete", {
        method: "POST",
        skipDataset: true,
        skipModel: true,
        body: {
          orgName: wizardState.accountInfo?.orgName || undefined,
          // Store only the chosen dataset. Non-actioneer.com accounts are locked to
          // it (server-side); actioneer.com accounts are unrestricted and still see
          // every dataset regardless of what's stored here.
          selectedSampleDatasets: uploadedDatasetId ? [] : [selected],
        },
      });
    } catch (err) {
      // localStorage still has the right dataset — app can proceed.
      console.warn("[onboarding/complete] metadata write failed", err);
    }

    if (uploadedDatasetId) {
      // Uploaded dataset already processed — go straight to app
      setWizardStep("complete");
      completeWizard();
      router.push("/");
    } else {
      // Route sample-dataset users through the syncing page — same UX as uploads
      setWizardStep("syncing");
      router.push("/onboarding/syncing");
    }
  }

  function handleBack() {
    setWizardStep("connect");
    router.push("/onboarding/connect");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full max-w-4xl"
    >
      {uploadedDatasetId ? (
        <>
          <h1 className="text-2xl font-semibold text-[#18181b] text-center mb-2">
            Your Data Is Ready
          </h1>
          <p className="text-[11.7px] text-[#71717a] text-center mb-8 max-w-md mx-auto">
            We&apos;ve analyzed your dataset and built the schema. Ask your first question whenever you&apos;re ready.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-[#18181b] text-center mb-2">
            Pick Your Demo Dataset
          </h1>
          <p className="text-[11.7px] text-[#71717a] text-center mb-8 max-w-md mx-auto">
            Pick the one closest to your industry. You won&apos;t be able to change it later, so go with the best fit.
          </p>

          <div className="grid grid-cols-2 gap-3 mb-8">
            {SAMPLE_OPTIONS.map((opt) => (
              <DatasetCard
                key={opt.id}
                id={opt.id}
                name={opt.name}
                category={opt.category}
                description={opt.description}
                selected={selected === opt.id}
                onClick={() => setSelected(opt.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* CTA */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={handleBack}
          className="h-11 px-5 rounded-lg border border-[#e4e4e7] text-[12.6px] text-[#18181b] font-medium hover:bg-[#f4f4f5] active:scale-[0.97] transition-all flex items-center gap-1.5"
        >
          <ArrowLeft strokeLinecap="square" strokeLinejoin="miter" className="w-3.5 h-3.5" />
          Back
        </button>
        <button
          onClick={handleContinue}
          disabled={saving}
          className="h-11 px-10 rounded-lg bg-[#18181b] text-white text-[12.6px] font-medium hover:bg-[#18181b]/90 active:scale-[0.97] transition-all disabled:opacity-60"
        >
          {saving ? "Setting up..." : "Continue to Actioneer"}
        </button>
      </div>
    </motion.div>
  );
}
