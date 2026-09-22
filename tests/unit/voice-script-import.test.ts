import { describe, expect, it } from "vitest";
import {
  buildImportDiagnostics,
  buildImportedScriptText,
  buildPlaceholderRoleMap,
  convertUniversalRouteBindings,
  extractSpokenLines,
  isVerbatimFromSource,
  mapImportedNodeIds,
  normalizeImportGenre,
  normalizeScriptPlaceholders,
  normalizeWorkflowPlaceholders,
  sanitizeImportedWorkflow,
  sanitizeRouteBindings,
  stampWorkflowProvenance,
  verifyVerbatimSpokenLines,
  type ScriptImportVerification,
} from "@/lib/voice-script-import";
import {
  applyScriptToWorkflow,
  bootstrapWorkflowFromScript,
  workflowScriptFingerprint,
} from "@/lib/voice-campaign-studio-utils";
import type { GeneratedVoiceWorkflow } from "@/lib/prompts/voice-campaign";

/** Excerpt shaped like the Piramal handoff: labelled beats, {snake_case} slots. */
const PIRAMAL_SOURCE = `Collections Bot B1 Script (Hinglish) — General Flow
B1. Greeting & Identity Check
Namaste! Main {agent_name} bol rahi hoon, Piramal Finance ki taraf se. Kya main {customer_name} ji se baat kar rahi hoon?
B2. Call Recording Disclosure
Yeh call quality purposes ke liye record ki ja rahi hai.
B3. Bounce Notification
Aapki Personal Loan EMI, jo ki {emi_amount} rupaye ki thi, is mahine bounce ho gayi hai.
B9. Customer Gives PTP
Theek hai, maine aapki commitment note kar li hai — {emi_amount} rupaye ka payment aap {ptp_date} tak kar denge.`;

/** Excerpt shaped like the TVS handoff: prose turns, <angle> slots. */
const TVS_SOURCE = `ABND CALLING SCRIPT (TVS CREDIT)
Agent: Good morning, Sir/Madam, this is <Name> calling you from TVS Credit.
Am I speaking with Mr. <xxxx>/Ms.<xxxx>.
Agent: Kindly note that this call is being recorded for internal training and quality purposes.
If the respondent is available, continue the call with the customer otherwise ask for a convenient time to reconnect.
Agent: Thank you for giving your valuable time to TVS Credit, have a good day.`;

function workflow(
  nodes: Array<{ id: string; title: string; body: string; helper?: string | null; kind?: string }>,
  edges: Array<{ source: string; target: string; label?: string | null }> = [],
): GeneratedVoiceWorkflow {
  return {
    title: "Imported",
    description: "d",
    objective: "o",
    audienceHint: "a",
    nodes: nodes.map((n, i) => ({
      id: n.id,
      kind: (n.kind ?? (i === 0 ? "start" : "prompt")) as GeneratedVoiceWorkflow["nodes"][number]["kind"],
      title: n.title,
      body: n.body,
      helper: n.helper ?? null,
    })),
    edges: edges.map((e) => ({ source: e.source, target: e.target, label: e.label ?? null })),
  };
}

describe("placeholder normalization", () => {
  it("maps unambiguous customer-name dialects onto the one token the runtime fills", () => {
    // `<Name>` is deliberately absent — it is ambiguous and handled by role
    // classification. See the "placeholder roles from the model" block.
    for (const raw of ["{user_name}", "{customer_name}", "<xxxx>", "{{Customer Name}}", "{borrower_name}"]) {
      const { text } = normalizeScriptPlaceholders(`Hello ${raw} ji`);
      expect(text).toBe("Hello {{Customer Name}} ji");
    }
  });

  it("substitutes the agent name literally so the bot still says who it is", () => {
    const { text, mappings } = normalizeScriptPlaceholders(
      "Main {agent_name} bol rahi hoon",
      { agentName: "Priya" },
    );
    expect(text).toBe("Main Priya bol rahi hoon");
    expect(mappings[0].binding).toBe("agent-name");
  });

  it("flags an unbound agent name rather than silently dropping it", () => {
    const { text, mappings } = normalizeScriptPlaceholders("Main {agent_name} bol rahi hoon");
    expect(text).toBe("Main {{Agent Name}} bol rahi hoon");
    expect(mappings[0].binding).toBe("unbound");
  });

  it("titleizes other slots so they normalize onto dataset columns", () => {
    const { text, mappings } = normalizeScriptPlaceholders("EMI {emi_amount} due {ptp_date}");
    expect(text).toBe("EMI {{Emi Amount}} due {{Ptp Date}}");
    expect(mappings.every((m) => m.binding === "dataset-column")).toBe(true);
  });

  it("leaves angle-bracket prose alone", () => {
    const { text } = normalizeScriptPlaceholders("pay within <3 days> of the call");
    expect(text).toBe("pay within <3 days> of the call");
  });

  it("keeps runtime-only slots as runtime slots", () => {
    const { mappings } = normalizeScriptPlaceholders("Continue in {{Selected Language}}");
    expect(mappings[0].binding).toBe("runtime-slot");
  });
});

