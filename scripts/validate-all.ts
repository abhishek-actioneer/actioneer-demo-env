import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSampleWorkspaceSeeder } from "../src/lib/server/sample-workspace-registry";
import { listFunnels } from "../src/lib/server/funnel-repo";
import { listRetentions } from "../src/lib/server/retention-repo";
import { listSegments } from "../src/lib/server/segment-repo";
function loadEnv(f:string){if(!existsSync(f))return;for(const raw of readFileSync(f,"utf8").split(/\r?\n/)){const l=raw.trim();if(!l||l.startsWith("#"))continue;const e=l.indexOf("=");if(e<0)continue;const k=l.slice(0,e).trim();let v=l.slice(e+1).trim().replace(/^export\s+/,"");if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}}
loadEnv(resolve(".env"));loadEnv(resolve(".env.local"));
const U="validate-all-user-v2";
const IDS=["vastu-hfc","fundsindia","presto","quickhelp","healthians","hdfc-creditfraud","yesbank-cards","flipkart-marketplace"];
async function main(){
 for(const id of IDS){
  const seeder=getSampleWorkspaceSeeder(id);
  if(!seeder){console.log(`\n${id}: NO SEEDER (flag off or unregistered)`);continue;}
  await seeder(U);
  const fns=listFunnels(U,id), rts=listRetentions(U,id), segs=listSegments(U,id);
  const minSeg=Math.min(...segs.map(s=>s.userCount));
  const under=segs.filter(s=>s.userCount<1000);
  const fOk=fns.length===3?"✓":`⚠ ${fns.length}`;
  const rOk=rts.length===3?"✓":`⚠ ${rts.length}`;
  console.log(`\n${id}: funnels=${fns.length}${fOk==='✓'?' ✓':' '+fOk}  retention=${rts.length}${rOk==='✓'?' ✓':' '+rOk}  segments=${segs.length} (min ${isFinite(minSeg)?minSeg:'-'})`);
  if(under.length) under.forEach(s=>console.log(`   ⚠ SEGMENT <1000: ${s.userCount}  ${s.name}`));
 }
 process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
