/**
 * Deterministic question spec for the /form "chat-card" reskin.
 *
 * This walks the SAME field set + reveal order as the 5-step wizard in
 * LoanWizard.tsx, one (or two) questions at a time, with NO LLM. Derived metrics
 * (LTV, CLTV, down payment, cash-out %) are NEVER asked — they're computed and
 * shown only in the sidebar. Currency, number, and state use inline controls; other
 * fields use lettered A/B/C cards.
 *
 * Ordering mirrors CLAUDE.md's Step 1–5 description and buildProfileSections().
 * The few option arrays that live locally in LoanWizard.tsx are duplicated here
 * with a sync note — keep them aligned if the wizard's options change.
 */
import type { WizardForm } from "@/components/LoanWizard";
import { validateMmYyyy } from "@/lib/creditEventTiming";
import {
  BANK_STMT_BUSINESS_LABEL,
  BANK_STMT_COMBINED_LABEL,
  PL_2MO_BS_LABEL,
  PL_ONLY_LABEL,
  CITIZENSHIP_OPTIONS,
  DOC_TYPE_OPTIONS,
  EXISTING_SECOND_LIEN_OPTIONS,
  INVESTMENT_INCOME_TYPE_OPTIONS,
  LIEN_POSITION_FIRST,
  LIEN_POSITION_PIGGYBACK,
  LIEN_POSITION_SECOND,
  PAYMENT_HISTORY_OPTIONS,
  INTEGRATED_PROPERTY_TYPES,
  computeLtvPercent,
  isDscrPathScenario,
  shouldShowEstablishedPrimaryRes,
  shouldShowPaymentHistory,
  listingSeasoningRequired,
  shouldAskFirstTimeHomebuyer,
  shouldHardcodeFirstTimeHomebuyerNo,
  shouldAskFirstTimeInvestor,
  shouldHardcodeFirstTimeInvestorNo,
  patchFirstTimeHomebuyerForScenario,
  patchFirstTimeInvestorForScenario,
  SCENARIO_FIRST_TIME_TRIGGER_FIELDS,
  SCENARIO_FTHB_TRIGGER_FIELDS,
  LOAN_TERM_SELECT_OPTIONS,
  effectivePrimaryLoanPurpose,
  formatLoanTermDisplay,
  formatLoanTermStorage,
  formatMoneyForInput,
} from "@/lib/nqmIntegratedForm";
import { STATES } from "@/lib/wizardFormUi";
import {
  getGeoFieldsForCounty,
  geoSubFieldKeys,
  clearGeoFollowupFieldsPatch,
  inferGeoFollowupsFromCounty,
  countyNeedsGeoFollowUp,
  type GeoFieldConfig,
} from "@/lib/stateGeoFollowUp";

// ── Option arrays mirrored from LoanWizard.tsx (keep in sync) ──────────────────
const OCCUPANCY_OPTS = [
  { value: "Primary Residence", label: "Primary Residence" },
  { value: "Second Home", label: "Second Home" },
  { value: "Investment Property", label: "Investment Property" },
] as const;

/** /form chat cards — sub-text under each loan-purpose option (wizard select unchanged). */
const LOAN_PURPOSE_CHAT_OPTS: FormChatOption[] = [
  { value: "Purchase", label: "Purchase", description: "Buying a home" },
  { value: "Refinance", label: "Rate & Term Refinance", description: "Lower rate, same balance" },
  { value: "Cash-Out Refinance", label: "Cash-Out Refinance", description: "Pull equity out" },
];

const SECOND_LIEN_PRODUCT_OPTS = [
  { value: "heloc", label: "HELOC", description: "Revolving line of credit" },
  { value: "heloan", label: "HELOAN / Closed-End Second", description: "Fixed lump sum" },
] as const;

const PREPAY_OPTS = ["5 Year", "4 Year", "3 Year", "2 Year", "1 Year", "No Penalty"].map((v) => ({
  value: v,
  label: v,
}));

const RENTAL_TYPE_OPTS = [
  { value: "Long-term rental", label: "Long-term rental" },
  { value: "Short-term rental", label: "Short-term rental" },
] as const;

const VISA_CATEGORY_OPTS = [
  { value: "employment", label: "Employment Visa" },
  { value: "treaty_investor", label: "Investor / Treaty Visa" },
  { value: "intracompany", label: "Intracompany Transfer" },
  { value: "extraordinary", label: "Extraordinary Ability / Professional" },
  { value: "religious_diplomatic", label: "Religious / Diplomatic / Special" },
  { value: "other", label: "Other / Not Listed" },
] as const;

const VISA_SUBTYPE_OPTS: Record<string, { value: string; label: string; description?: string }[]> =
  {
    employment: [
      { value: "H-1B", label: "H-1B", description: "Skilled worker" },
      { value: "H-4 EAD", label: "H-4 EAD", description: "H-1B spouse" },
      { value: "H-2A", label: "H-2A", description: "Farm worker" },
      { value: "H-2B", label: "H-2B", description: "Temp worker" },
      { value: "H-3", label: "H-3", description: "Trainee visa" },
    ],
    treaty_investor: [
      { value: "E-1", label: "E-1", description: "Treaty trader" },
      { value: "E-2", label: "E-2", description: "Treaty investor" },
      { value: "E-3", label: "E-3", description: "Australian professional" },
      { value: "EB-5", label: "EB-5", description: "Investor immigrant" },
    ],
    intracompany: [
      { value: "L-1A", label: "L-1A", description: "Executive transfer" },
      { value: "L-1B", label: "L-1B", description: "Specialized transfer" },
    ],
    extraordinary: [
      { value: "O-1", label: "O-1", description: "Extraordinary ability" },
      { value: "TN", label: "TN", description: "USMCA professional" },
    ],
    religious_diplomatic: [
      { value: "I", label: "I", description: "Media representative" },
      { value: "G-1", label: "G-1", description: "Intl organization" },
      { value: "G-2", label: "G-2", description: "Intl employee" },
      { value: "G-3", label: "G-3", description: "Foreign representative" },
      { value: "G-4", label: "G-4", description: "Intl officer" },
      { value: "G-5", label: "G-5", description: "Personal employee" },
      { value: "NATO", label: "NATO", description: "NATO personnel" },
      { value: "R-1", label: "R-1", description: "Religious worker" },
    ],
  };

export const CREDIT_EVENT_OPTS = [
  { value: "BK-Ch7-Discharged", label: "Bankruptcy — Chapter 7 Discharged" },
  { value: "BK-Ch7-Dismissed", label: "Bankruptcy — Chapter 7 Dismissed" },
  { value: "BK-Ch13-Discharged", label: "Bankruptcy — Chapter 13 Discharged" },
  { value: "BK-Ch13-Dismissed", label: "Bankruptcy — Chapter 13 Dismissed" },
  { value: "FC", label: "Foreclosure" },
  { value: "SS", label: "Short Sale" },
  { value: "DIL", label: "Deed-in-Lieu" },
  { value: "Pre-FC", label: "Pre-Foreclosure" },
  { value: "Charge-Off", label: "Mortgage Charge-Off" },
  { value: "NOD", label: "Notice of Default" },
  { value: "Mod", label: "Loan Modification" },
  { value: "Forbearance", label: "Forbearance" },
  { value: "Deferral", label: "Deferral" },
] as const;

/**
 * Generic bankruptcy code used while the chapter/status is still unknown (e.g. the
 * user just said "had a BK"). It blocks credit-events completion until resolved to
 * one of the four specific BK-* codes — never silently default to Ch. 7 Discharged.
 */
export const CREDIT_EVENT_BK_GENERIC = "BK";

/** Sentinel for the "no credit events" choice on the combined chat select card. */
export const CREDIT_EVENT_NONE = "NONE";

/** Chat select card options — BK grouped as ONE entry; the chapter is asked next. */
export const CREDIT_EVENT_SELECT_OPTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: CREDIT_EVENT_BK_GENERIC, label: "Bankruptcy" },
  ...CREDIT_EVENT_OPTS.filter((o) => !o.value.startsWith("BK-")),
];

/** BK chapter/status follow-up options (single-select). */
export const BK_TYPE_OPTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "BK-Ch7-Discharged", label: "Chapter 7 — Discharged" },
  { value: "BK-Ch7-Dismissed", label: "Chapter 7 — Dismissed" },
  { value: "BK-Ch13-Discharged", label: "Chapter 13 — Discharged" },
  { value: "BK-Ch13-Dismissed", label: "Chapter 13 — Dismissed" },
];

/** Resolve free text like "ch 7 discharged" to a specific BK code (or null). */
export function bkCodeFromFreeText(text: string): string | null {
  const t = (text || "").toLowerCase();
  const ch = /ch(?:apter)?\.?\s*0?7\b/.test(t)
    ? "7"
    : /ch(?:apter)?\.?\s*13\b/.test(t)
      ? "13"
      : null;
  const status = /dismiss/.test(t) ? "Dismissed" : /discharg/.test(t) ? "Discharged" : null;
  if (!ch || !status) return null;
  return `BK-Ch${ch}-${status}`;
}

export function creditEventLabel(code: string): string {
  if (code === CREDIT_EVENT_BK_GENERIC) return "Bankruptcy";
  return CREDIT_EVENT_OPTS.find((o) => o.value === code)?.label ?? code;
}

/** Short labels for the mortgage profile sidebar (keeps Ch. 7/13 rows compact). */
export function creditEventSidebarLabel(code: string): string {
  switch (code) {
    case "BK-Ch7-Discharged":
      return "Ch7 - Disch.";
    case "BK-Ch7-Dismissed":
      return "Ch7 - Dism.";
    case "BK-Ch13-Discharged":
      return "Ch13 - Disch.";
    case "BK-Ch13-Dismissed":
      return "Ch13 - Dism.";
    case CREDIT_EVENT_BK_GENERIC:
      return "BK (chapter?)";
    default:
      return creditEventLabel(code);
  }
}

export const DECISION_CREDIT_SCORE_MIN = 300;
export const DECISION_CREDIT_SCORE_MAX = 800;
export const DECISION_CREDIT_SCORE_CAUTION = "Caution: Should be between 300 and 800";
/** Wait after last keystroke before showing the inline FICO caution. */
export const DECISION_CREDIT_SCORE_CAUTION_DELAY_MS = 1500;

export function isDecisionCreditScoreInRange(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return false;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n >= DECISION_CREDIT_SCORE_MIN && n <= DECISION_CREDIT_SCORE_MAX;
}

export function showDecisionCreditScoreCaution(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return !isDecisionCreditScoreInRange(t);
}

