// ─────────────────────────────────────────────────────────────────────────────
// chatConversation.ts — conversational dispatcher + content for /chat (overhaul)
//
// This drives the prose-first chat intake. It does NOT own a second field
// schema — every question, option list, and showIf rule still lives in
// `FORM_CHAT_QUESTIONS` (lib/formChatFlow.ts). This module only:
//   1. wraps each question with a grounded "why it matters" lead-in,
//   2. holds the curated COMBO_PAIRS (which two fields combine into one ask),
//   3. decides, each turn, which of the five ask formats to use, and
//   4. guarantees the connective wording never repeats in a session.
//
// The five ask formats:
//   ① why_question      why lead-in + question (prose)
//   ② options_question  question + A/B/C card (enum) or value hint (numeric)
//   ③ summary_question  captured-so-far + numbered remaining, free-text reply
//   ④ combo_question    two curated fields in one ask
//   ⑤ optional_batch    end-of-intake optional card (incl. product prefs)
//
// Cadence: turn 1 = scenario → bulk summary + stock-take (hook). Q1–Q3 alternate
// ①/②; Q4 is ④ (if a pair matches) else ③; Q5+ is a constrained roll over ①②④
// with ③ forced every ~5 asks. A queued reinforcement confirm always preempts.
// ─────────────────────────────────────────────────────────────────────────────

import type { WizardForm } from "@/components/LoanWizard";
import {
  computeYearsSinceBucket,
  normalizeCreditEventYearBucket,
  validateMmYyyy,
  type CreditEventYearBucket,
} from "@/lib/creditEventTiming";
import {
  chatAnswerFormPatch,
  creditEventLabel,
  FORM_CHAT_QUESTIONS,
  formChatProductPrefOptions,
  includeFormChatQuestionInFlow,
  isAnswered,
  isFormChatProductPrefQuestion,
  isNoProductPreference,
  optionsFor,
  parseDocumentationTimeframeReply,
  parseLoanTermChatReply,
  resolveFormChatPrompt,
  visibleQuestions,
  type FormChatQuestion,
} from "@/lib/formChatFlow";
import {
  LIEN_POSITION_FIRST,
  LIEN_POSITION_PIGGYBACK,
  LIEN_POSITION_SECOND,
} from "@/lib/nqmIntegratedForm";
import { inferGeoFollowupsFromCounty, clearGeoFollowupFieldsPatch } from "@/lib/stateGeoFollowUp";

// ── Themes ───────────────────────────────────────────────────────────────────

export type ChatTheme =
  | "basics"
  | "property"
  | "capacity"
  | "credit"
  | "considerations"
  | "preferences";

const THEME_LABEL: Record<ChatTheme, string> = {
  basics: "the basics",
  property: "the property",
  capacity: "capacity",
  credit: "credit",
  considerations: "a few considerations",
  preferences: "product preferences",
};

// Section-1 questions that are really about the property/loan structure, not the
// borrower — pulled into the "property" theme so combined asks group sensibly.
const PROPERTY_IN_BASICS = new Set(["propertyType", "valueLoanLtv", "cashInHandRequest"]);

/** Which of the 6 themes a question belongs to (derived from its section). */
export function themeOf(q: FormChatQuestion): ChatTheme {
  if (q.special === "product_pref") return "preferences";
  switch (q.section) {
    case 2:
      return "capacity";
    case 3:
      return "credit";
    case 4:
      return "property";
    case 5:
      return "considerations";
    default:
      return PROPERTY_IN_BASICS.has(q.id) ? "property" : "basics";
  }
}

/** Field ids grouped by theme — derived from FORM_CHAT_QUESTIONS, never hand-listed. */
export const CHAT_THEME_GROUPS: Record<ChatTheme, string[]> = (() => {
  const groups: Record<ChatTheme, string[]> = {
    basics: [],
    property: [],
    capacity: [],
    credit: [],
    considerations: [],
    preferences: [],
  };
  for (const q of FORM_CHAT_QUESTIONS) groups[themeOf(q)].push(q.id);
  return groups;
})();

// ── "Why it matters" catalog ─────────────────────────────────────────────────

export interface ConversationalPrompt {
  /** Optional "why it matters" lead-in. Present only for curated, grounded fields. */
  why?: string;
  /** The actual ask. Defaults to the question's existing `prompt`. */
  question: string;
}