describe("placeholder roles from the model", () => {
  // Regression: a live import of the TVS script mapped `<Name>` — the AGENT's
  // name in "this is <Name> calling you from TVS Credit" — onto
  // {{Customer Name}}, so the agent would have introduced itself using the
  // customer's own name. Only the surrounding sentence disambiguates it.
  const TVS_LINE = "this is <Name> calling you from TVS Credit. Am I speaking with Mr. <xxxx>?";

  it("does not guess a party for a bare name token", () => {
    const { text, mappings } = normalizeScriptPlaceholders(TVS_LINE);
    expect(text).toContain("{{Name}}");
    expect(text).toContain("{{Customer Name}}");
    expect(mappings.find((m) => m.source === "<Name>")?.binding).toBe("unbound");
    expect(mappings.find((m) => m.source === "<xxxx>")?.binding).toBe("customer-name");
  });

  it("uses the model's role assignment to resolve it correctly", () => {
    const roles = buildPlaceholderRoleMap([
      { token: "<Name>", role: "agent-name" },
      { token: "<xxxx>", role: "customer-name" },
    ]);
    const { text } = normalizeScriptPlaceholders(TVS_LINE, { agentName: "Priya", roles });
    expect(text).toBe("this is Priya calling you from TVS Credit. Am I speaking with Mr. {{Customer Name}}?");
  });

  it("lets a model role override a token-name heuristic", () => {
    // `{customer_name}` looks like the customer, but this document uses it for
    // the agent; the model saw the sentence, the heuristic did not.
    const roles = buildPlaceholderRoleMap([{ token: "{customer_name}", role: "agent-name" }]);
    const { text } = normalizeScriptPlaceholders("Main {customer_name} bol rahi hoon", {
      agentName: "Priya",
      roles,
    });
    expect(text).toBe("Main Priya bol rahi hoon");
  });

  it("matches roles regardless of delimiter or spacing", () => {
    const roles = buildPlaceholderRoleMap([{ token: "{{ Emi Amount }}", role: "dataset-field" }]);
    const { mappings } = normalizeScriptPlaceholders("Pay {emi_amount} today", { roles });
    expect(mappings[0].binding).toBe("dataset-column");
  });

  it("ignores malformed role entries", () => {
    const roles = buildPlaceholderRoleMap([
      { token: 42, role: "agent-name" },
      { token: "{x}", role: "not-a-role" },
      { token: "{y}", role: "customer-name" },
    ] as never);
    expect(Object.keys(roles)).toEqual(["y"]);
  });
});

