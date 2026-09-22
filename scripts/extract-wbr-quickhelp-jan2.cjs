// SAFE TO RUN ALONGSIDE DEV SERVER: yes (reads CSV via :memory:, no file lock)
// Extracts Jan 6-12, 2025 data for Quick Help weekly business review HTML slide deck

const duckdb = require('@duckdb/node-api');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data/csv');
const DATE_FILTER = `booking_date BETWEEN '2025-01-06' AND '2025-01-12'`;
const SUCCESS_FILTER = `payment_status = 'success'`;

async function main() {
  const inst = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await inst.connect();

  const run = async (sql) => {
    const reader = await conn.stream(sql);
    const names = [];
    for (let i = 0; i < reader.columnCount; i++) {
      names.push(reader.columnName(i));
    }
    const cols = await reader.getColumnsJson();
    const nRows = cols[0] ? cols[0].length : 0;
    const rows = [];
    for (let r = 0; r < nRows; r++) {
      const row = {};
      for (let c = 0; c < names.length; c++) {
        const v = cols[c][r];
        row[names[c]] = typeof v === 'bigint' ? Number(v) : v;
      }
      rows.push(row);
    }
    return rows;
  };

  // Create denormalized bookings view (same as quickhelp.ts viewSQL)
  await conn.run(`
    CREATE VIEW bookings AS
    SELECT
      b.*,
      c.signup_date, c.preferred_payment, c.is_active,
      camp.campaign_name, camp.campaign_type, camp.discount_pct
    FROM read_csv('${DATA_DIR}/bookings.csv', auto_detect=true) b
    LEFT JOIN read_csv('${DATA_DIR}/customers.csv', auto_detect=true) c
      USING (customer_id)
    LEFT JOIN read_csv('${DATA_DIR}/campaigns.csv', auto_detect=true) camp
      USING (campaign_id)
  `);

  // 1. KPIs
  const kpis = await run(`
    SELECT
      ROUND(SUM(booking_value), 2) AS total_revenue,
      COUNT(*) AS total_bookings,
      ROUND(AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100, 2) AS on_time_pct,
      COUNT(CASE WHEN is_first_booking THEN 1 END) AS new_customers,
      COUNT(DISTINCT customer_id) AS total_unique_customers
    FROM bookings
    WHERE ${DATE_FILTER} AND ${SUCCESS_FILTER}
  `);

  // 2. Daily revenue trend (7 days, Jan 6-12)
  const daily = await run(`
    SELECT
      booking_date::VARCHAR AS day,
      ROUND(SUM(booking_value), 2) AS revenue,
      COUNT(*) AS bookings,
      ROUND(AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100, 2) AS on_time_pct
    FROM bookings
    WHERE ${DATE_FILTER} AND ${SUCCESS_FILTER}
    GROUP BY booking_date
    ORDER BY booking_date
  `);

  // 3. Service type revenue (top 8)
  const serviceType = await run(`
    SELECT
      service_type,
      ROUND(SUM(booking_value), 2) AS revenue,
      COUNT(*) AS bookings
    FROM bookings
    WHERE ${DATE_FILTER} AND ${SUCCESS_FILTER}
    GROUP BY service_type
    ORDER BY revenue DESC
    LIMIT 8
  `);

  // 4. Tier mix
  const tiers = await run(`
    SELECT
      service_tier,
      ROUND(SUM(booking_value), 2) AS revenue,
      COUNT(*) AS bookings
    FROM bookings
    WHERE ${DATE_FILTER} AND ${SUCCESS_FILTER}
    GROUP BY service_tier
    ORDER BY revenue DESC
  `);

  // 5. Customer retention (new vs repeat)
  const retention = await run(`
    SELECT
      COUNT(DISTINCT customer_id) AS total_customers,
      COUNT(CASE WHEN is_first_booking THEN 1 END) AS new_customers,
      COUNT(DISTINCT CASE WHEN NOT is_first_booking THEN customer_id END) AS repeat_customers
    FROM bookings
    WHERE ${DATE_FILTER} AND ${SUCCESS_FILTER}
  `);

  // 6. On-time by hub (top 10 by bookings)
  const onTimeByHub = await run(`
    SELECT
      hub_name,
      ROUND(AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100, 2) AS on_time_pct,
      COUNT(*) AS bookings
    FROM bookings
    WHERE ${DATE_FILTER} AND ${SUCCESS_FILTER}
    GROUP BY hub_name
    ORDER BY bookings DESC
    LIMIT 10
  `);

  // 7. Hub revenue (top 10)
  const hubRevenue = await run(`
    SELECT
      hub_name,
      ROUND(SUM(booking_value), 2) AS revenue,
      COUNT(*) AS bookings
    FROM bookings
    WHERE ${DATE_FILTER} AND ${SUCCESS_FILTER}
    GROUP BY hub_name
    ORDER BY revenue DESC
    LIMIT 10
  `);

  const output = {
    kpis: kpis[0],
    daily,
    serviceType,
    tiers,
    retention: retention[0],
    onTimeByHub,
    hubRevenue,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
