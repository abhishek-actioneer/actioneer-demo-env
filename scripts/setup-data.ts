/**
 * One-time setup script: reads parquet or CSV files, creates DuckDB database
 * with an `events` view and pre-materialized summary tables.
 *
 * Supports both formats — place files in data/parquet/ OR data/csv/:
 *   - Parquet: data/parquet/*.parquet
 *   - CSV:     data/csv/*.csv  (from Kaggle download)
 *
 * Usage: npx tsx scripts/setup-data.ts
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "path";
import { existsSync, readdirSync } from "fs";

const DB_PATH = resolve(__dirname, "../data/ecommerce.duckdb");
const PARQUET_DIR = resolve(__dirname, "../data/parquet");
const CSV_DIR = resolve(__dirname, "../data/csv");

function detectDataSource(): { type: "parquet" | "csv"; path: string } {
  const hasParquet =
    existsSync(PARQUET_DIR) &&
    readdirSync(PARQUET_DIR).some((f) => f.endsWith(".parquet"));
  const hasCsv =
    existsSync(CSV_DIR) &&
    readdirSync(CSV_DIR).some((f) => f.endsWith(".csv"));

  if (hasParquet) return { type: "parquet", path: PARQUET_DIR };
  if (hasCsv) return { type: "csv", path: CSV_DIR };

  console.error(
    "No data files found! Place parquet files in data/parquet/ or CSV files in data/csv/.\n" +
      "Download the dataset from: https://www.kaggle.com/datasets/mkechinov/ecommerce-behavior-data-from-multi-category-store"
  );
  process.exit(1);
}

async function main() {
  console.log("Creating DuckDB database at:", DB_PATH);

  const source = detectDataSource();
  console.log(`\nDetected ${source.type.toUpperCase()} files in: ${source.path}`);

  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  // Create view over data files
  console.log("\n1. Creating events view...");
  if (source.type === "parquet") {
    await conn.run(`
      CREATE OR REPLACE VIEW events AS
      SELECT * FROM read_parquet('${source.path}/*.parquet')
    `);
  } else {
    await conn.run(`
      CREATE OR REPLACE VIEW events AS
      SELECT * FROM read_csv('${source.path}/*.csv', auto_detect=true)
    `);
  }

  // Verify row count
  const countResult = await conn.run("SELECT COUNT(*) as cnt FROM events");
  const rows = await countResult.getRows();
  console.log(`   Total events: ${rows?.[0]?.[0]?.toLocaleString() ?? "unknown"}`);

  // Sample data
  console.log("\n2. Sample rows:");
  const sampleResult = await conn.run("SELECT * FROM events LIMIT 3");
  const sampleRows = await sampleResult.getRows();
  const colNames = sampleResult.columnNames();
  console.log("   Columns:", colNames);
  for (const row of sampleRows) {
    console.log("  ", row);
  }

  // Create summary tables
  console.log("\n3. Creating daily_metrics...");
  await conn.run(`
    CREATE OR REPLACE TABLE daily_metrics AS
    SELECT
      DATE_TRUNC('day', event_time::TIMESTAMP) AS date,
      COUNT(*) AS total_events,
      COUNT(DISTINCT user_id) AS unique_users,
      COUNT(CASE WHEN event_type = 'purchase' THEN 1 END) AS purchases,
      COUNT(CASE WHEN event_type = 'view' THEN 1 END) AS views,
      COUNT(CASE WHEN event_type = 'cart' THEN 1 END) AS add_to_carts,
      COUNT(CASE WHEN event_type = 'remove_from_cart' THEN 1 END) AS removes,
      SUM(CASE WHEN event_type = 'purchase' THEN price ELSE 0 END) AS revenue,
      COUNT(DISTINCT CASE WHEN event_type = 'purchase' THEN user_id END) AS paying_users,
      COUNT(DISTINCT user_session) AS total_sessions
    FROM events
    GROUP BY 1
    ORDER BY 1
  `);
  const dmCount = await conn.run("SELECT COUNT(*) FROM daily_metrics");
  const dmRows = await dmCount.getRows();
  console.log(`   ${dmRows[0][0]} days of data`);

  console.log("\n4. Creating brand_metrics...");
  await conn.run(`
    CREATE OR REPLACE TABLE brand_metrics AS
    SELECT
      brand,
      COUNT(*) AS total_events,
      COUNT(CASE WHEN event_type = 'purchase' THEN 1 END) AS purchases,
      COUNT(CASE WHEN event_type = 'view' THEN 1 END) AS views,
      SUM(CASE WHEN event_type = 'purchase' THEN price ELSE 0 END) AS total_revenue,
      COUNT(DISTINCT CASE WHEN event_type = 'purchase' THEN user_id END) AS unique_buyers,
      AVG(CASE WHEN event_type = 'purchase' THEN price END) AS avg_purchase_price
    FROM events
    WHERE brand IS NOT NULL AND brand != ''
    GROUP BY 1
    ORDER BY total_revenue DESC
  `);
  const bmCount = await conn.run("SELECT COUNT(*) FROM brand_metrics");
  const bmRows = await bmCount.getRows();
  console.log(`   ${bmRows[0][0]} brands`);

  console.log("\n5. Creating category_metrics...");
  await conn.run(`
    CREATE OR REPLACE TABLE category_metrics AS
    SELECT
      category_code,
      SPLIT_PART(category_code, '.', 1) AS top_category,
      COUNT(*) AS total_events,
      COUNT(CASE WHEN event_type = 'purchase' THEN 1 END) AS purchases,
      COUNT(CASE WHEN event_type = 'view' THEN 1 END) AS views,
      SUM(CASE WHEN event_type = 'purchase' THEN price ELSE 0 END) AS total_revenue,
      COUNT(DISTINCT CASE WHEN event_type = 'purchase' THEN user_id END) AS unique_buyers
    FROM events
    WHERE category_code IS NOT NULL AND category_code != ''
    GROUP BY 1, 2
    ORDER BY total_revenue DESC
  `);
  const cmCount = await conn.run("SELECT COUNT(*) FROM category_metrics");
  const cmRows = await cmCount.getRows();
  console.log(`   ${cmRows[0][0]} categories`);

  console.log("\n6. Creating hourly_patterns...");
  await conn.run(`
    CREATE OR REPLACE TABLE hourly_patterns AS
    SELECT
      EXTRACT(HOUR FROM event_time::TIMESTAMP) AS hour_of_day,
      EXTRACT(DOW FROM event_time::TIMESTAMP) AS day_of_week,
      event_type,
      COUNT(*) AS event_count,
      COUNT(DISTINCT user_id) AS unique_users
    FROM events
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `);
  const hpCount = await conn.run("SELECT COUNT(*) FROM hourly_patterns");
  const hpRows = await hpCount.getRows();
  console.log(`   ${hpRows[0][0]} hourly pattern rows`);

  console.log("\n7. Creating monthly_metrics...");
  await conn.run(`
    CREATE OR REPLACE TABLE monthly_metrics AS
    SELECT
      DATE_TRUNC('month', event_time::TIMESTAMP) AS month,
      COUNT(*) AS total_events,
      COUNT(DISTINCT user_id) AS unique_users,
      COUNT(CASE WHEN event_type = 'purchase' THEN 1 END) AS purchases,
      COUNT(CASE WHEN event_type = 'view' THEN 1 END) AS views,
      SUM(CASE WHEN event_type = 'purchase' THEN price ELSE 0 END) AS revenue,
      COUNT(DISTINCT CASE WHEN event_type = 'purchase' THEN user_id END) AS paying_users,
      COUNT(DISTINCT user_session) AS total_sessions
    FROM events
    GROUP BY 1
    ORDER BY 1
  `);

  console.log("\nSetup complete! Database ready at:", DB_PATH);

  // Final summary
  const summary = await conn.run(`
    SELECT
      COUNT(*) AS total_events,
      COUNT(DISTINCT user_id) AS unique_users,
      COUNT(DISTINCT CASE WHEN event_type = 'purchase' THEN user_id END) AS paying_users,
      SUM(CASE WHEN event_type = 'purchase' THEN price ELSE 0 END)::DECIMAL(12,2) AS total_revenue,
      MIN(event_time) AS earliest_event,
      MAX(event_time) AS latest_event
    FROM events
  `);
  const summaryRows = await summary.getRows();
  console.log("\nDataset Summary:");
  console.log("  Total events:", summaryRows[0][0]?.toLocaleString());
  console.log("  Unique users:", summaryRows[0][1]?.toLocaleString());
  console.log("  Paying users:", summaryRows[0][2]?.toLocaleString());
  console.log("  Total revenue: $" + summaryRows[0][3]);
  console.log("  Date range:", summaryRows[0][4], "to", summaryRows[0][5]);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