describe("verbatim verification", () => {
  it("accepts an exact line", () => {
    expect(
      isVerbatimFromSource("Yeh call quality purposes ke liye record ki ja rahi hai.", PIRAMAL_SOURCE),
    ).toBe(true);
  });

  it("accepts a line whose placeholders were rewritten to runtime tokens", () => {
    expect(
      isVerbatimFromSource(
        "Namaste! Main {{Customer Name}} ji se baat kar rahi hoon?",
        normalizeScriptPlaceholders(PIRAMAL_SOURCE).text,
      ),
    ).toBe(true);
  });

  it("matches an agent-name-substituted line once the source is normalized alike", () => {
    // Mirrors how verifyVerbatimSpokenLines feeds the source through the same
    // mapping — the literal "Priya" exists on neither side until it does on both.
    const line = "Namaste! Main Priya bol rahi hoon, Piramal Finance ki taraf se.";
    expect(isVerbatimFromSource(line, PIRAMAL_SOURCE)).toBe(false);
    expect(
      isVerbatimFromSource(line, normalizeScriptPlaceholders(PIRAMAL_SOURCE, { agentName: "Priya" }).text),
    ).toBe(true);
  });

  it("accepts across the angle-bracket dialect", () => {
    expect(
      isVerbatimFromSource(
        "Good morning, Sir/Madam, this is {{Agent Name}} calling you from TVS Credit.",
        TVS_SOURCE,
      ),
    ).toBe(true);
  });

  it("tolerates curly quotes and em dashes from the word processor", () => {
    expect(isVerbatimFromSource("Theek hai, maine aapki commitment note kar li hai —", PIRAMAL_SOURCE)).toBe(true);
    expect(isVerbatimFromSource("Theek hai, maine aapki commitment note kar li hai -", PIRAMAL_SOURCE)).toBe(true);
  });

  it("rejects a reworded compliance line", () => {
    expect(
      isVerbatimFromSource("This call is being recorded for quality and training.", TVS_SOURCE),
    ).toBe(false);
  });

  it("rejects an invented amount", () => {
    expect(
      isVerbatimFromSource("Agar EMI miss hoti hai toh 900 rupaye ka charge lagega.", PIRAMAL_SOURCE),
    ).toBe(false);
  });

  it("does not let a placeholder wildcard span across beats", () => {
    // "Namaste!" and "bounce ho gayi hai" are in different beats; a greedy
    // wildcard would stitch them into one bogus "verbatim" line.
    expect(isVerbatimFromSource("Namaste! {{X}} bounce ho gayi hai.", PIRAMAL_SOURCE)).toBe(false);
  });
});

describe("spoken-line extraction", () => {
  it("takes Say:/कहें: lines and ignores private guidance", () => {
    const body = [
      "Say: Namaste, main Piramal Finance se bol rahi hoon.",
      "Private: wait for confirmation before continuing.",
      "कहें: Dhanyawad.",
      "Note: capture the reason code.",
    ].join("\n");
    expect(extractSpokenLines(body)).toEqual([
      "Namaste, main Piramal Finance se bol rahi hoon.",
      "Dhanyawad.",
    ]);
  });
});

describe("verifyVerbatimSpokenLines", () => {
  const wf = workflow([
    { id: "greeting", title: "Greeting", body: "Say: Yeh call quality purposes ke liye record ki ja rahi hai." },
    { id: "charges", title: "Charges", body: "Say: Agar EMI miss hoti hai toh 900 rupaye ka charge lagega." },
  ]);

  it("passes clean nodes and pinpoints the drifted one", () => {
    const result = verifyVerbatimSpokenLines(wf, PIRAMAL_SOURCE);
    expect(result.checkedLines).toBe(2);
    expect(result.verbatim).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].nodeId).toBe("charges");
  });

  it("reports unbound placeholders so the UI can prompt for a binding", () => {
    const { workflow: normalized, mappings } = normalizeWorkflowPlaceholders(
      workflow([{ id: "a", title: "A", body: "Say: Main {agent_name} bol rahi hoon" }]),
    );
    const result = verifyVerbatimSpokenLines(normalized, PIRAMAL_SOURCE, mappings);
    expect(result.unboundPlaceholders).toContain("{{Agent Name}}");
  });
});

