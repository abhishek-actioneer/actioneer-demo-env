import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import { ingestFromFile, ingestFromUrl } from "@/features/roleplay/roleplay-ingest";

// PDF/DOCX parsing needs the Node runtime (Buffer, unpdf, mammoth).
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json(
      { error: "Roleplay training is not available for this dataset" },
      { status: 403 },
    );
  }

  const contentType = (req.headers.get("content-type") || "").toLowerCase();

  try {
    // ── File upload (PDF / DOCX / text) ──
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "No file provided." }, { status: 400 });
      }
      if (file.size === 0) {
        return Response.json({ error: "The uploaded file is empty." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return Response.json({ error: "File is too large (max 20MB)." }, { status: 413 });
      }
      const bytes = await file.arrayBuffer();
      const result = await ingestFromFile(bytes, file.name, file.type);
      return Response.json(result);
    }

    // ── URL ──
    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const url = String(body.url ?? "").trim();
    if (!url) {
      return Response.json({ error: "Provide a URL or upload a file." }, { status: 400 });
    }
    const result = await ingestFromUrl(url);
    return Response.json(result);
  } catch (err) {
    console.error("[roleplay/ingest] failed:", err);
    const message = err instanceof Error ? err.message : "Could not read that source.";
    // These are user-actionable (bad URL, scanned PDF, unsupported type) → 422.
    return Response.json({ error: message }, { status: 422 });
  }
}
