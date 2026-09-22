---
title: "PyArrow Writes DATE as TIMESTAMP — Chart Axes Show '2025-02-10 00:00:00' Clutter"
date: 2026-03-16
category: database-issues
subcategory: parquet-type-inference
severity: low
status: solved
symptoms:
  - "Chart X-axis labels show '2025-02-10 00:00:00' instead of '2025-02-10'"
  - "Date-only columns appear as TIMESTAMP in DuckDB schema"
  - "Charts look cluttered with unnecessary time component"
technologies:
  - "Python pandas + PyArrow"
  - "DuckDB (reads parquet)"
  - "Recharts (renders charts)"
components:
  - "scripts/generate-gameramp.py"
  - "any Python data generation script writing parquet"
---

# PyArrow Writes DATE as TIMESTAMP — Chart Axes Show Timestamp Clutter

## Problem

When chart queries return a `cohort_date` column used as the X-axis, labels showed
`2025-02-10 00:00:00` instead of `2025-02-10`. The time component `00:00:00` was noise —
the column was intended as a calendar date.

## Root Cause

In the Python data generator, `datetime.date` objects were converted to pandas
`Timestamps` via `pd.to_datetime()` before writing to parquet:

```python
# ❌ This converts date → Timestamp → TIMESTAMP type in parquet
df["cohort_date"] = pd.to_datetime(df["cohort_date"])
```

PyArrow infers the column type from the pandas dtype:
- `datetime64[ns]` (pandas Timestamp) → **`TIMESTAMP`** in parquet
- Python `datetime.date` objects (object dtype) → **`date32`** in parquet

DuckDB then reads the type from parquet and formats accordingly:
- `TIMESTAMP` → `"2025-02-10 00:00:00"`
- `DATE` → `"2025-02-10"`

## Fix

Do **not** call `pd.to_datetime()` on columns that should remain calendar dates.
Keep them as Python `datetime.date` objects — PyArrow will infer `date32`:

```python
# ✅ Keep as Python datetime.date — PyArrow writes as date32 (DATE)
# cohort_date stays as datetime.date objects in the rows list
df = pd.DataFrame(rows)
# No pd.to_datetime() call needed
```

If the rows come from a pandas groupby where dates were Timestamps, extract with `.date()`:

```python
cohort_date = g["install_date"].date() if hasattr(g["install_date"], "date") else g["install_date"]
# Then don't call pd.to_datetime() at the end — keep as date objects
```

## Verification

```python
import pyarrow.parquet as pq
table = pq.read_table("data/parquet/gameramp/campaign.parquet")
print(table.schema)
# cohort_date: date32  ← correct
# NOT: cohort_date: timestamp[us, tz=UTC]
```

In DuckDB:
```sql
DESCRIBE campaign;
-- cohort_date  DATE  ← correct, not TIMESTAMP
```

## Impact

Affects any Python-generated parquet file where a date-only column is accidentally
converted via `pd.to_datetime()`. Common in data generation scripts.