// Curated "why it matters" lead-ins — one per metric the chat asks about. Every
// line must be traceable to an actual rule in the engine/schema (ltv_matrix gates,
// geographic_restrictions, credit_event_seasoning, formChatFlow showIf logic);
// do not invent thresholds. (e.g. the DTI > 43% line maps to formChatFlow.ts
// nocbVisible / residualTriggered; citizenship maps to the per-program
// citizenship gate in backend/eligibility.py.)
const WHY_BY_FIELD: Record<string, string> = {
  citizenship:
    "Programs gate on borrower type — some accept only U.S. citizens and permanent residents, while others are built for ITIN, visa, and foreign-national borrowers.",
  ofacSanctioned:
    "OFAC exposure is a hard compliance gate — it rules a file in or out before anything else is reviewed.",
  visaCategory:
    "For visa holders, the specific visa class determines which foreign-national and non-permanent-resident programs are open.",
  hasUsCredit:
    "Foreign nationals without a U.S. credit score route to the programs that allow foreign credit or no-FICO qualifying.",
  occupancy:
    "Primary residence, second home, and investment property each open a different set of programs and leverage limits.",
  loanPurpose:
    "Purchase, rate/term refinance, and cash-out each carry their own LTV ceilings and overlays.",
  lienPosition:
    "A second lien adds a combined-LTV (CLTV) gate on top of the first-lien LTV, which changes the leverage math.",
  secondLienProduct:
    "HELOC and closed-end second are different products with their own CLTV caps and program lists.",
  propertyType:
    "Condos, 2–4 units, and larger multi-unit properties each carry their own leverage caps and overlays.",
  valueLoanLtv:
    "Loan size and LTV are the primary leverage gates — most programs qualify and price off this triangle.",
  decisionCreditScore:
    "FICO bands drive the eligibility matrix — a few points can open or close a leverage tier.",
  firstTimeHomebuyer:
    "First-time-homebuyer status carries overlays on some programs — a few require housing history or tighter leverage.",
  firstTimeInvestor:
    "DSCR lenders care about landlord experience — first-time investors face extra restrictions on some programs.",
  investmentIncomePath:
    "An investment property can qualify off the borrower's income or the property's rent (DSCR) — the path decides everything we ask next.",
  establishedPrimaryRes:
    "Investors without an established primary residence trip overlays on several programs.",
  documentationType:
    "Doc type decides how income is calculated — full doc uses tax returns and W-2s, bank statements use deposits, P&L only skips statements, and asset utilization converts liquid assets to income.",
  documentationTimeframe:
    "The 12- vs 24-month window changes how income is averaged and which programs apply — and it impacts pricing.",
  estimatedDti:
    "Once DTI passes 43% on a primary or second-home loan, a residual-income test and the non-occupant co-borrower (NOCB) option come into play.",
  dscr: "On a DSCR loan it's the property's rent-to-payment ratio that qualifies the deal, not the borrower's personal income.",
  rentalType:
    "Short-term rentals carry their own DSCR overlays and leverage caps versus long-term leases.",
  prepaymentTerms:
    "On investment loans the prepay penalty term feeds both eligibility and pricing — longer terms usually price better.",
  reservesAvailable:
    "Months of reserves is a hard gate on most programs — bigger loans and riskier scenarios require more.",
  assetsLiquidFunds:
    "Liquid assets back up both reserves and funds-to-close — underwriters look at the two together.",
  giftFundsPercent: "Programs cap how much of the funds-to-close can come from gifts.",
  paymentHistory:
    "Mortgage lates over the last 12 months (0x30, 1x30, …) bucket the file into different program tiers.",
  hasCreditEvent:
    "Bankruptcies, foreclosures, and short sales carry seasoning windows that can rule whole programs in or out.",
  tradelines:
    "Programs set minimum tradeline depth — thin credit routes to a smaller set of lenders.",
  state:
    "Lenders restrict or overlay specific states — the property's location can rule programs in or out on its own.",
  stateCounty:
    "Several restrictions are county-level — declining-market and disaster overlays key off the county.",
  isRuralProperty: "Rural properties trip acreage and marketability overlays on several programs.",
  acreage: "Acreage caps are program-specific — large parcels narrow the list.",
  vacantProperty:
    "A vacant property on a DSCR refinance triggers occupancy and lease overlays on some programs.",
  recentlyRehabbed: "Recently rehabbed properties can hit value-seasoning rules on a refinance.",
  hiLavaZone: "Hawaii lava zones 1 and 2 are excluded or restricted by several lenders.",
  propertyCondition: "Condition ratings of C5/C6 are ineligible for most programs.",
  decliningMarket: "A declining-market designation cuts the maximum LTV on several programs.",
  listingSeasoning:
    "A property listed for sale in the last six months can trigger seasoning overlays on a refinance.",
  powerOfAttorney: "POA closings are restricted on some programs, especially cash-out.",
  nonArmsLength: "Non-arm's-length deals carry extra scrutiny and are excluded by some programs.",
  departingResidence:
    "A departing residence affects DTI — expected rent can offset the old housing payment.",
};

/** `{ why?, question }` per field, keyed by FORM_CHAT_QUESTIONS id (showIf stays in sync). */
export const CONVERSATIONAL_PROMPTS: Record<string, ConversationalPrompt> = Object.fromEntries(
  FORM_CHAT_QUESTIONS.filter((q) => q.prompt.trim()).map((q) => [
    q.id,
    WHY_BY_FIELD[q.id] ? { why: WHY_BY_FIELD[q.id], question: q.prompt } : { question: q.prompt },
  ]),
);

function promptFor(q: FormChatQuestion, form?: WizardForm): ConversationalPrompt {
  const curated = CONVERSATIONAL_PROMPTS[q.id];
  // Dynamic prompts first (promptFn — e.g. the triangle's "I already have the
  // property value ($800,000) — give me one more…" acknowledgment) so a partial
  // brain-dump never gets re-asked for values it already provided.
  const dynamic = form && q.promptFn ? resolveFormChatPrompt(form, q).trim() : "";
  const question =
    dynamic || curated?.question?.trim() || q.prompt.trim() || "Could you add a bit more detail?";
  const why = WHY_BY_FIELD[q.id];
  return why ? { why, question } : { question };
}

// ── Combo catalog — curated 2-field pairs (plan §3) ──────────────────────────

// [fieldA, fieldB, transition line]. A pair is eligible only when BOTH fields are
// currently missing + visible and neither is a complex (form-card) question.
// County+Rural from the vision can't pair — county uses the search card.
export const COMBO_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ["occupancy", "loanPurpose", "Together they set which program families are on the table."],
  ["propertyType", "occupancy", "Property type and occupancy combine into the program grid."],
  ["firstTimeHomebuyer", "citizenship", "Both shape which borrower-profile programs apply."],
  [
    "firstTimeHomebuyer",
    "documentationType",
    "Borrower profile and income docs usually travel together.",
  ],
  ["documentationType", "estimatedDti", "Doc type and DTI together pick the income lane."],
  [
    "estimatedDti",
    "reservesAvailable",
    "Capacity is judged on both — the payment load and the cushion behind it.",
  ],
  ["dscr", "rentalType", "The ratio and the rental strategy are read together on DSCR deals."],
  [
    "firstTimeInvestor",
    "investmentIncomePath",
    "Investor experience and the qualifying path pair naturally.",
  ],
  [
    "vacantProperty",
    "recentlyRehabbed",
    "Both are quick property-status checks for a DSCR refinance.",
  ],
  [
    "paymentHistory",
    "hasCreditEvent",
    "Housing history and credit events make up the credit picture.",
  ],
  ["powerOfAttorney", "nonArmsLength", "Two quick closing-logistics checks."],
  [
    "reservesAvailable",
    "assetsLiquidFunds",
    "Reserves and liquid assets are reviewed side by side.",
  ],
  ["listingSeasoning", "powerOfAttorney", "Two final transaction checks."],
];

/** First curated pair fully inside `missing` (preferring pairs that include `missing[0]`). */
function comboFor(
  missing: FormChatQuestion[],
): { fields: [FormChatQuestion, FormChatQuestion]; lead: string } | null {
  const byId = new Map(missing.map((q) => [q.id, q]));
  const usable = (id: string) => {
    const q = byId.get(id);
    return q && !isComplexQuestion(q) ? q : null;
  };
  const headId = missing[0]?.id;
  const ranked = [
    ...COMBO_PAIRS.filter(([a, b]) => a === headId || b === headId),
    ...COMBO_PAIRS.filter(([a, b]) => a !== headId && b !== headId),
  ];
  for (const [a, b, lead] of ranked) {
    const qa = usable(a);
    const qb = usable(b);
    if (qa && qb) return { fields: [qa, qb], lead };
  }
  return null;
}

