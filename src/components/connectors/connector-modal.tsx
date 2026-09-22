"use client";

import Image from "next/image";
import { useState } from "react";
import { motion } from "motion/react";
import {
  ChevronRight,
  Database,
  ExternalLink,
} from "lucide-react";
import type { ConnectorCategory } from "@/lib/connector-categories";
import { ConnectorLogo } from "@/components/connectors/connector-logo";

export function ConnectorModal({
  name,
  category,
  onClose,
  onContinue,
}: {
  name: string;
  category: ConnectorCategory;
  onClose: () => void;
  onContinue: (connectionName: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [connectionName, setConnectionName] = useState("");

  return (
    <div
      className="fixed inset-0 bg-background/60 backdrop-blur-[2px] flex items-center justify-center z-[60]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-[520px] mx-4"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      >
        {/* Logo row: Connector → Actioneer */}
        <div className="flex items-center justify-center gap-3 pt-10 pb-6">
          <ConnectorLogo name={name} fallbackIcon={category.icon} size={36} className="rounded-full" />
          <div className="flex items-center">
            <div className="w-8 h-px bg-border" />
            <div className="w-0 h-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-border" />
          </div>
          <Image src="/grlogo.svg" alt="Actioneer" width={28} height={28} className="shrink-0" />
        </div>

        {/* Connector name */}
        <p className="text-center text-sm font-medium text-muted-foreground mb-2">{name}</p>

        {step === 1 ? (
          /* Step 1: Choose connection method */
          <div className="px-10 pb-10">
            <h2 className="text-[19.8px] font-semibold text-center mb-8 leading-tight">
              How do you want to connect your data?
            </h2>

            <div className="space-y-3">
              <button
                onClick={() => setStep(2)}
                className="w-full flex items-center gap-3 px-4 py-4 border border-border rounded-xl text-left hover:bg-muted/30 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Database className="w-4.5 h-4.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium whitespace-nowrap">Connect Directly</span>
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-border text-muted-foreground leading-none">
                      Recommended
                    </span>
                  </div>
                  <p className="text-[11.7px] text-muted-foreground mt-0.5">
                    Connects directly to your database.
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>

              <button
                onClick={() => setStep(2)}
                className="w-full flex items-center gap-3 px-4 py-4 border border-border rounded-xl hover:bg-muted/30 transition-colors text-left"
              >
                <Image src="/grlogo.svg" alt="Actioneer" width={20} height={20} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold">Connect via Actioneer Warehouse</span>
                  <p className="text-[11.7px] text-muted-foreground mt-0.5">
                    Imports your data to the Actioneer warehouse.
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            </div>
          </div>
        ) : (
          /* Step 2: Name your connection */
          <div className="px-10 pb-10">
            <h2 className="text-[19.8px] font-semibold text-center mb-8 leading-tight">
              Name Your Connection
            </h2>

            <div>
              <label className="text-sm font-medium">
                Connection Name<span className="text-muted-foreground">*</span>
              </label>
              <input
                type="text"
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
                placeholder="My Production Database"
                className="w-full mt-2 text-sm border border-border rounded-lg px-4 py-3 bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
              <p className="text-[11.7px] text-muted-foreground mt-3 leading-relaxed">
                Use a descriptive name to identify this data source.<br />
                (e.g. &quot;Production DB&quot;, &quot;Analytics Warehouse&quot;, &quot;Customer warehouse&quot;)
              </p>
            </div>

            <button
              onClick={() => onContinue(connectionName || `My ${name} Connection`)}
              className="flex items-center gap-2 mt-8 px-5 py-3 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Continue to {name}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
