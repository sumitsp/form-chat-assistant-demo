# Chat Mode — Implementation Spec

A complete spec for adding a **Chat Mode** alongside the existing Form Mode in the mortgage intake app. Hand this to Cursor or Claude Code along with the existing `ChatIntakeExperience.jsx` (or equivalent) and the backend API surface.

The frontend and backend pieces are split into clearly-marked sections. The frontend changes are self-contained and assume the existing question schema (`QUESTIONS` array) is reusable.

---

## 1. Goal

Chat Mode lets the user describe their mortgage scenario in plain English (typed or voiced), instead of clicking through a sequence of question cards. The assistant extracts what it can from each turn, replies in natural-language prose, and asks only what's still missing. After ~3 conversational asks it occasionally drops a compact A/B/C/D option card or a multi-field themed prompt to vary the rhythm. Complex inputs (Property Value / Loan Amount / LTV triangle, credit-events timeline, NOCB + Residual Income) always render as form cards.

Behavior must be **decoupled** from Form Mode — Chat Mode never auto-stacks card after card; cards only appear when the type genuinely needs one or when the conversational counter hits its cadence threshold.

---

## 2. Architecture

Single component, two modes selected via a tab strip:

```
┌───────────────────────────────────────────────────────────────┐
│  [Form Mode] [Chat Mode]    Have a 1003? Switch to Form →     │
├───────────────────────────────────────────────────────────────┤
│  [Sidebar: profile fields]  │  [Chat scroll]                  │
│                             │  [Input bar with voice + send]  │
└───────────────────────────────────────────────────────────────┘
```

Both modes:

- Share the same `scenario` state object (every field defined in `QUESTIONS`).
- Share the same left sidebar (`MortgageProfileSidebar`) that renders filled fields grouped by step.
- Share the same submit + results flow (`handleFindPrograms`, results card, suggestion cards).
- Share the same Scenario Vault, profile dropdown, and resubmit logic.

What's specific to Chat Mode:

- Welcome message text
- Input handler (`handleChatModeMessage`) instead of the form-mode router
- A conversational dispatcher (`advanceChatModeNext`) that decides whether the next ask is prose / themed-prose / option card / form card
- A regex-based or LLM-backed extractor

---

## 3. State additions

Add to the main component:

```js
const [mode, setMode] = useState("form"); // "form" | "chat"
const [chatConversationalTurns, setChatConversationalTurns] = useState(0);
const [pendingChatField, setPendingChatField] = useState(null);
const [pendingReinforcement, setPendingReinforcement] = useState(null);
const [chatHadBrainDump, setChatHadBrainDump] = useState(false);
```

Reset all four chat-mode states inside `handleClearAndRestart` and whenever the user toggles modes.

---

## 4. UI shell

**Mode tab bar.** Two buttons (Form Mode / Chat Mode). Active is filled navy; inactive is transparent gray text. To the right of the tabs in Chat Mode show: _"Have a 1003 / URLA v3.4? Switch to Form Mode →"_ as an inline link. The far right of the bar holds the profile dropdown trigger.

**Chat Mode welcome.** Three-paragraph assistant message:

1. _"Hi! I'm your mortgage assistant, here to help you find programs that best match your property and financing needs."_
2. _"I'll guide you through a few quick questions to understand your scenario and help identify suitable options. Whether you're purchasing, refinancing, or exploring eligibility, I'll help narrow down the best-fit programs for you."_
3. _"Type your scenario to get started. With your inputs, your profile and matching scenario will take shape on the left."_

No Start button needed — Chat Mode is "live" the moment the user types.

**Chat input bar.**

- Single text input with placeholder `"Message"` in Chat Mode.
- Voice mic button left of send — uses Web Speech API (`window.SpeechRecognition || window.webkitSpeechRecognition`). On result, fill the input with the transcript and let the user hit send (or auto-send on end if you prefer).
- Send button on the right.
- Pressing Enter sends.

---

## 5. Message types

Add (or reuse) these message types in the chat scroll renderer:

