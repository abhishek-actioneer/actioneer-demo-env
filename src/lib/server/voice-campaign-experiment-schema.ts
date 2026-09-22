import { z } from "zod/v4";

export const VoiceCampaignExperimentSplitSchema = z.object({
  enabled: z.boolean(),
  testPercent: z.number().int().min(0).max(100),
  controlPercent: z.number().int().min(0).max(100),
  randomizationUnit: z.enum(["recipient", "phone_number"]),
  testLabel: z.string().trim().min(1).max(80),
  controlLabel: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(500).optional(),
});
