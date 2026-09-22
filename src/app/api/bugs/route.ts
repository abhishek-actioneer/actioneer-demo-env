import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { createBug, listBugsForUser } from "@/lib/server/bug-repo";

const CreateBugSchema = z.object({
  description: z.string().min(1).max(2000),
  pageUrl: z.string().max(2000).optional().nullable(),
  screenshotB64: z.string().max(8_000_000).optional().nullable(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = CreateBugSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid bug payload" }, { status: 400 });
  }

  const datasetId = req.headers.get("x-dataset-id") || null;

  const bug = createBug({
    userId,
    datasetId,
    description: parsed.data.description,
    pageUrl: parsed.data.pageUrl ?? null,
    userAgent: req.headers.get("user-agent"),
    screenshotB64: parsed.data.screenshotB64 ?? null,
  });

  return Response.json({ id: bug.id, status: bug.status });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(listBugsForUser(userId));
}
