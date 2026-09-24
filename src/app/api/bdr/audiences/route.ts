import { bdrRoute } from "@/lib/bdr/http";
import { listMonacoAudiences } from "@/lib/bdr/monaco";
export const runtime = "nodejs";
export async function GET() {
  return bdrRoute(async () => Response.json({ audiences: await listMonacoAudiences() }, { headers: { "Cache-Control": "no-store" } }));
}
