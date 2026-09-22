import { parse } from "csv-parse/sync";
import {
  MAX_AUDIENCE_CSV_COLUMNS,
  MAX_AUDIENCE_CSV_ROWS,
} from "@/lib/segment-csv-upload";

export interface ParsedAudienceCsv {
  headers: string[];
  rows: string[][];
}

export function parseAudienceCsv(csvText: string): ParsedAudienceCsv {
  let records: string[][];
  try {
    records = parse(csvText, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }) as string[][];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Malformed CSV";
    throw new Error(`Could not read CSV: ${message}`);
  }

  if (records.length < 2) {
    throw new Error("CSV must contain a header row and at least one data row.");
  }

  const headers = records[0]!.map((header) => String(header).trim());
  if (headers.some((header) => !header)) {
    throw new Error("Every CSV column must have a header.");
  }
  if (headers.length > MAX_AUDIENCE_CSV_COLUMNS) {
    throw new Error(`CSV can contain at most ${MAX_AUDIENCE_CSV_COLUMNS} columns.`);
  }

  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error("CSV column headers must be unique.");
  }

  const rows = records.slice(1).map((row) => row.map((value) => String(value)));
  if (rows.length > MAX_AUDIENCE_CSV_ROWS) {
    throw new Error(`CSV can contain at most ${MAX_AUDIENCE_CSV_ROWS.toLocaleString()} data rows.`);
  }

  return { headers, rows };
}