/** Match typed text to a US state option (code, full name, or label). */
export function matchStateOption(
  opts: ReadonlyArray<FormChatOption>,
  raw: string,
): FormChatOption | null {
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;
  const plainName = (label: string) =>
    label
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim()
      .toLowerCase();
  let match = opts.find(
    (o) =>
      o.value.toLowerCase() === needle ||
      o.label.toLowerCase() === needle ||
      plainName(o.label) === needle,
  );
  if (!match && needle.length >= 2) {
    const prefixHits = opts.filter((o) => plainName(o.label).startsWith(needle));
    if (prefixHits.length === 1) match = prefixHits[0];
  }
  return match ?? null;
}

const HI_LAVA_ZONE_OPTS = ["Zone 1", "Zone 2", "Zone 3-9 (lower risk)"].map((v) => ({
  value: v,
  label: v,
}));

// ── Public types ───────────────────────────────────────────────────────────
export type FormChatKind = "enum" | "yesno" | "currency" | "number" | "state";

export interface FormChatOption {
  value: string;
  label: string;
  description?: string;
}

export interface FormChatQuestion {
  /** Form field key this question fills (also used as the chat message id). */
  id: string;
  section: 1 | 2 | 3 | 4 | 5;
  sectionName: string;
  prompt: string;
  /** Dynamic prompt (e.g. doc-type follow-up). Takes precedence over `prompt`. */
  promptFn?: (form: WizardForm) => string;
  /** Second line under the main prompt (shown above answer controls). */
  promptSubline?: string;
  hint?: string;
  kind: FormChatKind;
  priority: "mandatory" | "optional";
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  options?: ReadonlyArray<FormChatOption>;
  optionsFn?: (form: WizardForm) => ReadonlyArray<FormChatOption>;
  showIf?: (form: WizardForm) => boolean;
  /**
   * Safe assumed value for the /chat 2-strike guard: when a question fails to
   * extract twice, this value is applied (marked editable from the sidebar)
   * instead of looping. Only set where the default is the overwhelmingly common
   * case and the LO can correct it later; never on compliance gates (OFAC) or
   * fields that gate big branches (credit events).
   */
  safeDefault?: string;
  /** Multi-part questions the driver expands (per-event dates, loan-details triangle, geo follow-ups). */
  special?:
    | "geo"
    | "credit_events"
    | "triangle"
    | "geo_followup"
    | "county_search"
    | "capacity_dti_notice"
    | "product_pref";
}

/** Product-preference slots — need explicit Confirm (form defaults are "No preference"). */
export const FORM_CHAT_PRODUCT_PREF_IDS = ["loanTerm", "rateTypePref", "interestOnlyPref"] as const;

export function isFormChatProductPrefQuestion(q: FormChatQuestion): boolean {
  return (FORM_CHAT_PRODUCT_PREF_IDS as readonly string[]).includes(q.id);
}

export const FORM_CHAT_LOAN_TERM_NO_PREF = "No preference";

const FORM_CHAT_RATE_TYPE_PREF_OPTIONS: FormChatOption[] = [
  { value: "No Preference", label: "No Preference" },
  {
    value: "Fixed",
    label: "Fixed-rate",
    description: "Same rate for the life of the loan",
  },
  {
    value: "Adjustable-Rate",
    label: "Adjustable-rate (ARM)",
    description: "Rate adjusts after intro period",
  },
];

const FORM_CHAT_IO_PREF_OPTIONS: FormChatOption[] = [
  { value: "No preference", label: "No Preference" },
  {
    value: "Yes",
    label: "Yes — I want Interest-Only",
    description: "Lower initial payments",
  },
  { value: "No", label: "No — fully amortizing only" },
];

/** Lettered-card / chat option lists for loan term, rate type, and IO prefs. */
export function formChatProductPrefOptions(q: FormChatQuestion): FormChatOption[] {
  if (q.id === "loanTerm") {
    return [
      { value: FORM_CHAT_LOAN_TERM_NO_PREF, label: "No Preference" },
      ...LOAN_TERM_SELECT_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    ];
  }
  if (q.id === "rateTypePref") return FORM_CHAT_RATE_TYPE_PREF_OPTIONS;
  if (q.id === "interestOnlyPref") return FORM_CHAT_IO_PREF_OPTIONS;
  return [];
}

/** Conversational ask text for product prefs in /chat (lettered options, not form cards). */
export function resolveProductPrefChatPrompt(q: FormChatQuestion): string {
  if (q.id === "loanTerm") {
    return "Any preferred loan term(s)?";
  }
  if (q.id === "rateTypePref") {
    return "Any rate-type preference — fixed, adjustable (ARM), or no preference?";
  }
  if (q.id === "interestOnlyPref") {
    return "Interest-only preference — yes, no, or no preference?";
  }
  return q.prompt.trim() || "Any product preference?";
}

/** Footer hint under lettered option cards for product prefs. */
export function productPrefOptionsFooterHint(q: FormChatQuestion): string {
  if (q.id === "loanTerm") {
    return "Type all that apply (e.g. B, D or 20 and 30 years), or say no preference — or click one option.";
  }
  if (q.id === "rateTypePref") {
    return "Pick one — type a letter (A, B, …), say no preference, or click an option.";
  }
  if (q.id === "interestOnlyPref") {
    return "Pick one — type a letter, say no preference, or click an option.";
  }
  return "Type a letter (A, B, …), say no preference, or click an option.";
}

/** Parse free-text loan-term replies (multi-select letters or year terms). */
export function parseLoanTermChatReply(text: string, options: FormChatOption[]): string {
  const lc = text.toLowerCase().trim();
  if (!lc || /^(?:no\s*pref(?:erence)?|none|skip|n\/?a)$/.test(lc)) {
    return FORM_CHAT_LOAN_TERM_NO_PREF;
  }
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const parts = lc.split(/[,/&]|\band\b/i).map((s) => s.trim());
  const values: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const letter = part.match(/^([a-g])\b/);
    if (letter) {
      const opt = options[letter[1].charCodeAt(0) - 97];
      if (opt) values.push(opt.value);
      continue;
    }
    // A bare number counts only when the part IS the answer ("30", "30 yrs") or the
    // year word is explicit — never a number plucked from an unrelated sentence
    // ("anything less than 30 words" must NOT become a 30-year term).
    const year =
      part.match(/^\s*(10|15|20|25|30|40)\s*(?:yr|year)?s?\s*$/) ||
      part.match(/\b(10|15|20|25|30|40)\s*(?:yr|year)s?\b/);
    if (year) {
      values.push(year[1]);
      continue;
    }
    const exact = options.find((o) => norm(o.label) === norm(part) || norm(o.value) === norm(part));
    if (exact) values.push(exact.value);
  }
  if (values.includes(FORM_CHAT_LOAN_TERM_NO_PREF)) return FORM_CHAT_LOAN_TERM_NO_PREF;
  const terms = values
    .filter((v) => v !== FORM_CHAT_LOAN_TERM_NO_PREF)
    .map((v) => parseInt(v, 10))
    .filter((n) => !Number.isNaN(n));
  if (terms.length) return formatLoanTermStorage(terms);
  return "";
}

const FORM_CHAT_PRODUCT_PREF_CHIPS: Record<string, string> = {
  loanTerm: "LOAN_TERM_PREF",
  rateTypePref: "RATE_TYPE_PREF",
  interestOnlyPref: "IO_PREF",
};

/** Section chip for product-preference question cards (Form + chat modes). */
export function formChatProductPrefQuestionChip(sectionName: string, qId: string): string {
  const prefChip = FORM_CHAT_PRODUCT_PREF_CHIPS[qId];
  if (prefChip) {
    return `${sectionName.toUpperCase()} · QUESTION ${prefChip.replace(/_/g, " ")}`;
  }
  return `${sectionName} · ${qId}`;
}

/** User-bubble label after confirming a product-preference answer. */
export function productPrefAnswerLabel(qId: string, form: WizardForm): string {
  if (qId === "loanTerm") {
    return isNoProductPreference(form.loanTerm)
      ? "No preference"
      : formatLoanTermDisplay(form.loanTerm);
  }
  if (qId === "rateTypePref") {
    if (isNoProductPreference(form.rateTypePref)) return "No preference";
    const opt = FORM_CHAT_RATE_TYPE_PREF_OPTIONS.find((o) => o.value === form.rateTypePref);
    return opt?.label ?? form.rateTypePref;
  }
  if (qId === "interestOnlyPref") {
    if (isNoProductPreference(form.interestOnlyPref)) return "No preference";
    const opt = FORM_CHAT_IO_PREF_OPTIONS.find((o) => o.value === form.interestOnlyPref);
    return opt?.label ?? form.interestOnlyPref;
  }
  return "No preference";
}

/** Primary NOCB and/or residual-income follow-up when DTI is high. */
export function capacityDtiExtrasVisible(wizard: WizardForm): boolean {
  return nocbVisible(wizard) || residualFollowupRequired(wizard);
}

// ── Predicate helpers ────────────────────────────────────────────────────────
const isFN = (f: WizardForm) => f.citizenship === "Foreign National";
// Visa questions apply to Foreign Nationals AND Non-Permanent Resident Aliens.
const needsVisa = (f: WizardForm) =>
  f.citizenship === "Foreign National" || f.citizenship === "Non-Permanent Resident Alien";
const isInvestment = (f: WizardForm) => f.occupancy === "Investment Property";
const isStandaloneSecond = (f: WizardForm) => f.lienPosition === LIEN_POSITION_SECOND;
const isCashOut = (f: WizardForm) =>
  f.loanPurpose === "Cash-Out Refinance" || f.primaryLoanPurpose === "Cash-Out Refinance";
const isRefi = (f: WizardForm) => {
  const p = effectivePrimaryLoanPurpose(f);
  return p === "Refinance" || p === "Cash-Out Refinance";
};

// ── Loan Details contextual labels — SINGLE SOURCE for both intakes ─────────
// Implements loan_details_field_labels_spec.md: every render site (form card,
// wizard step, chat prompt/pills, sidebars) reads labels + visibility from here
// so /form and /chat can never drift.

export type LoanDetailsFieldSpec = {
  /** Sales Price (purchase) | Appraised Value (any refi). */
  propertyValue: string;
  /** Loan Amount | New Loan Amount | New Piggyback (2nd) Amount | HELOC Credit Limit | New 2nd Lien Amount (HELOAN). */
  loanAmount: string;
  /** LTV | LTV on 2nd. */
  ltv: string;
  /** CLTV — display-only everywhere (never an input). */
  cltv: string;
  /** Existing 1st Lien Balance | New First Mortgage Amount (piggyback). */
  existingFirstLien: string;
  /** Required on second liens AND first-lien refis (spec: payoff is not optional). */
  existingFirstLienRequired: boolean;
  showExistingFirstLien: boolean;
  existingSecondLien: string;
  showExistingSecond: boolean;
  cashOut: string;
  /** Cash-Out Request — hidden on standalone HELOC (Initial Draw replaces it). */
  showCash: boolean;
  /** HELOC-only: Initial Draw (with Draw Period asked separately). */
  showHelocDraw: boolean;
  downPayment: string;
  showDownPayment: boolean;
  showCltv: boolean;
};

