import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeSQLInternal } from "../src/lib/sql-executor";
function loadEnv(f:string){if(!existsSync(f))return;for(const raw of readFileSync(f,"utf8").split(/\r?\n/)){const l=raw.trim();if(!l||l.startsWith("#"))continue;const e=l.indexOf("=");if(e<0)continue;const k=l.slice(0,e).trim();let v=l.slice(e+1).trim().replace(/^export\s+/,"");if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}}
loadEnv(resolve(".env"));loadEnv(resolve(".env.local"));
const C: Record<string,{label:string;sql:string}[]> = {
 "hdfc-creditfraud":[
  {label:"any fraud alert (distinct cust)",sql:"SELECT DISTINCT customer_id FROM fraud_alerts"},
  {label:"intl-enabled cards",sql:"SELECT DISTINCT customer_id FROM cards WHERE intl_enabled_flag=true"},
  {label:"premium Imperia+Preferred",sql:"SELECT customer_id FROM customers WHERE segment IN ('Imperia','Preferred')"},
  {label:"revolvers (statements)",sql:"SELECT DISTINCT cu.customer_id FROM statements s JOIN cards c ON c.card_id=s.card_id JOIN customers cu ON cu.customer_id=c.customer_id WHERE s.revolve_flag=true"},
  {label:"declined-txn customers",sql:"SELECT DISTINCT cu.customer_id FROM transactions t JOIN cards c ON c.card_id=t.card_id JOIN customers cu ON cu.customer_id=c.customer_id WHERE t.response='DECLINED'"},
  {label:"intl spenders (channel)",sql:"SELECT DISTINCT cu.customer_id FROM transactions t JOIN cards c ON c.card_id=t.card_id JOIN customers cu ON cu.customer_id=c.customer_id WHERE t.channel IN ('INTL_ECOM','INTL_POS')"},
  {label:"2+ alerts",sql:"SELECT customer_id FROM fraud_alerts GROUP BY customer_id HAVING COUNT(*)>=2"},
  {label:"high-value income band",sql:"SELECT customer_id FROM customers WHERE income_band IN ('15L+','10-15L','25L+')"},
  {label:"customers segment distinct values",sql:"SELECT segment, COUNT(*) n FROM customers GROUP BY 1 ORDER BY 2 DESC"},
 ],
 "yesbank-cards":[
  {label:"active cards",sql:"SELECT DISTINCT customer_id FROM cards WHERE status='ACTIVE'"},
  {label:"high CIBIL 750+",sql:"SELECT customer_id FROM customers WHERE cibil_band IN ('750-799','800+')"},
  {label:"intl spenders",sql:"SELECT DISTINCT c.customer_id FROM transactions t JOIN cards c ON t.card_id=c.card_id WHERE t.is_intl_flag=true"},
  {label:"EMI converters",sql:"SELECT DISTINCT c.customer_id FROM transactions t JOIN cards c ON t.card_id=c.card_id WHERE t.emi_converted_flag=true"},
  {label:"rewards plan subscribers",sql:"SELECT DISTINCT customer_id FROM cards WHERE rewards_subscription_plan IN ('3X','5X')"},
  {label:"campaign-contacted",sql:"SELECT DISTINCT customer_id FROM campaign_history"},
  {label:"salary acct w/ yes",sql:"SELECT customer_id FROM customers WHERE salary_account_with_yes_flag=true"},
  {label:"cibil band dist",sql:"SELECT cibil_band, COUNT(*) n FROM customers GROUP BY 1 ORDER BY 2 DESC"},
 ],
};
async function main(){
 for(const [ds,cands] of Object.entries(C)){
  console.log(`\n===== ${ds} =====`);
  for(const c of cands){
   try{ const r=await executeSQLInternal(c.sql.toUpperCase().includes('GROUP BY')&&c.sql.includes('COUNT(*) n')?c.sql:`SELECT COUNT(*) n FROM (${c.sql}) s`, ds);
    if(r.error){console.log(`  ERR ${c.label}: ${r.error.slice(0,80)}`);continue;}
    if(c.sql.includes('COUNT(*) n')) console.log(`  ${c.label}: ${JSON.stringify(r.rows)}`);
    else console.log(`  ${String((r.rows[0] as any).n).padStart(7)}  ${c.label}`);
   }catch(e){console.log(`  THREW ${c.label}: ${e instanceof Error?e.message.slice(0,80):e}`);}
  }
 }
 process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