// ── Complex / form-card fields ───────────────────────────────────────────────

// `special` types that cannot be asked as prose — they always render a form card.
const COMPLEX_SPECIALS = new Set([
  "triangle",
  "credit_events",
  "county_search",
  "geo_followup",
  "capacity_dti_notice",
  "capacity_dti_bundle",
  "product_pref",
]);

export function isComplexQuestion(q: FormChatQuestion): boolean {
  return !!q.special && COMPLEX_SPECIALS.has(q.special);
}

const isOptional = (q: FormChatQuestion) => q.priority === "optional";
/** Summary (③) cards list mandatory fields only — optionals never mix in. */
const mandatoryOnly = (missing: FormChatQuestion[]) =>
  missing.filter((q) => q.priority === "mandatory");

/**
 * Triggered, still-unanswered questions to feed `advanceChatModeNext`, in SLOT order.
 * Reuses `visibleQuestions` (showIf) + `isAnswered` from formChatFlow so there's no
 * second notion of "what's left." LO mode asks mandatory + product prefs; UW mode
 * also includes other optional-priority and UW-only questions (non-product optionals
 * may batch at end-of-intake).
 */
export function missingChatQuestions(
  form: WizardForm,
  mode: "lo" | "underwriter",
  opts: { productPrefConfirmed?: ReadonlySet<string> } = {},
): FormChatQuestion[] {
  const includeOptional = mode === "underwriter";
  const confirmed = opts.productPrefConfirmed;
  return (
    visibleQuestions(form)
      .filter((q) => {
        if (!includeFormChatQuestionInFlow(q, includeOptional)) return false;
        if (isFormChatProductPrefQuestion(q)) {
          return !confirmed?.has(q.id);
        }
        if (isAnswered(form, q)) return false;
        return true;
      })
      // promptFn / geo_followup use empty static prompts — resolve per form so chat
      // never renders a bare "Q." with no question text. Credit events get the
      // chat-specific list-all / per-event-timing prose (the /form card keeps its own).
      .map((q) => ({
        ...q,
        prompt:
          q.special === "credit_events"
            ? chatCreditEventsPrompt(form)
            : resolveFormChatPrompt(form, q),
      }))
  );
}

// ── Credit-event conversation (hasCreditEvent=Yes follow-up) ─────────────────
//
// Flow: ① prose ask — "list ALL events with when each happened" (the extractor
// resolves one event + seasoning bucket per turn; the hook ACCUMULATES them via
// `adjustCreditEventPatch`) → ② per-event timing follow-ups for any event still
// missing a date/bucket → ③ if a reply doesn't parse, the hook falls back to the
// CHAT_CREDIT_EVENTS multi-select card, then timing cards per event.

/** True once `code` has usable timing — mirrors `isAnswered`'s per-event check. */
export function creditEventTimingDone(form: WizardForm, code: string): boolean {
  const y = form.creditEventYears?.[code]?.trim() ?? "";
  if (y) return true;
  const d = form.creditEventDates?.[code]?.trim() ?? "";
  return !!d && !validateMmYyyy(d);
}

/** First selected credit event still missing a date/bucket, or null. */
export function nextUntimedCreditEvent(form: WizardForm): string | null {
  for (const ev of form.creditEvents ?? []) {
    if (!creditEventTimingDone(form, ev)) return ev;
  }
  return null;
}

/** Chat prose for the credit-events question — list-all first, then per-event timing. */
export function chatCreditEventsPrompt(form: WizardForm): string {
  const untimed = nextUntimedCreditEvent(form);
  if ((form.creditEvents?.length ?? 0) > 0 && untimed) {
    return `When did the ${creditEventLabel(untimed).toLowerCase()} happen? Give a month/year (e.g. 06/2022) or roughly how many years ago.`;
  }
  return "Which credit events apply, and when did each happen? List them together with a month/year or how long ago — e.g. “Chapter 7 discharged 3 years ago and a short sale in 06/2022”.";
}

function bucketFromYears(years: number): CreditEventYearBucket {
  if (years < 1) return "<1 year";
  if (years < 2) return "1-2 years";
  if (years < 3) return "2-3 years";
  if (years < 4) return "3-4 years";
  if (years < 7) return "4-7 years";
  return "7+ years";
}

/**
 * Client-side parse of a timing reply ("06/2022", "in 2021", "3 years ago",
 * "18 months") → an MM/YYYY date or a seasoning bucket. Null when nothing matches
 * (the LLM extractor still gets the turn).
 */
export function parseCreditEventTimingReply(
  text: string,
): { date?: string; bucket?: string } | null {
  const mm = text.match(/\b(\d{1,2})\/(\d{4})\b/);
  if (mm) {
    const date = `${mm[1].padStart(2, "0")}/${mm[2]}`;
    if (!validateMmYyyy(date)) return { date };
  }
  const yrs = text.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/i);
  if (yrs) return { bucket: bucketFromYears(parseFloat(yrs[1])) };
  const months = text.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?)\b/i);
  if (months) return { bucket: bucketFromYears(parseFloat(months[1]) / 12) };
  const bareYear = text.match(/\b((?:19|20)\d{2})\b/);
  if (bareYear) {
    return { bucket: bucketFromYears(new Date().getFullYear() - parseInt(bareYear[1], 10)) };
  }
  const bare = text.trim().match(/^(\d{1,2})(?:\.\d+)?$/);
  if (bare) return { bucket: bucketFromYears(parseFloat(bare[0])) };
  return null;
}

/**
 * Store one event's timing EXACTLY like the /form card does
 * (FormChatFlow `pickCreditEventBucket` / `updateCreditEventDate`):
 * - MM/YYYY date → keep the date AND derive its seasoning bucket into
 *   `creditEventYears` (the engine reads the bucket).
 * - bucket → store the bucket and DELETE any stale date for that event.
 */
