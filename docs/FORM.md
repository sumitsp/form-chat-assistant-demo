# Form Mode (`/form`) — guided intake

## What it is

A **one-question-at-a-time** chat in the center column plus a live **Mortgage Profile** sidebar. Each answer patches shared wizard `form` state; the sidebar and eligibility payload stay in sync.

While you answer, **`POST /api/eligibility/quick`** runs after each change (debounced) and updates the **Eligible Programs N/30** counter — a preliminary SQL-only estimate, not the final Submit result.

## Routes and roles

| URL | Role |
|---|---|
| `/form` | **Loan Officer** — mandatory questions + product preferences |
| `/form?mode=underwriter` | **Underwriter** — also UW-only mandatory fields and remaining optionals |

Role is chosen on the home screen and reflected in the URL. The legacy **5-step wizard** (Basics → Capacity → Credit → Collateral → Conditions) is still reachable from edit/back flows; the default intake is the guided chat driven by `FORM_CHAT_QUESTIONS`.

## Faster start

On the welcome screen you can upload:

- **1003 / URLA (PDF)** — fields extracted into `form`
- **Fannie Mae MISMO 3.4 (XML)** — same

Imported fields show a highlight in the sidebar; the chat only asks **gaps**.

## Questions (five sections, in order)

Questions use `showIf` rules — inapplicable ones are skipped (e.g. DSCR fields on full-doc primary, FTHB on refi).

### 1. Basics

Citizenship → visa/OFAC (foreign national) → occupancy → **loan purpose** (before lien) → lien position → property type → **Loan Details** (value / loan / LTV triangle — enter any two; CLTV and lien-specific fields when second lien or cash-out) → decision credit score → first-time homebuyer / investor (purchase only; refi hardcodes No) → owner-occupied income path when applicable.

### 2. Capacity

Documentation type → **12 vs 24 month** doc window (income-doc types only) → DTI **or** DSCR + rental type → prepayment terms → prepay stepdown (when prepay applies).

High-DTI on primary/second home can trigger a **NOCB / residual income** bundle (confirm notice, then relationship + combined DTI or household size + residual).

### 3. Credit

Payment history → credit-events gate → multi-select events with per-event timing (MM/YYYY or year bucket).

### 4. Collateral

State → **county search** (matched to `dim_county`) → state-specific geo follow-ups (city, zip, borough, metro flags — only where configured) → rural → acreage → vacant / recently rehabbed (DSCR refi) → optional property condition / declining market (UW).

### 5. Considerations

Listing seasoning (when required) → POA → non-arm's length → departing residence (optional) → product preferences (loan term, rate type, interest-only — each defaults to "No preference").

**Underwriter-only mandatory** (skipped in LO mode): liquid assets, tradelines, POA, non-arm's length are asked in UW; other optionals (reserves, tradelines detail, etc.) appear in UW flow or optional batch.

## Sidebar

- Rows mirror answered (and some pending) fields; **click a row** to re-open that question in the chat.
- **Upstream edits cascade:** changing occupancy, purpose, lien, state, or county clears dependents that are no longer valid and re-asks the first gap one-by-one.
  - Example: state change clears county + geo follow-ups; purpose Primary → Investment clears income-path / doc / DTI fields as needed.
- **Red "Required" rows** when Submit/Resubmit is blocked (`highlightGaps`).
- **Scenario notes** card appears after structured questions complete.

## Submit and results

**Submit Profile** calls **`POST /api/eligibility`** (full check — see [ELIGIBILITY.md](./ELIGIBILITY.md)):

| Result area | What you get |
|---|---|
| Matched programs | Cards with gate metrics + **Know More** (guideline notes from RAG) |
| Just Missed | Up to two programs with a concrete fix (LTV/loan tweak or FICO/DTI suggestion) |
| Exclusions | Geo and overlay rules that removed programs |
| Pricing & Compare | Live LoanPASS rates when configured ([PRICING.md](./PRICING.md)) |
| Results Q&A | Follow-up questions against lender guidelines |

## After Submit — edit and Resubmit

Post-results, the same guided chat continues in the center column.

The **amber Resubmit bar** appears only when **all** of:

1. Profile was submitted once
2. Form changed since last run (`dirtySinceSubmit`)
3. Intake flow has no mandatory gaps (including re-answered cascade fields)
4. Profile passes the resubmit gate (`mandatoryComplete` for guided chat, or legacy step completion)

Blocked Resubmit shows a toast and red sidebar gaps.

## Scenario Vault

Save scenarios with matched/rejected programs; reopen, clone, export PDF (`POST /api/scenario/pdf`).

---

*Code: question catalog `frontend/src/lib/formChatFlow.ts`; UI `wizard/FormChatFlow.tsx`; orchestration `LoanWizard.tsx`.*
