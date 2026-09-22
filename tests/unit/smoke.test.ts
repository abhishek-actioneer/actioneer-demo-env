import { describe, it, expect } from "vitest";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";

describe("vitest infra smoke", () => {
  it("resolves the @ alias and imports client-safe dataset constants", () => {
    expect(typeof DEFAULT_DATASET).toBe("string");
    expect(DEFAULT_DATASET.length).toBeGreaterThan(0);
  });
});