export function loanDetailsFieldSpec(f: WizardForm): LoanDetailsFieldSpec {
  const second = f.isSecondLien === "yes";
  const piggyback = f.lienPosition === LIEN_POSITION_PIGGYBACK;
  const standaloneSecond = f.lienPosition === LIEN_POSITION_SECOND;
  const heloc = standaloneSecond && f.secondLienProduct === "heloc";
  const refi = isRefi(f);
  const cashOut = isCashOut(f);
  const firstLienRefi = !second && refi;
  const purchase = !refi;

  return {
    propertyValue: refi ? "Appraised Value" : "Sales Price",
    loanAmount: piggyback
      ? "New Piggyback (2nd) Amount"
      : heloc
        ? "HELOC Credit Limit"
        : standaloneSecond
          ? "New 2nd Lien Amount"
          : refi
            ? "New Loan Amount"
            : "Loan Amount",
    ltv: second ? "LTV on 2nd" : "LTV",
    cltv: second ? "CLTV ((1st + 2nd) ÷ value)" : "CLTV",
    existingFirstLien: piggyback ? "New First Mortgage Amount" : "Existing 1st Lien Balance",
    existingFirstLienRequired: second || firstLienRefi,
    showExistingFirstLien: second || firstLienRefi,
    existingSecondLien: "Existing 2nd lien on title?",
    showExistingSecond: firstLienRefi,
    cashOut: "Cash-Out Request",
    showCash: cashOut && !heloc,
    showHelocDraw: heloc,
    downPayment: "Down Payment",
    showDownPayment: purchase,
    // Second liens AND first-lien refis show CLTV (computed; = LTV when no 2nd subordinates).
    showCltv: second || firstLienRefi,
  };
}

/** Purchase down payment: 1st = value − loan; piggyback = value − new first − new second. */
export function loanDetailsDownPayment(f: {
  valueSalesPrice: string;
  loanAmount: string;
  existingFirstLien: string;
  lienPosition: string;
}): number {
  const n = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
  const first = f.lienPosition === LIEN_POSITION_PIGGYBACK ? n(f.existingFirstLien) : 0;
  return Math.max(0, n(f.valueSalesPrice) - first - n(f.loanAmount));
}

/**
 * Loan Details (triangle) ask that acknowledges what's already captured —
 * "I already have the property value ($800,000) — give me one more…" instead of
 * re-asking for everything when the scenario dump included some of it.
 */
function loanDetailsPrompt(f: WizardForm): string {
  const money = (v: string) => {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : v;
  };
  const spec = loanDetailsFieldSpec(f);
  // Labels used VERBATIM (title case) so the prose matches the card exactly.
  const known: string[] = [];
  if (f.valueSalesPrice.trim()) known.push(`${spec.propertyValue} (${money(f.valueSalesPrice)})`);
  if (f.loanAmount.trim()) known.push(`${spec.loanAmount} (${money(f.loanAmount)})`);
  if (f.ltv.trim()) known.push(`${spec.ltv} (${f.ltv}%)`);
  if (known.length === 0) {
    // Nothing captured yet — contextual full ask (chat shows the same labels the
    // Loan Details card does; no generic "property value" wording).
    const wants = [spec.propertyValue, spec.loanAmount, spec.ltv];
    const tail: string[] = [];
    if (spec.showExistingFirstLien && spec.existingFirstLienRequired)
      tail.push(`the ${spec.existingFirstLien}`);
    if (spec.showCash) tail.push("the Cash-Out Request");
    if (spec.showHelocDraw) tail.push("the Initial Draw");
    return `What are the ${wants.join(", ")}? Enter any two and I'll compute the third${
      tail.length ? ` — plus ${tail.join(" and ")}` : ""
    }.`;
  }

  const missing: string[] = [];
  if (!f.valueSalesPrice.trim()) missing.push(spec.propertyValue);
  if (!f.loanAmount.trim()) missing.push(spec.loanAmount);
  if (!f.ltv.trim()) missing.push(spec.ltv);

  const extras: string[] = [];
  if (spec.showExistingFirstLien && spec.existingFirstLienRequired && !f.existingFirstLien.trim())
    extras.push(`the ${spec.existingFirstLien}`);
  if (spec.showCash && !f.cashInHandRequest.trim()) extras.push("the cash-out request");
  if (spec.showHelocDraw && !f.helocInitialDraw.trim()) extras.push("the initial draw");
  if (spec.showExistingSecond && f.existingFirstLien.trim() && !f.existingSecondLien.trim())
    extras.push("whether there's an existing second lien on title");

  if (missing.length === 0) {
    return extras.length
      ? `I have the ${known.join(", ")} — just need ${extras.join(" and ")} to finish Loan Details.`
      : "";
  }
  const extraTail = extras.length ? ` I'll also need ${extras.join(" and ")}.` : "";
  return `I already have the ${known.join(" and ")} — give me one more (${missing.join(
    " or ",
  )}) and I'll compute the rest.${extraTail}`;
}

/** Edits that can change which Loan Details (triangle) fields are required. */
export const PURPOSE_LIEN_CASCADE_IDS = new Set([
  "loanPurpose",
  "primaryLoanPurpose",
  "lienPosition",
]);

/** All value/loan/LTV + lien-detail fields owned by the grouped Loan Details form. */
export const LOAN_DETAILS_FIELD_CLEAR: Partial<WizardForm> = {
  valueSalesPrice: "",
  loanAmount: "",
  ltv: "",
  cltv: "",
  existingFirstLien: "",
  existingSecondLien: "",
  existingSecondLienBalance: "",
  cashInHandRequest: "",
  helocInitialDraw: "",
};

/** True when an edit changes the canonical loan purpose (Purchase / Refi / Cash-Out). */
export function primaryLoanPurposeChanged(form: WizardForm, patch: Partial<WizardForm>): boolean {
  if (patch.loanPurpose === undefined && patch.primaryLoanPurpose === undefined) return false;
  const before = effectivePrimaryLoanPurpose(form);
  if (!before) return false;
  const after = effectivePrimaryLoanPurpose({ ...form, ...patch } as WizardForm);
  return before !== after;
}

/** Clear grouped Loan Details fields on a patch object. */
export function applyLoanDetailsFieldClear(target: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(LOAN_DETAILS_FIELD_CLEAR)) {
    target[k] = v;
  }
}

/**
 * Clear lien-detail fields when purpose / lien changes.
 * Mirrors LoanWizard: any purpose change wipes lien position + the full triangle.
 */
export function lienDetailsCascadePatch(
  qId: string,
  form: WizardForm,
  patch: Partial<WizardForm>,
): Partial<WizardForm> {
  if (!PURPOSE_LIEN_CASCADE_IDS.has(qId)) return {};

  if (
    (qId === "loanPurpose" || qId === "primaryLoanPurpose") &&
    primaryLoanPurposeChanged(form, patch)
  ) {
    return {
      ...LOAN_DETAILS_FIELD_CLEAR,
      lienPosition: "",
      isSecondLien: "",
      secondLienProduct: "",
    };
  }

  if (qId === "lienPosition") {
    const nextLp = String(
      (patch as Record<string, unknown>).lienPosition ?? form.lienPosition ?? "",
    ).trim();
    if (nextLp && nextLp !== String(form.lienPosition ?? "").trim()) {
      return {
        ...LOAN_DETAILS_FIELD_CLEAR,
        ...(nextLp === LIEN_POSITION_SECOND ? { secondLienProduct: "" } : {}),
      };
    }
    return {};
  }

  const merged = { ...form, ...patch } as WizardForm;
  const purpose = effectivePrimaryLoanPurpose(merged);
  const lp = merged.lienPosition;
  // Piggyback vs standalone second depends on purpose — force re-pick when incompatible.
  if (purpose === "Purchase" && lp === LIEN_POSITION_SECOND) {
    return {
      ...LOAN_DETAILS_FIELD_CLEAR,
      lienPosition: "",
      isSecondLien: "",
      secondLienProduct: "",
    };
  }
  if (purpose && purpose !== "Purchase" && lp === LIEN_POSITION_PIGGYBACK) {
    return {
      ...LOAN_DETAILS_FIELD_CLEAR,
      lienPosition: "",
      isSecondLien: "",
      secondLienProduct: "",
    };
  }
  return {};
}
const isDscr = (f: WizardForm) =>
  isDscrPathScenario({
    occupancy: f.occupancy,
    propertyType: f.propertyType,
    investmentIncomePath: f.investmentIncomePath,
  });
const docTypeAsked = (f: WizardForm) => !isDscr(f);
export const nocbVisible = (wizard: WizardForm) =>
  !isDscr(wizard) &&
  wizard.occupancy === "Primary Residence" &&
  wizard.primaryLoanPurpose !== "Cash-Out Refinance" &&
  (parseFloat(wizard.estimatedDti) || 0) > 43 &&
  wizard.citizenship !== "Foreign National";
export const nocbBranchComplete = (wizard: WizardForm): boolean =>
  !nocbVisible(wizard) ||
  wizard.nonOccupantCoBorrower === "No" ||
  (!!wizard.noCbRelationship.trim() && !!wizard.combinedDti.trim());
const isStepdownNA = (prepay: string) =>
  !prepay || prepay === "No Penalty" || prepay === "1 Year" || prepay === "2 Year";
// Residual income matters for primary/second-home loans once the (effective) DTI > 43%.
const effectiveDtiNum = (wizard: WizardForm) =>
  wizard.nonOccupantCoBorrower === "Yes" && wizard.combinedDti
    ? parseFloat(wizard.combinedDti) || 0
    : parseFloat(wizard.estimatedDti) || 0;
const residualFollowupRequired = (wizard: WizardForm) =>
  !isDscr(wizard) &&
  (wizard.occupancy === "Primary Residence" || wizard.occupancy === "Second Home") &&
  !!wizard.estimatedDti.trim() &&
  (parseFloat(wizard.estimatedDti) || 0) > 43;
export const residualTriggered = (wizard: WizardForm) =>
  residualFollowupRequired(wizard) && effectiveDtiNum(wizard) > 43;
export const residualQuestionsVisible = (wizard: WizardForm): boolean =>
  residualFollowupRequired(wizard) && nocbBranchComplete(wizard);

function capacityFollowupsComplete(form: WizardForm): boolean {
  if (nocbVisible(form)) {
    if (!form.nonOccupantCoBorrower.trim()) return false;
    if (
      form.nonOccupantCoBorrower === "Yes" &&
      (!form.noCbRelationship.trim() || !form.combinedDti.trim())
    ) {
      return false;
    }
  }
  if (residualFollowupRequired(form)) {
    if (!form.householdSize.trim() || !form.monthlyResidualIncome.trim()) return false;
  }
  return true;
}

export function effectiveDtiPercent(wizard: WizardForm): number {
  return effectiveDtiNum(wizard);
}

