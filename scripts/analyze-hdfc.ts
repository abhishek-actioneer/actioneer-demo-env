import { DuckDBInstance } from "@duckdb/node-api";

async function runAnalysis() {
  try {
    const dbPath = '/Users/vimarsh/Documents/baby-sentinel/data/datasets/hdfc-creditfraud/hdfc-creditfraud.duckdb';
    
    // Create instance in READ_ONLY mode
    const instance = await DuckDBInstance.create(dbPath, {
      access_mode: 'READ_ONLY'
    });

    const conn = await instance.connect();

    console.log('='.repeat(80));
    console.log('HDFC CREDIT FRAUD DATASET ANALYSIS');
    console.log('='.repeat(80));

    // Query 1: Customer segments by bank segment + fraud exposure
    console.log('\n1. CUSTOMER SEGMENTS BY BANK SEGMENT + FRAUD EXPOSURE\n');
    const q1 = `SELECT c.segment, c.income_band, c.occupation,
      COUNT(DISTINCT c.customer_id) as customers,
      COUNT(DISTINCT fa.alert_id) as alerts,
      SUM(CASE WHEN fa.disposition = 'TRUE_POSITIVE' THEN 1 ELSE 0 END) as confirmed_fraud,
      SUM(CASE WHEN fa.customer_response = 'CONFIRMED_GENUINE' AND fa.disposition = 'TRUE_POSITIVE' THEN 1 ELSE 0 END) as coerced_confirmations,
      ROUND(AVG(t.amount_inr)) as avg_txn_amount,
      SUM(CASE WHEN fa.disposition = 'TRUE_POSITIVE' THEN t.amount_inr ELSE 0 END) as fraud_amount_inr
    FROM customers c
    LEFT JOIN fraud_alerts fa ON c.customer_id = fa.customer_id
    LEFT JOIN transactions t ON fa.txn_id = t.txn_id
    GROUP BY c.segment, c.income_band, c.occupation
    ORDER BY confirmed_fraud DESC`;
    
    const result1 = await conn.run(q1);
    const cols1 = result1.columnNames();
    const rows1 = await result1.getRows();
    console.log("Columns:", cols1);
    rows1.forEach((row: unknown[]) => console.log(row));

    // Query 2: Fraud typology by customer segment
    console.log('\n' + '='.repeat(80));
    console.log('2. FRAUD TYPOLOGY BY CUSTOMER SEGMENT\n');
    const q2 = `SELECT c.segment, fe.typology, COUNT(*) as cnt,
      SUM(fe.amount_lost_inr) as lost_inr,
      SUM(fe.amount_prevented_inr) as prevented_inr
    FROM fraud_episodes fe
    JOIN customers c ON fe.customer_id = c.customer_id
    GROUP BY c.segment, fe.typology
    ORDER BY lost_inr DESC`;
    
    const result2 = await conn.run(q2);
    const cols2 = result2.columnNames();
    const rows2 = await result2.getRows();
    console.log("Columns:", cols2);
    rows2.forEach((row: unknown[]) => console.log(row));

    // Query 3: Alert trigger patterns by segment
    console.log('\n' + '='.repeat(80));
    console.log('3. ALERT TRIGGER PATTERNS BY SEGMENT (Top 20)\n');
    const q3 = `SELECT c.segment, fa.trigger_reasons, fa.severity,
      COUNT(*) as cnt,
      AVG(fa.response_latency_s) as avg_response_latency_s,
      SUM(CASE WHEN fa.customer_response = 'NO_RESPONSE' THEN 1 ELSE 0 END) as no_response_count
    FROM fraud_alerts fa
    JOIN customers c ON fa.customer_id = c.customer_id
    GROUP BY c.segment, fa.trigger_reasons, fa.severity
    ORDER BY cnt DESC LIMIT 20`;
    
    const result3 = await conn.run(q3);
    const cols3 = result3.columnNames();
    const rows3 = await result3.getRows();
    console.log("Columns:", cols3);
    rows3.forEach((row: unknown[]) => console.log(row));

    // Query 4: Card tier + fraud pattern
    console.log('\n' + '='.repeat(80));
    console.log('4. CARD TIER + FRAUD PATTERN\n');
    const q4 = `SELECT ca.card_tier, ca.product, ca.network,
      COUNT(DISTINCT ca.card_id) as cards,
      COUNT(DISTINCT fa.alert_id) as alerts,
      SUM(CASE WHEN fa.disposition = 'TRUE_POSITIVE' THEN 1 ELSE 0 END) as confirmed_fraud,
      ROUND(AVG(t.amount_inr)) as avg_fraud_amount
    FROM cards ca
    LEFT JOIN fraud_alerts fa ON ca.card_id = fa.card_id
    LEFT JOIN transactions t ON fa.txn_id = t.txn_id AND t.is_fraud_flag = true
    GROUP BY ca.card_tier, ca.product, ca.network
    ORDER BY confirmed_fraud DESC`;
    
    const result4 = await conn.run(q4);
    const cols4 = result4.columnNames();
    const rows4 = await result4.getRows();
    console.log("Columns:", cols4);
    rows4.forEach((row: unknown[]) => console.log(row));

    // Query 5: Repeat fraud victims
    console.log('\n' + '='.repeat(80));
    console.log('5. REPEAT FRAUD VICTIMS\n');
    const q5 = `SELECT c.segment, c.income_band, c.occupation,
      COUNT(*) as repeat_victims,
      ROUND(AVG(fe.amount_lost_inr)) as avg_loss
    FROM customers c
    JOIN fraud_episodes fe ON c.customer_id = fe.customer_id
    WHERE c.repeat_fraud_victim_flag = true
    GROUP BY c.segment, c.income_band, c.occupation
    ORDER BY repeat_victims DESC`;
    
    const result5 = await conn.run(q5);
    const cols5 = result5.columnNames();
    const rows5 = await result5.getRows();
    console.log("Columns:", cols5);
    rows5.forEach((row: unknown[]) => console.log(row));

    // Query 6: No-response alert pool
    console.log('\n' + '='.repeat(80));
    console.log('6. NO-RESPONSE ALERT POOL - HARDEST TO REACH (Top 15)\n');
    const q6 = `SELECT c.segment, c.city, c.occupation,
      COUNT(*) as no_response_alerts,
      SUM(t.amount_inr) as amount_at_risk
    FROM fraud_alerts fa
    JOIN customers c ON fa.customer_id = c.customer_id
    JOIN transactions t ON fa.txn_id = t.txn_id
    WHERE fa.customer_response = 'NO_RESPONSE'
    AND fa.disposition = 'TRUE_POSITIVE'
    GROUP BY c.segment, c.city, c.occupation
    ORDER BY amount_at_risk DESC LIMIT 15`;
    
    const result6 = await conn.run(q6);
    const cols6 = result6.columnNames();
    const rows6 = await result6.getRows();
    console.log("Columns:", cols6);
    rows6.forEach((row: unknown[]) => console.log(row));

    conn.closeSync();
    instance.closeSync();
    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS COMPLETE');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('Error during analysis:', error);
    process.exit(1);
  }
}

runAnalysis();