export function creditEventTimingPatch(
  form: WizardForm,
  code: string,
  value: string,
): Partial<WizardForm> {
  const v = value.trim();
  const isDate = /^\d{1,2}\/\d{4}$/.test(v) && !validateMmYyyy(v);
  if (isDate) {
    const bucket = computeYearsSinceBucket(v);
    const years = { ...(form.creditEventYears ?? {}) };
    if (bucket) years[code] = bucket;
    else delete years[code];
    return {
      creditEventDates: { ...(form.creditEventDates ?? {}), [code]: v },
      creditEventYears: years,
    } as Partial<WizardForm>;
  }
  const dates = { ...(form.creditEventDates ?? {}) };
  delete dates[code];
  return {
    creditEventYears: {
      ...(form.creditEventYears ?? {}),
      [code]: normalizeCreditEventYearBucket(v),
    },
    creditEventDates: dates,
  } as Partial<WizardForm>;
}

/**
 * Fold a turn's extracted credit-event delta into the existing form state:
 * UNION-merge events (the extractor returns one event per turn and would
 * otherwise overwrite the list), preserve per-event timing maps, and attach a
 * bare `years_since_event` to the first event still missing timing.
 */
export function adjustCreditEventPatch(
  current: WizardForm,
  patch: Partial<WizardForm>,
): Partial<WizardForm> {
  const out: Partial<WizardForm> = { ...patch };
  if (Array.isArray(out.creditEvents) && out.hasCreditEvent !== "No") {
    const existing = current.creditEvents ?? [];
    if (existing.length) {
      out.creditEvents = [...new Set([...existing, ...out.creditEvents])];
    }
    out.creditEventYears = {
      ...(current.creditEventYears ?? {}),
      ...(out.creditEventYears ?? {}),
    };
  }
  const yrs = typeof out.yearsSinceCreditEvent === "string" ? out.yearsSinceCreditEvent.trim() : "";
  if (yrs) {
    const merged = { ...current, ...out } as WizardForm;
    const untimed = nextUntimedCreditEvent(merged);
    if (untimed) {
      out.creditEventYears = {
        ...(current.creditEventYears ?? {}),
        ...(out.creditEventYears ?? {}),
        [untimed]: normalizeCreditEventYearBucket(yrs),
      };
      // Mirror /form's pickCreditEventBucket: a bucket replaces any stale date.
      const dates = { ...(current.creditEventDates ?? {}), ...(out.creditEventDates ?? {}) };
      delete dates[untimed];
      out.creditEventDates = dates;
    }
  }
  return out;
}

/** Total in-flow question count for the stock-take line ("N of M"). */
function inFlowQuestionCount(form: WizardForm, mode: "lo" | "underwriter"): number {
  return visibleQuestions(form).filter((q) =>
    includeFormChatQuestionInFlow(q, mode === "underwriter"),
  ).length;
}

/**
 * Stock-take line after the opening bulk extraction (plan §4): how much is
 * captured, how much is left, and where the gaps cluster. Pure count — no LLM.
 */
export function chatStockTakeLine(form: WizardForm, mode: "lo" | "underwriter"): string {
  const missing = missingChatQuestions(form, mode);
  const total = inFlowQuestionCount(form, mode);
  const left = missing.length;
  if (left === 0) return "That covers everything I mandatorily need.";
  const counts = new Map<ChatTheme, number>();
  for (const q of missing) {
    const t = themeOf(q);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([t]) => THEME_LABEL[t]);
  const captured = Math.max(0, total - left);
  return `That covers ${captured} of about 20 details I mandatorily need — about ${left} to go, mostly around ${top.join(" and ")}.`;
}

