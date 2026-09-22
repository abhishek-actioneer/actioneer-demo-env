import { DuckDBInstance } from "@duckdb/node-api";

async function fetchAll(result: any): Promise<any[]> {
  const cols = result.columnNames();
  const rows: any[] = [];
  while (true) {
    const chunk = await result.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;
    for (let r = 0; r < chunk.rowCount; r++) {
      const row: any = {};
      for (let c = 0; c < cols.length; c++) {
        const val = chunk.getChildAt(c).getItem(r);
        row[cols[c]] = val !== null && val !== undefined ? String(val) : null;
      }
      rows.push(row);
    }
  }
  return rows;
}

async function main() {
  const instance = await DuckDBInstance.create('data/datasets/hdfc-creditfraud/hdfc-creditfraud.duckdb', {
    access_mode: 'READ_ONLY'
  });
  const conn = await instance.connect();

  const tables = await fetchAll(await conn.run("SHOW TABLES"));
  console.log('=== TABLES ===\n' + tables.map(t => t.name).join('\n'));

  await conn.close();
}

main().catch(console.error);