export const NOCB_RELATIONSHIP_OPTIONS = [
  "Parent",
  "Sibling",
  "Spouse / Domestic Partner",
  "Child",
  "Grandparent",
  "Aunt / Uncle",
  "Cousin",
  "Other Relative",
] as const;

// Wizard field id usually matches; triangle / bundles use dedicated question ids.
// Geo sub-fields are included so typed geo answers mirror into the portfolio too.
const SLOT_BY_FIELD: Record<string, string> = {
  citizenship: "citizenship",
  occupancy: "occupancy",
  loanPurpose: "loan_purpose",
  primaryLoanPurpose: "loan_purpose",
  propertyType: "property_type",
  valueSalesPrice: "property_value",
  loanAmount: "loan_amount",
  ltv: "ltv",
  cltv: "cltv",
  decisionCreditScore: "fico",
  documentationType: "doc_type",
  documentationTimeframe: "doc_timeframe",
  estimatedDti: "estimated_dti",
  dscr: "dscr",
  rentalType: "rental_type",
  prepaymentTerms: "prepayment_terms",
  state: "property_state",
  lienPosition: "lien_position",
  investmentIncomePath: "investment_income_path",
  visaCategory: "visa_category",
  secondLienProduct: "second_lien_product",
  vacantProperty: "vacant_property",
  recentlyRehabbed: "recently_rehabbed",
  prepayStepdown: "prepay_stepdown",
  establishedPrimaryRes: "established_primary_res",
  hiLavaZone: "hi_lava_zone",
  stateCounty: "state_county",
  stateCity: "state_city",
  stateBorough: "state_borough",
  stateZipCode: "state_zip",
  isInBaltimoreCity: "is_in_baltimore",
  isInIndianapolis: "is_in_indianapolis",
  isInPhiladelphia: "is_in_philadelphia",
  isInMemphis: "is_in_memphis",
  isInLubbock: "is_in_lubbock",
  isRuralProperty: "rural_property",
  paymentHistory: "payment_history",
  hasCreditEvent: "has_credit_event",
  creditEvents: "credit_event_category",
  firstTimeHomebuyer: "first_time_homebuyer",
  firstTimeInvestor: "first_time_investor",
  existingFirstLien: "existing_first_lien",
  existingSecondLien: "existing_second_lien",
  helocDrawYears: "heloc_draw_years",
  helocInitialDraw: "heloc_initial_draw",
  listingSeasoning: "listing_seasoning",
  powerOfAttorney: "power_of_attorney",
  nonArmsLength: "non_arms_length",
};

// Inverse: sidebar slot edits arrive with snake_case slot ids. First camelCase
// field wins (loan_purpose → loanPurpose, not primaryLoanPurpose).
const FIELD_BY_SLOT: Record<string, string> = {};
for (const [field, slot] of Object.entries(SLOT_BY_FIELD)) {
  if (!(slot in FIELD_BY_SLOT)) FIELD_BY_SLOT[slot] = field;
}

/** Portfolio slot id for a wizard form field key (static map; geo sub-fields included). */
export function portfolioSlotForFormField(fieldKey: string): string | undefined {
  return SLOT_BY_FIELD[fieldKey];
}

/** Intake extract `last_target_slots` for the pending chat question (geo → slot id). */
export function resolveIntakeTargetSlot(
  form: WizardForm,
  pendingQuestionId: string | null,
): string | undefined {
  if (!pendingQuestionId) return undefined;
  if (pendingQuestionId === "geo_followup") {
    return nextRequiredGeoField(form)?.slot_id;
  }
  const q = FORM_CHAT_QUESTIONS.find((qq) => qq.id === pendingQuestionId);
  if (!q) return SLOT_BY_FIELD[pendingQuestionId];
  return SLOT_BY_FIELD[pendingQuestionId] ?? pendingQuestionId;
}

/** Form patch for a chat answer — geo_followup writes the active geo sub-field, not `geo_followup`. */
export function chatAnswerFormPatch(
  form: WizardForm,
  questionId: string,
  value: string,
): Partial<WizardForm> {
  if (questionId === "geo_followup") {
    const fld = nextRequiredGeoField(form);
    if (!fld) return {};
    return { [fld.form_key]: value } as Partial<WizardForm>;
  }
  const q = FORM_CHAT_QUESTIONS.find((qq) => qq.id === questionId);
  if (q) return applyFormChatAnswer(form, q, value) as Partial<WizardForm>;
  return { [questionId]: value } as Partial<WizardForm>;
}

/** First required geo follow-up field (county/city/zip…) for the state that's still unfilled. */
export function nextRequiredGeoField(f: WizardForm): GeoFieldConfig | null {
  if (!f.stateCounty.trim()) return null;
  for (const fld of getGeoFieldsForCounty(f.state, f.stateCounty)) {
    if (!fld.required) continue;
    const v = String((f as Record<string, unknown>)[fld.form_key] ?? "").trim();
    if (fld.widget === "zip") {
      if (v.replace(/\D/g, "").length !== 5) return fld;
    } else if (!v) {
      return fld;
    }
  }
  return null;
}

const toOpt = (o: { value: string; label: string; description?: string }): FormChatOption => ({
  value: o.value,
  label: o.label,
  ...(o.description ? { description: o.description } : {}),
});
const docTypeOpts = DOC_TYPE_OPTIONS.map((o) => ({ value: o.label, label: o.label }));
const stateOpts = STATES.map((s) => ({ value: s.code, label: `${s.label} (${s.code})` }));

// Doc types that ask the borrower for a 12-/24-month timeframe (stored as "12" | "24").
// Asset Utilization, Asset Qualifier, and WVOE Only skip — pricing defaults to 24 month.
const DOC_TIMEFRAME_DOC_TYPES = new Set<string>([
  "Full Documentation",
  BANK_STMT_COMBINED_LABEL,
  BANK_STMT_BUSINESS_LABEL,
  PL_ONLY_LABEL,
  PL_2MO_BS_LABEL,
  "1099",
]);
export const docTimeframeAsked = (f: WizardForm) =>
  !isDscr(f) && DOC_TIMEFRAME_DOC_TYPES.has((f.documentationType ?? "").trim());

type DocTimeframeConfig = {
  prompt: string;
  options: ReadonlyArray<FormChatOption>;
};

function docTimeframeConfig(docType: string): DocTimeframeConfig | null {
  switch (docType.trim()) {
    case "Full Documentation":
      return {
        prompt: "How many years of tax returns will the borrower provide?",
        options: [
          { value: "12", label: "1-Year Tax Returns" },
          { value: "24", label: "2-Year Tax Returns" },
        ],
      };
    case BANK_STMT_COMBINED_LABEL:
    case BANK_STMT_BUSINESS_LABEL:
      return {
        prompt: "How many months of bank statements?",
        options: [
          { value: "12", label: "12 Months" },
          { value: "24", label: "24 Months" },
        ],
      };
    case PL_ONLY_LABEL:
    case PL_2MO_BS_LABEL:
      return {
        prompt: "Which P&L window?",
        options: [
          { value: "12", label: "12-Month P&L" },
          { value: "24", label: "Trailing 24-Month P&L" },
        ],
      };
    case "1099":
      return {
        prompt: "How many years of 1099s?",
        options: [
          { value: "12", label: "1-Year of 1099s" },
          { value: "24", label: "2-Years of 1099s" },
        ],
      };
    default:
      return null;
  }
}

export function docTimeframePrompt(form: WizardForm): string {
  return (
    docTimeframeConfig(form.documentationType ?? "")?.prompt ??
    "What documentation timeframe applies?"
  );
}

export function docTimeframeOptions(form: WizardForm): ReadonlyArray<FormChatOption> {
  return (
    docTimeframeConfig(form.documentationType ?? "")?.options ?? [
      { value: "12", label: "12 Months" },
      { value: "24", label: "24 Months" },
    ]
  );
}

/** Parse natural-language doc-timeframe replies → stored "12" | "24". */
export function parseDocumentationTimeframeReply(text: string): "12" | "24" | "" {
  const lc = text.toLowerCase().trim();
  const collapsed = lc
    .replace(/\bof\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(?:a\b|one\b)?\s*1[\s-]?years?/.test(collapsed) ||
    collapsed === "12" ||
    /^12\b/.test(collapsed) ||
    /\b1[\s-]?year/.test(collapsed)
  ) {
    return "12";
  }
  if (
    /^(?:b\b|two\b)?\s*2[\s-]?years?/.test(collapsed) ||
    collapsed === "24" ||
    /^24\b/.test(collapsed) ||
    /\b2[\s-]?years?/.test(collapsed)
  ) {
    return "24";
  }
  return "";
}

/** True when the pending chat question expects a structured slot answer (not free-text notes). */
export function isStructuredPendingQuestion(pendingQuestionId: string | null): boolean {
  if (!pendingQuestionId) return false;
  if (
    pendingQuestionId === "scenarioNotes" ||
    pendingQuestionId === "summary_ask" ||
    pendingQuestionId === "geo_followup" ||
    pendingQuestionId === "creditEvents"
  ) {
    return false;
  }
  const q = FORM_CHAT_QUESTIONS.find((qq) => qq.id === pendingQuestionId);
  if (!q || q.special) return false;
  return q.kind === "enum" || q.kind === "number" || q.kind === "currency" || q.kind === "yesno";
}

/** Stored value ("12" | "24" or legacy labels) → uniform "12-month" | "24-month" display. */
export function formatDocumentationTimeframeDisplay(raw: string | null | undefined): string {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return "";
  if (v === "12" || v.startsWith("12") || /1[\s-]?year/.test(v)) return "12-month";
  if (v === "24" || v.startsWith("24") || /2[\s-]?years?/.test(v)) return "24-month";
  return String(raw).trim();
}

export function resolveFormChatPrompt(form: WizardForm, q: FormChatQuestion): string {
  if (isFormChatProductPrefQuestion(q)) {
    return resolveProductPrefChatPrompt(q);
  }
  if (q.special === "geo_followup") {
    const f = nextRequiredGeoField(form);
    if (f?.prompt?.trim()) return f.prompt.trim();
    if (f?.label) return `What ${f.label.toLowerCase()} is the property in?`;
    return "Where is the property located?";
  }
  if (q.promptFn) {
    const dynamic = q.promptFn(form).trim();
    if (dynamic) return dynamic;
  }
  const staticPrompt = q.prompt.trim();
  if (staticPrompt) return staticPrompt;
  return "Could you add a bit more detail?";
}