/** ③ summary card intro — progress in captured *inputs*, not conversational turns. */
export function summaryProgressLine(captured: number, remaining: number): string {
  if (remaining <= 0) return "We've captured everything I mandatorily need.";
  const tail =
    remaining === 1 ? "just one more input to go" : `about ${remaining} more inputs to go`;
  return `Fantastic progress — we've captured ${captured} inputs, ${tail}. You're doing great!`;
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export type ChatFormat =
  | "bulk"
  | "why_question" // ① why lead-in + question
  | "options_question" // ② question + option card / value hint
  | "summary_question" // ③ captured + numbered remaining, free-text reply
  | "combo_question" // ④ two curated fields in one ask
  | "optional_batch" // ⑤ end-of-intake optional card
  | "confirm"
  | "scenario" // closing recap (CHAT_RECAP) + notes / change-anything step
  | "pre_submit"
  | "submit_profile"
  | "final";

/** Ask formats that advance the question cadence (turn counter + anti-repetition). */
export const CHAT_ASK_FORMATS: ReadonlySet<ChatFormat> = new Set([
  "why_question",
  "options_question",
  "summary_question",
  "combo_question",
]);

export interface ReinforcementPrompt {
  field: string;
  text: string;
}

/**
 * Persistent dispatcher state. The hook keeps ONE instance for the whole session
 * and passes it on every call; `advanceChatModeNext` mutates `usedTemplates`,
 * `lastFormats`, and `asksSinceSummary` in place as it decides.
 */
export interface DispatcherState {
  /** Conversational asks already emitted this session (the bulk summary is excluded). */
  turn: number;
  mode: "lo" | "underwriter";
  /** A guessed/ambiguous value awaiting confirmation; gates the next roll. */
  pendingReinforcement?: ReinforcementPrompt | null;
  /** Set once the closing recap (notes / change-anything) step has been offered. */
  scenarioCaptured?: boolean;
  /** Connective template variants already used — wording never repeats (plan §7). */
  usedTemplates?: Set<string>;
  /** Last 2 ask formats, for anti-repetition in the roll. */
  lastFormats?: ChatFormat[];
  /** Asks since the last summary question — ③ is forced every ~SUMMARY_INTERVAL. */
  asksSinceSummary?: number;
  /** Asks since the last encouragement line — keeps "Getting there!" occasional. */
  asksSinceAck?: number;
  /** One-shot: force a summary question (re-ask of 2-strike deferred fields). */
  forceSummary?: boolean;
  /** Set after OPTIONAL_CHAT_INTRO is prepended to the first optional ask. */
  optionalIntroShown?: boolean;
  /** Live form snapshot — lets builders resolve dynamic prompts (promptFn). */
  form?: WizardForm;
}

export interface DispatcherDecision {
  format: ChatFormat;
  /** Fields this ask covers: [] for final, 1 for most, 2 combined, all remaining for summary. */
  fields: FormChatQuestion[];
  /** The "why it matters" lead-in, when the chosen format includes one. */
  why?: string;
  /** The curated COMBO_PAIRS transition line (combo asks; fed to the framing agent). */
  lead?: string;
  /** Fully assembled assistant message text. */
  text: string;
  /** Anchor for context-aware short replies (null when there's nothing to answer). */
  pendingChatField: string | null;
}

export const CHAT_SCENARIO_NOTES_PROMPT =
  "If you'd like to change any inputs, or if there's anything else we should know about this borrower or property — type it in the message box below, or send Skip to continue.";

/** /form guided intake — no "change inputs" line (sidebar handles edits). */
export const FORM_SCENARIO_NOTES_PROMPT =
  "If there's anything else we should know about this borrower or property — type it in the message box below, or send Skip to continue.";

/** Streams in chat before the eligibility scan (mirrors /form FormChatFlow). */
export const PRE_SUBMIT_ASSISTANT_TEXT =
  "I have everything I need. Click Submit below — or just say “submit” — and I'll find your matching programs.";

/** Brief beat after the pre-submit line finishes before the eligibility scan starts. */
export const PRE_SUBMIT_TO_SCAN_DELAY_MS = 300;

const FINAL_TEXT =
  "That's everything I need — want me to run the numbers and pull up the matching programs?";
const OPTIONAL_BATCH_TEXT =
  "Almost done. A few optional details that can refine the shortlist — type any that apply, or skip them.";

/** Prepended once before the first optional-priority ask in /chat. */
export const OPTIONAL_CHAT_INTRO =
  "Now moving on to optional details — these help refine the shortlist but aren't required.";

// ── Wording variant pools (plan §7 — hard-coded framing, never repeats) ──────

const WHY_OPENERS = [
  "",
  "Next up.",
  "Let's keep going.",
  "Onward —",
  "Almost through this part.",
  "Here's one that matters more than it looks.",
] as const;

const OPTIONS_OPENERS = [
  "Quick one —",
  "This one's a short pick.",
  "A short answer works here.",
  "Next:",
  "Easy one next.",
  "Almost there —",
  "One more for the list:",
  "Let's knock this one out.",
  "While we're at it —",
  "Just a couple left.",
] as const;

const COMBO_OPENERS = [
  "Next, let's get these two sorted together.",
  "Two related ones — knock them out in one go.",
  "These pair naturally, so let's take them together.",
  "Let's tackle these two at once.",
] as const;

const SUMMARY_INTROS = [
  "Quick stock-take before we keep going.",
  "Let's take stock for a second.",
  "Here's where we stand.",
  "Checking in on progress so far.",
] as const;

const RECAP_INTROS = [
  "Looks like I have everything.",
  "That's the full picture from my side.",
  "We've covered everything I track.",
] as const;

// Occasional encouragement lines, tiered by how deep into the intake we are.
// Fired at most every 3rd ask (rng-gated), never the same line twice in a session.
const ACK_EARLY = ["This is a good start.", "Great — that helps.", "Nice, we're moving."] as const;
const ACK_MID = ["Getting there!", "Good progress.", "We're making solid headway."] as const;
const ACK_LATE = ["Almost there!", "Home stretch now.", "Just a little more to go."] as const;

/** ③ summary card invite line (rendered under the numbered remaining list). */
export const SUMMARY_ASK_INVITE =
  "Answer any of these in one message — plain sentences are fine, I'll sort them into the right fields. Or send Skip to keep going one at a time.";

/** Closing recap ask — rendered as numbered item 1 above captured sections (plan §9). */
export const RECAP_INVITE =
  "Add any scenario notes, or change a value — e.g. “change LTV to 75” or “make it a condo”. Send Skip when you're ready to continue.";

/** Pick an unused variant from a pool; once a pool is exhausted, variants recycle. */
function pickVariant(
  key: string,
  pool: readonly string[],
  state: DispatcherState,
  rng: () => number,
): string {
  const used = (state.usedTemplates ??= new Set<string>());
  const unused = pool.map((_, i) => i).filter((i) => !used.has(`${key}.${i}`));
  const idxPool = unused.length > 0 ? unused : pool.map((_, i) => i);
  const idx = idxPool[Math.min(idxPool.length - 1, Math.floor(rng() * idxPool.length))] ?? 0;
  used.add(`${key}.${idx}`);
  return pool[idx];
}

/** Occasional encouragement line — every 3rd+ ask, ~45% of the time, never repeated. */
function maybeAck(state: DispatcherState, rng: () => number): string {
  if (state.turn < 2) return "";
  if ((state.asksSinceAck ?? 0) < 3) return "";
  if (rng() > 0.45) return "";
  const tier = state.turn >= 8 ? "late" : state.turn >= 4 ? "mid" : "early";
  const pool = tier === "late" ? ACK_LATE : tier === "mid" ? ACK_MID : ACK_EARLY;
  return pickVariant(`ack.${tier}`, pool, state, rng);
}

/** Record an ask in the cadence state (anti-repetition window + counters + ack line). */
function record(
  state: DispatcherState,
  decision: DispatcherDecision,
  rng: () => number,
): DispatcherDecision {
  if (CHAT_ASK_FORMATS.has(decision.format)) {
    state.lastFormats = [...(state.lastFormats ?? []).slice(-1), decision.format];
    state.asksSinceSummary =
      decision.format === "summary_question" ? 0 : (state.asksSinceSummary ?? 0) + 1;
    state.asksSinceAck = (state.asksSinceAck ?? 0) + 1;
    // Options cards drop the prose text, so an ack there would be lost — prose asks only.
    if (decision.format !== "options_question") {
      const ack = maybeAck(state, rng);
      if (ack) {
        decision.text = `${ack} ${decision.text}`;
        state.asksSinceAck = 0;
      }
    }
  }
  return decision;
}

/** Force ③ once this many asks pass without a stock-take (while ≥3 questions remain). */
const SUMMARY_INTERVAL = 5;

/**
 * Decide the next ask's presentation format (plan §8 cadence).
 *
 * @param missing  Triggered, unanswered, mode-filtered questions in SLOT order.
 * @param state    Persistent cadence state — mutated in place (see DispatcherState).
 * @param rng      Injectable RNG (defaults to Math.random) for deterministic tests.
 */
export function advanceChatModeNext(
  missing: FormChatQuestion[],
  state: DispatcherState,
  rng: () => number = Math.random,
): DispatcherDecision {
  // 1. Reinforcement gate — confirm a guessed/ambiguous value before anything else.
  if (state.pendingReinforcement) {
    const r = state.pendingReinforcement;
    return { format: "confirm", fields: [], text: r.text, pendingChatField: r.field };
  }

  // 2. End of intake — closing recap (notes + change-anything), then offer submit.
  if (missing.length === 0) {
    if (!state.scenarioCaptured) {
      return {
        format: "scenario",
        fields: [],
        text: pickVariant("recap", RECAP_INTROS, state, rng),
        // Anchor short replies so "nothing else" routes to the notes handler.
        pendingChatField: "scenarioNotes",
      };
    }
    return {
      format: "submit_profile",
      fields: [],
      text: PRE_SUBMIT_ASSISTANT_TEXT,
      pendingChatField: null,
    };
  }

  // 3. End-of-intake optional batch — ⑤ for non-product optionals (UW). Product
  //    preferences are asked ONE BY ONE as conversational cards (user feedback:
  //    never stack the big pref cards, and never mix optionals into a single card).
  if (missing.every(isOptional)) {
    const batchable = missing.filter((q) => !isFormChatProductPrefQuestion(q));
    if (batchable.length > 0) {
      return {
        format: "optional_batch",
        fields: batchable.slice(0, 5),
        text: OPTIONAL_BATCH_TEXT,
        pendingChatField: null,
      };
    }
  }

  // 4. One-shot deferred re-ask — 2-strike skipped fields come back as one ③ card.
  if (state.forceSummary) {
    state.forceSummary = false;
    const mand = mandatoryOnly(missing);
    if (mand.length > 0) return record(state, buildSummary(mand, state, rng), rng);
  }

  const next = missing[0];

  // 5. Complex override — compound fields can't be prose; force the card/hint shape.
  if (isComplexQuestion(next)) return record(state, buildOptions(next, state, rng), rng);

  const last = state.lastFormats?.[state.lastFormats.length - 1];

  // 6. Q1–Q3 — always ① or ②, alternating so the shape varies (plan §8).
  if (state.turn < 3) {
    const canWhy = !!promptFor(next).why;
    const canOptions = next.kind === "yesno" || !!next.options?.length || !!next.optionsFn;
    const decision =
      canWhy && (last !== "why_question" || !canOptions)
        ? buildWhy(next, state, rng)
        : buildOptions(next, state, rng);
    return record(state, decision, rng);
  }

  // 7. Q4 — always ④ (when a curated pair matches) or ③ (plan §8). The ③ card
  //    lists MANDATORY fields only — optionals/prefs never mix into it.
  if (state.turn === 3) {
    const combo = comboFor(missing);
    if (combo) return record(state, buildCombo(combo.fields, combo.lead, state, rng), rng);
    const mand = mandatoryOnly(missing);
    if (mand.length > 0) return record(state, buildSummary(mand, state, rng), rng);
  }

  // 7b. Q5 — when Q4 went to a combo, the first stock-take lands HERE (Q4 double →
  //     Q5 summary), so every session gets an early ③ instead of waiting for the
  //     periodic interval that short sessions never reach.
  if (state.turn === 4 && last === "combo_question") {
    const mand = mandatoryOnly(missing);
    if (mand.length >= 2) return record(state, buildSummary(mand, state, rng), rng);
  }

  // 8. Periodic stock-take — force ③ every ~5 asks while enough MANDATORY remains.
  if ((state.asksSinceSummary ?? 0) >= SUMMARY_INTERVAL && mandatoryOnly(missing).length >= 3) {
    return record(state, buildSummary(mandatoryOnly(missing), state, rng), rng);
  }

  // 9. Constrained roll over ① ② ④ with anti-repetition (never 3× the same shape).
  return record(state, rollFormats(next, missing, state, rng), rng);
}

function rollFormats(
  next: FormChatQuestion,
  missing: FormChatQuestion[],
  state: DispatcherState,
  rng: () => number,
): DispatcherDecision {
  const combo = comboFor(missing);
  let valid: ReadonlyArray<readonly [ChatFormat, number]> = [
    ["why_question", 0.4],
    ["options_question", 0.35],
    ...(combo ? ([["combo_question", 0.25]] as const) : []),
  ];

  // Anti-repetition — a format never fires three times in a row.
  const [a, b] = [state.lastFormats?.[0], state.lastFormats?.[1]];
  if (a && a === b && valid.length > 1) {
    valid = valid.filter(([fmt]) => fmt !== a);
  }

  switch (weightedPick(valid, rng)) {
    case "combo_question":
      return combo ? buildCombo(combo.fields, combo.lead, state, rng) : buildWhy(next, state, rng);
    case "options_question":
      return buildOptions(next, state, rng);
    default:
      return buildWhy(next, state, rng);
  }
}

function weightedPick(
  items: ReadonlyArray<readonly [ChatFormat, number]>,
  rng: () => number,
): ChatFormat {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [fmt, w] of items) {
    r -= w;
    if (r <= 0) return fmt;
  }
  return items[items.length - 1][0];
}