| Type               | Purpose                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| `assistant`        | Plain prose reply (single string `content` OR an array of paragraphs)           |
| `user`             | What the user said                                                              |
| `question`         | A form card (existing QUESTIONS-driven UI)                                      |
| `answered`         | A user bubble with a "Change" button to edit                                    |
| `chat-extraction`  | A summary card showing fields just picked up (only on brain dumps of 4+ fields) |
| `chat-options`     | A compact inline A/B/C/D option card (for multi-choice with ≤4 options)         |
| `results`          | Eligibility results                                                             |
| `suggestion-cards` | Post-results action bar                                                         |
| `final-action`     | Submit / Resubmit CTA                                                           |

---

## 6. Extraction engine

Frontend has a regex-based extractor that runs every turn. Replace or augment with a backend call when ready.

**Function signature:**

```js
function extractScenarioFromText(text) {
  return {
    extracted: {
      /* field: value */
    },
    notes: [
      /* informational strings the assistant can mention */
    ],
    ambiguous: [
      /* { field, reason } items needing clarification */
    ],
  };
}
```

**Fields the extractor should cover** (matching the existing `QUESTIONS` array):

- `citizenship` (us_citizen / permanent_resident / non_permanent_resident / foreign_national / itin_daca)
- `occupancy` (primary / second_home / investment)
- `loanPurpose` (purchase / rate_term / cash_out — infer cash_out from "pay off the first … out of …" pattern and add an `Inferred Cash-Out` note)
- `lienPosition` (first / second / piggyback)
- `propertyType` (single_family / pud / townhouse / condo / two_to_four)
- `documentationType` (full_doc / bank_stmt_personal / bank_stmt_business / pl_only / asset_util — if "bank statements" appears without "personal"/"business", set bank_stmt_personal AND push an ambiguous item)
- `creditScore` (3-digit FICO)
- `estimatedDti` (1-2 digit percent)
- `state` (50 states + DC, by name → 2-letter code; also note "Lee County" etc. without using as a field)
- `propertyValue`, `loanAmount`, `ltv` (auto-compute LTV when two of three are present)
- `housingHistory` (0x30x12 / 1x30x12 / 0x60x12 / 1x60x12 — match "clean", "no lates", "0×30×12" etc.)
- `hasCreditEvent` (yes / no — match "no credit events", "bankruptcy", "foreclosure", etc.)

**Number parsing.** Handle `"600.000"` (European thousands separator), `"$600,000"`, `"600k"`, `"1.5M"`. Strip trailing/leading separators before evaluating. Detect the "looks like N×3 grouping" pattern with `/^\d{1,3}([.,]\d{3})+$/` and strip all separators if it matches.

**Backend hook.** When you wire the LLM extractor, the function becomes:

```js
async function extractScenarioFromText(text) {
  const res = await fetch("/api/extract-scenario", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, currentScenario: scenarioRef.current }),
  });
  return await res.json(); // same shape as above
}
```

---

## 7. Conversational prompts

Every field that can be asked conversationally needs a prompt that:

1. Briefly explains **why** the answer matters
2. Hints at the **possible responses**
3. Ends with the actual question

Pattern: `"{why} {options/hint}. {question}?"`

**Examples** (full list lives in a `CONVERSATIONAL_PROMPTS` constant):

```js
citizenship:
  "Let's start with citizenship/residency. Some programs are available only to U.S. citizens and permanent residents, while others are designed specifically for ITIN borrowers, visa holders, and foreign nationals. What's the borrower's citizenship or residency status?",

estimatedDti:
  "DTI above 43% triggers a residual income test plus an NOCB option; over 50% raises the residual floor to $3,500. What's the estimated DTI percentage?",

documentationType:
  "Doc type defines how income gets calculated. Full doc uses tax returns and W-2s; bank statements use 12-24 months of deposits; P&L only is profit-and-loss without statements; asset utilization converts liquid assets to qualifying income. Which path will the borrower use?",
```

Write one entry per field that has a conversational ask.

---

## 8. Conversational flow logic

The core dispatcher: when a turn completes, call `advanceChatModeNext(scenarioSnapshot)`. Decide what to do next in this order:

