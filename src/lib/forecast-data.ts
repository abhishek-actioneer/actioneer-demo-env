// src/lib/forecast-data.ts
import type { ForecastModel } from "./forecast-types";

// Seed data is no longer hardcoded — forecast models are generated per dataset at runtime.
export const BASE_SEED_DATA: Record<string, Record<string, number>> = {};

export const DEFAULT_MODEL: ForecastModel = {
  id: "default",
  name: "Forecast",
  forecastStart: new Date().toISOString().split("T")[0],
  historyWeeks: 12,
  forecastWeeks: 12,
  rows: [],
};
