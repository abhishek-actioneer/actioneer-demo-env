import { createHash } from "crypto";
import type { ExperimentArm } from "@/lib/lifecycle-campaign-types";

export interface AssignmentDecision {
  arm: ExperimentArm;
  bucket: number;
  hash: string;
}

function stableUnitHash(experimentId: string, investorId: string, salt: string): string {
  return createHash("sha256")
    .update(`${experimentId}:${investorId}:${salt}`)
    .digest("hex");
}

export function assignmentBucket(experimentId: string, investorId: string, salt: string): {
  bucket: number;
  hash: string;
} {
  const hash = stableUnitHash(experimentId, investorId, salt);
  const first48Bits = Number.parseInt(hash.slice(0, 12), 16);
  return {
    bucket: first48Bits / 0xffffffffffff,
    hash,
  };
}

export function assignExperimentArm(
  experimentId: string,
  investorId: string,
  salt: string,
  arms: ExperimentArm[],
): AssignmentDecision {
  if (arms.length === 0) {
    throw new Error("Cannot assign without experiment arms");
  }

  const totalAllocation = arms.reduce((sum, arm) => sum + Math.max(0, arm.allocationPct), 0);
  if (totalAllocation <= 0) {
    throw new Error("Experiment arms must have positive allocation");
  }

  const { bucket, hash } = assignmentBucket(experimentId, investorId, salt);
  const target = bucket * totalAllocation;
  let cursor = 0;

  for (const arm of arms) {
    cursor += Math.max(0, arm.allocationPct);
    if (target <= cursor) return { arm, bucket, hash };
  }

  return { arm: arms[arms.length - 1], bucket, hash };
}
