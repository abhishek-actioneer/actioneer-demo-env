import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { seedHdfcCreditfraudSampleWorkspace } from "../src/lib/server/hdfc-creditfraud-sample-workspace";
import { seedYesbankCardsSampleWorkspace } from "../src/lib/server/yesbank-cards-sample-workspace";
import { seedFlipkartMarketplaceSampleWorkspace } from "../src/lib/server/flipkart-marketplace-sample-workspace";
import { listFunnels } from "../src/lib/server/funnel-repo";
import { listRetentions } from "../src/lib/server/retention-repo";
import { listSegments } from "../src/lib/server/segment-repo";

function loadEnv(f: string){ if(!existsSync(f))return; for(const raw of readFileSync(f,"utf8").split(/\r?\n/)){const l=raw.trim();if(!l||l.startsWith("#"))continue;const e=l.indexOf("=");if(e<0)continue;const k=l.slice(0,e).trim();let v=l.slice(e+1).trim().replace(/^export\s+/,"");if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}}
loadEnv(resolve(".env")); loadEnv(resolve(".env.local"));

const U = "seed-validation-user-v4";
const JOBS: Array<[string,string,(u:string)=>Promise<{segments:number;funnels:number;retentions:number}>]> = [
  ["hdfc-creditfraud","hdfc-creditfraud",seedHdfcCreditfraudSampleWorkspace],
  ["yesbank-cards","yesbank-cards",seedYesbankCardsSampleWorkspace],
  ["flipkart-marketplace","flipkart-marketplace",seedFlipkartMarketplaceSampleWorkspace],
];
function pct(v:number|null){ return v==null?"NULL":v.toFixed(1)+"%"; }
function flagF(v:number|null){ if(v==null)return " ⚠ FAILED"; if(v<=0.1)return " ⚠ ~0%"; if(v>=99)return " ⚠ ~100%"; return " ok"; }

async function main(){
  for(const [label,ds,seed] of JOBS){
    console.log(`\n========== ${label} ==========`);
    const r = await seed(U);
    console.log(`seeded: ${r.segments} segments, ${r.funnels} funnels, ${r.retentions} retentions`);
    console.log("-- FUNNELS (overall conversion) --");
    for(const f of listFunnels(U,ds)) console.log(`  ${pct(f.overallConversion)}${flagF(f.overallConversion)}  ${f.name}`);
    console.log("-- RETENTIONS (d7 snapshot) --");
    for(const rt of listRetentions(U,ds)) console.log(`  ${pct(rt.d7Retention)}  ${rt.name}`);
    console.log("-- SEGMENTS (member count) --");
    for(const s of listSegments(U,ds)) console.log(`  ${String(s.userCount).padStart(7)}${s.userCount===0?" ⚠ EMPTY":""}  ${s.name}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
