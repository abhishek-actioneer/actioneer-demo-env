import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "path";

async function main() {
  const outPath = resolve(__dirname, "../data/parquet/events.parquet");
  console.log("Starting CSV → Parquet conversion...");
  console.log("Output:", outPath);

  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();

  await conn.run(
    `COPY (SELECT * FROM read_csv('${resolve(__dirname, "../data/csv")}/*.csv', auto_detect=true)) TO '${outPath}' (FORMAT PARQUET, COMPRESSION ZSTD)`
  );

  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