describe("verifies the opening line too", () => {
  it("flags an opening the model stitched together from two source lines", () => {
    const wf = workflow([{ id: "a", title: "A", body: "Note: nothing spoken here." }]);
    const stitched = "Good morning, Sir/Madam, this is <Name> calling you from TVS Credit. Thank you for giving your valuable time to TVS Credit, have a good day.";
    const result = verifyVerbatimSpokenLines(wf, TVS_SOURCE, [], { firstMessage: stitched });
    expect(result.verbatim).toBe(false);
    expect(result.issues[0].nodeId).toBe("__first_message__");
  });

  it("passes a genuine single-line opening", () => {
    const wf = workflow([{ id: "a", title: "A", body: "Note: nothing spoken here." }]);
    const result = verifyVerbatimSpokenLines(wf, TVS_SOURCE, [], {
      firstMessage: "Good morning, Sir/Madam, this is {{Agent Name}} calling you from TVS Credit.",
    });
    expect(result.verbatim).toBe(true);
    expect(result.checkedLines).toBe(1);
  });
});

describe("sanitizeImportedWorkflow", () => {
  const fallbacks = { objective: "obj", audienceHint: "aud" };

  it("keeps long bodies so approved alternates are not silently dropped", () => {
    const body = Array.from({ length: 40 }, (_, i) => `Say: Approved variant number ${i}.`).join("\n");
    const out = sanitizeImportedWorkflow(
      { nodes: [{ id: "a", kind: "start", title: "A", body, helper: null }], edges: [] },
      fallbacks,
    );
    expect(extractSpokenLines(out.nodes[0].body)).toHaveLength(40);
  });

  it("demotes duplicate starts instead of discarding their content", () => {
    const out = sanitizeImportedWorkflow(
      {
        nodes: [
          { id: "a", kind: "start", title: "A", body: "Say: one", helper: null },
          { id: "b", kind: "start", title: "B", body: "Say: two", helper: null },
        ],
        edges: [],
      },
      fallbacks,
    );
    expect(out.nodes.map((n) => n.kind)).toEqual(["start", "end"]);
    expect(extractSpokenLines(out.nodes[1].body)).toEqual(["two"]);
  });

  it("guarantees a start and an end", () => {
    const out = sanitizeImportedWorkflow(
      {
        nodes: [
          { id: "a", kind: "prompt", title: "A", body: "Say: one", helper: null },
          { id: "b", kind: "prompt", title: "B", body: "Say: two", helper: null },
        ],
        edges: [],
      },
      fallbacks,
    );
    expect(out.nodes[0].kind).toBe("start");
    expect(out.nodes.some((n) => n.kind === "end")).toBe(true);
  });

  it("drops dangling and self edges, then falls back to a linear chain", () => {
    const out = sanitizeImportedWorkflow(
      {
        nodes: [
          { id: "a", kind: "start", title: "A", body: "Say: one", helper: null },
          { id: "b", kind: "end", title: "B", body: "Say: two", helper: null },
        ],
        edges: [
          { source: "a", target: "a", label: null },
          { source: "a", target: "ghost", label: null },
        ],
      },
      fallbacks,
    );
    expect(out.edges).toEqual([{ source: "a", target: "b", label: null }]);
  });

  it("dedupes identical edges", () => {
    const out = sanitizeImportedWorkflow(
      {
        nodes: [
          { id: "a", kind: "start", title: "A", body: "x", helper: null },
          { id: "b", kind: "end", title: "B", body: "y", helper: null },
        ],
        edges: [
          { source: "a", target: "b", label: "agreed" },
          { source: "a", target: "b", label: "agreed" },
        ],
      },
      fallbacks,
    );
    expect(out.edges).toHaveLength(1);
  });

  it("survives entirely malformed model output", () => {
    const out = sanitizeImportedWorkflow(null, fallbacks);
    expect(out.nodes.length).toBeGreaterThanOrEqual(2);
    expect(out.nodes[0].kind).toBe("start");
    expect(out.nodes.some((n) => n.kind === "end")).toBe(true);
    expect(out.objective).toBe("obj");
  });
});