// ── The ordered question spec — mirrors the 5-step wizard exactly ─────────────
export const FORM_CHAT_QUESTIONS: FormChatQuestion[] = [
  // ───────── Step 1 · Basics ─────────
  {
    id: "citizenship",
    section: 1,
    sectionName: "Basics",
    prompt: "What's the citizenship status of the primary borrower?",
    kind: "enum",
    priority: "mandatory",
    options: CITIZENSHIP_OPTIONS.map((c) => ({ value: c, label: c })),
  },
  {
    id: "ofacSanctioned",
    section: 1,
    sectionName: "Basics",
    prompt: "Is the borrower a citizen of, or residing in, an OFAC-sanctioned country?",
    kind: "yesno",
    priority: "mandatory",
    showIf: isFN,
  },
  {
    id: "visaCategory",
    section: 1,
    sectionName: "Basics",
    prompt: "Which visa category does the borrower hold?",
    kind: "enum",
    priority: "mandatory",
    options: VISA_CATEGORY_OPTS.map(toOpt),
    showIf: needsVisa,
  },
  {
    id: "visaType",
    section: 1,
    sectionName: "Basics",
    prompt: "Which specific visa type?",
    kind: "enum",
    priority: "mandatory",
    optionsFn: (f) => VISA_SUBTYPE_OPTS[f.visaCategory] ?? [],
    showIf: (f) => needsVisa(f) && !!f.visaCategory && f.visaCategory !== "other",
  },
  {
    id: "hasUsCredit",
    section: 1,
    sectionName: "Basics",
    prompt: "Does the borrower have an established US credit score?",
    kind: "yesno",
    priority: "mandatory",
    showIf: isFN,
  },
  {
    id: "occupancy",
    section: 1,
    sectionName: "Basics",
    prompt: "What's the occupancy type?",
    kind: "enum",
    priority: "mandatory",
    optionsFn: (f) =>
      isFN(f) ? OCCUPANCY_OPTS.filter((o) => o.value !== "Primary Residence") : [...OCCUPANCY_OPTS],
  },
  {
    id: "loanPurpose",
    section: 1,
    sectionName: "Basics",
    prompt: "What's the loan purpose?",
    kind: "enum",
    priority: "mandatory",
    options: LOAN_PURPOSE_CHAT_OPTS,
  },
  {
    id: "lienPosition",
    section: 1,
    sectionName: "Basics",
    prompt: "What's the lien position?",
    kind: "enum",
    priority: "mandatory",
    optionsFn: (f) => {
      const first = { value: LIEN_POSITION_FIRST, label: "First Lien" };
      // One combined "Second Lien" option (no piggyback/standalone split in the UI).
      // A second lien on a purchase is structurally a piggyback; on a refi/cash-out
      // it's a standalone second — so the underlying value adapts to the purpose.
      const secondValue =
        f.loanPurpose === "Purchase" ? LIEN_POSITION_PIGGYBACK : LIEN_POSITION_SECOND;
      if (!f.loanPurpose) return [first];
      return [first, { value: secondValue, label: "Second Lien" }];
    },
  },
  {
    id: "secondLienProduct",
    section: 1,
    sectionName: "Basics",
    prompt: "What type of second-lien product?",
    kind: "enum",
    priority: "mandatory",
    options: SECOND_LIEN_PRODUCT_OPTS.map((o) => ({ ...o })),
    showIf: isStandaloneSecond,
  },
  // existingFirstLien / existingSecondLien / existingSecondLienBalance are captured
  // inline by the Loan Details group (the value/loan/LTV "triangle"), not asked
  // separately — kept here (never shown) so other code can still reference them.
  {
    id: "existingFirstLien",
    section: 1,
    sectionName: "Basics",
    prompt: "What's the balance on the existing first lien?",
    kind: "currency",
    priority: "mandatory",
    prefix: "$",
    placeholder: "e.g. 400,000",
    showIf: () => false,
  },
  {
    id: "existingSecondLien",
    section: 1,
    sectionName: "Basics",
    prompt: "Is there an existing second lien on the property?",
    kind: "enum",
    priority: "mandatory",
    options: EXISTING_SECOND_LIEN_OPTIONS.map((v) => ({ value: v, label: v })),
    showIf: () => false,
  },
  {
    id: "existingSecondLienBalance",
    section: 1,
    sectionName: "Basics",
    prompt: "What's the balance on that existing second lien?",
    kind: "currency",
    priority: "mandatory",
    prefix: "$",
    placeholder: "e.g. 60,000",
    showIf: () => false,
  },
  {
    id: "propertyType",
    section: 1,
    sectionName: "Basics",
    prompt: "What's the property type?",
    kind: "enum",
    priority: "mandatory",
    options: INTEGRATED_PROPERTY_TYPES.map(toOpt),
  },
  {
    id: "valueLoanLtv",
    section: 1,
    sectionName: "Basics",
    prompt:
      "What are the property value, loan amount, LTV, and down payment? Enter any two of value / loan / LTV — the rest auto-fill.",
    promptFn: loanDetailsPrompt,
    // No hint — the contextual field labels (Sales Price / Appraised Value, …) say it.
    kind: "currency",
    priority: "mandatory",
    special: "triangle",
  },
  {
    // Captured inline by the Loan Details group for cash-out — not asked separately.
    id: "cashInHandRequest",
    section: 1,
    sectionName: "Basics",
    prompt: "How much cash-out is the borrower requesting?",
    kind: "currency",
    priority: "mandatory",
    prefix: "$",
    placeholder: "e.g. 50,000",
    showIf: () => false,
  },
  {
    id: "helocDrawYears",
    section: 1,
    sectionName: "Basics",
    prompt: "What draw period for the HELOC?",
    kind: "enum",
    priority: "mandatory",
    options: [
      { value: "2", label: "2 years" },
      { value: "3", label: "3 years" },
      { value: "5", label: "5 years" },
    ],
    showIf: (f) => isStandaloneSecond(f) && f.secondLienProduct === "heloc",
  },
  {
    // Captured inline by the Loan Details group on standalone HELOCs (replaces the
    // ambiguous cash-out request — credit limit is the line, this is the day-one draw).
    id: "helocInitialDraw",
    section: 1,
    sectionName: "Basics",
    prompt: "How much is the initial draw on the HELOC?",
    kind: "currency",
    priority: "mandatory",
    prefix: "$",
    placeholder: "e.g. 50,000",
    showIf: () => false,
  },
  {
    id: "decisionCreditScore",
    section: 1,
    sectionName: "Basics",
    prompt: "What's the Decision Credit Score?",
    kind: "number",
    priority: "mandatory",
    placeholder: "e.g., 720",
    showIf: (f) => !(isFN(f) && f.hasUsCredit === "No"),
  },
  {
    id: "firstTimeHomebuyer",
    section: 1,
    sectionName: "Basics",
    prompt: "Is the borrower a first-time homebuyer?",
    kind: "yesno",
    priority: "mandatory",
    showIf: (f) => shouldAskFirstTimeHomebuyer(f),
  },
  {
    id: "firstTimeInvestor",
    section: 1,
    sectionName: "Basics",
    prompt: "Is the borrower a first-time investor?",
    kind: "yesno",
    priority: "mandatory",
    showIf: (f) => shouldAskFirstTimeInvestor(f),
  },
  {
    id: "investmentIncomePath",
    section: 1,
    sectionName: "Basics",
    prompt:
      "How will this investment property qualify — on the borrower's personal income (documentation), or on the property's rental income (DSCR)?",
    kind: "enum",
    priority: "mandatory",
    options: INVESTMENT_INCOME_TYPE_OPTIONS.map(toOpt),
    showIf: isInvestment,
  },
  {
    id: "establishedPrimaryRes",
    section: 1,
    sectionName: "Basics",
    prompt: "Does the borrower currently have an established primary residence?",
    kind: "yesno",
    priority: "mandatory",
    showIf: (f) =>
      shouldShowEstablishedPrimaryRes(f.occupancy, f.firstTimeHomebuyer, f.firstTimeInvestor),
  },

  // ───────── Step 2 · Capacity ─────────
  {
    id: "documentationType",
    section: 2,
    sectionName: "Capacity",
    prompt: "What documentation type will the borrower use?",
    kind: "enum",
    priority: "mandatory",
    options: docTypeOpts,
    showIf: docTypeAsked,
  },
  {
    id: "documentationTimeframe",
    section: 2,
    sectionName: "Capacity",
    prompt: "",
    promptFn: docTimeframePrompt,
    kind: "enum",
    priority: "mandatory",
    optionsFn: docTimeframeOptions,
    showIf: docTimeframeAsked,
  },
  {
    id: "estimatedDti",
    section: 2,
    sectionName: "Capacity",
    prompt: "What's the estimated DTI (debt-to-income)?",
    kind: "number",
    priority: "mandatory",
    suffix: "%",
    placeholder: "e.g. 42",
    showIf: docTypeAsked,
  },
  {
    id: "dtiCapacityNotice",
    section: 2,
    sectionName: "Capacity",
    prompt:
      "Since DTI is higher than the allowed threshold (43%), we need a few additional details — about any Non-Occupant Co-Borrower (NOCB).",
    kind: "yesno",
    priority: "mandatory",
    showIf: capacityDtiExtrasVisible,
    special: "capacity_dti_notice",
  },
  {
    id: "nonOccupantCoBorrower",
    section: 2,
    sectionName: "Capacity",
    prompt: "Do you have a non-occupant co-borrower to help you qualify?",
    kind: "yesno",
    priority: "mandatory",
    showIf: nocbVisible,
  },
  {
    id: "noCbRelationship",
    section: 2,
    sectionName: "Capacity",
    prompt: "What is the co-borrower's relationship to the primary borrower?",
    kind: "enum",
    priority: "mandatory",
    options: NOCB_RELATIONSHIP_OPTIONS.map((o) => ({ value: o, label: o })),
    showIf: (f) => nocbVisible(f) && f.nonOccupantCoBorrower === "Yes",
  },
  {
    id: "combinedDti",
    section: 2,
    sectionName: "Capacity",
    prompt: "What's the combined DTI with the non-occupant co-borrower included?",
    kind: "number",
    priority: "mandatory",
    suffix: "%",
    placeholder: "e.g. 38",
    showIf: (f) =>
      nocbVisible(f) && f.nonOccupantCoBorrower === "Yes" && !!f.noCbRelationship.trim(),
  },
  {
    id: "householdSize",
    section: 2,
    sectionName: "Capacity",
    prompt: "What's the household size (number of people)?",
    kind: "number",
    priority: "mandatory",
    placeholder: "e.g. 3",
    showIf: residualQuestionsVisible,
  },
  {
    id: "monthlyResidualIncome",
    section: 2,
    sectionName: "Capacity",
    prompt: "What's the monthly residual income (after housing and debts)?",
    kind: "number",
    priority: "mandatory",
    prefix: "$",
    placeholder: "e.g. 2,500",
    showIf: (f) => residualQuestionsVisible(f) && !!f.householdSize.trim(),
  },
  {
    id: "dscr",
    section: 2,
    sectionName: "Capacity",
    prompt: "What's the DSCR (debt-service coverage ratio)?",
    kind: "number",
    priority: "mandatory",
    placeholder: "e.g. 1.15",
    showIf: isDscr,
  },
  {
    id: "rentalType",
    section: 2,
    sectionName: "Capacity",
    prompt: "What's the rental type?",
    kind: "enum",
    priority: "mandatory",
    options: RENTAL_TYPE_OPTS.map((o) => ({ ...o })),
    showIf: isDscr,
  },
  {
    id: "prepaymentTerms",
    section: 2,
    sectionName: "Capacity",
    prompt:
      "What prepayment penalty term is acceptable — e.g. No Penalty, or a 1, 2, 3, 4, or 5-year prepay?",
    kind: "enum",
    priority: "mandatory",
    options: PREPAY_OPTS,
    showIf: isInvestment,
  },
  {
    id: "prepayStepdown",
    section: 2,
    sectionName: "Capacity",
    prompt: "Prefer a step-down prepayment structure?",
    kind: "yesno",
    priority: "mandatory",
    safeDefault: "No",
    showIf: (f) => isInvestment(f) && !isStepdownNA(f.prepaymentTerms),
  },
  {
    id: "reservesAvailable",
    section: 2,
    sectionName: "Capacity",
    prompt: "How many months of reserves are available (PITIA)?",
    kind: "number",
    priority: "mandatory",
    suffix: "months",
    placeholder: "e.g. 6",
  },
  {
    id: "assetsLiquidFunds",
    section: 2,
    sectionName: "Capacity",
    prompt: "Roughly how much in liquid assets?",
    kind: "currency",
    priority: "mandatory",
    prefix: "$",
    placeholder: "e.g. 50,000",
  },
  {
    id: "giftFundsPercent",
    section: 2,
    sectionName: "Capacity",
    prompt: "What percentage of funds to close are gift funds?",
    kind: "number",
    priority: "optional",
    suffix: "%",
    placeholder: "e.g. 10",
  },

  // ───────── Step 3 · Credit ─────────
  {
    id: "paymentHistory",
    section: 3,
    sectionName: "Credit",
    prompt:
      "What's the borrower's housing payment history over the last 12 months — e.g. 0×30 (no late payments), or any 30/60/120-day lates?",
    kind: "enum",
    priority: "mandatory",
    options: PAYMENT_HISTORY_OPTIONS.map(toOpt),
    showIf: (f) => shouldShowPaymentHistory(f.estimatedDti, f.documentationType, f.occupancy),
  },
  {
    id: "hasCreditEvent",
    section: 3,
    sectionName: "Credit",
    prompt: "Any prior credit events (bankruptcy, foreclosure, short sale, etc.)?",
    kind: "yesno",
    priority: "mandatory",
  },
  {
    id: "creditEvents",
    section: 3,
    sectionName: "Credit",
    prompt: "Which credit events apply? (Select all that apply — you'll enter timing next)",
    kind: "enum",
    priority: "mandatory",
    options: CREDIT_EVENT_OPTS.map((o) => ({ ...o })),
    showIf: (f) => f.hasCreditEvent === "Yes",
    special: "credit_events",
  },
  {
    id: "tradelines",
    section: 3,
    sectionName: "Credit",
    prompt: "What's the borrower's tradeline depth?",
    kind: "enum",
    priority: "mandatory",
    options: [
      "3+ active accounts, 12+ mo history",
      "2+ active accounts, 24+ mo history",
      "Mortgage tradeline (36+ mo)",
      "Unsure / Provide via credit report",
      "None — need non-traditional credit",
    ].map((v) => ({ value: v, label: v })),
  },

  // ───────── Step 4 · Collateral ─────────
  {
    id: "state",
    section: 4,
    sectionName: "Collateral",
    prompt: "What state is the property in?",
    kind: "state",
    priority: "mandatory",
    options: stateOpts,
  },
  {
    id: "stateCounty",
    section: 4,
    sectionName: "Collateral",
    prompt: "Which county is the property in?",
    kind: "text",
    priority: "mandatory",
    special: "county_search",
    showIf: (f) => !!f.state.trim(),
  },
  {
    // State-specific follow-ups after county (city / borough / zip / yes-no gates).
    id: "stateGeoFollowup",
    section: 4,
    sectionName: "Collateral",
    prompt: "",
    kind: "enum",
    priority: "mandatory",
    special: "geo_followup",
    showIf: (f) =>
      !!f.state.trim() && !!f.stateCounty.trim() && countyNeedsGeoFollowUp(f.state, f.stateCounty),
  },
  {
    id: "hiLavaZone",
    section: 4,
    sectionName: "Collateral",
    prompt: "Which lava zone is the Hawaii property in?",
    kind: "enum",
    priority: "mandatory",
    options: HI_LAVA_ZONE_OPTS,
    showIf: (f) => f.state === "HI",
  },
  {
    id: "isRuralProperty",
    section: 4,
    sectionName: "Collateral",
    prompt: "Is the property rural?",
    kind: "yesno",
    priority: "mandatory",
    safeDefault: "No",
    showIf: (f) => f.state.trim().length > 0,
  },
  {
    id: "acreage",
    section: 4,
    sectionName: "Collateral",
    prompt: "Roughly how many acres?",
    kind: "number",
    priority: "mandatory",
    suffix: "ac",
    placeholder: "e.g. 5",
    showIf: (f) => f.isRuralProperty === "Yes",
  },
  {
    id: "vacantProperty",
    section: 4,
    sectionName: "Collateral",
    prompt: "Is the property currently vacant?",
    kind: "yesno",
    priority: "mandatory",
    safeDefault: "No",
    showIf: (f) => isDscr(f) && isRefi(f),
  },
  {
    id: "recentlyRehabbed",
    section: 4,
    sectionName: "Collateral",
    prompt: "Was the property recently rehabbed?",
    kind: "yesno",
    priority: "mandatory",
    safeDefault: "No",
    showIf: (f) => isDscr(f) && isRefi(f),
  },
  {
    id: "propertyCondition",
    section: 4,
    sectionName: "Collateral",
    prompt: "How would you rate the property condition?",
    kind: "enum",
    priority: "optional",
    options: ["C1 / C2 — Excellent", "C3 — Good", "C4 — Fair", "C5 / C6 — Needs work"].map((v) => ({
      value: v,
      label: v,
    })),
  },
  {
    id: "decliningMarket",
    section: 4,
    sectionName: "Collateral",
    prompt: "Is the property in a declining market?",
    kind: "yesno",
    priority: "optional",
    safeDefault: "No",
  },

  // ───────── Step 5 · Considerations ─────────
  {
    id: "listingSeasoning",
    section: 5,
    sectionName: "Considerations",
    prompt: "Was the property listed for sale in the last 6 months?",
    kind: "yesno",
    priority: "mandatory",
    safeDefault: "No",
    showIf: listingSeasoningRequired,
  },
  {
    id: "powerOfAttorney",
    section: 5,
    sectionName: "Considerations",
    prompt: "Will the loan be signed via Power of Attorney?",
    kind: "yesno",
    priority: "mandatory",
    safeDefault: "No",
  },
  {
    id: "nonArmsLength",
    section: 5,
    sectionName: "Considerations",
    prompt: "Is this a non-arm's-length transaction (between relatives or business partners)?",
    kind: "yesno",
    priority: "mandatory",
    safeDefault: "No",
  },
  {
    id: "departingResidence",
    section: 5,
    sectionName: "Considerations",
    prompt: "Is the borrower departing a current residence?",
    kind: "yesno",
    priority: "optional",
  },
  {
    id: "departingRent",
    section: 5,
    sectionName: "Considerations",
    prompt: "What's the expected monthly rent on the departing residence?",
    kind: "currency",
    priority: "optional",
    prefix: "$",
    placeholder: "e.g. 2,500",
    showIf: (f) => f.departingResidence === "Yes",
  },
  // Product preferences — lettered cards; answers are optional (no preference is valid).
  {
    id: "loanTerm",
    section: 5,
    sectionName: "Considerations",
    prompt: "Preferred Loan Term(s)",
    promptSubline: "Select all that apply",
    kind: "enum",
    priority: "optional",
    special: "product_pref",
  },
  {
    id: "rateTypePref",
    section: 5,
    sectionName: "Considerations",
    prompt: "Rate type preference?",
    kind: "enum",
    priority: "optional",
    special: "product_pref",
  },
  {
    id: "interestOnlyPref",
    section: 5,
    sectionName: "Considerations",
    prompt: "Interest-Only (I/O) preference?",
    kind: "enum",
    priority: "optional",
    special: "product_pref",
  },
];

