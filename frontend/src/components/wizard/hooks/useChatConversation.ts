/**
 * useChatConversation — turn handler for the prose-first /chat overhaul.
 *
 * Owns the conversational turn loop on the CLIENT (the server /api/intake planner is
 * retired for chat). Each user turn:
 *   1. Field extraction via the stateless `/api/intake/extract` (reuses the intake
 *      Extractor), merged into the shared wizard `form` through `portfolioToFormPatch`.
 *   2. The closing recap step reuses the form's extract→summarize→keep implementation
 *      (`extractScenarioNotes`) AND accepts "change X to Y" corrections.
 *   3. `advanceChatModeNext` (lib/chatConversation) decides the next ask's format
 *      from the five-format cadence (docs/CHAT.md).
 *
 * It patches the same `form`/`setForm` the wizard owns, so the lien/purpose/LTV cascade
 * effects keep working, and the post-results edit → dirty → Resubmit loop is reused as-is.
 *
 * Inferred/ambiguous values are queued (`reinforceQueueRef`) and confirmed one at a time
 * before the next question. A question that fails to extract 3 times is skipped: fields
 * with a `safeDefault` get the default applied (editable from the sidebar); others are
 * deferred and re-asked once at the end inside a summary card (2-strike guard).
 */
import { useCallback, useRef, useState } from "react";

import type { WizardForm } from "@/components/LoanWizard";
import {
  adjustCreditEventPatch,
  advanceChatModeNext,
  changedRowsFromPatch,
  CHAT_ASK_FORMATS,
  chatCreditEventsPrompt,
  chatFieldCaptureLabel,
  chatStockTakeLine,
  summaryProgressLine,
  contextAwareParse,
  CONVERSATIONAL_PROMPTS,
  creditEventTimingPatch,
  dropRowsShownAsChanges,
  mergeCapturedRows,
  missingChatQuestions,
  quickParseCaptureFields,
  nextUntimedCreditEvent,
  parseCreditEventTimingReply,
  OPTIONAL_CHAT_INTRO,
  PRE_SUBMIT_ASSISTANT_TEXT,
  RECAP_INVITE,
  SUMMARY_ASK_INVITE,
  themeOf,
  type DispatcherState,
} from "@/lib/chatConversation";
import { intakeAssist, intakeExtract, intakeFrame } from "@/lib/chatIntakeApi";
import { CREDIT_EVENT_YEAR_BUCKETS } from "@/lib/creditEventTiming";
import {
  BK_TYPE_OPTS,
  bkCodeFromFreeText,
  CREDIT_EVENT_BK_GENERIC,
  CREDIT_EVENT_NONE,
  CREDIT_EVENT_SELECT_OPTS,
  creditEventLabel,
  creditEventSidebarLabel,
  FORM_CHAT_LOAN_TERM_NO_PREF,
  FORM_CHAT_PRODUCT_PREF_IDS,
  FORM_CHAT_QUESTIONS,
  chatAnswerFormPatch,
  formChatProductPrefOptions,
  parseLoanTermChatReply,
  isFormChatProductPrefQuestion,
  isFormChatSkipMessage,
  isNoProductPreference,
  mandatoryComplete,
  isStructuredPendingQuestion,
  nextRequiredGeoField,
  optionsFor,
  portfolioSlotForFormField,
  productPrefOptionsFooterHint,
  resolveFormChatPrompt,
  resolveIntakeTargetSlot,
  type FormChatQuestion,
} from "@/lib/formChatFlow";
import { EXISTING_SECOND_LIEN_NONE } from "@/lib/nqmIntegratedForm";
import { portfolioSnapshotToFormPatch, portfolioToFormPatch } from "@/lib/portfolioToFormPatch";
import { fetchCountiesForState, normalizeCountyName } from "@/lib/stateGeoFollowUp";
import { extractScenarioNotes } from "@/lib/scenarioNotesExtract";
import { buildProfileSections } from "@/components/wizard/loanWizardProfileSections";

/**
 * Prose asks for rate-type and IO preferences — a line of context plus the options
 * inline (user spec: conversational, not a bare "Rate type preference?"). Loan term
 * stays a multi-select card; these two parse typed replies and fall back to the
 * clickable card if the reply doesn't resolve.
 */
const PREF_PROSE_ASKS: Record<string, string> = {
  rateTypePref:
    "Fixed keeps the same rate and payment for the life of the loan, while an ARM starts lower and adjusts after the intro period.\n\nQ. Any rate-type preference — Fixed, Adjustable (ARM), or no preference?",
  interestOnlyPref:
    "Interest-only keeps early payments lower since principal comes later; fully amortizing pays the balance down from day one.\n\nQ. Any Interest-Only preference — yes (I/O), no (fully amortizing), or no preference?",
};

/**
 * Opening-turn preamble after the brain-dump summary card. Tone scales with how much
 * the dump actually captured: "making progress / already narrowed" only when more
 * than BRAINDUMP_RICH_MIN fields landed; a humbler "that's a start" otherwise.
 */
const BRAINDUMP_RICH_MIN = 5;
const BRAINDUMP_PREAMBLES_RICH = [
  "Great, we're making progress. Based on what you've shared, we've already narrowed the list of matching programs. To finalize the shortlist, I need a few more details.",
  "Excellent — that covers a lot of ground. The list of matching programs is already taking shape; a few more details will finalize the shortlist.",
  "Nice, that gives us plenty to work with. We've already narrowed the field of matching programs — just a few more details to finalize the shortlist.",
];
const BRAINDUMP_PREAMBLES_LIGHT = [
  "That's a start. As you share more details, I'll narrow down the list of matching programs.",
  "Good — that gets us going. Each detail you add helps me narrow the list of matching programs.",
  "Thanks, noted. The more you share, the tighter I can make the list of matching programs.",
];

