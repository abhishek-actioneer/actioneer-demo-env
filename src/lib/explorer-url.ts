import type { ExplorerConfig } from "./explorer-types";
import { createDefaultConfig } from "./explorer-types";

/**
 * Encode ExplorerConfig into URL search params.
 * Only non-default values are included to keep URLs short.
 */
export function configToSearchParams(config: ExplorerConfig): URLSearchParams {
  const params = new URLSearchParams();
  const def = createDefaultConfig();

  // Events: comma-separated eventId:measureType pairs
  if (config.events.length > 0) {
    params.set(
      "events",
      config.events.map((e) => `${e.eventId}:${e.measureType}`).join(","),
    );
  }

  // Date range
  if ("preset" in config.dateRange) {
    if (config.dateRange.preset !== "30d") {
      params.set("range", config.dateRange.preset);
    }
  } else {
    params.set("from", config.dateRange.start);
    params.set("to", config.dateRange.end);
  }

  if (config.granularity !== def.granularity) {
    params.set("granularity", config.granularity);
  }
  if (config.chartType !== def.chartType) {
    params.set("chart", config.chartType);
  }
  if (config.breakdown) {
    params.set("breakdown", config.breakdown);
  }
  if (config.computation && config.computation !== "none") {
    params.set("computation", config.computation);
  }
  if (config.compare && config.compare !== "none") {
    params.set("compare", config.compare);
  }

  return params;
}

/**
 * Parse URL search params into a partial ExplorerConfig.
 * Returns null if no explorer params are present.
 */
export function searchParamsToConfig(
  params: URLSearchParams,
): ExplorerConfig | null {
  if (!params.has("events") && !params.has("range") && !params.has("from")) {
    return null;
  }

  const config = createDefaultConfig();

  // Events
  const eventsStr = params.get("events");
  if (eventsStr) {
    config.events = eventsStr.split(",").map((pair) => {
      const [eventId, measureType] = pair.split(":");
      return {
        eventId,
        measureType: (measureType as ExplorerConfig["events"][0]["measureType"]) ?? "event_totals",
      };
    });
  }

  // Date range
  const from = params.get("from");
  const to = params.get("to");
  const range = params.get("range");
  if (from && to) {
    config.dateRange = { start: from, end: to };
  } else if (range) {
    config.dateRange = { preset: range as "7d" | "30d" | "60d" | "90d" | "1y" };
  }

  // Other fields
  const granularity = params.get("granularity");
  if (granularity) config.granularity = granularity as ExplorerConfig["granularity"];

  const chart = params.get("chart");
  if (chart) config.chartType = chart as ExplorerConfig["chartType"];

  const breakdown = params.get("breakdown");
  if (breakdown) config.breakdown = breakdown;

  const computation = params.get("computation");
  if (computation) config.computation = computation as ExplorerConfig["computation"];

  const compare = params.get("compare");
  if (compare) config.compare = compare as ExplorerConfig["compare"];

  return config;
}