**Step 1 — Final?** If `chatModeMissingQuestion(snapshot)` returns null, push a final-action card and stop.

**Step 2 — Reinforcement queued?** If `pendingReinforcement` is set (an inferred/ambiguous value), prompt the user to confirm. Don't move forward until they reply.

**Step 3 — Themed grouping.** Use a `CHAT_THEME_GROUPS` constant to detect when 2-3 missing fields share a theme (basics / property / capacity / credit / considerations / preferences). If a theme has 2+ missing entries, ask them all in one multi-paragraph prose message:

```
"Let's cover Credit. {prompt for housingHistory} {prompt for hasCreditEvent}"
```

After a themed ask, anchor `pendingChatField` to the first of the bundle so short replies route correctly. Reset `chatConversationalTurns` to 1 (counts as one ask).

**Step 4 — Complex type → form card.** If the next missing question's type is `triangle`, `multi-select`, `credit-events-timeline`, `compound-high-dti`, or `notice`, push a form card. Reset turns to 0.

**Step 5 — Option-card cadence.** If `chatConversationalTurns >= 2` AND the next question is `multi-choice` with ≤4 options, push a compact A/B/C/D card (`chat-options` message type). Reset turns to 0.

**Step 6 — Conversational prose.** Otherwise, push the conversational prompt for that field. Set `pendingChatField` to the field. Increment turns by 1.

**Brain-dump preamble.** After the initial brain dump (4+ extracted in one message), set `chatHadBrainDump = true`. The next conversational ask should be wrapped with: _"Great, we're making progress. Based on what you've shared so far, we've already narrowed down the list of matching programs. To finalize the shortlist, I need a few more details."_ — then the actual prompt. Reset the flag after use.

---

## 9. Context-aware short replies

When the assistant asks conversationally about a specific field (`pendingChatField` set), parse the next user reply with extra leniency:

```js
function contextAwareParse(text, pendingChatField, scenario) {
  const q = QUESTIONS.find((qq) => qq.field === pendingChatField);
  if (!q) return {};
  const lc = text.toLowerCase().trim();
  if (q.type === "yes-no") {
    if (/^(?:yes|yeah|yep|sure|ok|y|true|correct|yup)\b/.test(lc))
      return { [pendingChatField]: "yes" };
    if (/^(?:no|nope|nah|n|false|negative)\b/.test(lc)) return { [pendingChatField]: "no" };
  }
  if (q.type === "number") {
    const m = text.match(/\d+(?:\.\d+)?/);
    if (m) return { [pendingChatField]: m[0] };
  }
  if (q.type === "multi-choice" || q.type === "select") {
    const opts = getOptions(q, scenario);
    const hit = opts.find(
      (o) =>
        lc === o.value.toLowerCase() ||
        lc === o.label.toLowerCase() ||
        lc.startsWith(o.label.toLowerCase()) ||
        (lc.length >= 3 && o.label.toLowerCase().startsWith(lc)),
    );
    if (hit) return { [pendingChatField]: hit.value };
  }
  return {};
}
```

Merge context-aware results BEFORE the generic extractor's results, so stricter generic matches still win when both fire.

---

## 10. Reinforcement / ambiguity handling

When the extractor returns `notes` containing `"Inferred …"` OR `ambiguous.length > 0`, ask for confirmation BEFORE moving to the next missing field.

```js
function detectReinforcements(extracted, notes, ambiguous, merged) {
  const items = [];
  if (extracted.loanPurpose && notes.some((n) => /Inferred Cash-Out/.test(n))) {
    items.push({
      field: "loanPurpose",
      prompt:
        "Quick check first — I picked up that you're paying off an existing first plus pulling some equity out, which reads as a cash-out refinance. Want me to lock that in, or is it actually rate-and-term?",
      kind: "inferred",
    });
  }
  ambiguous.forEach((a) => {
    if (a.field === "documentationType") {
      items.push({
        field: "documentationType",
        prompt:
          "Quick clarification — you mentioned bank statements. Are these personal bank statements or business bank statements? They follow slightly different income-calc rules.",
        kind: "ambiguous",
      });
    }
  });
  return items;
}
```

