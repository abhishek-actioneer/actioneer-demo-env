import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { identifyVoiceBiometric } from "@/lib/voice-biometric/client";
import {
  activeVoiceBiometricSubjectIds,
  getVoiceBiometricEnrollmentByKey,
} from "@/lib/voice-biometric/store";

const IdentifySchema = z.object({ wavBase64: z.string().min(64).max(30_000_000) });

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = IdentifySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const datasetId = req.headers.get("x-dataset-id")?.trim() || DEFAULT_DATASET;
  const candidateIds = activeVoiceBiometricSubjectIds(userId, datasetId);
  const result = await identifyVoiceBiometric({
    wavBase64: parsed.data.wavBase64,
    candidateIds,
  });
  const topKey = result.status === "candidate" ? result.matches[0]?.customer_id : undefined;
  const enrollment = topKey
    ? getVoiceBiometricEnrollmentByKey(userId, datasetId, topKey)
    : undefined;
  return Response.json({
    ...result,
    matches: result.matches.map((match) => {
      const row = getVoiceBiometricEnrollmentByKey(userId, datasetId, match.customer_id);
      return { subjectId: row?.subjectId ?? null, displayName: row?.displayName ?? null, similarity: match.similarity };
    }),
    identifiedProfile: enrollment?.profile ?? null,
  });
}
