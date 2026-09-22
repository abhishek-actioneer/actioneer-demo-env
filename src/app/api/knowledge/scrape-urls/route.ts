import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getDatasetForUser } from "@/lib/datasets";
import { scrapeWebsitePages } from "@/lib/server/knowledge-website-crawler";

export const maxDuration = 300;

const BodySchema = z.object({
  urls: z.array(z.string().min(1).max(2_048)).min(1).max(100),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!datasetId) return Response.json({ error: "x-dataset-id header required" }, { status: 400 });
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Provide between 1 and 100 valid URLs" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        let completed = 0;
        let failed = 0;
        try {
          send({ type: "started", total: parsed.data.urls.length });
          await scrapeWebsitePages(parsed.data.urls, {
            onPageStart(url, index) {
              send({ type: "page_start", url, index });
            },
            onPageProgress(url, progress, index) {
              send({ type: "page_progress", url, progress, index });
            },
            onPageComplete(page, index) {
              completed += 1;
              send({ type: "page_complete", page, index });
            },
            onPageError(url, error, index) {
              failed += 1;
              send({ type: "page_error", url, error, index });
            },
          });
          send({ type: "done", completed, failed });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Website scraping failed.";
          console.error("[knowledge/scrape-urls] Crawl failed:", error);
          send({ type: "error", error: message });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