When the user replies to a reinforcement:

- `yes / correct / right / lock it in` → confirm, clear `pendingReinforcement`, continue.
- `no / wrong / not quite` → clear that field from scenario, set `pendingChatField = field`, ask its conversational prompt.
- Anything else → run normal extraction; the user may have provided the corrected value directly.

---

## 11. Compound forms

For `triangle`, `multi-select`, `credit-events-timeline`, and `compound-high-dti`, voice/typed text should fill fields too — not just clicks.

**Triangle (PV / LA / LTV).**

- Parser: match "property value", "value", "pv", "loan amount", "loan", "la", "ltv" followed by a number (optional `$`, `k`/`M`, separators, `%`).
- Submit only when at least 2 of 3 are present; the third auto-computes via `ltv = (loanAmount / propertyValue) * 100`.
- If only 0-1 are parsed, prompt: _"Mention at least two of: property value, loan amount, LTV — e.g., 'property value 850k, loan amount 600k'."_

**Compound high-DTI (NOCB + Residual).**

- Lift state up so chat input can write into it.
- Parser handles: `yes/no nocb`, relationship words (spouse/parent/sibling/child/other relative/non-relative + their synonyms: husband/wife/mom/dad/etc), `combined dti 38`, `household 3` / `family of 4`, `residual 2500` / `monthly residual income $4000`.
- Auto-advance step 1 → step 2 when NOCB section completes.
- Auto-submit when all five fields are filled in one breath.

**Credit-events timeline.**

- Multi-select cards for event types, then one-card-per-event flow for timing.
- Each card asks "Event N of K — how long ago was this?" with bucket cards `<2y / 2-3y / 3-4y / 4-7y / 7+y` plus an `MM/YYYY` input.
- Validate MM/YYYY with `/^(0[1-9]|1[0-2])\/\d{4}$/`.

**Multi-select.**

- Toggle cards, "Continue (N selected)" button at bottom. Cards show ✓ in place of letter when selected.

---

## 12. Backend contract

Three endpoints to expose (or extend whatever you already have):

**`POST /api/extract-scenario`** — natural-language extraction

- Request: `{ text: string, currentScenario: object }`
- Response: `{ extracted: object, notes: string[], ambiguous: { field, reason }[] }`
- Should handle the same field set as Section 6. Notes prefixed with `"Inferred "` trigger the reinforcement flow. Ambiguous entries trigger clarification prompts.

**`POST /api/eligibility/full`** (existing) — submit complete scenario

- Request: full scenario object
- Response: `{ matched: Program[], excluded: ExcludedProgram[] }`

**`POST /api/extract-scenario/voice`** (optional) — voice-specific path

- Same shape as `/api/extract-scenario` but the backend may apply different cleanup for spoken speech (e.g. "six hundred thousand" → 600000). If omitted, the frontend can do the conversion before submit.

If the backend isn't ready, the frontend regex extractor handles ~80% of common phrasings. Replace it later without changing any UI code.

---

## 13. Voice input

- Toggle button in the chat input bar with mic icon (line-art SVG).
- Active state pulses red.
- `recognition.lang = "en-US"`, `continuous = false`, `interimResults = true`.
- On `onresult`, write the latest transcript to the chat input. On `onend`, set `isRecording = false`.
- Browser support fallback: if `window.SpeechRecognition || window.webkitSpeechRecognition` is missing, alert "Voice input isn't supported in this browser. Try Chrome or Edge."

For complex form cards (triangle, compound), voice writes to chat input → handler routes the transcript through the same parser the typed input uses (Section 11).

---

## 14. Edge cases & state management