// ── Walk helpers ─────────────────────────────────────────────────────────────

/** Label shown in chat when an underwriter-mode optional question is skipped. */
export const FORM_CHAT_SKIP_LABEL = "Skipped";

export function isFormChatSkipMessage(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, "");
  return t === "skip" || t === "skip →" || t.startsWith("skip,") || t === "n/a" || t === "na";
}

/** Marked answered (e.g. Skip chip) but no value stored on the form yet. */
export function isFormChatSkippedQuestion(
  q: FormChatQuestion,
  form: WizardForm,
  answeredQIds?: Set<string>,
): boolean {
  if (!answeredQIds?.has(q.id)) return false;
  return !isAnswered(form, q);
}

/** Sidebar value for first-time homebuyer — refi/cash-out shows No; purchase shows answer. */
export function firstTimeHomebuyerSidebarValue(form: WizardForm): string {
  if (shouldHardcodeFirstTimeHomebuyerNo(form)) return "No";
  if (!shouldAskFirstTimeHomebuyer(form)) return "";
  return String(form.firstTimeHomebuyer ?? "").trim();
}

/** Sidebar value for first-time investor — refi/cash-out shows No; purchase shows answer. */
export function firstTimeInvestorSidebarValue(form: WizardForm): string {
  if (shouldHardcodeFirstTimeInvestorNo(form)) return "No";
  if (!shouldAskFirstTimeInvestor(form)) return "";
  return String(form.firstTimeInvestor ?? "").trim();
}

/** Underwriter-only mandatory questions — skipped in LO mode, required (no Skip) in UW. */
export const FORM_CHAT_UNDERWRITER_ONLY_QUESTION_IDS = new Set([
  "assetsLiquidFunds",
  "tradelines",
  "powerOfAttorney",
  "nonArmsLength",
]);

export function isFormChatUnderwriterOnlyQuestion(q: { id: string }): boolean {
  return FORM_CHAT_UNDERWRITER_ONLY_QUESTION_IDS.has(q.id);
}

/** LO + UW: product prefs are asked in chat; other optionals only in underwriter mode. */
export function includeFormChatQuestionInFlow(
  q: FormChatQuestion,
  includeOptional: boolean,
): boolean {
  if (isFormChatUnderwriterOnlyQuestion(q) && !includeOptional) return false;
  if (q.priority === "optional") {
    if (includeOptional) return true;
    return isFormChatProductPrefQuestion(q);
  }
  return true;
}

