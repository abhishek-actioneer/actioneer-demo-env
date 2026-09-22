// SAFE TO RUN ALONGSIDE DEV SERVER: yes (reads parquet, no file lock)
// Extracts Nov 1-7, 2019 data for the weekly business review HTML slide deck

const duckdb = require('@duckdb/node-api');
const path = require('path');

const PARQUET_PATH = path.join(__dirname, '../data/parquet/*.parquet');
const FILTER = `event_time >= '2019-11-01' AND event_time < '2019-11-08'`;

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

  await conn.run(`CREATE VIEW events AS SELECT * FROM read_parquet('${PARQUET_PATH}')`);

  // 1. KPIs
  const kpis = await run(`
    SELECT
      ROUND(SUM(CASE WHEN event_type='purchase' THEN price ELSE 0 END), 2) AS total_revenue,
      COUNT(CASE WHEN event_type='purchase' THEN 1 END) AS orders,
      COUNT(DISTINCT CASE WHEN event_type='purchase' THEN user_id END) AS unique_buyers,
      ROUND(SUM(CASE WHEN event_type='purchase' THEN price ELSE 0 END) /
        NULLIF(COUNT(CASE WHEN event_type='purchase' THEN 1 END), 0), 2) AS aov
    FROM events WHERE ${FILTER}
  `);

  // 2. Daily revenue
  const daily = await run(`
    SELECT
      strftime(DATE_TRUNC('day', event_time::TIMESTAMP), '%Y-%m-%d') as day,
      ROUND(SUM(price), 2) as revenue,
      COUNT(*) as orders
    FROM events
    WHERE event_type='purchase' AND ${FILTER}
    GROUP BY 1 ORDER BY 1
  `);

  // 3. Category revenue
  const categories = await run(`
    SELECT
      category_code,
      ROUND(SUM(price), 2) as revenue,
      COUNT(*) as orders
    FROM events
    WHERE event_type='purchase' AND category_code IS NOT NULL AND ${FILTER}
    GROUP BY 1 ORDER BY revenue DESC LIMIT 8
  `);

  // 4. Brand revenue
  const brands = await run(`
    SELECT
      brand,
      ROUND(SUM(price), 2) as revenue,
      COUNT(*) as orders
    FROM events
    WHERE event_type='purchase' AND brand IS NOT NULL AND ${FILTER}
    GROUP BY 1 ORDER BY revenue DESC LIMIT 5
  `);

  // 5. Apple vs Samsung
  const appleVsSamsung = await run(`
    SELECT
      brand,
      ROUND(SUM(price), 2) as revenue,
      COUNT(*) as orders,
      ROUND(AVG(price), 2) as aov
    FROM events
    WHERE event_type='purchase' AND brand IN ('apple', 'samsung') AND ${FILTER}
    GROUP BY 1 ORDER BY 1
  `);

  // 6. Hourly orders
  const hourly = await run(`
    SELECT
      CAST(EXTRACT(hour FROM event_time::TIMESTAMP) AS INTEGER) as hour,
      COUNT(*) as orders
    FROM events
    WHERE event_type='purchase' AND ${FILTER}
    GROUP BY 1 ORDER BY 1
  `);

  // 7. Funnel
  const funnel = await run(`
    SELECT
      COUNT(DISTINCT CASE WHEN event_type='view' THEN user_id END) as view_users,
      COUNT(DISTINCT CASE WHEN event_type='cart' THEN user_id END) as cart_users,
      COUNT(DISTINCT CASE WHEN event_type='purchase' THEN user_id END) as purchase_users,
      COUNT(CASE WHEN event_type='view' THEN 1 END) as views,
      COUNT(CASE WHEN event_type='cart' THEN 1 END) as carts,
      COUNT(CASE WHEN event_type='purchase' THEN 1 END) as purchases
    FROM events WHERE ${FILTER}
  `);

  const output = {
    kpis: kpis[0],
    daily,
    categories,
    brands,
    appleVsSamsung,
    hourly,
    funnel: funnel[0],
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