// ── Message builders ─────────────────────────────────────────────────────────

/** ① why lead-in + question. */
function buildWhy(
  q: FormChatQuestion,
  state: DispatcherState,
  rng: () => number,
): DispatcherDecision {
  const p = promptFor(q, state.form);
  const opener = pickVariant("why", WHY_OPENERS, state, rng);
  const head = [opener, p.why].filter(Boolean).join(" ");
  return {
    format: "why_question",
    fields: [q],
    why: p.why,
    // Put the actual question on its own line with a "Q." lead so it stands out.
    text: head ? `${head}\n\nQ. ${p.question}` : `Q. ${p.question}`,
    pendingChatField: q.id,
  };
}

/** ② question + options (enum renders a CHAT_OPTIONS card in the hook) or value hint. */
function buildOptions(
  q: FormChatQuestion,
  state: DispatcherState,
  rng: () => number,
): DispatcherDecision {
  const p = promptFor(q, state.form);
  // The DTI capacity notice is a heads-up that leads into extra details — not a casual
  // yes/no. Render it as a plain notice: no breezy opener, no "(Yes / No)" suffix.
  if (q.special === "capacity_dti_notice" || q.special === "capacity_dti_bundle") {
    return {
      format: "options_question",
      fields: [q],
      text: p.question,
      pendingChatField: q.id,
    };
  }
  const opener = pickVariant("options", OPTIONS_OPENERS, state, rng);
  const hint = q.hint?.trim()
    ? ` (${q.hint.trim()})`
    : q.placeholder?.trim()
      ? ` (${q.placeholder.trim()})`
      : q.kind === "yesno"
        ? " (Yes / No)"
        : "";
  return {
    format: "options_question",
    fields: [q],
    // The Q. always starts its own line after the opener/context (matches buildWhy).
    text: `${opener}\n\nQ. ${p.question}${hint}`,
    pendingChatField: q.id,
  };
}

