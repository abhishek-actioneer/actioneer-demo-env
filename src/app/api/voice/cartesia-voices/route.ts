import { auth } from "@clerk/nextjs/server";
import { ensureCartesiaConfig } from "@/lib/cartesia-tts-client";
import type { CartesiaVoiceOption } from "@/lib/cartesia-voices";

interface CartesiaVoiceResponse {
  data?: Array<{
    id?: string;
    name?: string;
    description?: string;
    language?: string;
    preview_file_url?: string;
    is_public?: boolean;
    is_owner?: boolean;
  }>;
  has_more?: boolean;
  next_page?: string | null;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  ensureCartesiaConfig();
  const { searchParams } = new URL(req.url);
  const params = new URLSearchParams();
  params.set("limit", searchParams.get("limit") || "50");
  params.append("expand[]", "preview_file_url");
  const q = searchParams.get("q");
  if (q) params.set("q", q);
  const language = searchParams.get("language");
  if (language) params.set("language", language);

  const res = await fetch(`https://api.cartesia.ai/voices?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
      "Cartesia-Version": "2026-03-01",
    },
  });

  const body = await res.json().catch(() => null) as CartesiaVoiceResponse | null;
  if (!res.ok || !body) {
    return Response.json(body || { error: res.statusText }, { status: res.status });
  }

  const voices: CartesiaVoiceOption[] = (body.data ?? [])
    .filter((voice): voice is NonNullable<CartesiaVoiceResponse["data"]>[number] & { id: string; name: string } =>
      typeof voice.id === "string" && typeof voice.name === "string"
    )
    .map((voice) => ({
      id: voice.id,
      name: voice.name,
      description: voice.description,
      language: voice.language,
      previewFileUrl: voice.preview_file_url,
      isPublic: voice.is_public,
      isOwner: voice.is_owner,
    }));

  return Response.json({
    voices,
    hasMore: Boolean(body.has_more),
    nextPage: body.next_page ?? null,
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
