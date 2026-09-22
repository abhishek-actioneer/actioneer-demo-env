# Vastu Housing Finance — Research & Data Extraction
## Sources: Project Aegis KPMG Databooks + Analyst Reports (Investec, Citi, JM Financial, Morgan Stanley)

---

## VASTU HOUSING FINANCE — Key Facts

| Metric | Value | Source |
|--------|-------|--------|
| AUM | ₹10,000+ Cr (FY25) | Website |
| AUM (FY23) | ₹6,100 Cr | Investec |
| 5yr AUM CAGR | **51%** (highest among all affordable HFCs) | Investec |
| PAT | ₹361 Cr (FY24) | Website |
| Avg RoA (FY19-23) | **5.1%** | Investec |
| GNPA (HFC) | **0.89%** Stage 3 | Website |
| CRAR | **68%** | Investec |
| Rating | AA-/Stable (ICRA, CARE) | Website |
| Branches | 100-200+ | Website |
| States | 12-17 | Website |
| Employees | 3,000+ | Website |
| Customers | 1 lakh+ | Website |
| Monthly disbursements | ₹300+ Cr run rate | Website |
| Investors | Naspers Ventures, TA Associates | Website |
| Key tech | PULSE — proprietary underwriting for undocumented income | Website |
| Subsidiary | Vastu Finserve (business/auto/equipment loans) | Website |

**Products:** Home loans (purchase, extension, plot+construction, green), LAP, commercial property, business loans, auto/CV/tractor/equipment (via subsidiary)

**Customer profile:** Self-employed, informal income (~₹50K/month), first-time homebuyers, 99% women customers (UN WEP award), affordable segment

**Interest rates:** Home loan 12.5-19.5% (salaried), 13-19.5% (self-employed). LAP 17.5-23.5%. PLR 19.92%.

**Loan terms:** Up to ₹1 Cr, up to 20yr tenure, processing fee up to 3%

---

## PROJECT AEGIS — KPMG Credit Cost Due Diligence (3 Excel files)

### What It Is
KPMG-prepared credit cost databook for "Project Aegis" — a due diligence exercise (likely for an investor/acquirer evaluating Vastu). Contains **84 sheets** of vintage-cohort default analysis.

### Key Credit Metrics

| Metric | Scenario 1 | Scenario 2 | Mgmt S1 | Mgmt S2 |
|--------|-----------|-----------|---------|---------|
| LGD | 72.6% | 71.3% | 70.8% | 69.4% |
| GDR at MOB 42 | 10.0% | 8.2% | 10.0% | 8.2% |
| Ultimate Loss Rate | 7.3% | 5.8% | 7.1% | 5.7% |

### Provision Requirements (Next 12 Months, ₹ mn)

| Metric | Scenario 1 | Scenario 2 | Mgmt S1 | Mgmt S2 |
|--------|-----------|-----------|---------|---------|
| Ultimate Loss | 2,063 | — | — | 1,989 |
| Closing Provision (Mar-25) | 450 | — | — | 410 |
| Total Charge to PL (FY25) | 622 | — | — | 607 |
| FY25 charge per FS | 573 | 573 | 573 | 573 |
| **Incremental charge needed** | **49** | — | — | **34** |

### Segmentation Dimensions in Aegis Data

1. **Vintage/Cohort**: Quarterly (Q1'19 – Q4'25), Monthly (Apr 2018 – Mar 2025)
2. **Fiscal Year**: FY19 – FY25
3. **MOB (Months on Book)**: 0 – 84 months seasoning
4. **Co-lending Partner**: 11 partners (DMI, TVS, HDB, NAC, Piramal, Utkarsh, VCPL, Finnable, Axis, Gosree, Tata)
5. **Bureau criteria**: ETC (Existing to Credit) vs NTC (New to Credit)
6. **Swapout generation**: Overall, Ex Gen 3, Ex Gen 2
7. **Provision methodology**: Lifetime ECL, Point-in-Time, Next 12 Months
8. **4 Scenarios**: Weighted vs simple avg LGD, with/without Gen 3 swapouts

### Key Formulas

```
GDR 90+ = Cumulative % of disbursement POS that has gone 90+ DPD (by MOB)
LGD = 1 - cumulative recovery rate (tracked monthly per NPA cohort)
Ultimate Loss Rate = GDR × LGD
Expected Provision = Σ(per cohort: Disbursement × Extrapolated_GDR × LGD × AUM_rundown%)
Extrapolation Factor = GDR_terminal / GDR_at_current_MOB
```

### Rundown Schedule Parameters
- ATS (Average Ticket Size): ₹2,35,000
- Disbursement ROI: 25%
- Tenure: 36 months
- Monthly amortization: ~4.8%

### Key Insight: Co-Lending Model
Vastu operates a **co-lending model** with 11 partners. This is a critical dimension — each partner has different:
- Default rates (GDR curves differ by partner)
- Recovery rates (LGD differs)
- Vintage profiles (different start dates)
- Bureau characteristics (ETC vs NTC)