function braindumpPreamble(capturedCount: number): string {
  const pool =
    capturedCount > BRAINDUMP_RICH_MIN ? BRAINDUMP_PREAMBLES_RICH : BRAINDUMP_PREAMBLES_LIGHT;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Opening-turn nudge when the very first message is off-topic / abuse / junk (no scenario
 * captured yet). We do NOT jump into the first question — instead, one combined message
 * that steers them to describe the scenario in their own words, and intake picks up from there.
 */
const SCENARIO_DESCRIBE_INVITE =
  "To make this easy, just describe your scenario in a sentence or two — for example: " +
  "“Purchase of a single-family home in Florida, $720K loan at 80% LTV, 720 FICO, full doc.” " +
  "I’ll take it from there.";

const AFFIRM_RE =
  /^(?:yes|yep|yeah|yup|y|correct|right|confirm(?:ed)?|ok(?:ay)?|looks good|that'?s right|sure|👍)\b/i;

/** Replies that mean "nothing to change / keep going" on the summary + recap steps. */
const CONTINUE_RE = /^(?:nothing|none|continue|keep going|all good|no changes?|looks good)\b/i;

/** A removal/drop command (e.g. "remove Ch7-Disch and Foreclosure"). */
const REMOVAL_VERB_RE = /\b(remove|delete|drop|get rid of|getting rid of|take out|exclude)\b/i;

/** Looks like an edit COMMAND (vs a genuine free-text scenario note) at the recap. */
const EDIT_COMMAND_RE =
  /\b(change|update|set|switch|correct|edit|fix|modif|make it|increase|decrease|lower|raise|adjust|remove|delete|drop)\b/i;

/** Credit-event vocabulary — used to detect a removal aimed at credit events that matched nothing. */
const CREDIT_KEYWORDS_RE =
  /\b(bankruptc|bk|foreclosure|short\s*sale|deed.?in.?lieu|charge.?off|notice of default|loan mod|modification|forbearance|deferral|ch\.?\s*7|ch\.?\s*13|chapter\s*(?:7|13)|credit event)\b/i;

function normForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens that identify a credit-event code in free text (label, sidebar label, keywords). */
function creditEventMatchTokens(code: string): string[] {
  const toks = [normForMatch(creditEventLabel(code)), normForMatch(creditEventSidebarLabel(code))];
  if (code.startsWith("BK")) toks.push("bankruptcy", "bk");
  const kw: Record<string, string[]> = {
    FC: ["foreclosure"],
    SS: ["short sale"],
    DIL: ["deed in lieu", "dil"],
    "Pre-FC": ["pre foreclosure"],
    "Charge-Off": ["charge off", "chargeoff"],
    NOD: ["notice of default"],
    Mod: ["loan modification", "modification", "loan mod"],
    Forbearance: ["forbearance"],
    Deferral: ["deferral"],
  };
  if (kw[code]) toks.push(...kw[code]);
  return [...new Set(toks.filter(Boolean))];
}

/** A bare "reset / start over" command — wipes the scenario and restarts intake. */
const RESET_COMMAND_RE =
  /^\s*(reset|start over|start again|restart|clear (?:everything|all|it))\b/i;

/**
 * Cross-field conflict registry: a new input that's invalid GIVEN prior inputs.
 * Returns a plain-language reason (or null). DSCR↔occupancy is handled separately with a
 * tailored fix; these are the "no clean auto-fix — reset or continue" conflicts. Extend by
 * adding a rule: a regex on the raw text + a predicate on the already-captured form.
 */
function detectInputConflict(raw: string, form: WizardForm): string | null {
  const isSecondLien = String(form.isSecondLien ?? "").toLowerCase() === "yes";
  const purpose = String(form.primaryLoanPurpose || form.loanPurpose || "");

  // HELOC / HELOAN is a second-lien product, but the scenario is a first lien.
  if (
    /\b(heloc|heloan|home equity (?:line|loan)|second lien)\b/i.test(raw) &&
    form.isSecondLien &&
    !isSecondLien
  ) {
    return "A HELOC / HELOAN is a second-lien product, but this scenario is set to a first lien.";
  }
  // Cash-out is a refinance feature, but the loan purpose is a purchase.
  if (/\bcash[\s-]?out\b/i.test(raw) && /purchase/i.test(purpose)) {
    return "Cash-out is a refinance feature, but the loan purpose here is Purchase.";
  }
  return null;
}

/** Which of the borrower's current credit-event codes the removal text refers to. */
function creditEventsToRemove(raw: string, codes: readonly string[]): string[] {
  const hay = normForMatch(raw);
  return codes.filter((code) => creditEventMatchTokens(code).some((t) => hay.includes(t)));
}

/**
 * Looser match for an EDIT target (timing/type change) — also accepts bare "ch7"/"ch13"
 * (removal stays strict to avoid dropping the wrong chapter; edits ask when ambiguous).
 */
function creditEventEditMatch(raw: string, codes: readonly string[]): string[] {
  const hay = normForMatch(raw);
  return codes.filter((code) => {
    const toks = creditEventMatchTokens(code);
    if (code.includes("Ch7")) toks.push("ch7", "ch 7", "chapter 7");
    if (code.includes("Ch13")) toks.push("ch13", "ch 13", "chapter 13");
    return toks.some((t) => hay.includes(normForMatch(t)));
  });
}

/** New seasoning value from a timing-change phrase — prefers the part after "to". */
function parseTimingChange(raw: string): string | null {
  const toMatch = raw.match(/\bto\b(.*)$/i);
  const seg = (toMatch ? toMatch[1] : raw).trim();
  const segNorm = normForMatch(seg);
  for (const b of CREDIT_EVENT_YEAR_BUCKETS) {
    if (segNorm.includes(normForMatch(b))) return b;
  }
  const parsed = parseCreditEventTimingReply(seg);
  return parsed?.date ?? parsed?.bucket ?? null;
}

/** Re-key one credit-event code → another (e.g. Ch7 Discharged → Dismissed), moving its timing. */
function rekeyCreditEventPatch(
  form: WizardForm,
  oldCode: string,
  newCode: string,
): Partial<WizardForm> {
  const events = (form.creditEvents ?? []).map((c) => (c === oldCode ? newCode : c));
  const years = { ...(form.creditEventYears ?? {}) };
  const dates = { ...(form.creditEventDates ?? {}) };
  if (years[oldCode] != null) {
    years[newCode] = years[oldCode];
    delete years[oldCode];
  }
  if (dates[oldCode] != null) {
    dates[newCode] = dates[oldCode];
    delete dates[oldCode];
  }
  return {
    creditEvents: [...new Set(events)],
    creditEventYears: years,
    creditEventDates: dates,
    creditEventType: creditEventLabel(newCode),
  } as Partial<WizardForm>;
}

/**
 * Parse a prose loan-preference edit (rate type / IO / term) into a canonical form patch.
 * The Extractor is unreliable here, so map keywords directly (term parsed by the shared
 * loan-term reply parser). Returns {} when nothing matched.
 */
function tryLoanPrefPatch(raw: string, form: WizardForm): Partial<WizardForm> {
  const lc = raw.toLowerCase();
  let out: Partial<WizardForm> = {};
  if (/\b\d{1,2}\s*(?:year|yr)\b/.test(lc)) {
    const q = FORM_CHAT_QUESTIONS.find((x) => x.id === "loanTerm");
    const parsed = q ? parseLoanTermChatReply(raw, formChatProductPrefOptions(q)) : "";
    if (parsed && parsed !== FORM_CHAT_LOAN_TERM_NO_PREF) {
      out = { ...out, ...chatAnswerFormPatch(form, "loanTerm", parsed) };
    }
  }
  if (!("loanTerm" in out)) {
    if (/\b(arm|adjustable)\b/.test(lc)) {
      out = { ...out, ...chatAnswerFormPatch(form, "rateTypePref", "Adjustable-Rate") };
    } else if (/\bfixed\b/.test(lc) && !/fixed\s+income/.test(lc)) {
      out = { ...out, ...chatAnswerFormPatch(form, "rateTypePref", "Fixed") };
    }
  }
  if (/\binterest[\s-]?only\b|\bi\/o\b/.test(lc)) {
    out = { ...out, ...chatAnswerFormPatch(form, "interestOnlyPref", "Yes") };
  } else if (/fully\s*amortiz|amortizing|not\s+interest[\s-]?only/.test(lc)) {
    out = { ...out, ...chatAnswerFormPatch(form, "interestOnlyPref", "No") };
  }
  return out;
}

function chatOptionsPayload(
  form: WizardForm,
  q: FormChatQuestion,
  opts?: { fallback?: boolean; optionalIntro?: boolean },
) {
  const pref = isFormChatProductPrefQuestion(q);
  let prompt = resolveFormChatPrompt(form, q);
  if (opts?.optionalIntro) {
    prompt = `${OPTIONAL_CHAT_INTRO}\n\n${prompt}`;
  }
  const options = (pref ? formChatProductPrefOptions(q) : optionsFor(form, q)).map((o) => ({
    value: o.value,
    label: o.label,
  }));
  return {
    questionId: q.id,
    prompt,
    options,
    footerHint: pref ? productPrefOptionsFooterHint(q) : undefined,
    multiSelect: q.id === "loanTerm",
    fallback: opts?.fallback ?? false,
  };
}

function maybeOptionalIntro(state: DispatcherState, q: FormChatQuestion | undefined): boolean {
  if (!q || q.priority !== "optional" || state.optionalIntroShown) return false;
  state.optionalIntroShown = true;
  return true;
}

/**
 * Phase-2 framing agent (plan §7): /api/intake/frame phrases combo + summary asks.
 * Opt-out via VITE_CHAT_FRAMING_LLM=0. Hard-capped per session; hard-coded variant
 * templates remain the instant fallback on timeout/error.
 */
const FRAMING_LLM_ENABLED =
  ((import.meta.env?.VITE_CHAT_FRAMING_LLM as string | undefined) ?? "1") !== "0";
const FRAMING_LLM_MAX_PER_SESSION = 3;

/** A queued confirmation for an inferred or ambiguous value (asked before the next question). */
type Reinforcement = {
  slot: string;
  label: string;
  value?: string;
  phrase?: string;
  candidates?: string[];
};

/** Confirm prompt — offers the candidates / expected value and invites a free-entry correction. */
function reinforcementText(item: Reinforcement): string {
  if (item.candidates?.length) {
    return `Quick check on ${item.label.toLowerCase()} — did you mean ${item.candidates.join(
      " or ",
    )}? Reply with one, or type the correct value.`;
  }
  const from = item.phrase ? ` from “${item.phrase}”` : "";
  return `Quick check — I read ${item.label} as ${item.value}${from}. Reply “yes” to confirm, or type the correct ${item.label.toLowerCase()}.`;
}

/** Chapter already known for a pending generic BK ("7" / "13" / null) — narrows the ask. */
function bkChapterHint(form: WizardForm): "7" | "13" | null {
  const t = String(form.creditEventType ?? "");
  if (/13/.test(t)) return "13";
  if (/7/.test(t)) return "7";
  return null;
}

/**
 * Resolve a generic "BK" pick to its chapter/status code — re-keys timing already
 * captured under "BK" so an inline "7 years back" survives the resolution.
 */
function rekeyGenericBkPatch(form: WizardForm, code: string, label: string): Partial<WizardForm> {
  const events = (form.creditEvents ?? []).map((c) => (c === CREDIT_EVENT_BK_GENERIC ? code : c));
  const years = { ...(form.creditEventYears ?? {}) };
  const dates = { ...(form.creditEventDates ?? {}) };
  if (years[CREDIT_EVENT_BK_GENERIC] != null) {
    years[code] = years[CREDIT_EVENT_BK_GENERIC];
    delete years[CREDIT_EVENT_BK_GENERIC];
  }
  if (dates[CREDIT_EVENT_BK_GENERIC] != null) {
    dates[code] = dates[CREDIT_EVENT_BK_GENERIC];
    delete dates[CREDIT_EVENT_BK_GENERIC];
  }
  return {
    creditEvents: [...new Set(events)],
    creditEventYears: years,
    creditEventDates: dates,
    creditEventCategory: "BK",
    creditEventType: label,
  } as Partial<WizardForm>;
}

/** Captured-value sections for the CHAT_SUMMARY_ASK / CHAT_RECAP cards (sidebar-aligned). */
function recapSections(
  form: WizardForm,
): Array<{ title: string; rows: Array<{ label: string; value: string }> }> {
  return buildProfileSections(form, 5)
    .map((s) => ({
      title: s.title,
      rows: s.rows
        .filter((r) => !r.missing && r.value.trim())
        .map((r) => ({ label: r.label, value: r.value })),
    }))
    .filter((s) => s.rows.length > 0);
}

export type UseChatConversationDeps = {
  apiBase: string;
  mode: "lo" | "underwriter";
  formSyncRef: React.RefObject<WizardForm>;
  setForm: (updater: (prev: WizardForm) => WizardForm) => void;
  triggerQuickEligibilityScan: () => void;
  /** Push extracted scenario notes into the sidebar Session Notes. */
  applyScenarioNotesDelta: (raw: unknown[]) => void;
  appendUserChat: (content: string) => void;
  appendAssistantChat: (content: string, opts?: { preSubmitOpensGate?: boolean }) => void;
  setLoading: (v: boolean) => void;
  /** Fires when intake is complete and eligibility should run (chat mode). */
  onIntakeReady?: () => void;
  /** Reset the whole scenario (used by the "reset" command / invalid-input recovery). */
  onResetScenario?: () => void;
};

export function useChatConversation(deps: UseChatConversationDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  // snake_case working memory the Extractor reads back each turn (mirrors the old session).
  const portfolioRef = useRef<Record<string, unknown>>({});
  // Conversational asks already emitted (the bulk summary and recap step don't count).
  const turnRef = useRef(0);
  const pendingChatFieldRef = useRef<string | null>(null);
  const scenarioCapturedRef = useRef(false);
  // Captured-field count from the opening brain dump (0 = none pending); scales the preamble tone.
  const brainDumpCapturedRef = useRef(0);
  // Set when the user dismisses the end-of-intake optional batch with "Continue/Skip".
  const optionalsSkippedRef = useRef(false);
  /** Product prefs default to "No preference" — track explicit confirms in chat. */
  const productPrefConfirmedRef = useRef<Set<string>>(new Set());
  /** Notice-only prompts that need explicit chat acknowledgement. */
  const answeredQIdsRef = useRef<Set<string>>(new Set());
  const [productPrefConfirmed, setProductPrefConfirmed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** True once the closing recap is offered — Submit Profile gate (manual eligibility). */
  const [submitProfileGate, setSubmitProfileGate] = useState(false);
  // Inferred / ambiguous values awaiting confirmation — asked one at a time before advancing.
  const reinforceQueueRef = useRef<Reinforcement[]>([]);
  // Persistent cadence state — advanceChatModeNext mutates usedTemplates/lastFormats in place.
  const dispatcherRef = useRef<DispatcherState>({
    turn: 0,
    mode: deps.mode,
    usedTemplates: new Set(),
    lastFormats: [],
    asksSinceSummary: 0,
    optionalIntroShown: false,
  });
  /** 2-strike guard: failed-extraction count per pending question id. */
  const attemptsRef = useRef<Record<string, number>>({});
  /** Mandatory questions deferred by the 2-strike guard — re-asked once at the end. */
  const deferredRef = useRef<Set<string>>(new Set());
  /** Target slots of the last summary-question card (multi-slot extraction anchor). */
  const summarySlotsRef = useRef<string[]>([]);
  /** Framing-LLM calls used this session (≤ FRAMING_LLM_MAX_PER_SESSION). */
  const framingUsedRef = useRef(0);
  /** Last few assistant ask texts — passed to the framing agent for wording variety. */
  const recentAsksRef = useRef<string[]>([]);

  const mergeForm = useCallback((patch: Partial<WizardForm>) => {
    if (Object.keys(patch).length === 0) return;
    const d = depsRef.current;
    // Update formSyncRef SYNCHRONOUSLY (not just inside the setForm updater, which React only
    // runs on the next render). advance() and the inferences below read formSyncRef in the same
    // tick — a deferred ref write makes them see a stale form and re-ask the just-answered
    // question (e.g. lien position, whose optionsFn means the optimistic quick-parse is a no-op).
    const ref = d.formSyncRef as React.MutableRefObject<WizardForm>;
    ref.current = { ...ref.current, ...patch };
    d.setForm((s) => ({ ...s, ...patch }));
    // Mirror CLEARED fields into the extract portfolio. A stale slot (e.g. the old
    // county after a state change) would otherwise resurrect its value through the
    // every-turn snapshot sync, or mask the same value being re-extracted later.
    const cleared: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== "") continue;
      const slot = portfolioSlotForFormField(k);
      if (slot) cleared[slot] = "";
    }
    if (Object.keys(cleared).length > 0) {
      portfolioRef.current = { ...portfolioRef.current, ...cleared };
    }
  }, []);

  /**
   * Canonicalize a free-text extracted county against dim_county (MySQL) so the
   * profile matches the form's option values — "Palm beach county" → "Palm Beach
   * County". Fire-and-forget; applies only while the raw value is still current.
   */
  const canonicalizeCounty = useCallback(
    (state: string, raw: unknown) => {
      if (typeof raw !== "string") return;
      const q = raw.trim();
      const st = state.trim();
      if (!st || !q) return;
      void fetchCountiesForState(st, normalizeCountyName(q), 5)
        .then((rows) => {
          if (rows.length !== 1) return;
          const canonical = (rows[0].county_name ?? "").trim();
          if (!canonical || canonical === q) return;
          const d = depsRef.current;
          if (d.formSyncRef.current.stateCounty.trim() !== q) return; // superseded
          mergeForm({ stateCounty: canonical } as Partial<WizardForm>);
          portfolioRef.current = { ...portfolioRef.current, state_county: canonical };
        })
        .catch(() => {});
    },
    [mergeForm],
  );

  /**
   * Credit events — prose-first combined gate (user spec): one conversational ask
   * covers yes/no + the events ("say none, or tell me what happened and when");
   * the multi-select card opens only on demand ("yes" / "options" / "multiple")
   * or as the parse-fail fallback. BK chapter/status and per-event timing stay
   * as form-like cards.
   */
  const emitCreditEventsAsk = useCallback((opts: { selector?: boolean } = {}) => {
    const d = depsRef.current;
    const f = d.formSyncRef.current;
    const events = f.creditEvents ?? [];
    if (!f.hasCreditEvent.trim() || (f.hasCreditEvent === "Yes" && events.length === 0)) {
      pendingChatFieldRef.current = "creditEvents";
      if (opts.selector) {
        d.appendAssistantChat(
          `CHAT_CREDIT_EVENTS:${JSON.stringify({
            mode: "select",
            prompt: "Pick everything that applies — or None.",
            options: [
              { value: CREDIT_EVENT_NONE, label: "None — clean history" },
              ...CREDIT_EVENT_SELECT_OPTS,
            ],
          })}`,
        );
      } else {
        d.appendAssistantChat(
          "Any prior credit events — bankruptcy, foreclosure, short sale, deed-in-lieu, modification…? Seasoning on these decides which programs stay in play. Say none if it's clean, or tell me what happened and roughly when — several events in one message is fine. (Say options to pick from the full list.)",
        );
      }
      return;
    }
    if (events.includes(CREDIT_EVENT_BK_GENERIC)) {
      pendingChatFieldRef.current = "creditEvents";
      d.appendAssistantChat(
        `CHAT_CREDIT_EVENTS:${JSON.stringify({
          mode: "bk_type",
          prompt: bkChapterHint(f)
            ? `Got it — Chapter ${bkChapterHint(f)} bankruptcy. Was it discharged or dismissed?`
            : "On the bankruptcy — which chapter was it, and was it discharged or dismissed?",
          options: bkChapterHint(f)
            ? BK_TYPE_OPTS.filter((o) => o.value.includes(`Ch${bkChapterHint(f)}`))
            : BK_TYPE_OPTS,
        })}`,
      );
      return;
    }
    const untimed = nextUntimedCreditEvent(f);
    if (untimed) {
      pendingChatFieldRef.current = "creditEvents";
      d.appendAssistantChat(
        `CHAT_CREDIT_EVENTS:${JSON.stringify({
          mode: "timing",
          prompt: chatCreditEventsPrompt(f),
          code: untimed,
          label: creditEventLabel(untimed),
          buckets: CREDIT_EVENT_YEAR_BUCKETS,
        })}`,
      );
    }
  }, []);

  /**
   * Same-turn credit follow-ups from free text: resolve a pending generic BK when
   * the chapter/status is in the reply, and attach a timing phrase ("7+ years ago")
   * to the first untimed event — so "BK Ch7 discharged 7 years back" never re-asks.
   */
  const applyCreditFollowupsFromText = useCallback(
    (raw: string, patch: Partial<WizardForm>) => {
      const d = depsRef.current;
      let acted = false;
      if ((d.formSyncRef.current.creditEvents ?? []).includes(CREDIT_EVENT_BK_GENERIC)) {
        const code =
          bkCodeFromFreeText(raw) ??
          bkCodeFromFreeText(String((patch as Record<string, unknown>).creditEventType ?? ""));
        if (code) {
          mergeForm(rekeyGenericBkPatch(d.formSyncRef.current, code, creditEventLabel(code)));
          acted = true;
        }
      }
      const touchedCredit =
        pendingChatFieldRef.current === "creditEvents" ||
        (patch as Record<string, unknown>).creditEvents != null ||
        (patch as Record<string, unknown>).creditEventCategory != null;
      const untimed = nextUntimedCreditEvent(d.formSyncRef.current);
      if (untimed && touchedCredit) {
        const t = parseCreditEventTimingReply(raw);
        const tv = t?.date ?? t?.bucket;
        if (tv) {
          mergeForm(creditEventTimingPatch(d.formSyncRef.current, untimed, tv));
          acted = true;
        }
      }
      return acted;
    },
    [mergeForm],
  );

  const markProductPrefConfirmed = useCallback((fieldId: string | null | undefined) => {
    if (!fieldId) return;
    const q = FORM_CHAT_QUESTIONS.find((x) => x.id === fieldId);
    if (q && isFormChatProductPrefQuestion(q)) {
      productPrefConfirmedRef.current.add(fieldId);
      setProductPrefConfirmed(new Set(productPrefConfirmedRef.current));
    }
  }, []);

  /** Same capture echo as typed turns — clicked answers show the identical pill card. */
  const echoCaptured = useCallback(
    (
      formBefore: WizardForm,
      patch: Partial<WizardForm>,
      row: { label: string | null; value: string },
    ) => {
      const d = depsRef.current;
      const changes = changedRowsFromPatch(formBefore, patch);
      const captured = dropRowsShownAsChanges(
        row.label ? [{ label: row.label, value: row.value }] : [],
        changes,
      );
      if (captured.length > 0 || changes.length > 0) {
        d.appendAssistantChat(`CHAT_CAPTURED:${JSON.stringify({ captured, changes })}`);
      }
    },
    [],
  );

  /** Mark any product pref the extractor filled mid-stream as explicitly confirmed. */
  const syncProductPrefsFromForm = useCallback(() => {
    const form = depsRef.current.formSyncRef.current as unknown as Record<string, unknown>;
    for (const id of FORM_CHAT_PRODUCT_PREF_IDS) {
      const v = String(form[id] ?? "").trim();
      if (v && !isNoProductPreference(v)) markProductPrefConfirmed(id);
    }
  }, [markProductPrefConfirmed]);

  /** Compute the next ask and post it to the thread. */
  const advance = useCallback(async () => {
    const d = depsRef.current;
    let missing = missingChatQuestions(d.formSyncRef.current, d.mode, {
      productPrefConfirmed: productPrefConfirmedRef.current,
      answeredQIds: answeredQIdsRef.current,
    });
    if (optionalsSkippedRef.current) {
      missing = missing.filter(
        (q) => q.priority !== "optional" || isFormChatProductPrefQuestion(q),
      );
    }

    // 2-strike deferrals — held back until only they remain, then re-asked ONCE
    // inside a summary card (after that they re-enter the normal flow / block submit).
    const state = dispatcherRef.current;
    if (deferredRef.current.size > 0) {
      const nonDeferred = missing.filter((q) => !deferredRef.current.has(q.id));
      if (nonDeferred.length > 0) {
        missing = nonDeferred;
      } else if (missing.length > 0) {
        deferredRef.current = new Set();
        state.forceSummary = true;
      }
    }

    const pending = reinforceQueueRef.current[0];
    state.turn = turnRef.current;
    state.mode = d.mode;
    state.pendingReinforcement = pending
      ? { field: "reinforcement", text: reinforcementText(pending) }
      : null;
    state.scenarioCaptured = scenarioCapturedRef.current;
    state.form = d.formSyncRef.current;

    const decision = advanceChatModeNext(missing, state);

    pendingChatFieldRef.current = decision.pendingChatField;

    let text = decision.text;

    if (decision.format === "summary_question") {
      const captured = recapSections(d.formSyncRef.current).reduce((n, s) => n + s.rows.length, 0);
      text = summaryProgressLine(captured, decision.fields.length);
    } else if (
      FRAMING_LLM_ENABLED &&
      framingUsedRef.current < FRAMING_LLM_MAX_PER_SESSION &&
      decision.format === "combo_question"
    ) {
      // Phase-2 framing agent — combo asks only; summary uses deterministic input counts.
      framingUsedRef.current += 1;
      const framed = await intakeFrame(d.apiBase, {
        kind: "combo",
        questions: decision.fields.map((q) => q.prompt),
        whys: decision.fields.map((q) => CONVERSATIONAL_PROMPTS[q.id]?.why ?? "").filter(Boolean),
        lead: decision.lead,
        recent: recentAsksRef.current,
      });
      if (framed) text = framed;
    }

    if (
      brainDumpCapturedRef.current > 0 &&
      (decision.format === "why_question" || decision.format === "combo_question")
    ) {
      text = `${braindumpPreamble(brainDumpCapturedRef.current)}\n\n${text}`;
      brainDumpCapturedRef.current = 0;
    }

    if (CHAT_ASK_FORMATS.has(decision.format)) {
      turnRef.current += 1;
      recentAsksRef.current = [...recentAsksRef.current.slice(-3), text.slice(0, 200)];
    }

    // High-DTI notice is display-only: show it, mark acknowledged, and immediately
    // continue to the first real follow-up question in the same turn.
    if (decision.pendingChatField === "dtiCapacityNotice") {
      d.appendAssistantChat(text);
      answeredQIdsRef.current.add("dtiCapacityNotice");
      await advance();
      return decision;
    }

    // Credit events — always the form-like card flow (combined gate+events select,
    // BK chapter pick, per-event timing) instead of a prose yes/no march.
    if (
      decision.fields.length === 1 &&
      (decision.format === "why_question" || decision.format === "options_question") &&
      (decision.fields[0].id === "hasCreditEvent" || decision.fields[0].special === "credit_events")
    ) {
      emitCreditEventsAsk();
      return decision;
    }

    // Prose formats render as plain assistant bubbles; the rest carry a control payload
    // (the component renders a CTA / picker). Follows the app's message-prefix convention.
    if (decision.format === "options_question" && decision.fields.length === 1) {
      const q = decision.fields[0];
      // Product prefs — loan term gets the multi-select card; rate type and IO are
      // PROSE asks with a line of context and the options inline (user spec). Typed
      // replies parse; "no preference"/"skip" leaves the default; a failed parse
      // falls back to the clickable pref card.
      if (isFormChatProductPrefQuestion(q)) {
        pendingChatFieldRef.current = q.id;
        if (maybeOptionalIntro(state, q)) {
          d.appendAssistantChat(OPTIONAL_CHAT_INTRO);
        }
        const prose = PREF_PROSE_ASKS[q.id];
        if (prose) d.appendAssistantChat(prose);
        else d.appendAssistantChat(`CHAT_PRODUCT_PREF:${JSON.stringify({ questionId: q.id })}`);
        return decision;
      }
      // Plain enums — lettered CHAT_OPTIONS (not the heavy form cards).
      if (q.kind === "enum" && !q.special) {
        const opts = optionsFor(d.formSyncRef.current, q);
        if (opts.length > 0) {
          pendingChatFieldRef.current = q.id;
          d.appendAssistantChat(
            `CHAT_OPTIONS:${JSON.stringify(
              chatOptionsPayload(d.formSyncRef.current, q, {
                optionalIntro: maybeOptionalIntro(state, q),
              }),
            )}`,
          );
          return decision;
        }
      }
    }

    if (decision.format === "summary_question") {
      // ③ — captured-so-far + numbered remaining; reply is multi-slot extracted.
      summarySlotsRef.current = decision.fields
        .map((q) => resolveIntakeTargetSlot(d.formSyncRef.current, q.id))
        .filter((s): s is string => !!s);
      d.appendAssistantChat(
        `CHAT_SUMMARY_ASK:${JSON.stringify({
          text,
          captured: recapSections(d.formSyncRef.current),
          remaining: decision.fields.map((q, i) => ({ n: i + 1, prompt: q.prompt })),
          invite: SUMMARY_ASK_INVITE,
        })}`,
      );
    } else if (decision.format === "scenario") {
      // Closing recap — full captured picture + notes / change-anything invite.
      d.appendAssistantChat(
        `CHAT_RECAP:${JSON.stringify({
          text,
          sections: recapSections(d.formSyncRef.current),
          invite: RECAP_INVITE,
        })}`,
      );
    } else if (decision.format === "submit_profile") {
      const preText = text || PRE_SUBMIT_ASSISTANT_TEXT;
      d.appendAssistantChat(`CHAT_PRE_SUBMIT:${JSON.stringify({ text: preText })}`, {
        preSubmitOpensGate: true,
      });
    } else if (decision.format === "pre_submit") {
      d.appendAssistantChat(`CHAT_PRE_SUBMIT:${JSON.stringify({ text })}`);
    } else if (decision.format === "final") {
      d.appendAssistantChat(`CHAT_FINAL_CTA:${JSON.stringify({ text })}`);
    } else if (decision.format === "optional_batch") {
      let batchText = text;
      if (maybeOptionalIntro(state, decision.fields[0])) {
        batchText = `${OPTIONAL_CHAT_INTRO}\n\n${text}`;
      }
      d.appendAssistantChat(
        `CHAT_OPTIONAL_BATCH:${JSON.stringify({
          text: batchText,
          fields: decision.fields.map((q) => ({
            id: q.id,
            prompt: q.prompt,
          })),
        })}`,
      );
    } else if (decision.format === "confirm" && pending?.candidates?.length) {
      // Ambiguous clarification — render the candidates as clickable cards. A click sends the
      // candidate back through submitUserTurn, which resolves it via the reinforcement path.
      d.appendAssistantChat(
        `CHAT_CLARIFY:${JSON.stringify({ text, candidates: pending.candidates })}`,
      );
    } else {
      const geoFld =
        decision.pendingChatField === "geo_followup"
          ? nextRequiredGeoField(d.formSyncRef.current)
          : null;
      const countyQ = decision.fields[0];
      if (countyQ?.special === "county_search") {
        d.appendAssistantChat(
          `CHAT_COUNTY_SEARCH:${JSON.stringify({
            prompt: text,
            state: d.formSyncRef.current.state,
          })}`,
        );
      } else if (geoFld?.widget === "county_search") {
        d.appendAssistantChat(
          `CHAT_COUNTY_SEARCH:${JSON.stringify({
            prompt: text,
            state: d.formSyncRef.current.state,
          })}`,
        );
      } else {
        let out = text;
        if (maybeOptionalIntro(state, decision.fields[0])) {
          out = `${OPTIONAL_CHAT_INTRO}\n\n${text}`;
        }
        d.appendAssistantChat(out);
      }
    }
    return decision;
  }, [emitCreditEventsAsk]);

  /**
   * Re-ask the question currently pending — used after we answer/deflect an interjected
   * question so the user lands back on the SAME ask, without advancing the cadence or
   * burning a 2-strike attempt. Mirrors the first-failure form-fallback rendering; falls
   * back to the normal next ask when nothing specific is pending (e.g. the opening turn).
   */
  const reaskPending = useCallback(
    async (pendingQ: FormChatQuestion | undefined, lead: string) => {
      const d = depsRef.current;
      if (pendingQ?.special === "credit_events" || pendingQ?.id === "hasCreditEvent") {
        emitCreditEventsAsk();
        return;
      }
      if (pendingQ && isFormChatProductPrefQuestion(pendingQ)) {
        d.appendAssistantChat(`CHAT_PRODUCT_PREF:${JSON.stringify({ questionId: pendingQ.id })}`);
        return;
      }
      if (pendingQ?.kind === "enum" && !pendingQ.special) {
        const options = optionsFor(d.formSyncRef.current, pendingQ);
        if (options.length) {
          // NOT a parse failure — we just answered an interjected question. Use a clean
          // options card (fallback:false), prefixed with a connector so it reads as a
          // natural return to the pending question (not a "didn't catch that").
          const payload = chatOptionsPayload(d.formSyncRef.current, pendingQ, { fallback: false });
          payload.prompt = `${lead}${payload.prompt}`;
          d.appendAssistantChat(`CHAT_OPTIONS:${JSON.stringify(payload)}`);
          return;
        }
      }
      if (pendingQ) {
        const ask = resolveFormChatPrompt(d.formSyncRef.current, pendingQ);
        const hint = pendingQ.hint?.trim() ? ` (${pendingQ.hint.trim()})` : "";
        d.appendAssistantChat(`${lead}${ask}${hint}`);
        return;
      }
      await advance();
    },
    [advance, emitCreditEventsAsk],
  );

  const submitUserTurn = useCallback(
    async (text: string) => {
      const d = depsRef.current;
      const raw = text.trim();
      if (!raw) return;
      d.appendUserChat(raw);
      d.setLoading(true);
      try {
        // "reset" / "start over" — wipe the scenario and restart intake. (The reset clears
        // the thread itself, so no pre-reset message — the welcome reappears.)
        if (RESET_COMMAND_RE.test(raw)) {
          if (d.onResetScenario) {
            d.onResetScenario();
          } else {
            d.appendAssistantChat(
              "To start over, hit Reset at the top of the Mortgage Profile — or keep going and I'll work with your current inputs.",
            );
          }
          return;
        }

        // Invalid-input guard — a new input that conflicts with prior inputs (e.g. a HELOC on
        // a first lien, cash-out on a purchase). Don't silently apply it; explain and offer
        // reset-or-continue. (DSCR↔occupancy has its own tailored handling below.)
        const conflict = detectInputConflict(raw, d.formSyncRef.current);
        if (conflict) {
          d.appendAssistantChat(
            `${conflict} I haven't applied that — it doesn't fit your earlier inputs. Reply “reset” to start over, or just continue with your current inputs.`,
          );
          await advance();
          return;
        }

        // DSCR guard — DSCR qualifies on the property's rental cash flow, so it's an
        // INVESTMENT-property path only. If the user asks for DSCR while occupancy is a
        // Primary Residence / Second Home, the extractor silently drops it; instead, say
        // why (the rest of the turn still processes, so other valid fields are captured).
        let dscrHandled = false;
        {
          const occ = String(d.formSyncRef.current.occupancy ?? "").trim();
          if (/\bdscr\b/i.test(raw) && occ && !/investment/i.test(occ)) {
            d.appendAssistantChat(
              `DSCR loans qualify on the property's rental cash flow, so they're only available for investment properties — not a ${occ}. I'll keep this scenario on the income-documentation (DTI) path. If it's actually an investment property, just say so and I'll switch it to DSCR.`,
            );
            dscrHandled = true;
          }
        }

        // Credit-event removal (esp. at the recap) — "remove Ch7-Disch and Foreclosure".
        // Drop the named events, blank their timing, then re-offer the selector so the LO
        // can re-pick (the credit-event UI is a card flow, so prose-correction can't reach it).
        if (REMOVAL_VERB_RE.test(raw)) {
          const codes = (d.formSyncRef.current.creditEvents ?? []) as string[];
          const toRemove = creditEventsToRemove(raw, codes);
          if (toRemove.length > 0) {
            const fb = { ...d.formSyncRef.current };
            const remaining = codes.filter((c) => !toRemove.includes(c));
            const years = { ...(fb.creditEventYears ?? {}) };
            const dates = { ...(fb.creditEventDates ?? {}) };
            toRemove.forEach((c) => {
              delete years[c];
              delete dates[c];
            });
            const patch: Partial<WizardForm> = {
              creditEvents: remaining,
              creditEventYears: years,
              creditEventDates: dates,
            };
            if (remaining.length === 0) {
              patch.creditEventCategory = "";
              patch.creditEventType = "";
            }
            mergeForm(patch);
            d.triggerQuickEligibilityScan();
            d.appendAssistantChat(
              `Removed ${toRemove.map((c) => creditEventLabel(c)).join(" and ")}.`,
            );
            // Blank + re-ask: re-offer the full event list so they can re-pick (or None).
            pendingChatFieldRef.current = "creditEvents";
            d.appendAssistantChat(
              `CHAT_CREDIT_EVENTS:${JSON.stringify({
                mode: "select",
                prompt: "Pick everything that still applies — or None.",
                options: [
                  { value: CREDIT_EVENT_NONE, label: "None — clean history" },
                  ...CREDIT_EVENT_SELECT_OPTS,
                ],
              })}`,
            );
            return;
          }
          if (CREDIT_KEYWORDS_RE.test(raw)) {
            // A credit-event removal that matched none of the current events — say so
            // (don't silently file it as a scenario note).
            const have = codes.length ? codes.map((c) => creditEventLabel(c)).join(", ") : "none";
            d.appendAssistantChat(
              `I couldn't find that credit event to remove. Current credit events: ${have}. Tell me which one to drop.`,
            );
            return;
          }
          // Not a credit-event removal — fall through to normal processing.
        }

        // Display-only high-DTI notice: acknowledge internally and move straight to
        // the first follow-up question (NOCB / residual flow).
        if (pendingChatFieldRef.current === "dtiCapacityNotice") {
          answeredQIdsRef.current.add("dtiCapacityNotice");
          await advance();
          return;
        }

        // Reinforcement reply — confirm or correct a queued inferred/ambiguous value first.
        if (reinforceQueueRef.current.length > 0) {
          const item = reinforceQueueRef.current[0];
          if (!AFFIRM_RE.test(raw)) {
            // Not an affirmation → treat as a correction; re-extract weighting that slot.
            const cr = await intakeExtract(d.apiBase, {
              text: raw,
              portfolio: portfolioRef.current,
              last_target_slots: [item.slot],
              mode: d.mode,
            });
            portfolioRef.current = cr.portfolio ?? portfolioRef.current;
            mergeForm({
              ...portfolioSnapshotToFormPatch(cr.portfolio ?? {}),
              ...(portfolioToFormPatch(cr.extracted, {
                form: d.formSyncRef.current,
              }) as Partial<WizardForm>),
            });
            if (cr.scenario_notes_delta?.length) d.applyScenarioNotesDelta(cr.scenario_notes_delta);
            d.triggerQuickEligibilityScan();
          }
          reinforceQueueRef.current = reinforceQueueRef.current.slice(1);
          await advance();
          return;
        }

        // ③ summary-question reply — multi-slot extraction over the listed remaining fields.
        if (pendingChatFieldRef.current === "summary_ask") {
          const skip = isFormChatSkipMessage(raw) || CONTINUE_RE.test(raw) || AFFIRM_RE.test(raw);
          if (!skip) {
            const formBefore = { ...d.formSyncRef.current };
            const summaryQuick = summarySlotsRef.current.includes("noCbRelationship")
              ? contextAwareParse(raw, "noCbRelationship", formBefore)
              : {};
            const res = await intakeExtract(d.apiBase, {
              text: raw,
              portfolio: portfolioRef.current,
              mode: d.mode,
              last_target_slots: summarySlotsRef.current,
            });
            portfolioRef.current = res.portfolio ?? portfolioRef.current;
            const patch = adjustCreditEventPatch(d.formSyncRef.current, {
              ...portfolioSnapshotToFormPatch(res.portfolio ?? {}),
              ...(portfolioToFormPatch(res.extracted, {
                form: d.formSyncRef.current,
              }) as Partial<WizardForm>),
              ...(summaryQuick as Partial<WizardForm>),
            } as Partial<WizardForm>);
            mergeForm(patch);
            canonicalizeCounty(d.formSyncRef.current.state, patch.stateCounty);
            syncProductPrefsFromForm();
            if (res.scenario_notes_delta?.length)
              d.applyScenarioNotesDelta(res.scenario_notes_delta);
            d.triggerQuickEligibilityScan();
            const changes = changedRowsFromPatch(formBefore, patch);
            const captured = dropRowsShownAsChanges(
              mergeCapturedRows(res.captured ?? [], summaryQuick),
              changes,
            );
            const hadApplied = Object.entries(patch).some(([k, v]) => {
              if (typeof v !== "string") return false;
              const next = v.trim();
              if (!next) return false;
              const prev = String(
                (formBefore as unknown as Record<string, unknown>)[k] ?? "",
              ).trim();
              return prev !== next;
            });
            if (captured.length > 0 || changes.length > 0) {
              d.appendAssistantChat(`CHAT_CAPTURED:${JSON.stringify({ captured, changes })}`);
            } else if (hadApplied) {
              d.appendAssistantChat("Got it — captured that.");
            } else {
              d.appendAssistantChat(
                "I didn't catch any of those in that message — let's keep going one at a time.",
              );
            }
            // Queue inferred / ambiguous values to confirm before the next question.
            reinforceQueueRef.current = [
              ...(res.inferred ?? []).map((r) => ({
                slot: r.slot,
                label: r.label,
                value: r.value,
                phrase: r.phrase,
              })),
              ...(res.ambiguous ?? []).map((a) => ({
                slot: a.slot,
                label: a.label,
                candidates: a.candidates,
              })),
            ];
          }
          await advance();
          return;
        }

        // Closing recap — scenario notes AND "change X to Y" corrections before submit.
        if (pendingChatFieldRef.current === "scenarioNotes") {
          const skip = isFormChatSkipMessage(raw) || CONTINUE_RE.test(raw) || AFFIRM_RE.test(raw);
          if (!skip) {
            // Recap edits the Extractor can't reach: credit-event timing / BK chapter-status
            // change, and loan-preference (rate type / IO / term) changes. Handle these
            // deterministically before falling back to generic field extraction.
            const recapForm = d.formSyncRef.current;
            const ceCodes = (recapForm.creditEvents ?? []) as string[];
            if (ceCodes.length > 0 && CREDIT_KEYWORDS_RE.test(raw)) {
              // BK chapter/status re-key (e.g. "Ch7 was dismissed not discharged").
              const newBk = bkCodeFromFreeText(raw);
              const bks = ceCodes.filter((c) => c.startsWith("BK"));
              if (newBk && bks.length === 1 && bks[0] !== newBk && !ceCodes.includes(newBk)) {
                const oldBk = bks[0];
                mergeForm(rekeyCreditEventPatch(recapForm, oldBk, newBk));
                d.triggerQuickEligibilityScan();
                d.appendAssistantChat(
                  `CHAT_CAPTURED:${JSON.stringify({
                    captured: [],
                    changes: [
                      {
                        label: "Bankruptcy",
                        from: creditEventLabel(oldBk),
                        to: creditEventLabel(newBk),
                      },
                    ],
                  })}`,
                );
                await advance();
                return;
              }
              // Timing change (e.g. "change Ch7 from <1 year to >4 years").
              const newTiming = parseTimingChange(raw);
              if (newTiming) {
                const matched = creditEventEditMatch(raw, ceCodes);
                const target =
                  matched.length === 1
                    ? matched[0]
                    : matched.length === 0 && ceCodes.length === 1
                      ? ceCodes[0]
                      : null;
                if (target) {
                  const oldT = recapForm.creditEventYears?.[target] ?? "";
                  mergeForm(creditEventTimingPatch(recapForm, target, newTiming));
                  d.triggerQuickEligibilityScan();
                  d.appendAssistantChat(
                    `CHAT_CAPTURED:${JSON.stringify({
                      captured: [],
                      changes: [
                        {
                          label: `${creditEventLabel(target)} timing`,
                          from: oldT || "—",
                          to: newTiming,
                        },
                      ],
                    })}`,
                  );
                  await advance();
                  return;
                }
                // Couldn't tell which event — ask (don't save as a note).
                d.appendAssistantChat(
                  `Which event should I set to ${newTiming}? Current: ${ceCodes
                    .map((c) => creditEventLabel(c))
                    .join(", ")}.`,
                );
                return;
              }
            }

            // Loan-preference edit (rate type / IO / term).
            const prefPatch = tryLoanPrefPatch(raw, recapForm);
            if (Object.keys(prefPatch).length > 0) {
              const fb = { ...recapForm };
              mergeForm(prefPatch);
              for (const id of FORM_CHAT_PRODUCT_PREF_IDS) {
                if (id in prefPatch) {
                  markProductPrefConfirmed(id);
                  const slot = resolveIntakeTargetSlot(d.formSyncRef.current, id);
                  const val = (prefPatch as Record<string, unknown>)[id];
                  if (slot && typeof val === "string") {
                    portfolioRef.current = { ...portfolioRef.current, [slot]: val };
                  }
                }
              }
              d.triggerQuickEligibilityScan();
              const changes = changedRowsFromPatch(fb, prefPatch);
              if (changes.length > 0) {
                d.appendAssistantChat(`CHAT_CAPTURED:${JSON.stringify({ captured: [], changes })}`);
              }
              await advance();
              return;
            }

            let hadCorrections = false;
            try {
              const formBefore = { ...d.formSyncRef.current };
              const res = await intakeExtract(d.apiBase, {
                text: raw,
                portfolio: portfolioRef.current,
                mode: d.mode,
                last_target_slots: [],
              });
              portfolioRef.current = res.portfolio ?? portfolioRef.current;
              const patch = adjustCreditEventPatch(d.formSyncRef.current, {
                ...portfolioSnapshotToFormPatch(res.portfolio ?? {}),
                ...(portfolioToFormPatch(res.extracted, {
                  form: d.formSyncRef.current,
                }) as Partial<WizardForm>),
              } as Partial<WizardForm>);
              if (Object.keys(patch).length > 0) {
                hadCorrections = true;
                mergeForm(patch);
                canonicalizeCounty(d.formSyncRef.current.state, patch.stateCounty);
                applyCreditFollowupsFromText(raw, patch);
                syncProductPrefsFromForm();
                const changes = changedRowsFromPatch(formBefore, patch);
                const captured = dropRowsShownAsChanges(
                  mergeCapturedRows(res.captured ?? [], {}),
                  changes,
                );
                if (captured.length > 0 || changes.length > 0) {
                  d.appendAssistantChat(`CHAT_CAPTURED:${JSON.stringify({ captured, changes })}`);
                }
              }
            } catch (err) {
              console.error("scenario field extract:", err);
            }
            if (hadCorrections) {
              // An edit was applied — re-render the recap with the updated values. Do NOT
              // also file the edit text as a Scenario Note.
              d.triggerQuickEligibilityScan();
              await advance();
              return;
            }
            // Nothing applied. Tell apart a failed EDIT command (say so, don't save) from a
            // genuine free-text scenario note (keep it).
            if (EDIT_COMMAND_RE.test(raw)) {
              d.appendAssistantChat(
                "I couldn't apply that change. Try something like “change LTV to 75”, “make it a condo”, “remove the foreclosure”, or “rate type ARM”.",
              );
              return; // keep the recap open; don't pollute Scenario Notes
            }
            try {
              const items = await extractScenarioNotes(raw, { source: "chat" });
              if (items.length) d.applyScenarioNotesDelta(items as unknown[]);
            } catch (err) {
              console.error("scenario notes extract:", err);
            }
            d.triggerQuickEligibilityScan();
          }
          scenarioCapturedRef.current = true;
          await advance();
          return;
        }

        // Product-pref skip — "skip" / "no preference" confirms No Preference directly.
        const pendingPrefQ = pendingChatFieldRef.current
          ? FORM_CHAT_QUESTIONS.find(
              (q) => q.id === pendingChatFieldRef.current && isFormChatProductPrefQuestion(q),
            )
          : undefined;
        if (
          pendingPrefQ &&
          (isFormChatSkipMessage(raw) ||
            /^no\s+pref\w*$/i.test(raw) ||
            // Bare "no" to "Any rate-type preference?" means No Preference. (For the
            // IO ask a bare "no" instead matches its "No — fully amortizing" option
            // in contextAwareParse, so this stays rate-type only.)
            (pendingPrefQ.id === "rateTypePref" &&
              /^(?:no|nope|nah|none)[.!]?\s*$/i.test(raw.trim())))
        ) {
          markProductPrefConfirmed(pendingPrefQ.id);
          d.appendAssistantChat(
            `CHAT_CAPTURED:${JSON.stringify({
              captured: [{ label: chatFieldCaptureLabel(pendingPrefQ.id), value: "No preference" }],
              changes: [],
            })}`,
          );
          await advance();
          return;
        }

        // Credit-events prose gate — deterministic short replies, no LLM round-trip:
        // "none / no / clean" answers the gate; "yes / options / multiple" opens the
        // selector card. Anything richer ("BK 7 years back") falls through to extract.
        if (
          pendingChatFieldRef.current === "creditEvents" &&
          (d.formSyncRef.current.creditEvents ?? []).length === 0
        ) {
          if (/^(?:no|none|nope|nah|n|clean(?:\s+history)?|no\s+events?)[.!]?$/i.test(raw)) {
            const fb = { ...d.formSyncRef.current };
            mergeForm({
              hasCreditEvent: "No",
              creditEventCategory: "None",
              creditEvents: [],
              creditEventYears: {},
              creditEventDates: {},
            } as Partial<WizardForm>);
            portfolioRef.current = { ...portfolioRef.current, credit_event_category: "None" };
            delete attemptsRef.current["creditEvents"];
            echoCaptured(fb, {}, { label: "Credit Events", value: "None" });
            d.triggerQuickEligibilityScan();
            await advance();
            return;
          }
          if (AFFIRM_RE.test(raw) || /\b(options?|list|selector|multiple|several)\b/i.test(raw)) {
            emitCreditEventsAsk({ selector: true });
            return;
          }
        }

        // Snapshot BEFORE any of this turn's merges — basis for "X: A → B" change rows.
        const formBefore = { ...d.formSyncRef.current };

        // Optimistic short-reply parse for a snappy form update; the LLM is still the
        // source of truth and reconciles below. A credit-event timing reply ("06/2022",
        // "3 years ago") is attached to the first untimed event client-side.
        let quick: Partial<WizardForm> = {};
        const untimedEv =
          pendingChatFieldRef.current === "creditEvents"
            ? nextUntimedCreditEvent(d.formSyncRef.current)
            : null;
        if (untimedEv) {
          const timing = parseCreditEventTimingReply(raw);
          const value = timing?.date ?? timing?.bucket;
          if (value) {
            // Stores exactly like the /form card (date derives bucket; bucket clears date).
            quick = creditEventTimingPatch(d.formSyncRef.current, untimedEv, value);
          }
        }
        if (Object.keys(quick).length === 0) {
          quick = contextAwareParse(
            raw,
            pendingChatFieldRef.current,
            d.formSyncRef.current,
          ) as Partial<WizardForm>;
        }
        if (pendingChatFieldRef.current === "geo_followup") {
          const fld = nextRequiredGeoField(d.formSyncRef.current);
          if (fld && raw) quick = { [fld.form_key]: raw } as Partial<WizardForm>;
        }
        const pendingId = pendingChatFieldRef.current;
        if (pendingId && typeof quick[pendingId as keyof WizardForm] === "string") {
          quick = chatAnswerFormPatch(
            d.formSyncRef.current,
            pendingId,
            String(quick[pendingId as keyof WizardForm]),
          );
        }
        mergeForm(quick);
        for (const [fieldId, val] of Object.entries(quick)) {
          if (typeof val !== "string") continue;
          const slot = resolveIntakeTargetSlot(d.formSyncRef.current, fieldId);
          if (!slot) continue;
          portfolioRef.current = { ...portfolioRef.current, [slot]: val };
        }

        // A bare "yes"/"no" to a pending yes/no question is fully answered by the
        // quick parse — treat it exactly like clicking the option card and skip the
        // LLM round-trip. (The extractor has mis-mapped bare affirmations before,
        // e.g. "yes" to the credit-events gate came back as credit_event_category
        // "None", overriding the explicit answer.)
        const pendingQuickQ = pendingId
          ? FORM_CHAT_QUESTIONS.find((q) => q.id === pendingId)
          : undefined;
        const bareYesNo = /^(?:yes|yep|yeah|yup|y|no|nope|nah|n)[.!]?$/i.test(raw);
        if (
          bareYesNo &&
          pendingQuickQ?.kind === "yesno" &&
          typeof quick[pendingId as keyof WizardForm] === "string" &&
          String(quick[pendingId as keyof WizardForm]).trim()
        ) {
          delete attemptsRef.current[pendingId as string];
          const yesNoChanges = changedRowsFromPatch(formBefore, quick);
          const yesNoCaptured = dropRowsShownAsChanges(
            mergeCapturedRows([], quickParseCaptureFields(quick)),
            yesNoChanges,
          );
          if (yesNoCaptured.length > 0 || yesNoChanges.length > 0) {
            d.appendAssistantChat(
              `CHAT_CAPTURED:${JSON.stringify({ captured: yesNoCaptured, changes: yesNoChanges })}`,
            );
          }
          d.triggerQuickEligibilityScan();
          await advance();
          return;
        }

        // Stateless LLM field extraction. Tell the extractor which slot the user is
        // answering (last_target_slots) so terse replies like "cash out" resolve reliably.
        // Resolved against formBefore: the quick merge above may have already filled the
        // pending geo field, which would otherwise point this at the NEXT geo slot.
        const targetSlot = resolveIntakeTargetSlot(formBefore, pendingChatFieldRef.current);
        const res = await intakeExtract(d.apiBase, {
          text: raw,
          portfolio: portfolioRef.current,
          mode: d.mode,
          last_target_slots: targetSlot ? [targetSlot] : [],
        });
        portfolioRef.current = res.portfolio ?? portfolioRef.current;

        // Build the form patch, folding one inference into the SAME patch before merging:
        // a first-lien refi/cash-out with a first-lien balance but no second lien mentioned →
        // assume none, so the loan-details triangle doesn't re-ask already-answered value/loan/LTV.
        // (The LO can still set an existing second lien from the sidebar.) This MUST be one merge:
        // only the first setForm in a synchronous batch updates formSyncRef eagerly, so a second
        // mergeForm here would not be visible to advance() below and the triangle would re-ask.
        const patch = adjustCreditEventPatch(d.formSyncRef.current, {
          ...portfolioSnapshotToFormPatch(res.portfolio ?? {}),
          ...(portfolioToFormPatch(res.extracted, {
            form: d.formSyncRef.current,
          }) as Partial<WizardForm>),
        } as Partial<WizardForm>);
        const merged = { ...d.formSyncRef.current, ...patch };
        const isRefiPurpose =
          merged.loanPurpose === "Refinance" || merged.loanPurpose === "Cash-Out Refinance";
        if (
          merged.isSecondLien !== "yes" &&
          isRefiPurpose &&
          String(merged.existingFirstLien ?? "").trim() &&
          !String(merged.existingSecondLien ?? "").trim()
        ) {
          patch.existingSecondLien = EXISTING_SECOND_LIEN_NONE;
        }
        mergeForm(patch);
        canonicalizeCounty(
          d.formSyncRef.current.state,
          (patch as Record<string, unknown>).stateCounty ?? quick.stateCounty,
        );
        syncProductPrefsFromForm();

        // Same-turn credit follow-ups: a typed chapter/status resolves a pending
        // generic BK, and a timing phrase ("7+ years ago") attaches to the event —
        // neither needs an extra round-trip.
        const bkResolved = applyCreditFollowupsFromText(raw, patch);

        const structuredPending = isStructuredPendingQuestion(pendingId);
        const structuredAnswered =
          bkResolved ||
          Object.keys(quick).length > 0 ||
          Object.keys(res.extracted ?? {}).length > 0;

        // Don't park structured answers (e.g. doc timeframe) in scenario notes when the
        // extractor couldn't map them to a slot.
        if (res.scenario_notes_delta?.length) {
          if (!structuredPending || structuredAnswered) {
            d.applyScenarioNotesDelta(res.scenario_notes_delta);
          }
        }
        d.triggerQuickEligibilityScan();

        // Gibberish guard + 3-strike skip — if the turn yielded nothing (no fields, no
        // short-reply match), don't advance as if understood. Scenario notes alone do NOT
        // count when a structured enum/number is pending. Early failures re-ask with
        // options/hint; the 3rd failure skips or assumes the safe default.
        // Opening turn: nothing has been asked or captured yet. A question like "do you
        // give jumbo loans?" extracts no structured field but the LLM often files it as a
        // scenario note — which must NOT count as "understood" (that would skip the answer
        // and jump to the first question). So on the opening turn, notes alone don't qualify.
        const openingTurn = turnRef.current === 0 && !pendingChatFieldRef.current;
        const understood =
          structuredAnswered ||
          (!structuredPending && !openingTurn && (res.scenario_notes_delta?.length ?? 0) > 0);
        if (!understood) {
          const pendingQ = FORM_CHAT_QUESTIONS.find((q) => q.id === pendingChatFieldRef.current);

          // Already explained the DSCR/occupancy conflict above — don't ALSO run the
          // "did not understand" classifier (it would re-answer the same thing). Just
          // continue: re-ask the pending question, or move on if none is pending.
          if (dscrHandled) {
            if (pendingQ) {
              await reaskPending(pendingQ, "Coming back to our previous question:\n\n");
            } else {
              await advance();
            }
            return;
          }

          // The turn produced no scenario data. Before treating it as a failed answer,
          // classify it: an on-topic capability question gets answered, an off-topic or
          // abusive message gets a brief deflection — then we re-ask the SAME pending
          // question. An interjected question must NOT burn a 2-strike attempt.
          const assist = await intakeAssist(d.apiBase, {
            text: raw,
            pending_question: pendingQ
              ? resolveFormChatPrompt(d.formSyncRef.current, pendingQ)
              : "",
            mode: d.mode,
          });
          if (assist.intent !== "data" && assist.answer) {
            // Opening turn (nothing asked or captured yet): keep it to ONE message and
            // steer them to describe the scenario — don't split into two bubbles and
            // don't jump into the first question off a junk/abuse opener.
            if (!pendingQ && turnRef.current === 0) {
              d.appendAssistantChat(`${assist.answer}\n\n${SCENARIO_DESCRIBE_INVITE}`);
              return;
            }
            d.appendAssistantChat(assist.answer);
            await reaskPending(pendingQ, "Coming back to our previous question:\n\n");
            return;
          }

          // Opening turn, scenario-ish but no structured field yet (assist says "data"):
          // start the guided flow rather than nagging "could you add more detail".
          if (openingTurn) {
            await advance();
            return;
          }

          const failedId = pendingChatFieldRef.current;
          const attempts = failedId
            ? (attemptsRef.current[failedId] = (attemptsRef.current[failedId] ?? 0) + 1)
            : 1;

          if (attempts >= 3 && failedId && pendingQ) {
            const def = pendingQ.safeDefault?.trim();
            if (def) {
              // Assume the safe default, keep moving; the sidebar stays the escape hatch.
              const defPatch = chatAnswerFormPatch(d.formSyncRef.current, failedId, def);
              mergeForm(defPatch);
              const slot = resolveIntakeTargetSlot(d.formSyncRef.current, failedId);
              if (slot) portfolioRef.current = { ...portfolioRef.current, [slot]: def };
              d.appendAssistantChat(
                `No problem — I'll assume “${def}” for that one and move on. You can change it anytime from the Mortgage Profile sidebar.`,
              );
              d.triggerQuickEligibilityScan();
              await advance();
              return;
            }
            // No safe default — defer; it comes back once at the end in a summary card.
            deferredRef.current = new Set([...deferredRef.current, failedId]);
            d.appendAssistantChat(
              "Let's not get stuck here — I'll circle back to this at the end. You can also set it anytime from the Mortgage Profile sidebar.",
            );
            await advance();
            return;
          }

          // First failure → form fallback: if the pending question is a pick-list, show
          // clickable option cards instead of asking the user to rephrase.
          if (pendingQ?.special === "credit_events" || pendingQ?.id === "hasCreditEvent") {
            // Credit events parse-fail: open the selector card (or the BK chapter /
            // timing card, whichever step is pending) instead of re-asking in prose.
            emitCreditEventsAsk({ selector: true });
            return;
          }
          if (pendingQ && isFormChatProductPrefQuestion(pendingQ)) {
            // Parse-fail fallback for a text-based pref ask — show the proper pref
            // card (multi-select for loan term, explicit Confirm) instead of the
            // single-click lettered list.
            d.appendAssistantChat(
              `CHAT_PRODUCT_PREF:${JSON.stringify({ questionId: pendingQ.id })}`,
            );
            return;
          }
          if (pendingQ?.kind === "enum" && !pendingQ.special) {
            const options = optionsFor(d.formSyncRef.current, pendingQ);
            if (options.length) {
              d.appendAssistantChat(
                `CHAT_OPTIONS:${JSON.stringify(
                  chatOptionsPayload(d.formSyncRef.current, pendingQ, {
                    fallback: true,
                    optionalIntro: maybeOptionalIntro(dispatcherRef.current, pendingQ),
                  }),
                )}`,
              );
              return;
            }
          }
          // Acknowledge "I already gave that" and re-show the full question (with its hint)
          // instead of a dead-end "rephrase" — e.g. the triangle's "enter any two of value /
          // loan / LTV". Avoids the loop when a complex answer didn't resolve.
          const alreadyGiven =
            /\b(already|provided|gave|given|told you|said (?:that|it|this)|earlier)\b/i.test(raw);
          const ask = pendingQ
            ? resolveFormChatPrompt(d.formSyncRef.current, pendingQ)
            : "could you add a bit more detail?";
          const hint = pendingQ?.hint?.trim() ? ` (${pendingQ.hint.trim()})` : "";
          const lead = alreadyGiven
            ? "Sorry, I may have missed that — "
            : "I didn't quite catch that — ";
          d.appendAssistantChat(`${lead}${ask}${hint}`);
          return;
        }

        // Understood — clear the failure counter for this question.
        if (pendingChatFieldRef.current) delete attemptsRef.current[pendingChatFieldRef.current];

        markProductPrefConfirmed(pendingChatFieldRef.current);

        // Capture chips — merge API rows with optimistic short-reply parse so yes/no answers
        // (e.g. listing seasoning) show even when the Extractor returns an empty delta.
        // Values that OVERWROTE an existing answer render as "X: A → B" change pills.
        const changes = changedRowsFromPatch(formBefore, { ...quick, ...patch });
        const captured = dropRowsShownAsChanges(
          mergeCapturedRows(res.captured ?? [], quickParseCaptureFields(quick)),
          changes,
        );

        // Opening turn — ALWAYS show the brain-dump summary card (even one captured
        // field), followed by a deterministic stock-take of what's left (plan §4).
        if (turnRef.current === 0 && captured.length > 0) {
          brainDumpCapturedRef.current = captured.length;
          d.appendAssistantChat(
            `CHAT_BULK_SUMMARY:${JSON.stringify({
              captured,
              inferred: res.inferred ?? [],
              notes: res.notes ?? [],
              stockTake: chatStockTakeLine(d.formSyncRef.current, d.mode),
            })}`,
          );
        } else if (captured.length > 0 || changes.length > 0) {
          // Per-answer feedback — echo what we captured this turn before the next question.
          d.appendAssistantChat(`CHAT_CAPTURED:${JSON.stringify({ captured, changes })}`);
        }

        // Queue inferred / ambiguous values to confirm before the next question.
        reinforceQueueRef.current = [
          ...(res.inferred ?? []).map((r) => ({
            slot: r.slot,
            label: r.label,
            value: r.value,
            phrase: r.phrase,
          })),
          ...(res.ambiguous ?? []).map((a) => ({
            slot: a.slot,
            label: a.label,
            candidates: a.candidates,
          })),
        ];

        await advance();
      } catch (err) {
        console.error("submitUserTurn:", err);
        d.appendAssistantChat("Sorry, something went wrong. Please try again.");
      } finally {
        d.setLoading(false);
      }
    },
    [
      advance,
      applyCreditFollowupsFromText,
      canonicalizeCounty,
      echoCaptured,
      emitCreditEventsAsk,
      markProductPrefConfirmed,
      mergeForm,
      reaskPending,
      syncProductPrefsFromForm,
    ],
  );

  /**
   * Dismiss the optional batch and advance to the recap → submit. Unconfirmed
   * product prefs are treated as "No preference" (the form default).
   */
  const skipOptionals = useCallback(() => {
    optionalsSkippedRef.current = true;
    for (const id of FORM_CHAT_PRODUCT_PREF_IDS) productPrefConfirmedRef.current.add(id);
    setProductPrefConfirmed(new Set(productPrefConfirmedRef.current));
    void advance();
  }, [advance]);

  /** Confirm a product-preference card (loan term / rate type / I/O). */
  const confirmProductPref = useCallback(
    (questionId: string, patch: Partial<WizardForm>, label: string) => {
      const d = depsRef.current;
      d.appendUserChat(label);
      const formBefore = { ...d.formSyncRef.current };
      mergeForm(patch);
      markProductPrefConfirmed(questionId);
      echoCaptured(formBefore, patch, {
        label: chatFieldCaptureLabel(questionId),
        value: label,
      });
      d.triggerQuickEligibilityScan();
      void advance();
    },
    [advance, echoCaptured, markProductPrefConfirmed, mergeForm],
  );

  /** Confirm a product pref INSIDE the optional batch card — no advance (the card stays). */
  const confirmProductPrefInBatch = useCallback(
    (questionId: string, patch: Partial<WizardForm>) => {
      const d = depsRef.current;
      mergeForm(patch);
      markProductPrefConfirmed(questionId);
      d.triggerQuickEligibilityScan();
    },
    [markProductPrefConfirmed, mergeForm],
  );

  /**
   * Confirm the multi-select credit-events card. "None" answers the gate as No;
   * real events set the gate to Yes (union-merged) — a generic Bankruptcy pick
   * gets its chapter asked next, then per-event timing.
   */
  const confirmCreditEvents = useCallback(
    (codes: string[]) => {
      if (codes.length === 0) return;
      const d = depsRef.current;
      const formBefore = { ...d.formSyncRef.current };
      if (codes.includes(CREDIT_EVENT_NONE)) {
        d.appendUserChat("None — clean history");
        mergeForm({
          hasCreditEvent: "No",
          creditEventCategory: "None",
          creditEvents: [],
          creditEventYears: {},
          creditEventDates: {},
        } as Partial<WizardForm>);
        portfolioRef.current = { ...portfolioRef.current, credit_event_category: "None" };
        delete attemptsRef.current["creditEvents"];
        delete attemptsRef.current["hasCreditEvent"];
        echoCaptured(formBefore, {}, { label: "Credit Events", value: "None" });
        d.triggerQuickEligibilityScan();
        void advance();
        return;
      }
      const labels = codes.map((c) => creditEventLabel(c)).join(", ");
      d.appendUserChat(labels);
      const existing = formBefore.creditEvents ?? [];
      mergeForm({
        hasCreditEvent: "Yes",
        creditEvents: [...new Set([...existing, ...codes])],
      } as Partial<WizardForm>);
      delete attemptsRef.current["creditEvents"];
      delete attemptsRef.current["hasCreditEvent"];
      echoCaptured(formBefore, {}, { label: "Credit Events", value: labels });
      d.triggerQuickEligibilityScan();
      void advance();
    },
    [advance, echoCaptured, mergeForm],
  );

  /**
   * Resolve the generic Bankruptcy pick to its chapter/status code — re-keys any
   * timing already captured under "BK" so an inline "7 years back" is never lost.
   */
  const resolveBkType = useCallback(
    (code: string, label: string) => {
      const d = depsRef.current;
      const formBefore = { ...d.formSyncRef.current };
      d.appendUserChat(label);
      mergeForm(rekeyGenericBkPatch(formBefore, code, label));
      delete attemptsRef.current["creditEvents"];
      echoCaptured(formBefore, {}, { label: "Bankruptcy", value: label });
      d.triggerQuickEligibilityScan();
      void advance();
    },
    [advance, echoCaptured, mergeForm],
  );

  /** Set one event's timing from the card — a seasoning bucket or an MM/YYYY date. */
  const setCreditEventTiming = useCallback(
    (code: string, value: string) => {
      const v = value.trim();
      if (!v) return;
      const d = depsRef.current;
      d.appendUserChat(`${creditEventLabel(code)} — ${v}`);
      const formBefore = { ...d.formSyncRef.current };
      mergeForm(creditEventTimingPatch(formBefore, code, v));
      delete attemptsRef.current["creditEvents"];
      echoCaptured(formBefore, {}, { label: creditEventLabel(code), value: v });
      d.triggerQuickEligibilityScan();
      void advance();
    },
    [advance, echoCaptured, mergeForm],
  );

  /** Answer the pending enum question by clicking an option card (fast path, no LLM round-trip). */
  const selectOption = useCallback(
    (questionId: string, value: string, label: string) => {
      const d = depsRef.current;
      d.appendUserChat(label);
      const formBefore = { ...d.formSyncRef.current };
      const patch = chatAnswerFormPatch(formBefore, questionId, value);
      mergeForm(patch);
      const targetSlot = resolveIntakeTargetSlot(formBefore, questionId);
      if (targetSlot) {
        portfolioRef.current = { ...portfolioRef.current, [targetSlot]: value };
      }
      delete attemptsRef.current[questionId];
      markProductPrefConfirmed(questionId);
      echoCaptured(formBefore, patch, { label: chatFieldCaptureLabel(questionId), value: label });
      d.triggerQuickEligibilityScan();
      void advance();
    },
    [advance, echoCaptured, markProductPrefConfirmed, mergeForm],
  );

  /** After a sidebar edit that cascades clears — re-open the first mandatory gap. */
  const repromptAfterSidebarEdit = useCallback(
    (clearedFieldIds?: string[]) => {
      // Return the user to the step they were on. Pref confirmations and the
      // scenario/recap progress are reset ONLY when this edit's cascade actually
      // cleared them — an unrelated edit (e.g. DTI) must not re-open the pref
      // questions or restart the recap.
      const cleared = new Set(clearedFieldIds ?? []);
      let prefsTouched = false;
      for (const id of FORM_CHAT_PRODUCT_PREF_IDS) {
        if (cleared.has(id) && productPrefConfirmedRef.current.has(id)) {
          productPrefConfirmedRef.current.delete(id);
          prefsTouched = true;
        }
      }
      if (prefsTouched) setProductPrefConfirmed(new Set(productPrefConfirmedRef.current));
      if (cleared.size > 0) scenarioCapturedRef.current = false;
      setSubmitProfileGate(false);
      depsRef.current.appendAssistantChat("Starting from where we left —");
      void advance();
    },
    [advance],
  );

  /**
   * Echo a sidebar edit into the chat thread as a "Changed: X → Y" capture card —
   * the reprompt that follows re-asks the pending question so context isn't lost.
   */
  const echoSidebarChange = useCallback(
    (changes: Array<{ label: string; from: string; to: string }>, clearedLabels?: string[]) => {
      const d = depsRef.current;
      const rows = changes.filter((c) => c.label && c.to);
      if (rows.length > 0) {
        d.appendAssistantChat(`CHAT_CAPTURED:${JSON.stringify({ captured: [], changes: rows })}`);
      }
      const cleared = (clearedLabels ?? []).filter(Boolean);
      if (cleared.length > 0) {
        d.appendAssistantChat(
          `Heads up — your latest edit cleared ${cleared.join(", ")}, so I'll need ${
            cleared.length > 1 ? "those" : "that"
          } again.`,
        );
      }
    },
    [],
  );

  /**
   * Mirror sidebar-edit / cascade form changes into the extract portfolio, so the
   * next turn's delta comparison and snapshot sync don't revert or resurrect them.
   * An empty-string value clears the slot.
   */
  const syncPortfolioSlots = useCallback((slots: Record<string, string>) => {
    if (Object.keys(slots).length === 0) return;
    portfolioRef.current = { ...portfolioRef.current, ...slots };
  }, []);

  const reset = useCallback(() => {
    portfolioRef.current = {};
    turnRef.current = 0;
    pendingChatFieldRef.current = null;
    answeredQIdsRef.current = new Set();
    scenarioCapturedRef.current = false;
    brainDumpCapturedRef.current = 0;
    optionalsSkippedRef.current = false;
    productPrefConfirmedRef.current.clear();
    setProductPrefConfirmed(new Set());
    reinforceQueueRef.current = [];
    dispatcherRef.current = {
      turn: 0,
      mode: depsRef.current.mode,
      usedTemplates: new Set(),
      lastFormats: [],
      asksSinceSummary: 0,
      optionalIntroShown: false,
    };
    attemptsRef.current = {};
    deferredRef.current = new Set();
    summarySlotsRef.current = [];
    framingUsedRef.current = 0;
    recentAsksRef.current = [];
    setSubmitProfileGate(false);
  }, []);

  return {
    submitUserTurn,
    advance,
    repromptAfterSidebarEdit,
    skipOptionals,
    selectOption,
    confirmCreditEvents,
    resolveBkType,
    setCreditEventTiming,
    confirmProductPref,
    confirmProductPrefInBatch,
    productPrefConfirmed,
    submitProfileGate,
    setSubmitProfileGate,
    reset,
    syncPortfolioSlots,
    echoSidebarChange,
    portfolioRef,
    pendingChatFieldRef,
  };
}

export type UseChatConversationReturn = ReturnType<typeof useChatConversation>;