describe("imported script round-trips through the studio sync", () => {
  const wf = workflow(
    [
      { id: "start", title: "Greeting", body: "Say: Namaste, Piramal Finance se baat kar rahi hoon.", kind: "start" },
      { id: "pitch", title: "Bounce Notification", body: "Say: Aapki EMI bounce ho gayi hai.", helper: "Wait for reply." },
      { id: "close", title: "Close Call", body: "Say: Aapka din shubh ho.", kind: "end" },
    ],
    [
      { source: "start", target: "pitch" },
      { source: "pitch", target: "close", label: "customer agrees" },
    ],
  );

  const script = buildImportedScriptText(wf);

  it("emits the canonical shape parseConversationScript reads", () => {
    expect(script.startsWith("Conversation script:")).toBe(true);
    expect(script).toContain("2. Bounce Notification");
    expect(script).toContain("Note: Wait for reply.");
    expect(script).toContain("Routing notes:");
    expect(script).toContain("- Bounce Notification -> Close Call when customer agrees");
  });

  it("bootstraps a workflow that survives the script→workflow sync unchanged", () => {
    const boot = bootstrapWorkflowFromScript(script);
    expect(boot).not.toBeNull();
    const applied = applyScriptToWorkflow(script, boot!.nodes, boot!.edges);
    // This is the guarantee: importing then editing must not scramble the graph.
    expect(workflowScriptFingerprint(applied.nodes, applied.edges)).toBe(
      workflowScriptFingerprint(boot!.nodes, boot!.edges),
    );
  });

  it("preserves every spoken line through the round trip", () => {
    const boot = bootstrapWorkflowFromScript(script)!;
    const spoken = boot.nodes.flatMap((n) => extractSpokenLines(n.data.body));
    expect(spoken).toEqual([
      "Namaste, Piramal Finance se baat kar rahi hoon.",
      "Aapki EMI bounce ho gayi hai.",
      "Aapka din shubh ho.",
    ]);
  });
});

describe("genre normalization", () => {
  it("passes both known genres through", () => {
    expect(normalizeImportGenre("voicebot-native")).toBe("voicebot-native");
    expect(normalizeImportGenre("human-telecaller")).toBe("human-telecaller");
  });

  it("clamps anything else to unknown", () => {
    for (const value of ["telecaller", "", undefined, null, 42]) {
      expect(normalizeImportGenre(value)).toBe("unknown");
    }
  });
});

describe("mapImportedNodeIds", () => {
  it("maps raw model ids onto the sanitizer's cleaned ids", () => {
    const map = mapImportedNodeIds({
      nodes: [
        { id: "B1. Greeting", kind: "start", title: "Greeting", body: "x", helper: null },
        { id: "Close Call", kind: "end", title: "Close", body: "y", helper: null },
      ],
    });
    expect(map).toEqual({ "B1. Greeting": "b1-greeting", "Close Call": "close-call" });
  });

  it("matches the sanitizer's dedupe suffix, first raw occurrence winning", () => {
    const raw = {
      nodes: [
        { id: "step", kind: "start", title: "A", body: "x", helper: null },
        { id: "step", kind: "end", title: "B", body: "y", helper: null },
      ],
    };
    const map = mapImportedNodeIds(raw);
    const sanitized = sanitizeImportedWorkflow(raw, { objective: "o", audienceHint: "a" });
    expect(sanitized.nodes.map((n) => n.id)).toEqual(["step", "step-2"]);
    expect(map).toEqual({ step: "step" });
  });

  it("agrees with sanitizeImportedWorkflow on fallback ids", () => {
    const raw = { nodes: [{ kind: "start", title: "A", body: "x", helper: null }, { id: "b", kind: "end", title: "B", body: "y", helper: null }] };
    const sanitized = sanitizeImportedWorkflow(raw, { objective: "o", audienceHint: "a" });
    expect(sanitized.nodes.map((n) => n.id)).toEqual(["start", "b"]);
    // No raw id on the first node → nothing to map, but "b" still resolves.
    expect(mapImportedNodeIds(raw)).toEqual({ b: "b" });
  });
});

describe("stampWorkflowProvenance", () => {
  it("stamps every node verbatim without touching other fields", () => {
    const wf = workflow([
      { id: "a", title: "A", body: "Say: one" },
      { id: "b", title: "B", body: "Say: two" },
      { id: "c", title: "C", body: "Note: private.", kind: "end" },
    ]);
    const stamped = stampWorkflowProvenance(wf, "verbatim");
    expect(stamped.nodes).toHaveLength(3);
    expect(stamped.nodes.every((n) => n.provenance === "verbatim")).toBe(true);
    expect(stamped.nodes.map((n) => n.body)).toEqual(wf.nodes.map((n) => n.body));
    // Input untouched — the route reuses the pre-stamp object for verification.
    expect(wf.nodes.every((n) => n.provenance === undefined)).toBe(true);
  });
});