---

## AFFORDABLE HFC INDUSTRY BENCHMARKS (from analyst reports)

### Peer Comparison Summary

| Metric | Vastu | Aptus | Aadhar | Aavas | Home First | India Shelter |
|--------|-------|-------|--------|-------|-----------|---------------|
| AUM (FY23, ₹bn) | 61 | 67 | 172 | 142 | 72 | 44 |
| 5yr AUM CAGR | **51%** | 37% | 17% | 28% | 40% | 30% |
| Avg RoA (FY19-23) | **5.1%** | 6.9% | 2.8% | 3.7% | 3.3% | 4.6% |
| GNPA (FY23) | 0.9% | 1.2% | 1.2% | 0.9% | 1.6% | 1.1% |
| CRAR | 68% | 81% | 45% | 49% | 51% | 61% |
| Yield | ~18-19%* | 17.7% | 13.4% | 13.5% | 13.9% | 15.7% |
| CoF | ~8-9%* | 8.5% | 7.2% | 6.6% | 7.3% | 8.3% |
| Opex/AUM | ~3%* | 2.8% | 2.5% | 3.6% | 2.8% | 4.9% |
| Credit cost | ~0.4%* | 0.6% | 0.3% | 0.1% | 0.3% | 0.4% |

*Vastu figures estimated from RoA and industry positioning

### Industry-Level Key Ranges

| Metric | Range | Typical |
|--------|-------|---------|
| Yield on loans | 12.4% – 17.7% | 13-14% |
| Cost of funds | 6.6% – 8.5% | 7.2-7.5% |
| NIM on AUM | 5.4% – 12.7% | 7-9% |
| Spread | 5.4% – 9.7% | 6.5-7.5% |
| Opex/AUM | 2.5% – 4.9% | 2.8-3.3% |
| C/I ratio | 19% – 45% | 34-40% |
| Credit cost | 0.1% – 0.7% | 0.3-0.5% |
| RoA | 2.8% – 8.0% | 3.5-4.5% |
| RoE | 12% – 19% | 14-16% |
| Leverage | 1.9x – 8.4x | 2.5-3.5x |
| GNPA | 0.8% – 6.4% | 1.2-2.0% |
| Avg ticket size | ₹0.72mn – ₹2.4mn | ₹0.9-1.1mn |
| Self-employed % | 26% – 71% | 40-60% |
| Housing % of AUM | 58% – 89% | 70-75% |
| New to credit % | 20% – 38% | 25-35% |
| LTV | 57% – 63% | 58-60% |
| EWS+LIG % | 65% – 78% | ~70% |
| Bounce rate | 19% – 21% | ~20% |

### Customer Profile (Affordable HFC typical)

- **Income**: ₹20K-70K/month, median ~₹30-50K
- **Employment**: 40-70% self-employed, many informal/undocumented
- **Purpose**: First home purchase (new construction or resale), home improvement
- **Property**: Affordable housing (<₹45L), often self-constructed
- **Geography**: Tier 2/3/4 cities, semi-urban and rural
- **Age**: ~30-33 years (median borrower)
- **New to credit**: 20-38% have no prior bureau history
- **LTV**: 57-63% (conservative vs banks at 75-80%)

### Product Mix (Typical AHFC)

| Product | % of AUM |
|---------|----------|
| Home loans (purchase) | 50-60% |
| Home construction/improvement | 10-15% |
| Loan Against Property (LAP) | 15-30% |
| Commercial property loans | 5-10% |
| Business/other | 0-5% |

### Geographic Spread

**Key states for affordable HFCs:** Maharashtra, UP, Rajasthan, Gujarat, MP, Tamil Nadu, Telangana, AP, Karnataka, Odisha

**T30 vs B30 split:** Affordable HFCs skew heavily B30 (beyond top 30 cities)
- Aptus: 76% rural
- Aavas: mostly semi-urban/rural
- Aadhar: ~60% T30, 40% B30

### Funding Mix (Typical AHFC)

| Source | % of Borrowings |
|--------|----------------|
| Bank term loans | 40-50% |
| NCDs (Non-Convertible Debentures) | 20-30% |
| NHB refinance | 15-25% |
| Securitisation/Assignment | 0-20% |
| ECBs/Others | 0-5% |

### Asset Quality Framework

**DPD Buckets:**
- Stage 1: 0-30 DPD (current + SMA-0 + SMA-1) — typically 93-96%
- Stage 2: 31-90 DPD (SMA-2) — typically 3-5%
- Stage 3: 90+ DPD (NPA) — typically 0.8-2%

**Provision Coverage Ratios (PCR):**
- Stage 1: 0.2-0.5%
- Stage 2: 10-15%
- Stage 3: 30-45%
- Total ECL: 1.0-1.5%

**Bounce rates:** 19-21% (first EMI bounce), improving with seasoning

### Affordable Housing Market

