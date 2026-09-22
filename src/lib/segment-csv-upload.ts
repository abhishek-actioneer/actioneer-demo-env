export const MAX_AUDIENCE_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIENCE_CSV_ROWS = 100_000;
export const MAX_AUDIENCE_CSV_COLUMNS = 100;
export const UPLOADED_AUDIENCE_TABLE_PREFIX = "uploaded_audience_";

export function isUploadedAudienceSql(sql: string): boolean {
  return new RegExp(
    `^SELECT\\s+\\*\\s+FROM\\s+"?${UPLOADED_AUDIENCE_TABLE_PREFIX}[a-f0-9]+"?$`,
    "i",
  ).test(sql.trim().replace(/;+\s*$/, ""));
}
