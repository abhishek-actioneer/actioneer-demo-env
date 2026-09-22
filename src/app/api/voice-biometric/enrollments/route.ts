import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { deleteVoiceBiometricReference, enrollVoiceBiometric } from "@/lib/voice-biometric/client";
import {
  getVoiceBiometricEnrollment,
  listVoiceBiometricEnrollments,
  revokeVoiceBiometricEnrollment,
  upsertVoiceBiometricEnrollment,
  voiceBiometricKey,
} from "@/lib/voice-biometric/store";

const EnrollmentSchema = z.object({
  subjectId: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/),
  displayName: z.string().trim().min(1).max(100),
  consented: z.literal(true),
  wavBase64List: z.array(z.string().min(64).max(30_000_000)).min(2).max(5),
  balanceInr: z.number().finite().min(0).max(100_000_000).optional(),
});

const DeleteSchema = z.object({
  subjectId: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/),
});

function datasetId(req: Request): string {
  return req.headers.get("x-dataset-id")?.trim() || DEFAULT_DATASET;
}

function publicEnrollment(row: ReturnType<typeof upsertVoiceBiometricEnrollment>) {
  const { biometricKey: _biometricKey, tenantUserId: _tenantUserId, ...safe } = row;
  return safe;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = listVoiceBiometricEnrollments(userId, datasetId(req));
  return Response.json({ enrollments: rows.map(publicEnrollment) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = EnrollmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const ds = datasetId(req);
  const biometricKey = voiceBiometricKey(userId, ds, parsed.data.subjectId);
  const model = await enrollVoiceBiometric({
    subjectId: biometricKey,
    wavBase64List: parsed.data.wavBase64List,
  });
  const enrollment = upsertVoiceBiometricEnrollment({
    tenantUserId: userId,
    datasetId: ds,
    subjectId: parsed.data.subjectId,
    displayName: parsed.data.displayName,
    consentedAt: new Date().toISOString(),
    profile: parsed.data.balanceInr === undefined ? undefined : { balanceInr: parsed.data.balanceInr },
  });
  return Response.json({ enrollment: publicEnrollment(enrollment), model });
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const ds = datasetId(req);
  const enrollment = getVoiceBiometricEnrollment(userId, ds, parsed.data.subjectId);
  if (!enrollment) return Response.json({ error: "Enrollment not found" }, { status: 404 });
  await deleteVoiceBiometricReference(enrollment.biometricKey);
  revokeVoiceBiometricEnrollment(userId, ds, parsed.data.subjectId);
  return Response.json({ deleted: true });
}
