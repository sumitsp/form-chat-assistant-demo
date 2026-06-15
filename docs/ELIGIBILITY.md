# Eligibility — how a scenario gets matched

## What it is

Structured matching against ingested lender program data for **Denali/NQM**, **Everest/Deephaven**, and **Summit/Verus**. Matrices and rules live in MySQL (`dim_*`, `map_*`); guideline PDFs are chunked in Qdrant for notes and contradiction checks.

Answers: which programs match, which almost match (actionable fixes), and why others were excluded.

## API endpoints

| Endpoint | When | Qdrant |
|---|---|---|
| `POST /api/eligibility/quick` | After each intake answer (debounced) | No |
| `POST /api/eligibility` | Submit / Resubmit | Yes |

Both accept the same camelCase **`EligibilityRequest`** shape (built client-side from wizard `form` via `quickEligibilityPayload.ts` / `portfolio_to_eligibility_request()`).

## Quick scan vs full check

| | Quick scan | Full check |
|---|---|---|
| **Purpose** | Live sidebar counter, preview list | Final matched programs |
| **Speed** | Sub-second, SQL only | SQL + guideline retrieval |
| **Missing fields** | Not held against you — layers skip unset gates (`quick_skip_*`) | All triggered gates enforced |
| **Overlays / notes** | Minimal | Full overlays + RAG notes + hard blocks |

Unset citizenship, occupancy, purpose, property type, lien, etc. simply do not filter in quick mode until the user provides them.

## Matching layers (full check)

Programs shortlist through SQL layers; survivors get guideline cross-check:

| Layer | Table / source | Checks |
|---|---|---|
| **1** | `dim_programs` | Program-level gates: citizenship/NPRA, occupancy, purpose, property type, lien, income path |
| **2** | `map_ltv_matrix` | LTV/CLTV, loan amount, FICO band, doc type, DTI or DSCR vs matrix row |
| **2b** | `map_program_rule_guideline` | Basics overlays on matrix match |
| **3** | `map_program_fthb_eligibility` | First-time homebuyer rules when flagged |
| **4** | `map_program_products` | Product type (e.g. HELOC vs closed-end second) |
| **4b** | Product preference filters | Term / rate type / IO prefs when not "No preference" |
| **5** | `map_geographic_restrictions` | State, county, city, and configured geo flags |
| **6** | `map_credit_history_seasoning` | Credit events — type, chapter, outcome, months since |
| **7** | `map_housing_history_seasoning` | Payment history / housing overlays |
| **7b** | `map_program_rule_guideline` | Extended overlays: rural, acreage, NOCB, listing, POA, etc. |
| **8** | `map_program_rule_guideline` | Informational rule notes → `rag_notes` |
| **9** | `map_program_prepayment_options` | Prepay / stepdown (investment) |
| **10** | Qdrant `mortgage_matrices` | Retrieve guideline chunks; **hard-block** on clear contradiction; ambiguous rules → "Additional considerations" |

Implementation: `backend/eligibility.py` (`find_eligible_programs`).

## Fair margins (near tier edge)

A scenario **still matches** if it is within tolerance of a numeric gate (`backend/eligibility_tolerance.py`):

| Gate | Margin |
|---|---|
| LTV / CLTV / DTI | 0.5% |
| Loan amount | $2 |
| FICO | 2 points |
| DSCR | 0.05 |

## Response payload

### Matched programs

Each card includes lender, program name, key matrix metrics, `rag_notes` (summarized guideline bullets), and optional `special_overlay` flags.

### Just Missed (≤2)

Programs that fail on **one fixable dimension** the LO can realistically change:

- **LTV / loan amount** — suggests adjusted LTV or loan within tier
- **FICO / DTI** — human-fixable gap with hint (e.g. co-borrower, paydown)

Discovery windows: FICO within ~40 pts, DTI within ~10 pts of requirement (`NEAR_MISS_*` in `eligibility.py`). Multi-factor failures are exclusions, not near-misses.

### Exclusions

Structured lists of geo blocks and overlay rejections so "why not" is visible in the UI (`EligibilityExclusionDetails`).

## Why county and credit detail matter

- **County** — several geo rules are county- or city-specific; empty county blocks collateral completion and geo layer 5.
- **BK chapter + timing** — layer 6 seasoning keys off event type, chapter, and discharged/dismissed; chat enforces these before Submit.

## Diagnostics

Set `ELIGIBILITY_TRACE=1` to write per-run trace files under `logs/`. Use `npm run clean:logs` or `python -m backend.tools.clean_logs` to prune.

---

*Tables populated by `ingest/lenders/*_flow_to_mysql_qdrant.py`; guidelines by `*_guidelines_qdrant.py`.*
