"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { motion } from "motion/react";
import { RiCompass3Line, RiLineChartLine, RiTerminalBoxLine, RiRocket2Line } from "@remixicon/react";
import { setAccountInfo, setWizardStep } from "@/lib/onboarding-wizard-store";

const ROLES = [
  { id: "pm", label: "Product Manager", icon: RiCompass3Line, desc: "Track growth metrics and user behavior." },
  { id: "analyst", label: "Data Analyst", icon: RiLineChartLine, desc: "Run queries and build reports." },
  { id: "engineer", label: "Engineer", icon: RiTerminalBoxLine, desc: "Integrate data and automate workflows." },
  { id: "founder", label: "Founder / Exec", icon: RiRocket2Line, desc: "Monitor high-level KPIs and strategy." },
] as const;

export default function AccountStep() {
  const router = useRouter();
  const { user } = useUser();
  const [role, setRole] = useState("");
  const [orgName, setOrgName] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [attempted, setAttempted] = useState(false);

  // Pre-fill from Clerk user data
  useEffect(() => {
    if (!user) return;
    const company = user.organizationMemberships?.[0]?.organization?.name;
    if (company && !orgName) setOrgName(company);
  }, [user, orgName]);

  const canSubmit = role && orgName.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    if (!canSubmit) return;
    setAccountInfo({ orgName: orgName.trim(), appName: "", appUrl: appUrl.trim() });
    setWizardStep("connect");
    router.push("/onboarding/connect");
  }

  const isTouchDevice = typeof window !== "undefined" && "ontouchstart" in window;
  const showRoleError = attempted && !role;
  const showOrgError = attempted && !orgName.trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full max-w-lg"
    >
      <h1 className="text-2xl font-semibold text-[#18181b] text-center mb-8">
        Get Started
      </h1>

      {/* Role selection — required */}
      <div>
        <div className="grid grid-cols-2 gap-2.5 mb-1.5">
          {ROLES.map((r) => {
            const Icon = r.icon;
            const isSelected = role === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all duration-150 ${
                  isSelected
                    ? "border-[#18181b] bg-white"
                    : showRoleError
                    ? "border-[#dc2626] bg-white hover:border-[#a1a1aa]"
                    : "border-[#e4e4e7] bg-white hover:border-[#a1a1aa]"
                }`}
              >
                <Icon size={16} className={`mt-0.5 shrink-0 ${isSelected ? "text-[#18181b]" : "text-[#71717a]"}`} />
                <div>
                  <p className={`text-[11.7px] font-medium ${isSelected ? "text-[#18181b]" : "text-[#18181b]"}`}>
                    {r.label}
                  </p>
                  <p className="text-[9.9px] text-[#71717a] mt-0.5">{r.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
        {showRoleError && (
          <p className="text-[9.9px] text-[#dc2626] mt-1.5">Please select your role.</p>
        )}
      </div>

      {/* Account details */}
      <form onSubmit={handleSubmit} className="space-y-4 mt-8">
        <Field
          label="Organization"
          placeholder="Acme Corp"
          value={orgName}
          onChange={setOrgName}
          autoFocus={!isTouchDevice}
          error={showOrgError ? "Required" : undefined}
          required
        />
        <Field
          label="Company Website"
          placeholder="acme.com"
          value={appUrl}
          onChange={setAppUrl}
          type="url"
        />

        <button
          type="submit"
          className={`w-full h-11 rounded-lg text-[12.6px] font-medium bg-[#18181b] text-white hover:bg-[#18181b]/90 active:scale-[0.97] transition-all mt-2 ${
            canSubmit ? "" : "opacity-50 cursor-not-allowed"
          }`}
        >
          Continue
        </button>
      </form>
    </motion.div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  autoFocus,
  type = "text",
  error,
  required,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  type?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11.7px] text-[#18181b] font-medium mb-1.5">
        {label}{required && <span className="text-[#dc2626] ml-0.5">*</span>}
      </span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!!error}
        className={`w-full h-10 px-3.5 rounded-lg bg-white border text-[12.6px] text-[#18181b] placeholder:text-[#a1a1aa] focus:outline-none transition-colors ${
          error ? "border-[#dc2626] focus:border-[#dc2626]" : "border-[#e4e4e7] focus:border-[#71717a]"
        }`}
      />
      {error && (
        <p className="text-[9.9px] text-[#dc2626] mt-1">{error}</p>
      )}
    </label>
  );
}
