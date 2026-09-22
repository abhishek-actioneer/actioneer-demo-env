import { auth } from "@clerk/nextjs/server";
import { put } from "@vercel/blob";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 413 });
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json({ error: `Unsupported type: ${file.type}` }, { status: 415 });
  }

  // If Vercel Blob is configured, store there. Otherwise, return a data URL the
  // client can persist locally (localStorage). For real email delivery the host
  // must serve durable HTTPS images, so wire BLOB_READ_WRITE_TOKEN before send.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const key = `assets/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    try {
      const blob = await put(key, file, {
        access: "public",
        contentType: file.type,
        addRandomSuffix: false,
      });
      return Response.json({
        url: blob.url,
        pathname: blob.pathname,
        size: file.size,
        contentType: file.type,
      });
    } catch (err) {
      return Response.json(
        { error: (err as Error).message ?? "Upload failed" },
        { status: 500 },
      );
    }
  }

  // Local fallback: return a base64 data URL.
  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;
  return Response.json({
    dataUrl,
    size: file.size,
    contentType: file.type,
  });
}
