# Chat Mode (`/chat`) — conversational intake

## What it is

Same field schema and results as [Form Mode](./FORM.md), but intake is **free-text first**. You describe the deal; the app extracts slots, shows what it captured, and asks only for gaps. The Mortgage Profile sidebar, quick-scan counter, Submit, and Resubmit behave the same.

| URL | Role |
|---|---|
| `/chat` | Loan Officer |
| `/chat?mode=underwriter` | Underwriter (+ optional batch at end) |

## Session flow

### 1. Opening — brain dump

User types or speaks a scenario paragraph. The hook calls **`POST /api/intake/extract`** (stateless LLM extractor) with the full text and merges a portfolio → `form` patch.

The UI shows:

- **`CHAT_CAPTURED`** — "I picked these up" with labeled fields
- A **stock-take line** — e.g. *"That covers 8 of about 20 — about 12 to go"*

**Normalization:** counties are matched to `dim_county` (e.g. "palm beach" → "Palm Beach County"); states use Levenshtein validation server-side.

### 2. Conversational asks

Turn planning lives in `lib/chatConversation.ts` (`advanceChatModeNext`). It does **not** duplicate the field schema — it reads `FORM_CHAT_QUESTIONS` from `formChatFlow.ts`.

#### Five ask formats

| Format | UI | When used |
|---|---|---|
| ① **why_question** | Prose + grounded "why it matters" | Early turns, roll |
| ② **options_question** | A/B/C cards or value hint | Enums, yes/no, numbers |
| ③ **summary_question** | Captured + numbered remaining list; multi-field reply OK | Q4 fallback, Q5 after combo, every ~5 asks |
| ④ **combo_question** | Two related fields in one ask | Q4 when a curated pair matches |
| ⑤ **optional_batch** | End-of-intake optional card | UW mode, non-product optionals |

#### Cadence (after opening extract)

| Turn index | Rule |
|---|---|
| Q1–Q3 | Alternate ① and ② |
| Q4 (`turn === 3`) | ④ combo if both fields in `COMBO_PAIRS` are missing; else ③ summary |
| Q5 (`turn === 4`) | If Q4 was ④ **and** ≥2 mandatory gaps remain → ③ summary (early stock-take) |
| Q6+ | Weighted roll over ①②④; ③ forced every **5** asks if ≥3 mandatory remain |

Connective wording is picked from variant pools and **never repeats** in one session.

**Complex fields** always render as form cards (not prose): loan triangle, county search, geo follow-up, credit-events multi-select, NOCB/residual bundle, product-pref pickers.

**Loan Details prompt** acknowledges partial capture: *"I already have the property value ($800,000) — give me one more (loan amount or LTV)…"*

#### Guards

| Mechanism | Behavior |
|---|---|
| **Reinforcement** | Inferred/ambiguous extractor values → confirm before continuing |
| **2-strike skip** | Same question skipped twice → `safeDefault` (usually "No" for yes/no) or deferred to end-of-intake summary |
| **Bare yes/no fast path** | "yes"/"no" to a pending yes/no question skips the extractor LLM |
| **Deferred re-ask** | Skipped fields return once in a ③ summary card |

### 3. Credit events

Asked in prose first. Replies like *"BK 7 years back"* can fill event + timing in one extract pass.

Flow:

1. Gate: any prior events? (yes/no)
2. Multi-select list (includes "None — clean history")
3. **Bankruptcy** always gets chapter + discharged/dismissed (never assumed)
4. Per-event timing card for anything still missing MM/YYYY or bucket

### 4. Product preferences and optionals

Product prefs (term, rate type, IO) are asked **one at a time** as conversational cards — never stacked.

Remaining **optional** fields (UW mode) batch into one **`CHAT_OPTIONAL_BATCH`** card with Skip all.

### 5. Wrap-up

**Recap card** — full captured profile; user can say *"change LTV to 75"* or add scenario notes, then **Submit** runs full eligibility. Results, sidebar edit, and Resubmit match Form Mode.

## Sidebar edits in chat

Click-to-edit uses the same **`buildCascadePatchForFormEdit`** as Form Mode. Cleared slots are mirrored into the extract **portfolio** so the next LLM turn does not resurrect stale values. **`repromptAfterSidebarEdit`** re-opens the first mandatory gap in the chat thread.

Session Notes (amber card) hold LO free-text; extracted bullets can merge into scenario notes.

## APIs used (live path)

| Endpoint | Role |
|---|---|
| `POST /api/intake/extract` | Turn + bulk extraction → portfolio delta |
| `POST /api/intake/frame` | Optional LLM framing for combo asks only |
| `POST /api/eligibility/quick` | Sidebar counter while filling |
| `POST /api/eligibility` | Submit / Resubmit |

Legacy `/api/intake/message` planner routes exist in the backend but are **not** used by the current UI.

---

*Code: turn loop `wizard/hooks/useChatConversation.ts`; cadence `lib/chatConversation.ts`; shared schema `lib/formChatFlow.ts`.*
