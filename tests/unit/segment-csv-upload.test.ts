import { describe, expect, it } from "vitest";
import { isUploadedAudienceSql } from "@/lib/segment-csv-upload";
import { parseAudienceCsv } from "@/lib/server/segment-csv-upload";

describe("parseAudienceCsv", () => {
  it("parses quoted values and a BOM-prefixed header", () => {
    const result = parseAudienceCsv('\uFEFFname,phone,city\n"Asha, R.",9999999999,Pune\nVikram,8888888888,Mumbai');
    expect(result.headers).toEqual(["name", "phone", "city"]);
    expect(result.rows).toEqual([
      ["Asha, R.", "9999999999", "Pune"],
      ["Vikram", "8888888888", "Mumbai"],
    ]);
  });

  it("rejects missing, duplicate, and header-only CSVs", () => {
    expect(() => parseAudienceCsv("name,name\nAsha,Shah")).toThrow("unique");
    expect(() => parseAudienceCsv("name,\nAsha,999")).toThrow("header");
    expect(() => parseAudienceCsv("name,phone\n")).toThrow("at least one data row");
  });
});

describe("isUploadedAudienceSql", () => {
  it("recognizes only the server-owned uploaded audience table shape", () => {
    expect(isUploadedAudienceSql('SELECT * FROM "uploaded_audience_a1b2c3"')).toBe(true);
    expect(isUploadedAudienceSql("SELECT * FROM customers")).toBe(false);
    expect(isUploadedAudienceSql('SELECT * FROM "uploaded_audience_a1b2" WHERE active')).toBe(false);
  });
});
