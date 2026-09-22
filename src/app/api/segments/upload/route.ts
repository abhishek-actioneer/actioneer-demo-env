import { auth } from "@clerk/nextjs/server";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { getDatasetForUser } from "@/lib/datasets";
import { withConnection } from "@/lib/db";
import {
  MAX_AUDIENCE_CSV_BYTES,
  UPLOADED_AUDIENCE_TABLE_PREFIX,
} from "@/lib/segment-csv-upload";
import { parseAudienceCsv } from "@/lib/server/segment-csv-upload";
import { upsertSegment } from "@/lib/server/segment-repo";
import type { Segment } from "@/lib/types";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function defaultAudienceName(fileName: string): string {
  return basename(fileName).replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim() || "Uploaded audience";
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") ?? "";
  if (!/^[a-z0-9-]{1,64}$/.test(datasetId) || !getDatasetForUser(datasetId, userId)) {
    return Response.json({ error: "Invalid dataset" }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const requestedName = String(formData.get("name") ?? "").trim();
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a CSV file to upload." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return Response.json({ error: "Only .csv files are supported." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_AUDIENCE_CSV_BYTES) {
    return Response.json({ error: "CSV must be between 1 byte and 10 MB." }, { status: 400 });
  }
  if (requestedName.length > 200) {
    return Response.json({ error: "Audience name must be 200 characters or fewer." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let rowCount: number;
  try {
    rowCount = parseAudienceCsv(bytes.toString("utf8")).rows.length;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read CSV." },
      { status: 400 },
    );
  }

  // Stable across client retries, while still allowing two differently named
  // files with identical rows to become separate audiences.
  const digest = createHash("sha256")
    .update(userId)
    .update("\0")
    .update(datasetId)
    .update("\0")
    .update(file.name)
    .update("\0")
    .update(bytes)
    .digest("hex");
  const id = `csv-${digest.slice(0, 20)}`;
  const tableName = `${UPLOADED_AUDIENCE_TABLE_PREFIX}${digest.slice(0, 24)}`;
  const name = requestedName || defaultAudienceName(file.name);
  const sql = `SELECT * FROM ${quoteIdentifier(tableName)}`;
  const tempDir = await mkdtemp(join(tmpdir(), "sentinel-audience-"));
  const tempFile = join(tempDir, "audience.csv");

  try {
    await writeFile(tempFile, bytes);
    await withConnection(datasetId, async (conn) => {
      await conn.run(
        `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} AS ` +
        `SELECT * FROM read_csv('${escapeSqlString(tempFile)}', header=true, all_varchar=true)`,
      );
      await conn.run("CHECKPOINT");
    });

    upsertSegment(userId, {
      id,
      name,
      sql,
      description: `Imported from ${file.name}`,
      userCount: rowCount,
      datasetId,
    });
  } catch (error) {
    console.error("[segments/upload] Failed to import CSV", error);
    return Response.json({ error: "Could not import this CSV." }, { status: 500 });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  const segment: Segment = {
    id,
    name,
    sql,
    description: `Imported from ${file.name}`,
    userCount: rowCount,
    createdAt: new Date().toISOString(),
    pushStatus: {},
  };
  return Response.json(segment, { status: 201 });
}
