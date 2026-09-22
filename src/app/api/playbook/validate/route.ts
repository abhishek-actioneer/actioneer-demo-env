import { auth } from "@clerk/nextjs/server";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import type { PlaybookCell, PlaybookCellV2, PlaybookParam } from "@/lib/playbook-types";
import { validatePlaybookSqlCells } from "@/lib/server/playbook-sql-validator";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const cells: Array<PlaybookCellV2 | PlaybookCell> = body.cells ?? [];
  const params: PlaybookParam[] = body.params ?? [];
  const paramOverrides = body.paramOverrides && typeof body.paramOverrides === "object"
    ? body.paramOverrides as Record<string, string>
    : undefined;

  // Prefer the playbook's own datasetId (sent in body) over the header — same
  // reasoning as /api/playbook/run. Header is a fallback for legacy callers.
  const bodyDatasetId = typeof body.datasetId === "string" ? body.datasetId : undefined;
  const datasetId = bodyDatasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const validation = await validatePlaybookSqlCells({
    cells,
    params,
    paramOverrides,
    datasetId,
  });

  console.log(
    `[playbook-validate] datasetId=${datasetId} cells=${cells.length} ` +
    `sqlTargets=${validation.sqlTargetCount} valid=${validation.results.filter((r) => r.valid).length}/${validation.results.length}`,
  );

  // Distinguish "SQL cells exist but generation never produced SQL bodies" from
  // "there were no SQL cells to validate".
  if (validation.sqlTargetCount > 0 && validation.results.length > 0 && validation.results.every((r) => !r.valid && /No SQL query defined/i.test(r.error ?? ""))) {
    return Response.json({
      valid: false,
      results: validation.results,
      error: "Cells exist but have no SQL bodies. Generation likely stalled — try regenerating.",
      reason: "missing_bodies",
    });
  }

  return Response.json({
    valid: validation.valid,
    results: validation.results,
  });
}