- Total housing loans (Mar'23): ₹31.1 trn
- Affordable housing loans: ₹1.7 trn (5.5% of total)
- Market grew at 15% CAGR (FY16-FY23)
- **77mn target households**, only 2.9mn live affordable housing loans = **4% penetration**
- India mortgage/GDP: 11.7% (vs global peers: US 52%, UK 56%, China 18%)
- 92% of India's employment is informal — massive underserved market

### Housing Shortage
- Total urban shortage (2012): 18.78mn units
- EWS: 10.55mn (56%), LIG: 7.41mn (39%), MIG+HIG: 0.82mn (4%)
- 80% of shortage is from congested housing (not homelessness)

---

## AADHAR HOUSING FINANCE — Detailed Data (from Citi + Apis)

### Financial Projections (Apis PE model, FY21-FY30)

| Metric | FY21 | FY24 | FY27E | FY30E |
|--------|------|------|-------|-------|
| AUM (₹bn) | 133 | 211 | ~350 | ~524 |
| Yield | 13.1% | 13.9% | ~13.5% | ~13.3% |
| CoF | ~7.5% | ~7.5% | ~7.0% | ~7.0% |
| Spread | ~5.6% | ~6.4% | ~6.5% | ~6.3% |
| NIM/Avg AUM | 4.6% | ~7% | ~8% | ~8.2% |
| Opex/AUM | ~2.0% | ~2.5% | ~2.5% | ~2.5% |
| Credit cost | 0.6% | 0.3% | ~0.4% | ~0.4% |
| ROA | 2.6% | ~3.5% | ~4.2% | ~4.7% |
| ROE | 10% | ~18% | ~16% | ~14.7% |
| Leverage | 3.8x | ~4.5x | ~3.8x | ~3.2x |

### Aadhar Customer Segments (% of AUM)

| Segment | FY18 | FY24 |
|---------|------|------|
| Formal salaried | 56.5% | 46.6% |
| Informal salaried | 9.4% | 10.4% |
| Formal self-employed | 25.8% | 7.9% |
| **Informal self-employed** | **8.3%** | **35.1%** |

**Trend: Massive shift toward informal self-employed** (8% → 35% in 6 years). This is exactly Vastu's core segment.

### Aadhar Income Categories

| Category | FY18 | FY24 |
|----------|------|------|
| EWS | 34.8% | 24.5% |
| LIG | 44.4% | 46.9% |
| MIG | 16.7% | 26.5% |
| HIG | 4.1% | 2.1% |

### Aadhar Stage-wise Asset Quality

| Stage | FY18 | FY21 | FY24 | Typical |
|-------|------|------|------|---------|
| Stage 1 | 96.1% | 92.4% | 95.3% | 93-96% |
| Stage 2 | 3.2% | 6.3% | 3.6% | 3-5% |
| Stage 3 | 0.7% | 1.2% | 1.1% | 0.8-1.5% |

### Aadhar Sourcing Channels

| Channel | FY18 | FY24 |
|---------|------|------|
| DSAs | 18% | 46% |
| Aadhar Mitras (connectors) | 0% | 21% |
| Direct Sales Teams | 82% | 33% |

**Trend: Shift from direct to DSA/connector-driven sourcing** — more scalable but higher acquisition cost.

---

## KEY DIFFERENCES: VASTU vs TYPICAL AHFC

Based on the data:

1. **Vastu has the HIGHEST AUM CAGR** (51%) — fastest growing AHFC
2. **Very high CRAR** (68%) — under-leveraged, room to grow with debt
3. **5.1% RoA** — among the best, likely due to higher yields (serving harder-to-underwrite customers)
4. **Co-lending model** — 11 partners, unique distribution vs pure on-book lending
5. **PULSE technology** — differentiated underwriting for undocumented income
6. **Higher yields** (likely 18-20%) — serving truly informal segment, higher risk = higher price
7. **ATS ~₹2.35L** (from Aegis rundown) — much smaller than peers (₹0.85-1.1mn), suggesting micro-housing or very small loans
8. **36-month tenure** (from Aegis) — very short vs industry avg 6-10 years, suggesting LAP/business loan heavy mix
9. **25% ROI** (from Aegis rundown) — confirms very high-yield portfolio

**Wait — the Aegis data suggests ₹2.35L ATS and 36-month tenure at 25% yield. This is NOT typical home loan data. This is the Vastu Finserve subsidiary (business loans/micro-LAP).** The co-lending partners (DMI, Finnable, etc.) are consumer/MSME lenders, not housing lenders.

This means the "Project Aegis" data is likely for:
- The **non-housing book** (LAP, business loans, auto/equipment via Vastu Finserve)
- Or a **co-origination/co-lending portfolio** separate from the core housing book
- The core housing book would have ₹8-15L ATS, 15-20yr tenure, 13-15% yield

This is a **critical distinction** for the synthetic dataset — Vastu has two very different portfolios.
