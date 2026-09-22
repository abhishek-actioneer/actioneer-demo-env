/**
 * Shared builder for the ABSLI bancassurance cross-sell pool.
 *
 * `bancassurance_leads` is a pool of bank customers (from ABSLI's bancassurance
 * partner banks) who hold a banking relationship but own NO ABSLI policy — the
 * untapped cross-sell list an RM works down. Rows are a fully separate synthetic
 * cohort (new BNK_ ids), disjoint from raw_policyholders, so "no insurance yet"
 * is true by construction. Banks and geography match the live dataset.
 *
 * Deterministic: every attribute is derived from hash(i) so rebuilds are stable
 * (no random()). Also builds a `bancassurance_summary` roll-up.
 *
 * Used by both setup-absli-life.ts (full rebuild) and
 * add-absli-bancassurance.ts (non-destructive add to an existing db).
 */

export const BANCASSURANCE_ROWS = 180000;

type RunFn = (sql: string, label?: string) => Promise<void>;

export async function buildBancassurance(run: RunFn, rows: number = BANCASSURANCE_ROWS) {
  await run(`DROP TABLE IF EXISTS bancassurance_leads`);
  await run(`DROP TABLE IF EXISTS bancassurance_summary`);

  await run(`
    CREATE TABLE bancassurance_leads AS
    WITH pools AS (
      SELECT
        -- Bancassurance partner banks (weighted toward HDFC, matching the book)
        ['HDFC Bank','HDFC Bank','HDFC Bank','HDFC Bank','HDFC Bank','HDFC Bank','HDFC Bank','HDFC Bank',
         'Indian Bank','Indian Bank','DBS Bank','DBS Bank','IDFC First Bank','IDFC First Bank',
         'Ujjivan SFB','Ujjivan SFB','DCB Bank','Karur Vysya Bank','Bank of Maharashtra','Deutsche Bank'] AS banks,
        ['Mumbai','Delhi NCR','Bengaluru','Hyderabad','Pune','Chennai','Kolkata','Ahmedabad','Jaipur','Lucknow',
         'Chandigarh','Coimbatore','Surat','Nagpur','Indore','Kochi','Bhopal','Visakhapatnam','Patna','Bhubaneswar'] AS cities,
        ['Maharashtra','Delhi','Karnataka','Telangana','Maharashtra','Tamil Nadu','West Bengal','Gujarat','Rajasthan','Uttar Pradesh',
         'Chandigarh','Tamil Nadu','Gujarat','Maharashtra','Madhya Pradesh','Kerala','Madhya Pradesh','Andhra Pradesh','Bihar','Odisha'] AS states,
        ['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Krishna','Ishaan','Rohan',
         'Rahul','Karthik','Ankit','Manish','Suresh','Rajesh','Amit','Vikram','Nikhil','Deepak'] AS male_fn,
        ['Aadhya','Ananya','Diya','Ira','Myra','Sara','Anika','Navya','Kiara','Riya',
         'Pooja','Sneha','Priya','Neha','Divya','Kavya','Meera','Shruti','Anjali','Nisha'] AS female_fn,
        ['Sharma','Verma','Iyer','Nair','Reddy','Rao','Patel','Shah','Gupta','Mehta',
         'Singh','Kumar','Das','Bose','Menon','Pillai','Chopra','Kapoor','Malhotra','Joshi'] AS last_n,
        ['Salaried','Salaried','Salaried','Salaried','Self-Employed','Self-Employed',
         'Business Owner','Business Owner','Professional','Professional','Retired','Homemaker'] AS occs,
        ['5-10L','5-10L','5-10L','10-25L','10-25L','<5L','<5L','25-50L','50L+','10-25L'] AS incs,
        ['35-44','35-44','35-44','45-54','45-54','25-34','25-34','55+','18-24','45-54'] AS agebands,
        (SELECT list(DISTINCT agent_id) FROM raw_policies WHERE channel = 'Bancassurance' AND agent_id IS NOT NULL) AS agents
    ),
    g AS (SELECT i FROM range(0, ${rows}) t(i)),
    pick AS (
      SELECT
        g.i,
        banks[((hash(i * 2654435761 + 11) % len(banks)) + 1)::BIGINT]       AS bank_name,
        ((hash(i * 40503 + 23) % len(cities)) + 1)::BIGINT                  AS geo_idx,
        cities, states, male_fn, female_fn, last_n, agents,
        occs[((hash(i * 668265263 + 53) % len(occs)) + 1)::BIGINT]          AS occupation,
        incs[((hash(i * 374761393 + 61) % len(incs)) + 1)::BIGINT]          AS annual_income_band,
        agebands[((hash(i * 16777619 + 83) % len(agebands)) + 1)::BIGINT]   AS age_band,
        CASE WHEN (hash(i * 43 + 157) % 100) < 62 THEN 'M' ELSE 'F' END     AS gender,
        (hash(i * 2246822519 + 31) % 20)::BIGINT                            AS fn_idx,
        (hash(i * 3266489917 + 41) % len(last_n) + 1)::BIGINT               AS ln_idx,
        (hash(i * 2166136261 + 71) % 15)::BIGINT                            AS age_off,
        (hash(i * 97 + 101) % 100)::BIGINT                                  AS h_sal,
        (hash(i * 89 + 103) % 100)::BIGINT                                  AS h_fd,
        (hash(i * 83 + 107) % 100)::BIGINT                                  AS h_cc,
        (hash(i * 79 + 109) % 100)::BIGINT                                  AS h_hl,
        (hash(i * 73 + 113) % 100)::BIGINT                                  AS h_mf,
        (hash(i * 71 + 127) % 100)::BIGINT                                  AS h_status,
        (hash(i * 67 + 131) % 1000000000)::BIGINT                           AS h_agent,
        (hash(i * 61 + 137) % 10)::BIGINT                                   AS h_noise,
        (hash(i * 59 + 139) % 540)::BIGINT                                  AS h_date,
        (hash(i * 53 + 149) % 20)::BIGINT                                   AS h_contact,
        (hash(i * 2654435761 + 151) % 900000000 + 100000000)::BIGINT        AS mob_suffix,
        (hash(i * 31 + 163) % 3 + 1)::BIGINT                                AS tenure_bucket,
        (hash(i * 29 + 167) % 15 + 1)::BIGINT                               AS tenure_years
      FROM g CROSS JOIN pools
    ),
    derived AS (
      SELECT
        i, bank_name, occupation, annual_income_band, age_band, gender, tenure_years,
        cities[geo_idx] AS city,
        states[geo_idx] AS state,
        (CASE WHEN gender = 'M' THEN male_fn[fn_idx + 1] ELSE female_fn[fn_idx + 1] END) || ' ' || last_n[ln_idx] AS full_name,
        agents[((h_agent % NULLIF(len(agents), 0)) + 1)::BIGINT] AS agent_pick,
        CASE age_band
          WHEN '18-24' THEN 18 + (age_off % 7)
          WHEN '25-34' THEN 25 + (age_off % 10)
          WHEN '35-44' THEN 35 + (age_off % 10)
          WHEN '45-54' THEN 45 + (age_off % 10)
          ELSE 55 + (age_off % 15)
        END AS age,
        CASE annual_income_band
          WHEN '50L+' THEN 'HNI'
          WHEN '25-50L' THEN 'Affluent'
          WHEN '10-25L' THEN 'Mass Affluent'
          ELSE 'Mass'
        END AS customer_segment,
        ((occupation = 'Salaried' AND h_sal < 85) OR h_sal < 18) AS salary_account_flag,
        (h_fd < 45) AS has_fd_flag,
        (h_cc < 55) AS has_credit_card_flag,
        (h_hl < 22) AS has_home_loan_flag,
        (h_mf < 30) AS has_mutual_fund_flag,
        h_status, h_noise, h_date, h_contact, mob_suffix
      FROM pick
    ),
    scored AS (
      SELECT
        *,
        LEAST(99, GREATEST(1,
          30
          + (CASE WHEN salary_account_flag THEN 10 ELSE 0 END)
          + (CASE WHEN has_home_loan_flag THEN 15 ELSE 0 END)
          + (CASE annual_income_band WHEN '50L+' THEN 20 WHEN '25-50L' THEN 15 WHEN '10-25L' THEN 10 WHEN '5-10L' THEN 5 ELSE 0 END)
          + (CASE customer_segment WHEN 'HNI' THEN 15 WHEN 'Affluent' THEN 10 WHEN 'Mass Affluent' THEN 5 ELSE 0 END)
          + (CASE WHEN tenure_years > 5 THEN 5 ELSE 0 END)
          + h_noise
        )) AS propensity_score,
        CASE
          WHEN h_status < 55 THEN 'New'
          WHEN h_status < 80 THEN 'Assigned'
          WHEN h_status < 95 THEN 'Contacted'
          ELSE 'Not Interested'
        END AS lead_status
      FROM derived
    )
    SELECT
      'BNK_' || lower(substr(md5(i::VARCHAR), 1, 10))                       AS bank_lead_id,
      bank_name,
      full_name,
      gender,
      age,
      age_band,
      city,
      state,
      occupation,
      annual_income_band,
      customer_segment,
      lower(replace(full_name, ' ', '.')) || (i % 97) || '@example.com'     AS email,
      '+91 ' || mob_suffix::VARCHAR                                         AS mobile,
      tenure_years                                                          AS relationship_tenure_years,
      CASE customer_segment
        WHEN 'HNI' THEN '25L+'
        WHEN 'Affluent' THEN '10-25L'
        WHEN 'Mass Affluent' THEN '3-10L'
        ELSE '<3L'
      END                                                                  AS avg_balance_band,
      salary_account_flag,
      has_fd_flag,
      has_credit_card_flag,
      has_home_loan_flag,
      has_mutual_fund_flag,
      'Savings'
        || (CASE WHEN salary_account_flag THEN ', Salary Account' ELSE '' END)
        || (CASE WHEN has_fd_flag THEN ', Fixed Deposit' ELSE '' END)
        || (CASE WHEN has_credit_card_flag THEN ', Credit Card' ELSE '' END)
        || (CASE WHEN has_home_loan_flag THEN ', Home Loan' ELSE '' END)
        || (CASE WHEN has_mutual_fund_flag THEN ', Mutual Funds' ELSE '' END) AS banking_products,
      FALSE                                                                AS existing_insurance_flag,
      CASE
        WHEN has_home_loan_flag THEN 'Term'
        WHEN age >= 55 OR occupation = 'Retired' THEN 'Annuity'
        WHEN annual_income_band IN ('25-50L','50L+') AND age < 40 THEN 'ULIP'
        WHEN age BETWEEN 30 AND 45 THEN 'Child'
        WHEN annual_income_band IN ('<5L','5-10L') THEN 'Endowment'
        ELSE 'Term'
      END                                                                  AS recommended_product,
      propensity_score,
      CASE WHEN propensity_score >= 70 THEN 'High' WHEN propensity_score >= 45 THEN 'Medium' ELSE 'Low' END AS propensity_band,
      lead_status,
      CASE WHEN lead_status = 'New' THEN NULL ELSE agent_pick END          AS assigned_agent_id,
      (DATE '2026-06-24' - h_date::INTEGER)                                AS created_date,
      CASE WHEN lead_status IN ('Contacted','Not Interested')
        THEN (DATE '2026-06-24' - h_date::INTEGER + (h_contact + 1)::INTEGER) ELSE NULL END AS last_contact_date
    FROM scored
  `, `bancassurance_leads (${rows.toLocaleString()} untapped bank prospects, 0 policies)`);

  await run(`
    CREATE TABLE bancassurance_summary AS
    SELECT
      bank_name,
      customer_segment,
      propensity_band,
      recommended_product,
      COUNT(*) AS prospects,
      ROUND(AVG(propensity_score), 1) AS avg_propensity_score,
      COUNT(CASE WHEN has_home_loan_flag THEN 1 END) AS home_loan_prospects,
      COUNT(CASE WHEN salary_account_flag THEN 1 END) AS salary_account_prospects,
      COUNT(CASE WHEN lead_status = 'New' THEN 1 END) AS unassigned_prospects
    FROM bancassurance_leads
    GROUP BY 1, 2, 3, 4
    ORDER BY prospects DESC
  `, "bancassurance_summary");
}