export function canSkipFormChatQuestion(q: FormChatQuestion, includeOptional: boolean): boolean {
  if (isFormChatUnderwriterOnlyQuestion(q)) return false;
  return includeOptional && q.priority === "optional" && !q.special;
}

/** Location questions invalidated when the property state changes. */
export const LOCATION_DOWNSTREAM_Q_IDS = ["stateCounty", "stateGeoFollowup", "hiLavaZone"] as const;

/** Clear county + state-specific geo follow-ups (and HI lava zone when leaving HI). */
export function locationCascadeClearPatch(nextState: string): Partial<WizardForm> {
  const patch: Record<string, unknown> = {};
  for (const k of geoSubFieldKeys()) patch[k] = "";
  if (nextState.trim() && nextState.trim() !== "HI") patch.hiLavaZone = "";
  return patch as Partial<WizardForm>;
}

/** Whether a preference value means "no preference" / skip. */
export function isNoProductPreference(value: string): boolean {
  const v = value.trim().toLowerCase();
  return !v || v === "no preference";
}

/** A question is "answered" once its backing form field holds a value. */
export function isAnswered(form: WizardForm, q: FormChatQuestion): boolean {
  if (q.special === "credit_events") {
    const events = form.creditEvents ?? [];
    if (events.length === 0) return false;
    // A generic "BK" still needs its chapter/status resolved before it counts.
    if (events.includes(CREDIT_EVENT_BK_GENERIC)) return false;
    return events.every((ev) => {
      const d = form.creditEventDates?.[ev]?.trim() ?? "";
      const y = form.creditEventYears?.[ev]?.trim() ?? "";
      if (y) return true;
      return !!d && !validateMmYyyy(d);
    });
  }
  if (q.special === "county_search") {
    return !!form.stateCounty.trim();
  }
  if (q.special === "geo_followup") {
    if (!form.state.trim() || !form.stateCounty.trim()) return false;
    if (!countyNeedsGeoFollowUp(form.state, form.stateCounty)) return true;
    return nextRequiredGeoField(form) === null;
  }
  if (q.special === "capacity_dti_notice") return !capacityDtiExtrasVisible(form);
  if (q.special === "triangle") {
    // The Loan Details group captures value/loan/LTV plus the lien-specific fields —
    // completeness comes from the shared loanDetailsFieldSpec (labels spec).
    if (!form.valueSalesPrice.trim() || !form.loanAmount.trim()) return false;
    const spec = loanDetailsFieldSpec(form);
    if (spec.existingFirstLienRequired && !form.existingFirstLien.trim()) return false;
    if (spec.showCash && !form.cashInHandRequest.trim()) return false;
    if (spec.showHelocDraw && !form.helocInitialDraw.trim()) return false;
    // first-lien refi: once the payoff balance is in, the existing-second answer is required
    if (
      spec.showExistingSecond &&
      form.existingFirstLien.trim() &&
      !form.existingSecondLien.trim()
    ) {
      return false;
    }
    return true;
  }
  const v = (form as Record<string, unknown>)[q.id];
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return v != null && v !== "";
}

export function visibleQuestions(form: WizardForm): FormChatQuestion[] {
  return FORM_CHAT_QUESTIONS.filter((q) => !q.showIf || q.showIf(form));
}

/** Resolve the active option list for a question given the current form. */
export function optionsFor(form: WizardForm, q: FormChatQuestion): ReadonlyArray<FormChatOption> {
  if (q.kind === "yesno") {
    return [
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
    ];
  }
  if (q.optionsFn) return q.optionsFn(form);
  return q.options ?? [];
}

/** Driver-aware answered check (product prefs need an explicit Confirm in chat). */
export function isFormChatQuestionAnswered(
  form: WizardForm,
  q: FormChatQuestion,
  answeredQIds?: Set<string>,
): boolean {
  if (isFormChatProductPrefQuestion(q)) {
    return answeredQIds?.has(q.id) ?? false;
  }
  if (q.priority === "optional" && answeredQIds?.has(q.id)) return true;
  if (isFormChatSkippedQuestion(q, form, answeredQIds)) return true;
  if (q.special === "capacity_dti_notice") {
    if (!capacityDtiExtrasVisible(form)) return true;
    if (answeredQIds?.has(q.id)) return true;
    return capacityFollowupsComplete(form);
  }
  return isAnswered(form, q);
}

export type FormChatFlowOpts = {
  includeOptional?: boolean;
  answeredQIds?: Set<string>;
};

/** Lowest wizard step (1–5) that still has a mandatory gap — mirrors form-mode step gating. */
export function getFormChatActiveSection(
  form: WizardForm,
  opts: FormChatFlowOpts = {},
): 1 | 2 | 3 | 4 | 5 {
  for (const section of [1, 2, 3, 4, 5] as const) {
    if (!isFormChatSectionComplete(form, section, opts)) return section;
  }
  return 5;
}

export function isFormChatSectionComplete(
  form: WizardForm,
  section: 1 | 2 | 3 | 4 | 5,
  opts: FormChatFlowOpts = {},
): boolean {
  for (const q of FORM_CHAT_QUESTIONS) {
    if (q.section !== section) continue;
    if (!includeFormChatQuestionInFlow(q, !!opts.includeOptional)) continue;
    if (q.showIf && !q.showIf(form)) continue;
    if (!isFormChatQuestionAnswered(form, q, opts.answeredQIds)) return false;
  }
  return true;
}

/** Mandatory questions in wizard order, only through the active step (no future-step jumps). */
export function formChatQuestionsInFlowOrder(
  form: WizardForm,
  opts: FormChatFlowOpts = {},
): FormChatQuestion[] {
  const activeSection = getFormChatActiveSection(form, opts);
  const out: FormChatQuestion[] = [];
  const includeOptional = !!opts.includeOptional;
  for (const q of FORM_CHAT_QUESTIONS) {
    if (!includeFormChatQuestionInFlow(q, includeOptional)) continue;
    if (q.section > activeSection) continue;
    if (q.showIf && !q.showIf(form)) continue;
    out.push(q);
  }
  return out;
}

/**
 * Next unanswered, visible question. Mandatory questions come first (in order);
 * product prefs (loan term / rate type / IO) follow in both LO and UW modes;
 * other optionals only when `includeOptional` is true (underwriter).
 * Step gating: never ask Collateral/Credit/Considerations until prior steps are complete
 * (even when a 1003 import pre-filled later-step fields).
 */
export function nextFormChatQuestion(
  form: WizardForm,
  opts: { includeOptional?: boolean; answeredQIds?: Set<string> } = {},
): FormChatQuestion | null {
  for (const q of formChatQuestionsInFlowOrder(form, opts)) {
    if (isFormChatQuestionAnswered(form, q, opts.answeredQIds)) continue;
    return q;
  }
  return null;
}

/**
 * True when a mandatory gap exists but later questions still appear answered
 * (typical after an upstream edit prunes downstream without re-asking).
 */
export function formChatHasStaleAnswersAfterGap(
  form: WizardForm,
  answeredQIds: Set<string>,
  includeOptional = false,
): boolean {
  const opts = { includeOptional, answeredQIds };
  const next = nextFormChatQuestion(form, opts);
  if (!next) return false;
  const flow = formChatQuestionsInFlowOrder(form, opts);
  const nextIdx = flow.findIndex((q) => q.id === next.id);
  if (nextIdx < 0) return false;
  return flow.slice(nextIdx + 1).some((q) => answeredQIds.has(q.id));
}

/** True once every visible mandatory-priority question is answered. */
export function mandatoryComplete(
  form: WizardForm,
  opts: { answeredQIds?: Set<string> } = {},
): boolean {
  for (const q of formChatQuestionsInFlowOrder(form, { includeOptional: false, ...opts })) {
    if (q.priority !== "mandatory") continue;
    if (isFormChatQuestionAnswered(form, q, opts.answeredQIds)) continue;
    return false;
  }
  return true;
}

/**
 * Build the form patch for a single answered question. Sets the backing field
 * plus the few cascade/derived companions the wizard normally syncs via effects
 * (loanPurpose→primaryLoanPurpose, lienPosition→isSecondLien, value/loan→LTV),
 * so question ordering stays correct without waiting on async effects.
 */
export function applyFormChatAnswer(
  form: WizardForm,
  q: FormChatQuestion,
  value: string,
): Partial<WizardForm> {
  const stored = q.id === "decisionCreditScore" ? value.replace(/\D/g, "") : value;
  const patch: Record<string, unknown> = { [q.id]: stored };

  if (q.id === "documentationTimeframe") {
    const v = stored.trim();
    patch.documentationTimeframe =
      v === "12" || v.startsWith("12") ? "12" : v === "24" || v.startsWith("24") ? "24" : stored;
  }

  if (q.id === "loanPurpose") {
    patch.primaryLoanPurpose = value;
  }
  if (q.id === "lienPosition") {
    patch.isSecondLien = value === LIEN_POSITION_FIRST ? "no" : "yes";
  }
  if (q.id === "state" && stored.trim() !== form.state.trim()) {
    Object.assign(patch, locationCascadeClearPatch(stored));
  }
  if (q.id === "stateCounty" && stored.trim() !== form.stateCounty.trim()) {
    Object.assign(patch, clearGeoFollowupFieldsPatch());
    Object.assign(patch, inferGeoFollowupsFromCounty(form.state, stored));
  }
  if (q.id === "nonOccupantCoBorrower" && stored === "No") {
    patch.noCbRelationship = "";
    patch.combinedDti = "";
    patch.noCbFico = "";
    patch.noCbIncome = "";
  }
  if (q.id === "valueSalesPrice" || q.id === "loanAmount") {
    const valueStr = q.id === "valueSalesPrice" ? value : form.valueSalesPrice;
    const loanStr = q.id === "loanAmount" ? value : form.loanAmount;
    if (valueStr.trim() && loanStr.trim()) {
      patch.ltv = computeLtvPercent(loanStr, valueStr);
    }
  }
  if (q.id === "monthlyResidualIncome") {
    patch.monthlyResidualIncome = formatMoneyForInput(stored);
  }

  return patch as Partial<WizardForm>;
}

