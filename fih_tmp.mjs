import { DuckDBInstance } from "@duckdb/node-api";
import { readFileSync } from "fs";

const inst = await DuckDBInstance.create(":memory:");
const conn = await inst.connect();
await conn.run(`ATTACH '/tmp/fi_copy.duckdb' AS fi (READ_ONLY)`);
await conn.run(`ATTACH ':memory:' AS work`);
// Resolve unqualified names against attached db first, then writable work db (created views).
await conn.run(`SET search_path = 'fi.main,work.main'`);

const run = async (sql) => {
  const r = await conn.runAndReadAll(sql);
  return r.getRowObjects();
};

// cells: [{id, outputs:[], sql}] in order. date params already substituted.
const cells = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const c of cells) {
  try {
    const rows = await run(c.sql);
    console.log(`OK  ${c.id}  rows=${rows.length}  cols=${rows[0] ? Object.keys(rows[0]).join(",") : "(none)"}`);
    if (rows[0]) console.log("    sample=", JSON.stringify(rows[0], (k, v) => typeof v === "bigint" ? Number(v) : (v && v.days !== undefined ? v.days : v)).slice(0, 300));
    // materialize outputs as memory views (executor behavior)
    for (const out of c.outputs || []) {
      await conn.run(`CREATE OR REPLACE VIEW work.main."${out}" AS ${c.sql}`);
    }
  } catch (e) {
    console.log(`ERR ${c.id}  ${String(e.message).slice(0, 260)}`);
  }
}
conn.closeSync();
