const k = ["ready_to_buy", "at_risk", "engaged_browser", "frustrated", "casual_visitor"];
let d = null, a = null, y = "rf";
async function R() {
  d || (d = await import(
    /* @vite-ignore */
    "./ort.all-DiS7uDoQ.js"
  ), d.env.wasm.wasmPaths = "/assets/");
}
self.onmessage = async (n) => {
  const { type: s, payload: f } = n.data;
  if (s === "init") {
    const { modelUrl: e, modelType: r } = f;
    y = r || "rf";
    try {
      await R();
      const o = await (await fetch(e)).arrayBuffer();
      a = await d.InferenceSession.create(o, {
        executionProviders: ["wasm"]
      }), self.postMessage({ type: "init_done", success: !0, modelType: y });
    } catch (t) {
      console.error("[Sentinel Worker] Failed to load ONNX model:", t), self.postMessage({ type: "init_done", success: !1, error: t.message });
    }
  }
  if (s === "predict" && a && y === "rf") {
    const e = f.features, r = new Float32Array([
      e.timeOnPageMs || 0,
      e.scrollDepthPct || 0,
      e.clickCount || 0,
      e.rageEvents || 0,
      e.pagesInSession || 1,
      e.formFieldsStarted || 0,
      e.formFieldsCompleted || 0,
      e.scrollDirectionChanges || 0,
      e.idleTimeMs || 0
    ]);
    try {
      const t = new d.Tensor("float32", r, [1, 9]), o = {};
      o[a.inputNames[0]] = t;
      const p = (await a.run(o))[a.outputNames[0]].data, [c, _, h] = p, i = u(c), m = u(_), l = u(h), S = {
        engagementScore: i,
        intentSignal: M(l, i),
        predictedCohort: C(i, m, l, e.rageEvents || 0),
        exitRisk: m,
        purchasePropensity: l,
        confidence: 0.85
      };
      self.postMessage({ type: "predict_done", prediction: S });
    } catch (t) {
      console.error("[Sentinel Worker] RF inference error:", t), self.postMessage({ type: "predict_done", prediction: null });
    }
  }
  if (s === "predict_sequence" && a && y === "mamba") {
    const e = f.buckets;
    try {
      const r = performance.now(), t = new d.Tensor("float32", e, [1, 50, 5]), o = {};
      o.event_sequence = t;
      const w = await a.run(o), p = w.scores.data, c = w.cohort_logits.data, _ = u(p[0]), h = u(p[1]), i = u(p[2]);
      let m = 0, l = c[0];
      for (let g = 1; g < c.length; g++)
        c[g] > l && (l = c[g], m = g);
      const S = k[m] || "unknown", E = performance.now() - r, T = {
        engagementScore: _,
        intentSignal: M(i, _),
        predictedCohort: S,
        exitRisk: h,
        purchasePropensity: i,
        confidence: 0.85
      };
      self.postMessage({ type: "predict_sequence_done", prediction: T, latencyMs: E });
    } catch (r) {
      console.error("[Sentinel Worker] Mamba inference error:", r), self.postMessage({ type: "predict_sequence_done", prediction: null, latencyMs: 0 });
    }
  }
};
function u(n) {
  return Math.max(0, Math.min(1, n));
}
function M(n, s) {
  return n > 0.6 ? "high" : n > 0.3 ? "medium" : s > 0.2 ? "low" : "none";
}
function C(n, s, f, e) {
  return f > 0.7 ? "ready_to_buy" : s > 0.7 ? "at_risk" : n > 0.5 ? "engaged_browser" : e > 0.3 ? "frustrated" : "casual_visitor";
}
//# sourceMappingURL=edge-worker-DcD1mkOK.js.map
