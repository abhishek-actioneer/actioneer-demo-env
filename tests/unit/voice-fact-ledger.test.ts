import { describe, expect, it } from "vitest";
import { applyFactLedgerToWorkflow, extractFactAtoms } from "@/lib/voice-fact-ledger";

describe("extractFactAtoms", () => {
  it("never swallows a sentence comma into the atom", () => {
    // Regression: "\d[\d,]*" captured "5,000," — breaking source matching for
    // sourced values and deleting the comma from the rewritten body.
    const atoms = extractFactAtoms("Say: Aapka amount ₹5,000, aaj hi bhar dijiye. Fee 200, theek hai?");
    expect(atoms.map((atom) => atom.raw)).toEqual(["₹5,000", "200"]);
  });

  it("extracts currency in symbol, Rs, and Hinglish word forms", () => {
    const atoms = extractFactAtoms(
      "Say: Aapka EMI ₹5,000 due hai. Rs. 2500 late fee lagegi. Bas 500 rupaye advance dijiye.",
    );
    expect(atoms.map((atom) => [atom.kind, atom.raw])).toEqual([
      ["currency", "₹5,000"],
      ["currency", "Rs. 2500"],
      ["currency", "500 rupaye"],
    ]);
  });

  it("extracts lakh and crore amounts as currency", () => {
    const atoms = extractFactAtoms("Say: Aap 2 lakh tak ka loan le sakte hain, maximum 1.5 crore.");
    expect(atoms.map((atom) => [atom.kind, atom.raw])).toEqual([
      ["currency", "2 lakh"],
      ["currency", "1.5 crore"],
    ]);
  });

  it("extracts percentages in symbol and word forms", () => {
    const atoms = extractFactAtoms("Say: Processing fee sirf 2% hai aur interest 12.5 percent hoga.");
    expect(atoms.map((atom) => [atom.kind, atom.raw])).toEqual([
      ["percentage", "2%"],
      ["percentage", "12.5 percent"],
    ]);
  });

  it("extracts tenure ranges and single tenures", () => {
    const atoms = extractFactAtoms("Say: Tenure 6 to 24 months ya 6-48 months. Minimum 12 months.");
    expect(atoms.map((atom) => [atom.kind, atom.raw])).toEqual([
      ["tenure", "6 to 24 months"],
      ["tenure", "6-48 months"],
      ["tenure", "12 months"],
    ]);
  });

  it("extracts recognizable dates", () => {
    const atoms = extractFactAtoms("Say: Payment 15/08/2026 tak kar dijiye, yaani 15 August tak.");
    expect(atoms.map((atom) => [atom.kind, atom.raw])).toEqual([
      ["date", "15/08/2026"],
      ["date", "15 August"],
    ]);
  });

  it("extracts standalone numbers only at 100 or above", () => {
    const atoms = extractFactAtoms("Say: Aapka score 750 hai. Sirf 3 din bache hain.");
    expect(atoms).toEqual([{ raw: "750", kind: "number", index: 17 }]);
  });

  it("skips numbers inside {{...}} and {...} placeholder tokens", () => {
    const atoms = extractFactAtoms("Say: Aapka amount {{Amount500}} hai aur {emi_2500} pending hai.");
    expect(atoms).toEqual([]);
  });

  it("skips Note: lines entirely", () => {
    const atoms = extractFactAtoms("Note: penalty is 2% per month, max ₹5,000\nSay: Aapka payment due hai.");
    expect(atoms).toEqual([]);
  });

  it("skips B1/G2-style utterance labels and small list indices", () => {
    const atoms = extractFactAtoms("B1. Namaste ji\nG2: Dhanyavaad\n1. Pehla point\n2. Doosra point");
    expect(atoms).toEqual([]);
  });
});

describe("applyFactLedgerToWorkflow", () => {
  const node = (id: string, body: string, provenance?: string) => ({ id, body, provenance });

  it("treats comma-formatted numbers as sourced when the source has no commas", () => {
    const result = applyFactLedgerToWorkflow(
      { nodes: [node("n1", "Say: Aapka due amount 5,000 hai.")] },
      { brief: "Remind customers their EMI amount is 5000" },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.rewrittenNodes).toEqual([]);
  });

  it("matches sources case- and whitespace-insensitively", () => {
    const result = applyFactLedgerToWorkflow(
      { nodes: [node("n1", "Say: Tenure 6 to 24 months available hai.")] },
      { operatorAnswers: ["Tenure is 6   TO 24 MONTHS"] },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.rewrittenNodes).toEqual([]);
  });

  it("rewrites unsourced atoms to kind-derived placeholders with error diagnostics", () => {
    const result = applyFactLedgerToWorkflow(
      { nodes: [node("n1", "Say: Processing fee sirf 2% hai aur amount ₹5,000 hai.")] },
      { brief: "Call about the personal loan offer" },
    );
    expect(result.rewrittenNodes).toEqual([
      { id: "n1", body: "Say: Processing fee sirf {{Rate}} hai aur amount {{Amount}} hai." },
    ]);
    expect(result.diagnostics).toHaveLength(2);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.severity).toBe("error");
      expect(diagnostic.source).toBe("fact-ledger");
      expect(diagnostic.nodeId).toBe("n1");
    }
    const rate = result.diagnostics.find((d) => d.data?.kind === "percentage");
    expect(rate?.data).toEqual({ raw: "2%", kind: "percentage", placeholder: "{{Rate}}" });
    expect(rate?.message).toContain("2%");
    expect(rate?.message).toContain("{{Rate}}");
    const amount = result.diagnostics.find((d) => d.data?.kind === "currency");
    expect(amount?.data).toEqual({ raw: "₹5,000", kind: "currency", placeholder: "{{Amount}}" });
  });

  it("leaves verbatim and operator nodes untouched", () => {
    const result = applyFactLedgerToWorkflow(
      {
        nodes: [
          node("v1", "Say: Late fee ₹9,999 lagegi.", "verbatim"),
          node("o1", "Say: Interest 24% hai.", "operator"),
          node("g1", "Say: Cashback ₹250 milega.", "generated"),
        ],
      },
      {},
    );
    expect(result.rewrittenNodes).toEqual([{ id: "g1", body: "Say: Cashback {{Amount}} milega." }]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].nodeId).toBe("g1");
  });

  it("dedupes placeholders with numeric suffixes and reuses them for repeated atoms", () => {
    const workflow = {
      nodes: [
        node("n1", "Say: Pehla offer ₹5,000 ka hai."),
        node("n2", "Say: Doosra offer ₹10,000 ka hai, phir se ₹5,000 wala bhi."),
      ],
    };
    const first = applyFactLedgerToWorkflow(workflow, {});
    expect(first.rewrittenNodes).toEqual([
      { id: "n1", body: "Say: Pehla offer {{Amount}} ka hai." },
      { id: "n2", body: "Say: Doosra offer {{Amount2}} ka hai, phir se {{Amount}} wala bhi." },
    ]);
    // Determinism: identical input yields byte-identical output.
    const second = applyFactLedgerToWorkflow(workflow, {});
    expect(second).toEqual(first);
  });
});