describe("sanitizeRouteBindings", () => {
  it("keeps well-formed bindings and blanks empty sayLines to null", () => {
    expect(
      sanitizeRouteBindings([
        { kind: "end_call", nodeId: " close ", sayLine: "  " },
        { kind: "wrong_person", nodeId: "rpc", sayLine: "Sorry for the inconvenience." },
      ]),
    ).toEqual([
      { kind: "end_call", nodeId: "close", sayLine: null },
      { kind: "wrong_person", nodeId: "rpc", sayLine: "Sorry for the inconvenience." },
    ]);
  });

  it("drops unknown kinds, missing node ids, and non-arrays", () => {
    expect(
      sanitizeRouteBindings([
        { kind: "hang_up", nodeId: "a", sayLine: null },
        { kind: "end_call", nodeId: "", sayLine: null },
        { kind: "end_call", sayLine: null },
        "garbage",
      ]),
    ).toEqual([]);
    expect(sanitizeRouteBindings(undefined)).toEqual([]);
    expect(sanitizeRouteBindings({})).toEqual([]);
  });
});

describe("convertUniversalRouteBindings", () => {
  // Mirrors the post-sanitize, post-normalize workflow the route builds.
  const wf = workflow(
    [
      { id: "greeting", title: "Greeting", body: "Say: Good morning, Sir/Madam, this is {{Agent Name}} calling you from TVS Credit.", kind: "start" },
      { id: "callback-handling", title: "Callback Handling", body: "Note: Ask for a convenient time to reconnect." },
      { id: "close-call", title: "Close Call", body: "Say: Thank you for giving your valuable time to TVS Credit, have a good day.", kind: "end" },
    ],
  );
  const idMap = { "Close Call": "close-call", "Callback Handling": "callback-handling" };
  const CLOSE_LINE = "Thank you for giving your valuable time to TVS Credit, have a good day.";

  it("converts a verbatim sayLine binding with terminal flag and mapped target", () => {
    const { routes } = convertUniversalRouteBindings(
      [{ kind: "end_call", nodeId: "Close Call", sayLine: CLOSE_LINE }],
      wf,
      idMap,
      TVS_SOURCE,
    );
    expect(routes).toEqual([
      {
        kind: "end_call",
        label: "End Call",
        trigger: "Customer asks to end the call",
        behavior: CLOSE_LINE,
        targetNodeId: "close-call",
        terminal: true,
      },
    ]);
  });

  it("falls back to the node-title behavior when no sayLine is bound", () => {
    const { routes } = convertUniversalRouteBindings(
      [{ kind: "busy_callback", nodeId: "Callback Handling", sayLine: null }],
      wf,
      idMap,
      TVS_SOURCE,
    );
    expect(routes[0].behavior).toBe('Follow the "Callback Handling" step');
    expect(routes[0].terminal).toBe(false);
    expect(routes[0].targetNodeId).toBe("callback-handling");
  });

  it("resolves a nodeId the model already emitted in cleaned form", () => {
    const { routes } = convertUniversalRouteBindings(
      [{ kind: "busy_callback", nodeId: "callback-handling", sayLine: null }],
      wf,
      {},
      TVS_SOURCE,
    );
    expect(routes[0]?.targetNodeId).toBe("callback-handling");
  });

  it("drops a binding whose node did not survive sanitization", () => {
    const { routes, diagnostics } = convertUniversalRouteBindings(
      [{ kind: "escalation", nodeId: "ghost-node", sayLine: null }],
      wf,
      idMap,
      TVS_SOURCE,
    );
    expect(routes).toHaveLength(0);
    const info = diagnostics.find((d) => d.id === "route-unbound-escalation");
    expect(info?.severity).toBe("info");
    expect(info?.source).toBe("route");
  });

  it("drops a non-verbatim sayLine with a warn instead of shipping it", () => {
    const { routes, diagnostics } = convertUniversalRouteBindings(
      [{ kind: "end_call", nodeId: "Close Call", sayLine: "Thanks for your time, goodbye!" }],
      wf,
      idMap,
      TVS_SOURCE,
    );
    expect(routes).toHaveLength(0);
    const warn = diagnostics.find((d) => d.id === "route-drifted-end_call");
    expect(warn?.severity).toBe("warn");
    expect(warn?.source).toBe("route");
    expect(warn?.nodeId).toBe("close-call");
    // The kind is still unbound, so the default-behavior info also fires.
    expect(diagnostics.some((d) => d.id === "route-unbound-end_call")).toBe(true);
  });

  it("verifies sayLines through the same placeholder normalization as the verifier", () => {
    const { routes } = convertUniversalRouteBindings(
      [{ kind: "wrong_person", nodeId: "greeting", sayLine: "Good morning, Sir/Madam, this is <Name> calling you from TVS Credit." }],
      wf,
      idMap,
      TVS_SOURCE,
      { agentName: "Priya", roles: buildPlaceholderRoleMap([{ token: "<Name>", role: "agent-name" }]) },
    );
    expect(routes[0]?.behavior).toBe("Good morning, Sir/Madam, this is Priya calling you from TVS Credit.");
  });

  it("keeps only the first binding per kind", () => {
    const { routes } = convertUniversalRouteBindings(
      [
        { kind: "busy_callback", nodeId: "Callback Handling", sayLine: null },
        { kind: "busy_callback", nodeId: "Close Call", sayLine: null },
      ],
      wf,
      idMap,
      TVS_SOURCE,
    );
    expect(routes).toHaveLength(1);
    expect(routes[0].targetNodeId).toBe("callback-handling");
  });

  it("emits one info per unbound kind with the exact default-behavior message", () => {
    const { diagnostics } = convertUniversalRouteBindings(
      [
        { kind: "end_call", nodeId: "Close Call", sayLine: null },
        { kind: "busy_callback", nodeId: "Callback Handling", sayLine: null },
      ],
      wf,
      idMap,
      TVS_SOURCE,
    );
    const infos = diagnostics.filter((d) => d.severity === "info");
    expect(infos).toHaveLength(8);
    expect(infos.map((d) => d.source)).toEqual(Array(8).fill("route"));
    expect(infos.find((d) => d.id === "route-unbound-wrong_person")?.message).toBe(
      "No approved wording found for wrong_person; platform default behavior will apply.",
    );
    expect(diagnostics.some((d) => d.id === "route-unbound-end_call")).toBe(false);
    expect(diagnostics.some((d) => d.id === "route-unbound-busy_callback")).toBe(false);
  });
});