/** ④ two curated fields in one ask. */
function buildCombo(
  fields: [FormChatQuestion, FormChatQuestion],
  lead: string,
  state: DispatcherState,
  rng: () => number,
): DispatcherDecision {
  const opener = pickVariant("combo", COMBO_OPENERS, state, rng);
  const asks = fields.map((q, i) => `${i + 1}. ${promptFor(q, state.form).question}`).join("\n");
  return {
    format: "combo_question",
    fields: [...fields],
    lead,
    text: `${opener} ${lead}\n\n${asks}`,
    // Anchor short replies to the first field of the pair.
    pendingChatField: fields[0].id,
  };
}

/** ③ summary question — the hook renders a CHAT_SUMMARY_ASK card from `fields`. */
function buildSummary(
  missing: FormChatQuestion[],
  state: DispatcherState,
  rng: () => number,
): DispatcherDecision {
  return {
    format: "summary_question",
    fields: missing,
    text: pickVariant("summary", SUMMARY_INTROS, state, rng),
    pendingChatField: "summary_ask",
  };
}

// ── Captured-field display (brain-dump + per-answer pills) ───────────────────

export type ChatCapturedRow = { label: string; value: string };

/** Sidebar-aligned labels for per-answer capture chips and X: A → B change rows. */
const CHAT_FIELD_CAPTURE_LABELS: Record<string, string> = {
  listingSeasoning: "Listed Recently",
  isRuralProperty: "Rural Property",
  powerOfAttorney: "Power of Attorney",
  nonArmsLength: "Non-Arm's Length",
  hasCreditEvent: "Credit Events",
  vacantProperty: "Vacant Property",
  recentlyRehabbed: "Recently Rehabbed",
  decliningMarket: "Declining Market",
  firstTimeHomebuyer: "First-Time Buyer",
  firstTimeInvestor: "First-Time Investor",
  citizenship: "Citizenship",
  occupancy: "Occupancy",
  loanPurpose: "Loan Purpose",
  lienPosition: "Lien Position",
  propertyType: "Property Type",
  valueSalesPrice: "Property Value",
  loanAmount: "Loan Amount",
  ltv: "LTV",
  cltv: "CLTV",
  cashInHandRequest: "Cash-Out Request",
  existingFirstLien: "First Lien Balance",
  helocDrawYears: "Draw Period",
  helocInitialDraw: "Initial Draw",
  decisionCreditScore: "Credit Score",
  documentationType: "Doc Type",
  documentationTimeframe: "Doc Timeframe",
  estimatedDti: "DTI",
  dscr: "DSCR",
  rentalType: "Rental Type",
  prepaymentTerms: "Prepayment",
  reservesAvailable: "Reserves (months)",
  assetsLiquidFunds: "Liquid Assets",
  paymentHistory: "Payment History",
  state: "State",
  stateCounty: "County",
  acreage: "Acreage",
  loanTerm: "Loan Term",
  rateTypePref: "Rate Type",
  interestOnlyPref: "Interest-Only",
};

export function chatFieldCaptureLabel(fieldId: string): string | null {
  if (CHAT_FIELD_CAPTURE_LABELS[fieldId]) return CHAT_FIELD_CAPTURE_LABELS[fieldId];
  const q = FORM_CHAT_QUESTIONS.find((qq) => qq.id === fieldId);
  // Skip fields without a clean short label — compound/special questions or long prompts.
  // The API `captured` rows already carry the proper sidebar labels for those sub-fields.
  if (!q || q.special || !q.prompt.trim() || q.prompt.trim().length > 40) return null;
  return q.prompt.replace(/\?$/, "").trim();
}

/**
 * Fields whose form values are internal codes, not display strings — pills must
 * show the SAME labels the Mortgage Profile sidebar uses (loanWizardProfileSections).
 */
const CHAT_FIELD_VALUE_LABELS: Record<string, Record<string, string>> = {
  lienPosition: {
    [LIEN_POSITION_FIRST]: "First Lien",
    [LIEN_POSITION_SECOND]: "Second Lien (Standalone)",
    [LIEN_POSITION_PIGGYBACK]: "Second Lien (Piggyback)",
  },
  secondLienProduct: { heloc: "HELOC", heloan: "HELOAN" },
};

function chatFieldCaptureValue(fieldId: string, value: string): string {
  const coded = CHAT_FIELD_VALUE_LABELS[fieldId]?.[value.trim().toLowerCase()];
  if (coded) return coded;
  const q = FORM_CHAT_QUESTIONS.find((qq) => qq.id === fieldId);
  if (q?.kind === "yesno") {
    const lc = value.toLowerCase();
    if (lc === "yes") return "Yes";
    if (lc === "no") return "No";
  }
  return value;
}

/** Build capture rows from the optimistic short-reply parse (yes/no, letters, etc.). */
export function capturedRowsFromQuickParse(quick: Record<string, string>): ChatCapturedRow[] {
  return Object.entries(quick)
    .map(([fieldId, value]) => {
      const label = chatFieldCaptureLabel(fieldId);
      return label ? { label, value: chatFieldCaptureValue(fieldId, value) } : null;
    })
    .filter((r): r is ChatCapturedRow => r !== null);
}

// ── Changed-value rows ("X: A → B") ──────────────────────────────────────────

export type ChatChangedRow = { label: string; from: string; to: string };

// Derived/companion fields that churn alongside a real edit — never shown as changes.
// lienPosition/secondLienProduct store internal codes, not display strings; their
// changes surface through the API captured rows instead.
const CHANGE_HIDDEN_FIELDS = new Set([
  "primaryLoanPurpose",
  "isSecondLien",
  "firstLienPurpose",
  "piggybackPurpose",
  "investmentIncomePath",
  "creditEventCategory",
  "creditEventType",
  "yearsSinceCreditEvent",
  "lienPosition",
  "secondLienProduct",
]);

