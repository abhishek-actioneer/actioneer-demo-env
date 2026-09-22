/**
 * CI test data setup script.
 *
 * Seeds data/ecommerce.duckdb from tests/fixtures/sample.csv —
 * a small synthetic ecommerce dataset (~50 rows) with the same schema
 * as the production events table.
 *
 * Usage: npx tsx scripts/setup-test-data.ts
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { resolve } from 'path';

const DB_PATH = resolve(__dirname, '../data/ecommerce.duckdb');
const CSV_PATH = resolve(__dirname, '../tests/fixtures/sample.csv');

async function main() {
  console.log('Setting up test DuckDB at:', DB_PATH);
  console.log('From CSV:', CSV_PATH);

  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  // Create events table from fixture CSV (TABLE not VIEW so db.ts's
  // CREATE OR REPLACE VIEW cannot overwrite it when the dev server starts)
  console.log('\n1. Creating events table...');
  await conn.run(`
    CREATE OR REPLACE TABLE events AS
    SELECT * FROM read_csv('${CSV_PATH}', auto_detect=true)
  `);

  const countResult = await conn.run('SELECT COUNT(*) as cnt FROM events');
  const rows = await countResult.getRows();
  console.log(`   Total events: ${rows?.[0]?.[0]}`);

  // Create summary tables (same as setup-data.ts)
  console.log('\n2. Creating daily_metrics...');
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

  console.log('\n3. Creating brand_metrics...');
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

  console.log('\n4. Creating category_metrics...');
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

  console.log('\n5. Creating hourly_patterns...');
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

  console.log('\n6. Creating monthly_metrics...');
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

  // Create segments table (needed for segment tests)
  // Column order matches src/lib/db.ts to avoid maintenance confusion
  console.log('\n7. Creating segments table...');
  await conn.run(`
    CREATE TABLE IF NOT EXISTS segments (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      sql VARCHAR NOT NULL,
      user_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      source_conversation_id VARCHAR,
      push_status VARCHAR DEFAULT '{}'
    )
  `);

  // Create integrations table with seed data
  console.log('\n8. Creating integrations table...');
  await conn.run(`
    CREATE TABLE IF NOT EXISTS integrations (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      icon VARCHAR,
      description VARCHAR,
      connected BOOLEAN DEFAULT false,
      last_synced TIMESTAMP
    )
  `);
  // Seed both production integrations (firebase, clevertap, bigquery — same as
  // src/lib/db.ts) and test-specific ones (klaviyo etc.) so that any app code
  // referencing production IDs still works in CI.
  await conn.run(`
    INSERT OR IGNORE INTO integrations (id, name, icon, description, connected) VALUES
      ('firebase', 'Firebase', 'flame', 'Push user segments to Firebase Remote Config & Cloud Messaging for targeted push notifications and A/B tests.', true),
      ('clevertap', 'CleverTap', 'bell', 'Sync segments to CleverTap for personalized engagement campaigns, journeys, and real-time user targeting.', true),
      ('bigquery', 'BigQuery', 'database', 'Export segment data to BigQuery for advanced analytics, ML pipelines, and cross-platform data enrichment.', true),
      ('klaviyo', 'Klaviyo', 'klaviyo', 'Email and SMS marketing platform', false),
      ('mixpanel', 'Mixpanel', 'mixpanel', 'Product analytics platform', false),
      ('amplitude', 'Amplitude', 'amplitude', 'Digital analytics platform', false),
      ('braze', 'Braze', 'braze', 'Customer engagement platform', false)
  `);

  // Ensure all WAL data is flushed to the main .duckdb file before the
  // process exits — CI uploads only the .duckdb file, not the WAL.
  await conn.run('CHECKPOINT');

  console.log('\nTest database setup complete!');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
