"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { RiUpload2Line, RiDatabase2Line } from "@remixicon/react";
import { setWizardStep, setSelectedConnectors, setSelectedDataset } from "@/lib/onboarding-wizard-store";
import { setPendingUpload } from "@/lib/onboarding-upload-store";
import { slugify } from "@/lib/datasets/utils";

export default function ConnectStep() {
  const router = useRouter();
  const [mode, setMode] = useState<"choose" | "upload">("choose");

  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSampleData() {
    setSelectedConnectors([]);
    setSelectedDataset(""); // Clear any stale upload dataset so Complete page shows the picker grid
    setWizardStep("complete");
    router.push("/onboarding/complete");
  }

  function handleBack() {
    if (mode === "upload") {
      setMode("choose");
      setFile(null);
      setLabel("");
      setLabelTouched(false);
      setError(null);
      return;
    }
    setWizardStep("account");
    router.push("/onboarding/account");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setError(null);
    if (!labelTouched) {
      setLabel(
        picked.name
          .replace(/\.[^.]+$/, "")
          .replace(/[-_]+/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .trim()
      );
    }
    e.target.value = "";
  }

  function handleContinue() {
    if (!file || !label.trim()) return;

    if (!slugify(label.trim())) {
      setError("Name must contain at least one letter or number.");
      return;
    }

    const sizeLimitMB = file.name.toLowerCase().endsWith(".duckdb") ? 150 : 50;
    if (file.size > sizeLimitMB * 1024 * 1024) {
      setError(`File exceeds the ${sizeLimitMB} MB limit.`);
      return;
    }

    // Store file in memory for the syncing page to pick up
    setPendingUpload(file, label.trim());
    setSelectedConnectors(["csv-upload"]);
    setWizardStep("syncing");
    router.push("/onboarding/syncing");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full max-w-lg"
    >
      <h1 className="text-[19.8px] font-semibold text-[#18181b] text-center mb-2">
        Bring Your Data
      </h1>
      <p className="text-[11.7px] text-[#71717a] text-center mb-10">
        Upload your own dataset, or start with one of ours.
      </p>

      {mode === "choose" ? (
        <div className="space-y-3">
          {/* Upload CSV */}
          <button
            onClick={() => setMode("upload")}
            className="group relative flex items-center gap-4 w-full px-5 py-5 rounded-xl text-left transition-all duration-150 border border-[#e4e4e7] bg-white hover:border-[#a1a1aa] shadow-sm"
          >
            <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center bg-[#f4f4f5]">
              <RiUpload2Line size={18} className="text-[#71717a]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.6px] font-medium text-[#18181b]">Upload CSV</p>
              <p className="text-[10.8px] text-[#71717a] mt-0.5">
                Import your data and we&apos;ll build the schema for you.
              </p>
            </div>
            <ArrowRight strokeLinecap="square" strokeLinejoin="miter" className="w-4 h-4 text-[#71717a] group-hover:text-[#18181b] transition-colors shrink-0" />
          </button>

          {/* Use sample data */}
          <button
            onClick={handleSampleData}
            className="group relative flex items-center gap-4 w-full px-5 py-5 rounded-xl text-left transition-all duration-150 border border-[#e4e4e7] bg-white hover:border-[#a1a1aa] shadow-sm"
          >
            <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center bg-[#f4f4f5]">
              <RiDatabase2Line size={18} className="text-[#71717a]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.6px] font-medium text-[#18181b]">Use Sample Data</p>
              <p className="text-[10.8px] text-[#71717a] mt-0.5">
                Explore a preloaded, industry-specific dataset.
              </p>
            </div>
            <ArrowRight strokeLinecap="square" strokeLinejoin="miter" className="w-4 h-4 text-[#71717a] group-hover:text-[#18181b] transition-colors shrink-0" />
          </button>
        </div>
      ) : (
        /* Upload form */
        <motion.div
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          {/* File picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.duckdb"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2.5 w-full py-8 border-2 border-dashed border-[#e4e4e7] rounded-xl text-[#71717a] hover:border-[#18181b] hover:text-[#18181b] transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-[#f4f4f5] flex items-center justify-center">
              <RiUpload2Line size={18} />
            </div>
            {file ? (
              <div className="text-center">
                <p className="text-[12.6px] font-medium text-[#18181b]">{file.name}</p>
                <p className="text-[9.9px] text-[#71717a] mt-0.5">Click to replace</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-[12.6px] font-medium">Choose a File</p>
                <p className="text-[9.9px] text-[#71717a] mt-0.5">.csv or .duckdb &middot; max 50 MB</p>
              </div>
            )}
          </button>

          {/* Label */}
          <div>
            <label className="text-[10.8px] text-[#71717a] mb-1.5 block">Dataset Name</label>
            <input
              type="text"
              value={label}
              onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); setError(null); }}
              placeholder="e.g. Q4 Sales Data"
              className="w-full h-11 px-4 rounded-lg bg-white border border-[#e4e4e7] text-[12.6px] text-[#18181b] placeholder:text-[#a1a1aa] focus:border-[#71717a] focus:outline-none transition-colors"
            />
          </div>

          {error && (
            <p className="text-[10.8px] text-[#dc2626]">{error}</p>
          )}

          {/* Continue button */}
          <button
            onClick={handleContinue}
            disabled={!file || !label.trim()}
            className="w-full h-11 rounded-lg text-[12.6px] font-medium bg-[#18181b] text-white hover:bg-[#18181b]/90 active:scale-[0.97] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Upload & Continue
          </button>
        </motion.div>
      )}

      {/* Back */}
      <div className="mt-10">
        <button
          onClick={handleBack}
          className="h-11 px-5 rounded-lg border border-[#e4e4e7] text-[12.6px] text-[#18181b] font-medium hover:bg-[#f4f4f5] active:scale-[0.97] transition-all flex items-center gap-1.5 mx-auto"
        >
          <ArrowLeft strokeLinecap="square" strokeLinejoin="miter" className="w-3.5 h-3.5" />
          Back
        </button>
      </div>
    </motion.div>
  );
}
