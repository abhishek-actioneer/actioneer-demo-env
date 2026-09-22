"use client";

import { Fragment } from "react";
import { RiCheckLine } from "@remixicon/react";
import { WIZARD_STEPS, WIZARD_STEP_LABELS, type WizardStep } from "@/lib/onboarding-wizard-store";

interface OnboardingStepperProps {
  currentStep: WizardStep;
}

export function OnboardingStepper({ currentStep }: OnboardingStepperProps) {
  const currentIndex = WIZARD_STEPS.indexOf(currentStep);

  return (
    <div className="flex w-full items-center">
      {WIZARD_STEPS.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <Fragment key={step}>
            <div className="flex shrink-0 items-center gap-2">
              {/* Step marker */}
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[9.9px] font-semibold transition-colors duration-300 ${
                  isCompleted || isCurrent
                    ? "bg-[#18181b] text-white"
                    : "border border-[#e4e4e7] bg-white text-[#71717a]"
                }`}
              >
                {isCompleted ? <RiCheckLine size={12} /> : index + 1}
              </span>
              {/* Label */}
              <span
                className={`text-[11.7px] font-medium transition-colors duration-300 ${
                  isCurrent || isCompleted ? "text-[#18181b]" : "text-[#71717a]"
                }`}
              >
                {WIZARD_STEP_LABELS[step]}
              </span>
            </div>

            {/* Connector */}
            {index < WIZARD_STEPS.length - 1 && (
              <div
                className={`mx-3 h-px flex-1 transition-colors duration-300 ${
                  isCompleted ? "bg-[#18181b]" : "bg-[#e4e4e7]"
                }`}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
