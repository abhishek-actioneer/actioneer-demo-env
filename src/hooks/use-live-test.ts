"use client";

import { useCallback, useEffect, useState } from "react";
import type { VoiceCustomerContext } from "@/lib/voice-customer-context";

type PhoneConfirmCallback = (
  campaignId: string,
  phone: string,
  context: VoiceCustomerContext,
) => void | Promise<void>;

type PendingTestAction =
  | { type: "browser" }
  | { type: "phone"; campaignId: string; phone: string; callback: PhoneConfirmCallback };

export function useLiveTest({ existingCampaignId }: { existingCampaignId: string | null }) {
  const [showLiveTest, setShowLiveTest] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [sampledCustomer, setSampledCustomer] = useState<VoiceCustomerContext | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingTestAction | null>(null);
  const [autoStartLiveTest, setAutoStartLiveTest] = useState(false);
  const [preparingLiveTest, setPreparingLiveTest] = useState(false);
  const [liveTestCampaignId, setLiveTestCampaignId] = useState<string | null>(null);

  useEffect(() => {
    if (existingCampaignId) {
      setLiveTestCampaignId(null);
      setSampledCustomer(null);
    }
  }, [existingCampaignId]);

  const closeLiveTest = useCallback(() => {
    setAutoStartLiveTest(false);
    setShowLiveTest(false);
  }, []);

  const closeCustomerModal = useCallback(() => {
    setShowCustomerModal(false);
    setPendingAction(null);
  }, []);

  /** Called by openLiveTest (browser WebRTC test) */
  const openCustomerModalForBrowser = useCallback(() => {
    setPendingAction({ type: "browser" });
    setShowCustomerModal(true);
  }, []);

  /** Called by onCallLive (outbound phone call test) */
  const openCustomerModalForPhone = useCallback(
    (campaignId: string, phone: string, callback: PhoneConfirmCallback) => {
      setPendingAction({ type: "phone", campaignId, phone, callback });
      setShowCustomerModal(true);
    },
    [],
  );

  const confirmCustomerAndStartTest = useCallback((customer: VoiceCustomerContext) => {
    setSampledCustomer(customer);
    setShowCustomerModal(false);

    if (pendingAction?.type === "browser") {
      setShowLiveTest(true);
    } else if (pendingAction?.type === "phone") {
      void pendingAction.callback(pendingAction.campaignId, pendingAction.phone, customer);
    }

    setPendingAction(null);
  }, [pendingAction]);

  return {
    showLiveTest, setShowLiveTest,
    showCustomerModal, setShowCustomerModal,
    sampledCustomer, setSampledCustomer,
    pendingAction,
    autoStartLiveTest, setAutoStartLiveTest,
    preparingLiveTest, setPreparingLiveTest,
    liveTestCampaignId, setLiveTestCampaignId,
    closeLiveTest,
    closeCustomerModal,
    openCustomerModalForBrowser,
    openCustomerModalForPhone,
    confirmCustomerAndStartTest,
  };
}