/** Occupancy / purpose edits — downstream clears + FTHB / FTI hardcode sync. */
export function formChatScenarioCascadePatch(
  qId: string,
  form: WizardForm,
  patch: Partial<WizardForm>,
): Partial<WizardForm> {
  const extra: Record<string, unknown> = {};
  const occupancyChanged =
    qId === "occupancy" &&
    String(patch.occupancy ?? "").trim() !== String(form.occupancy ?? "").trim();
  if (occupancyChanged) {
    // First-time flags + established-primary are re-derived for the new occupancy below.
    Object.assign(extra, {
      firstTimeHomebuyer: "",
      firstTimeInvestor: "",
      establishedPrimaryRes: "",
    });
    // Capacity: clear ONLY what the new occupancy invalidates. Doc Type / Doc
    // Timeframe / DTI survive Primary↔Investment — they stay valid on the income
    // path; choosing DSCR at the income-path fork clears them then.
    const nextOcc = String(patch.occupancy ?? "").trim();
    if (nextOcc !== "Investment Property") {
      Object.assign(extra, { investmentIncomePath: "", dscr: "", rentalType: "" });
      if (String(form.documentationType ?? "").trim() === "DSCR") {
        // The DSCR sentinel doc type can't carry over to an income-doc occupancy.
        Object.assign(extra, { documentationType: "", documentationTimeframe: "" });
      }
    }
  }
  // Doc-type change → drop any stale timeframe; only the 6 timeframe doc types re-ask it
  // (asset / WVOE default to 24 month in the pricing mapping).
  if (qId === "documentationType") {
    const nextDoc = (patch.documentationType ?? form.documentationType ?? "").trim();
    if (!DOC_TIMEFRAME_DOC_TYPES.has(nextDoc)) extra.documentationTimeframe = "";
  }
  if (SCENARIO_FIRST_TIME_TRIGGER_FIELDS.has(qId)) {
    const merged = { ...form, ...patch, ...extra } as WizardForm;
    const fthb = patchFirstTimeHomebuyerForScenario(merged);
    if (fthb) Object.assign(extra, fthb);
    const fti = patchFirstTimeInvestorForScenario(merged);
    if (fti) Object.assign(extra, fti);
  }
  if (PURPOSE_LIEN_CASCADE_IDS.has(qId)) {
    Object.assign(extra, lienDetailsCascadePatch(qId, form, { ...patch, ...extra }));
  }
  // Product prefs survive purpose changes — a rate-type/term preference isn't
  // invalidated by purchase↔refi, and resetting them re-asked IO / Rate Type /
  // Loan Term on every restructure.
  return extra as Partial<WizardForm>;
}

/** Map a wizard form field key OR a snake_case slot id to the FORM_CHAT_QUESTIONS id that owns it. */
export function resolveFormChatEditQuestionId(fieldKey: string): string {
  // Sidebar slot edits pass snake_case slot ids (property_state, investment_income_path, …).
  const resolved = FIELD_BY_SLOT[fieldKey] ?? fieldKey;
  if (FORM_CHAT_QUESTIONS.some((q) => q.id === resolved)) return resolved;
  const FIELD_TO_QUESTION_ID: Record<string, string> = {
    primaryLoanPurpose: "loanPurpose",
    valueSalesPrice: "valueLoanLtv",
    loanAmount: "valueLoanLtv",
    ltv: "valueLoanLtv",
    cltv: "valueLoanLtv",
    existingFirstLien: "valueLoanLtv",
    existingSecondLien: "valueLoanLtv",
    existingSecondLienBalance: "valueLoanLtv",
    cashInHandRequest: "valueLoanLtv",
    helocInitialDraw: "valueLoanLtv",
    stateCity: "stateGeoFollowup",
    stateBorough: "stateGeoFollowup",
    stateZipCode: "stateGeoFollowup",
    isInPhiladelphia: "stateGeoFollowup",
    isInBaltimoreCity: "stateGeoFollowup",
    isInIndianapolis: "stateGeoFollowup",
    isInMemphis: "stateGeoFollowup",
    isInLubbock: "stateGeoFollowup",
    nonOccupantCoBorrower: "nonOccupantCoBorrower",
    noCbRelationship: "noCbRelationship",
    noCbFico: "noCbRelationship",
    noCbIncome: "noCbRelationship",
    combinedDti: "combinedDti",
    householdSize: "householdSize",
    monthlyResidualIncome: "monthlyResidualIncome",
  };
  return FIELD_TO_QUESTION_ID[resolved] ?? resolved;
}

function clearFieldsForQuestion(qId: string, target: Record<string, unknown>): void {
  if (qId === "creditEvents" || qId === "hasCreditEvent") {
    target.hasCreditEvent = "";
    target.creditEvents = [];
    target.creditEventYears = {};
    target.creditEventDates = {};
  } else if (qId === "valueLoanLtv") {
    applyLoanDetailsFieldClear(target);
  } else if (qId === "state") {
    for (const k of geoSubFieldKeys()) target[k] = "";
  } else if (qId === "stateGeoFollowup") {
    // Follow-up sub-fields only — county is owned by the county_search question
    // and must survive follow-up invalidation.
    for (const k of geoSubFieldKeys()) {
      if (k !== "stateCounty") target[k] = "";
    }
  } else if (qId === "nonOccupantCoBorrower") {
    target.nonOccupantCoBorrower = "";
    target.noCbRelationship = "";
    target.noCbFico = "";
    target.noCbIncome = "";
    target.combinedDti = "";
  } else if (qId === "noCbRelationship") {
    target.noCbRelationship = "";
    target.noCbFico = "";
    target.noCbIncome = "";
    target.combinedDti = "";
  } else if (qId === "combinedDti") {
    target.combinedDti = "";
  } else if (qId === "householdSize") {
    target.householdSize = "";
    target.monthlyResidualIncome = "";
  } else if (qId === "monthlyResidualIncome") {
    target.monthlyResidualIncome = "";
  } else if (
    qId === "dtiCapacityExtras" ||
    qId === "nocbCapacity" ||
    qId === "residualIncomeCheck"
  ) {
    target.nonOccupantCoBorrower = "";
    target.noCbRelationship = "";
    target.noCbFico = "";
    target.noCbIncome = "";
    target.combinedDti = "";
    target.householdSize = "";
    target.monthlyResidualIncome = "";
  } else {
    target[qId] = "";
  }
}

function questionStillValidAfterEdit(qq: FormChatQuestion, f: WizardForm): boolean {
  if (qq.special === "county_search") {
    // Pending county (state set, county empty) is still valid — not a stale answer.
    return !!f.state.trim();
  }
  if (qq.special === "geo_followup") {
    // No follow-ups for this state → nothing can be stale here. (Most states have
    // none; returning false used to wipe county + geo on EVERY edit.)
    if (!f.state.trim() || !f.stateCounty.trim() || !countyNeedsGeoFollowUp(f.state, f.stateCounty))
      return true;
    // Sub-answers without a county are orphaned; a pending/partial follow-up is
    // NOT stale — keep what the user already gave.
    return !!f.stateCounty.trim();
  }
  if (qq.showIf && !qq.showIf(f)) return false;
  if (!qq.special && qq.kind === "enum") {
    const val = (f as Record<string, unknown>)[qq.id];
    if (typeof val === "string" && val && !optionsFor(f, qq).some((o) => o.value === val))
      return false;
  }
  return true;
}

/**
 * Downstream field clears when an upstream answer changes (occupancy, state, purpose, etc.).
 * Shared by /form in-place edits and /chat sidebar edits.
 */
export function buildCascadePatchForFormEdit(
  form: WizardForm,
  fieldKey: string,
  patch: Partial<WizardForm>,
): Partial<WizardForm> {
  const qId = resolveFormChatEditQuestionId(fieldKey);

  // Changed-detection FIRST — cascades fire only on a genuine value change, so
  // re-saving the same answer (or the extractor re-emitting it) never wipes
  // downstream fields the user already provided.
  const prevState = String(form.state ?? "").trim();
  const nextState = String((patch as Record<string, unknown>).state ?? form.state ?? "").trim();
  const stateChanged = qId === "state" && nextState !== prevState;
  const prevCounty = String(form.stateCounty ?? "").trim();
  const nextCounty = String((patch as Record<string, unknown>).stateCounty ?? "").trim();
  const countyChanged = qId === "stateCounty" && nextCounty !== prevCounty;
  const incomePathChanged =
    qId === "investmentIncomePath" &&
    String((patch as Record<string, unknown>).investmentIncomePath ?? "").trim() !==
      String(form.investmentIncomePath ?? "").trim();

  const extra: Record<string, unknown> = {
    ...formChatScenarioCascadePatch(qId, form, patch),
  };
  if (incomePathChanged) {
    // Clear only the losing side of the income-vs-DSCR fork; a pending fork ("")
    // keeps both sides and the visibility sweep below prunes whatever hides.
    const nextPath = String((patch as Record<string, unknown>).investmentIncomePath ?? "").trim();
    if (nextPath === "dscr") {
      Object.assign(extra, { documentationType: "", documentationTimeframe: "", estimatedDti: "" });
    } else if (nextPath === "income") {
      Object.assign(extra, { dscr: "", rentalType: "" });
    }
  }
  if (stateChanged) {
    Object.assign(extra, locationCascadeClearPatch(nextState));
  }
  if (countyChanged) {
    Object.assign(extra, clearGeoFollowupFieldsPatch());
    if (nextCounty) Object.assign(extra, inferGeoFollowupsFromCounty(form.state, nextCounty));
  }

  const merged0 = { ...form, ...patch, ...extra } as WizardForm;
  const clearPatch: Record<string, unknown> = {};

  const purposeChanged =
    (qId === "loanPurpose" || qId === "primaryLoanPurpose") &&
    primaryLoanPurposeChanged(form, { ...patch, ...extra });
  const lienPositionChanged =
    qId === "lienPosition" &&
    String(patch.lienPosition ?? "").trim() !== String(form.lienPosition ?? "").trim();

  for (const qq of FORM_CHAT_QUESTIONS) {
    // Clear ONLY when THIS edit invalidated the question (visible/valid before,
    // not after). A question that was already hidden can still hold a legitimate
    // value — captured inline (cash-out amount, first-lien balance in the Loan
    // Details group), hardcoded (FTHB on refi), or extractor-filled — and wiping
    // it here silently emptied half the profile on unrelated sidebar edits.
    if (!questionStillValidAfterEdit(qq, merged0) && questionStillValidAfterEdit(qq, form)) {
      clearFieldsForQuestion(qq.id, clearPatch);
    }
    if (purposeChanged && (qq.id === "lienPosition" || qq.id === "secondLienProduct")) {
      clearFieldsForQuestion(qq.id, clearPatch);
    }
    // Product prefs survive purpose/lien changes — a rate-type or term preference
    // isn't invalidated by switching purchase↔refi (resetting them re-asked IO /
    // Rate Type / Loan Term on every restructure).
  }

  const triangleQ = FORM_CHAT_QUESTIONS.find((x) => x.id === "valueLoanLtv");
  if (PURPOSE_LIEN_CASCADE_IDS.has(qId) && triangleQ) {
    if (purposeChanged || lienPositionChanged || !isAnswered(merged0, triangleQ)) {
      applyLoanDetailsFieldClear(clearPatch);
    }
  }

  if (stateChanged) {
    for (const locId of LOCATION_DOWNSTREAM_Q_IDS) {
      clearFieldsForQuestion(locId, clearPatch);
    }
  }
  if (countyChanged) {
    clearFieldsForQuestion("stateGeoFollowup", clearPatch);
  }

  return { ...extra, ...clearPatch } as Partial<WizardForm>;
}
