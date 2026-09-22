// ── Column type categories ──
export type ColumnTypeCategory = "numeric" | "text" | "temporal" | "identifier";

// ── Column definition ──
export interface CatalogColumn {
  name: string;
  type: string; // DuckDB type: VARCHAR, BIGINT, DOUBLE, TIMESTAMP
  typeCategory: ColumnTypeCategory;
  nullable: boolean;
}

// ── Table definition ──
export interface CatalogTable {
  name: string;
  rowCount: number;
  columns: CatalogColumn[];
}

// ── Flat column view (column + which table) ──
export interface FlatColumn extends CatalogColumn {
  tableName: string;
}

// ── Filter types ──
export type CatalogTab = "tables" | "columns";

// ── Constants ──
export const COLUMN_TYPE_COLORS: Record<ColumnTypeCategory, string> = {
  numeric: "bg-muted text-foreground",
  text: "bg-muted text-foreground",
  temporal: "bg-muted text-foreground",
  identifier: "bg-muted text-muted-foreground",
};