describe("buildImportDiagnostics", () => {
  const verification: ScriptImportVerification = {
    verbatim: false,
    checkedLines: 3,
    issues: [
      { nodeId: "charges", nodeTitle: "Charges", line: "900 rupaye ka charge", closest: "750 rupaye ka charge" },
      { nodeId: "__first_message__", nodeTitle: "Opening line", line: "stitched opening" },
    ],
    placeholders: [{ source: "{agent_name}", target: "{{Agent Name}}", binding: "unbound" }],
    unboundPlaceholders: ["{{Agent Name}}"],
  };

  it("emits one error per verbatim issue, anchored to the node", () => {
    const errors = buildImportDiagnostics(verification).filter((d) => d.severity === "error");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      source: "verbatim",
      nodeId: "charges",
      data: { closest: "750 rupaye ka charge" },
    });
    expect(errors[0].message).toContain("900 rupaye ka charge");
    expect(errors[1].nodeId).toBe("__first_message__");
  });

  it("emits one warn per unbound placeholder", () => {
    const warns = buildImportDiagnostics(verification).filter((d) => d.severity === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].source).toBe("placeholder");
    expect(warns[0].message).toContain("{{Agent Name}}");
  });

  it("is empty for a clean verification", () => {
    expect(
      buildImportDiagnostics({
        verbatim: true,
        checkedLines: 5,
        issues: [],
        placeholders: [],
        unboundPlaceholders: [],
      }),
    ).toEqual([]);
  });
});
