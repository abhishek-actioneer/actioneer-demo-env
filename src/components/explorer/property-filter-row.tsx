"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { EventProperty, PropertyFilter } from "@/lib/explorer-types";

interface PropertyValue {
  value: string | number | boolean;
  count: number;
}

interface PropertyValuesResponse {
  values: PropertyValue[];
}

interface PropertyFilterRowProps {
  eventId: string;
  filter: PropertyFilter;
  properties: EventProperty[];
  onChange: (patch: Partial<PropertyFilter>) => void;
  onRemove: () => void;
  propertyMinWidthClass?: string;
}

const STRING_OPERATORS: Array<{ value: PropertyFilter["operator"]; label: string }> = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "contains", label: "contains" },
];

const NUMBER_OPERATORS: Array<{ value: PropertyFilter["operator"]; label: string }> = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
];

export function PropertyFilterRow({
  eventId,
  filter,
  properties,
  onChange,
  onRemove,
  propertyMinWidthClass = "min-w-[50px]",
}: PropertyFilterRowProps) {
  const prop = properties.find((property) => property.column === filter.property);
  const isNumeric = prop?.type === "number";
  const canUseValuePicker =
    !!eventId &&
    prop?.type === "string" &&
    prop.cardinalityHint !== "high" &&
    (filter.operator === "eq" || filter.operator === "neq");
  const [values, setValues] = useState<PropertyValue[]>([]);
  const [loadingValues, setLoadingValues] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!canUseValuePicker) {
      setValues([]);
      setLoadingValues(false);
      return;
    }

    setLoadingValues(true);
    apiFetch<PropertyValuesResponse>("/api/explorer/property-values", {
      method: "POST",
      body: { eventId, property: filter.property, limit: 50 },
      skipModel: true,
    })
      .then((data) => {
        if (!cancelled) setValues(data.values ?? []);
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingValues(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canUseValuePicker, eventId, filter.property]);

  const currentValue = String(filter.value ?? "");
  const selectValues = useMemo(() => {
    const seen = new Set<string>();
    const options = values
      .map((item) => ({ ...item, value: String(item.value) }))
      .filter((item) => {
        if (seen.has(item.value)) return false;
        seen.add(item.value);
        return true;
      });
    if (currentValue && !seen.has(currentValue)) {
      options.unshift({ value: currentValue, count: 0 });
    }
    return options;
  }, [currentValue, values]);

  const operatorOptions = isNumeric ? NUMBER_OPERATORS : STRING_OPERATORS;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`text-muted-foreground font-medium truncate ${propertyMinWidthClass}`}>
        {prop?.displayName ?? filter.property}
      </span>
      <select
        value={filter.operator}
        onChange={(event) => {
          const nextOperator = event.target.value as PropertyFilter["operator"];
          onChange({
            operator: nextOperator,
            value: nextOperator === "contains" ? String(filter.value ?? "") : filter.value,
          });
        }}
        className="appearance-none bg-muted rounded px-1.5 py-0.5 text-xs cursor-pointer border-0 focus:ring-1 focus:ring-border"
      >
        {operatorOptions.map((operator) => (
          <option key={operator.value} value={operator.value}>
            {operator.label}
          </option>
        ))}
      </select>

      {canUseValuePicker ? (
        <select
          value={currentValue}
          onChange={(event) => onChange({ value: event.target.value })}
          disabled={loadingValues && selectValues.length === 0}
          className="flex-1 min-w-0 appearance-none bg-muted rounded px-1.5 py-0.5 text-xs cursor-pointer border-0 focus:ring-1 focus:ring-border disabled:cursor-wait disabled:text-muted-foreground"
        >
          <option value="">{loadingValues ? "Loading..." : "Select value..."}</option>
          {selectValues.map((item) => (
            <option key={item.value} value={item.value}>
              {item.value}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={isNumeric ? "number" : "text"}
          value={currentValue}
          onChange={(event) =>
            onChange({
              value: isNumeric ? Number(event.target.value) : event.target.value,
            })
          }
          placeholder="value..."
          className="flex-1 min-w-0 bg-muted rounded px-1.5 py-0.5 text-xs border-0 focus:ring-1 focus:ring-border"
        />
      )}

      <button onClick={onRemove} className="text-muted-foreground hover:text-foreground flex-shrink-0">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