/**
 * Rows for values this turn OVERWROTE (an existing non-empty form value changed) —
 * rendered as "Label: old → new" pills next to the captured chips, so corrections
 * like "change LTV to 75" are visibly different from first-time captures.
 */
export function changedRowsFromPatch(
  before: WizardForm,
  patch: Partial<WizardForm>,
): ChatChangedRow[] {
  const rows: ChatChangedRow[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v !== "string" || CHANGE_HIDDEN_FIELDS.has(k)) continue;
    const prev = String((before as unknown as Record<string, unknown>)[k] ?? "").trim();
    const next = v.trim();
    if (!prev || !next || prev === next) continue;
    // "No preference" is the pref default, not a prior answer — the first real
    // answer is a plain capture, never a "Changed:" pill.
    if (isNoProductPreference(prev)) continue;
    const label = chatFieldCaptureLabel(k);
    if (!label) continue;
    rows.push({ label, from: chatFieldCaptureValue(k, prev), to: chatFieldCaptureValue(k, next) });
  }
  return rows;
}

/** Drop captured rows that are already shown as a change ("X: A → B" wins). */
export function dropRowsShownAsChanges(
  captured: ChatCapturedRow[],
  changes: ChatChangedRow[],
): ChatCapturedRow[] {
  if (changes.length === 0) return captured;
  const changed = new Set(changes.map((c) => c.label.toLowerCase()));
  return captured.filter((r) => !changed.has(r.label.toLowerCase()));
}

/** String fields from a client quick-parse patch (for capture pill merge). */
export function quickParseCaptureFields(quick: Partial<WizardForm>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(quick)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

/** Merge API capture rows with any fields resolved only by the client short-reply parse. */
/** Bounded Levenshtein — returns the distance if ≤ max, else null (early exit). */
function editDistance(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return null;
    prev = cur;
  }
  return prev[b.length] <= max ? prev[b.length] : null;
}

export function mergeCapturedRows(
  fromApi: ChatCapturedRow[],
  quick: Record<string, string>,
): ChatCapturedRow[] {
  // Dedupe on a NORMALIZED label ("Interest-Only" ≡ "Interest Only") so a backend
  // pill and a quick-parse pill for the same field never render side by side.
  const normLabel = (l: string) => l.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const quickRows = capturedRowsFromQuickParse(quick);
  if (fromApi.length === 0) return quickRows;
  const seen = new Set(fromApi.map((r) => normLabel(r.label)));
  return [...fromApi, ...quickRows.filter((r) => !seen.has(normLabel(r.label)))];
}

// ── Context-aware short replies ──────────────────────────────────────────────

/**
 * Lenient parse of a short reply when a single field is pending. Merged BEFORE the
 * LLM delta so "yes" / "3" / "B" resolve without a round-trip. Returns a partial
 * portfolio-style patch keyed by the pending field id, or {} when nothing matched.
 * Falls through to the LLM extractor for anything it can't confidently resolve.
 */
export function contextAwareParse(
  text: string,
  pendingChatField: string | null,
  form: WizardForm,
): Record<string, string> {
  if (!pendingChatField) return {};
  const q = FORM_CHAT_QUESTIONS.find((qq) => qq.id === pendingChatField);
  if (!q) return {};
  const lc = text.toLowerCase().trim();

  if (q.kind === "yesno") {
    if (/^(?:yes|yeah|yep|sure|ok|okay|y|true|correct|yup)\b/.test(lc)) return { [q.id]: "Yes" };
    if (/^(?:no|nope|nah|n|false|negative)\b/.test(lc)) return { [q.id]: "No" };
    return {};
  }

  if (q.special === "county_search") {
    const t = text.trim();
    return t
      ? {
          stateCounty: t,
          ...clearGeoFollowupFieldsPatch(),
          ...inferGeoFollowupsFromCounty(form.state, t),
        }
      : {};
  }

  if (q.kind === "number" || q.kind === "currency") {
    const m = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    return m ? { [q.id]: m[0] } : {};
  }

  if (q.kind === "enum") {
    if (q.id === "documentationTimeframe") {
      const parsed = parseDocumentationTimeframeReply(text);
      if (parsed) return { [q.id]: parsed };
    }

    // Product prefs resolve their options from the dedicated pref lists, so a typed
    // "30 years" / "fixed" answers the card without an LLM round-trip.
    const options = isFormChatProductPrefQuestion(q)
      ? formChatProductPrefOptions(q)
      : optionsFor(form, q);
    if (options.length === 0) return {};

    if (q.id === "loanTerm") {
      const parsed = parseLoanTermChatReply(text, options);
      if (parsed) return { loanTerm: parsed };
    }

    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/\bof\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const nlc = norm(text);

    // Bare option letter ("a", "b)", "c.") → option by index. Must stand alone so free text
    // like "I want cash out" isn't mis-mapped to an option by its first letter.
    const letter = lc.match(/^([a-z])(?:[.)]|\s*$)/);
    if (letter) {
      const opt = options[letter[1].charCodeAt(0) - 97];
      if (opt) return { [q.id]: opt.value };
    }

    // Exact (normalized) match on label or value.
    const exact = options.find((o) => norm(o.label) === nlc || norm(o.value) === nlc);
    if (exact) return { [q.id]: exact.value };

    // Slight typos ("no preferenace", "adjustble") — closest label/value within
    // edit distance 2, only for answers long enough that 2 edits can't flip meaning.
    if (nlc.length >= 5) {
      let best: { value: string; d: number } | null = null;
      for (const o of options) {
        for (const cand of [norm(o.label), norm(o.value)]) {
          if (cand.length < 5) continue;
          const d = editDistance(nlc, cand, 2);
          if (d !== null && (!best || d < best.d)) best = { value: o.value, d };
        }
      }
      if (best) return { [q.id]: best.value };
    }

    // Lenient: an option's label sits within the answer (or vice-versa). Prefer the longest
    // match so "cash out" resolves to Cash-Out Refinance rather than a shorter option.
    if (nlc.length >= 3) {
      const near = options
        .filter((o) => {
          const nl = norm(o.label);
          return nl.length >= 3 && (nlc.includes(nl) || nl.includes(nlc));
        })
        .sort((a, b) => norm(b.label).length - norm(a.label).length)[0];
      if (near) return { [q.id]: near.value };
    }
  }

  return {};
}