- **Mode switch.** Toggling between Form / Chat clears the scenario, calls `handleClearAndRestart`, and reseeds messages with the mode-appropriate welcome.
- **Profile / vault.** Both modes share the same profile dropdown and Scenario Vault. Loading a scenario from the vault drops the user back into Form Mode by default.
- **Resubmit.** After the user submits and then edits any answered field, the next time they reach the end the final-action label switches to "Resubmit with updated answers" and a sidebar pill appears. Holds across both modes.
- **History preservation.** `handleFindPrograms` only filters duplicate `final-action` entries. Never `.filter()` or `.slice()` `user`, `assistant`, `answered`, `question`, or the welcome message. The user must be able to scroll up after submission and click Change on any answered bubble.
- **Stale extractor.** When the backend extractor isn't available, fall back to the local regex implementation silently. Log to console only.
- **No-fields-extracted.** If a chat-mode message yields zero extracted fields AND no pending field is set, reply: _"Hmm, I didn't catch that. Could you rephrase? You can mention things like loan amount, property value, FICO, DTI, occupancy, doc type, etc."_

---

## 15. Implementation order

Recommended order if Cursor wants to ship in stages:

1. **Mode tab + welcome message + chat input bar.** Just the shell. Typing does nothing yet.
2. **Frontend regex extractor.** Wire `extractScenarioFromText`. Each user turn writes to `scenario` and acknowledges in prose.
3. **`chatModeMissingQuestion` + dispatcher.** Pick the next field, render conversational prompt, render form cards for complex types. Counter not yet — every ask is prose unless complex.
4. **`CONVERSATIONAL_PROMPTS`** with why+options text for every field.
5. **Context-aware short replies.** Add the `contextAwareParse` layer.
6. **Reinforcement queue.** Detect inferred/ambiguous, gate advancement on confirm.
7. **Cadence + option cards.** Add `chatConversationalTurns`; render `chat-options` after 2 conversational asks when the next question is multi-choice ≤4 options.
8. **Themed grouping.** Add `CHAT_THEME_GROUPS`; ask 2-3 same-theme fields together.
9. **Triangle / compound voice support.** Wire parsers for the complex types.
10. **Backend hookup.** Swap the regex extractor for `/api/extract-scenario`. UI unchanged.
11. **Brain-dump preamble.** Polish.
12. **Voice input (Web Speech API).** Already largely portable from Form Mode.

---

## 16. Files to touch

For a single-file implementation (matching the existing app structure):

- `ChatIntakeExperience.jsx` — all of the above lands here.
- `extractScenarioFromText.js` (optional split) — pure module if you want to test the parser independently.
- `CONVERSATIONAL_PROMPTS` — can stay inline or move to a `chatPrompts.js`.
- Backend: `/api/extract-scenario` route + its handler.

If your project uses split files / hooks, the natural splits are:

- Hook: `useChatMode(scenario, setScenario, currentQuestionId, setCurrentQuestionId)` returns `{ handleChatModeMessage, advanceChatModeNext, pendingChatField, pendingReinforcement, chatConversationalTurns }`.
- Component: `<ChatModePane />` renders the input + scroll for chat mode only.
- Shared: the existing `<MortgageProfileSidebar />`, `<QuestionMessage />`, `<AssistantMessage />`, `<UserMessage />`, results card.

---

## 17. Acceptance criteria

The implementation is done when:

1. Switching to Chat Mode shows the three-paragraph welcome and a single message input.
2. Pasting the canonical brain-dump (_"loan amount 600.000, first lien, single family, primary residence, value 850.000, paying off the first for 400.000 out of 200.000, full doc US citizen, FICO 720, Lee County Florida, DTI 42"_) extracts 12+ fields in one turn and posts a structured summary card.
3. After the brain dump, the assistant fires the "Great, we're making progress…" preamble + the first conversational question.
4. After every 3 conversational asks, the next ask is either an option card (4 cards labeled A-D) or a form card.
5. When the extractor infers cash-out (or hits ambiguity), the user gets a confirmation question first.
6. Voice button dictates into the chat input; pressing send routes through the same path as typing.
7. Clicking Change on any prior answered field — even after results have rendered — converts it back to a question; re-answering preserves all other answers unless their `showIf` returns false.
8. Submitting eligibility lands in the same results + suggestion-cards experience as Form Mode.
9. Resubmit, Save to Vault, and Profile dropdown all work identically across modes.
10. The chat history (welcome, answered bubbles, prior assistant messages) is never truncated by submission.

---

End of spec.
