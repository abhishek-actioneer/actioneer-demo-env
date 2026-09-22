import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const duckdb = require('@duckdb/node-api');

const db = await duckdb.DuckDBInstance.create('data/fundsindia.duckdb', { access_mode: 'READ_ONLY' });
const conn = await db.connect();

async function q(sql: string, label: string) {
  const r = await conn.runAndReadAll(sql);
  console.log(`\n=== ${label} ===`);
  const rows = r.getRowObjectsJs();
  rows.forEach((row: any) => console.log(JSON.stringify(row)));
}

await q('SELECT status, count(*) as n FROM raw_goals GROUP BY status ORDER BY n DESC', 'Goals status');
await q("SELECT goal_type, ROUND(AVG(CASE WHEN status='on_track' THEN 1.0 ELSE 0 END)*100,1) as on_track_pct, count(*) as n FROM raw_goals GROUP BY goal_type ORDER BY on_track_pct DESC", 'On-track % by type');
await q('SELECT goal_type, ROUND(AVG(current_value_inr)) as avg_cur, ROUND(AVG(target_amount_inr)) as avg_tgt FROM raw_goals GROUP BY goal_type ORDER BY avg_tgt', 'Current value vs target');
await q('SELECT plan_type, count(*) n FROM raw_systematic_plans GROUP BY plan_type', 'Systematic plan types');
await q("SELECT channel, ROUND(AVG(CASE WHEN delivered THEN 1.0 ELSE 0 END)*100,1) as del_pct FROM raw_comms_log GROUP BY channel", 'Delivery rate by channel');
await q("SELECT status, MIN(nps_score) as min_nps, MAX(nps_score) as max_nps, ROUND(AVG(nps_score),1) as avg_nps FROM raw_support WHERE nps_score IS NOT NULL GROUP BY status", 'NPS scores by status');

await conn.close();
await db.close();
