import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { executeSQLInternal } from "../src/lib/sql-executor";
function loadEnv(f:string){if(!existsSync(f))return;for(const raw of readFileSync(f,"utf8").split(/\r?\n/)){const l=raw.trim();if(!l||l.startsWith("#"))continue;const e=l.indexOf("=");if(e<0)continue;const k=l.slice(0,e).trim();let v=l.slice(e+1).trim().replace(/^export\s+/,"");if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}}
loadEnv(resolve(".env"));loadEnv(resolve(".env.local"));
async function main(){
 for(const ds of ["hdfc-creditfraud","yesbank-cards"]){
  console.log(`\n===== ${ds} =====`);
  const { metrics } = JSON.parse(readFileSync(join("data/datasets",ds,"metrics.json"),"utf8"));
  for(const m of metrics){
   const v = await executeSQLInternal(m.valueSql, ds);
   const ts = await executeSQLInternal(m.timeSeriesSql, ds);
   const val = v.error ? `VALUE-ERR: ${v.error.slice(0,70)}` : JSON.stringify(v.rows[0]?.value);
   const tsStat = ts.error ? `⚠ TS-ERR: ${ts.error.slice(0,60)}` : `ts ${ts.rows.length}pts`;
   const flag = v.error ? " 🔴" : "";
   console.log(`  ${m.id.padEnd(26)} = ${String(val).padStart(14)}  [${tsStat}]${flag}`);
  }
 }
 process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
