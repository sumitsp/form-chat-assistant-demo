/**
 * /form guided-intake — a full-screen, Claude-style chat experience modeled on
 * ChatIntakeExperience.jsx: a Mortgage Profile sidebar on the left and a
 * centered chat column on the right (welcome + Start gate, lettered answer
 * cards, the value/loan/LTV triangle, edit, and a persistent chat input bar with
 * voice).
 *
 * The flow + values are driven entirely by lib/formChatFlow.ts and patch the
 * SAME `form`/`setForm` the wizard owns, so the wizard's lien / purpose / LTV
 * cascade effects keep working untouched. The eligible-programs count, progress
 * bar and preview list are wired to the real quick-scan data passed in as props.
 *
 * Mode ("lo" vs "underwriter") is URL-driven by the /form route — no in-UI
 * toggle. "underwriter" additionally asks the optional questions.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  CornerDownLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  HelpCircle,
  Home,
  Lightbulb,
  Mic,
  Pencil,
  RotateCcw,
  Save,
  Square,
  Upload,
  X,
} from "lucide-react";

import {
  ChatMessageActions,
  type MessageFeedbackVote,
} from "@/components/wizard/ChatMessageActions";
import { CountySearchControl } from "@/components/wizard/CountySearchControl";
import { SearchablePicker, type SearchablePickerItem } from "@/components/wizard/SearchablePicker";
import { FormProfileSidebar } from "@/components/wizard/shared/mortgageProfileSidebar/FormProfileSidebar";
import { humanizeField } from "@/components/wizard/shared/mortgageProfileSidebar/formProfileSections";
import {
  ResultsCard,
  ResultsHeadlineBanner,
  SuggestionPills,
  programDetailText,
  resultsHeadlineVariant,
  BACK_TO_RESULTS_LIST_TEXT,
  buildRestoredResultsTail,
  eligibilityResultsHeadline,
  isResultsConversationMsg,
  isResultsNavigationCommand,
  isViewingResultsSubPanel,
  lastMessageIdOfKind,
  lastResultsMessageIndex,
  programDetailAfterResults,
} from "@/components/wizard/shared/results";

import {
  CompactThinkingBubble,
  ELIGIBILITY_REFRESH_LABEL,
  ELIGIBILITY_REFRESH_LABELS,
  ELIGIBILITY_RELOAD_LABEL,
  ELIGIBILITY_RELOAD_LABELS,
  ELIGIBILITY_RUN_LABEL,
  ELIGIBILITY_THINKING_LABELS,
  KNOW_MORE_THINKING_LABELS,
  RAG_FOLLOWUP_LABELS,
  stripLoadingEllipsis,
} from "@/components/ChatThinkingSkeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RetainedChatThread, type ChatThreadMsg } from "@/lib/chatThreadView";
import { buildFormWelcomeParagraphs, isMobileWelcomeViewport } from "@/lib/welcomeIntro";
import {
  EXISTING_SECOND_LIEN_OPTIONS,
  LIEN_POSITION_PIGGYBACK,
  LOAN_TERM_SELECT_OPTIONS,
  existingSecondLienNeedsSubordination,
  formatMortgageAcronyms,
  formatLoanTermDisplay,
  formatLoanTermStorage,
  formatMoneyForInput,
  parseLoanTermSelection,
  formatLeveragePercentDisplay,
  usesCltvLeverageField,
  isOwnerOccupiedOccupancy,
  OWNER_OCCUPIED_INCOME_PATH_LABEL,
  effectivePrimaryLoanPurpose,
  shouldHardcodeFirstTimeHomebuyerNo,
  shouldHardcodeFirstTimeInvestorNo,
  shouldShowOwnerOccupiedIncomePathSidebar,
  type ProductDisplayPrefs,
} from "@/lib/nqmIntegratedForm";
import { ProgramKnowMoreDetail, type ScenarioSnapshot } from "@/components/ProgramKnowMoreDetail";
import { ResultsPagination } from "@/components/wizard/results/ResultsPagination";
import { EligibilityExclusionDetails } from "@/components/EligibilityExclusionDetails";
import type { ProgramExclusion } from "@/lib/eligibilityExclusions";
import {
  fetchGeoConfig,
  geoSidebarSlotsForForm,
  geoSubFieldKeys,
  clearGeoFollowupFieldsPatch,
  inferGeoFollowupsFromCounty,
  geoSelectOptions,
  countyNeedsGeoFollowUp,
  type GeoFieldConfig,
} from "@/lib/stateGeoFollowUp";
import type { WizardForm, EligibleProgram, NearMissProgram } from "@/components/LoanWizard";
import {
  FORM_CHAT_COLUMN,
  FORM_CHAT_COMPOSER_CARD,
  FORM_CHAT_COMPOSER_CONTROLS,
  FORM_CHAT_COMPOSER_INPUT,
  FORM_CHAT_COMPOSER_SHELL,
  FORM_CHAT_H_PAD,
  FORM_CHAT_MESSAGE_STACK,
  FORM_CHAT_SCROLL_PAD,
} from "@/lib/formChatLayout";
import {
  programDisplayName,
  programGateMetricsLine,
  filterNotesForSummarize,
  limitConsiderationBullets,
  KnowMoreFollowupHint,
  knowMoreComposerPlaceholder,
  renderChatAnswer,
} from "@/lib/programDisplayHelpers";
import {
  FORM_CHAT_QUESTIONS,
  NOCB_RELATIONSHIP_OPTIONS,
  DECISION_CREDIT_SCORE_CAUTION,
  DECISION_CREDIT_SCORE_CAUTION_DELAY_MS,
  creditEventLabel,
  creditEventSidebarLabel,
  applyFormChatAnswer,
  isAnswered,
  isDecisionCreditScoreInRange,
  showDecisionCreditScoreCaution,
  isFormChatProductPrefQuestion,
  isFormChatQuestionAnswered,
  isNoProductPreference,
  mandatoryComplete,
  isFormChatUnderwriterOnlyQuestion,
  includeFormChatQuestionInFlow,
  canSkipFormChatQuestion,
  isFormChatSkipMessage,
  FORM_CHAT_SKIP_LABEL,
  firstTimeHomebuyerSidebarValue,
  firstTimeInvestorSidebarValue,
  formatDocumentationTimeframeDisplay,
  buildCascadePatchForFormEdit,
  formChatScenarioCascadePatch,
  PURPOSE_LIEN_CASCADE_IDS,
  primaryLoanPurposeChanged,
  applyLoanDetailsFieldClear,
  matchStateOption,
  nocbVisible,
  residualTriggered,
  formChatQuestionsInFlowOrder,
  formChatHasStaleAnswersAfterGap,
  LOCATION_DOWNSTREAM_Q_IDS,
  locationCascadeClearPatch,
  nextFormChatQuestion,
  nextRequiredGeoField,
  optionsFor,
  resolveFormChatPrompt,
  loanDetailsFieldSpec,
  loanDetailsDownPayment,
  type FormChatOption,
  type FormChatQuestion,
} from "@/lib/formChatFlow";
import {
  FORM_SCENARIO_NOTES_PROMPT,
  PRE_SUBMIT_ASSISTANT_TEXT,
  PRE_SUBMIT_TO_SCAN_DELAY_MS,
} from "@/lib/chatConversation";
import {
  computeYearsSinceBucket,
  CREDIT_EVENT_YEAR_BUCKETS,
  creditEventBucketForForm,
  normalizeCreditEventYearBucket,
  formatMmYyyyInput,
  validateMmYyyy,
} from "@/lib/creditEventTiming";
import { extractScenarioNotes } from "@/lib/scenarioNotesExtract";
import {
  isScenarioNotesGibberish,
  isScenarioNotesSkipMessage,
  shouldTreatScenarioNotesAsSkip,
  mergeScenarioNotesText,
} from "@/lib/sessionNotes";
import { parseLoanFormFile } from "@/lib/parseLoanFormApi";
import { loanFormExtractToWizardPatch } from "@/lib/loanFormToWizardPatch";
import { importedKeysFromExtract, stripImportedKeys } from "@/lib/loanFormImportedKeys";

export type FormChatMode = "underwriter" | "lo";

/** Pause after Good News / Hard Luck finishes streaming before the results table appears. */
const RESULTS_TABLE_REVEAL_DELAY_MS = 350;

/** The 3 always-shown starter questions on a program's Know More card. */
const PROGRAM_FOLLOWUP_FIXED = [
  "What are the geo / state restrictions?",
  "What documentation does this program require?",
  "What credit events affect eligibility?",
] as const;

/** Pool the rotating 4th chip is drawn from (all universally relevant Non-QM topics). */
const PROGRAM_FOLLOWUP_POOL = [
  "What's the prepayment penalty structure (terms, occupancies, ineligible states)?",
  "What appraisal requirements apply (review product, second-appraisal threshold)?",
  "What are the rules on gift funds?",
  "Are non-occupant co-borrowers permitted, and under what conditions?",
  "Can escrows be waived, and what are the conditions?",
  "What are the seller-concession / interested-party-contribution limits?",
  "What's the declining-markets overlay?",
  "Are temporary buydowns allowed, and who can fund them?",
] as const;

/**
 * The 4th Know More chip — picked ONCE per page load (lazily, so it's client-side and
 * never drifts between SSR and hydration). It's identical across every program card this
 * session; a fresh reload may surface a different question from the pool.
 */
let _followupFourth: string | null = null;
function programFollowupQuestions(): readonly string[] {
  if (_followupFourth === null) {
    _followupFourth =
      PROGRAM_FOLLOWUP_POOL[Math.floor(Math.random() * PROGRAM_FOLLOWUP_POOL.length)];
  }
  return [...PROGRAM_FOLLOWUP_FIXED, _followupFourth];
}

async function summarizeProgramNotes(
  program: EligibleProgram,
  rawNotes: string[],
): Promise<EligibleProgram> {
  if (rawNotes.length === 0) {
    return { ...program, summary_notes: null, summary_bullets: null };
  }
  try {
    const res = await fetch("/api/summarize-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: rawNotes, program_name: program.program_name }),
    });
    if (!res.ok) throw new Error("summarize failed");
    const data = (await res.json()) as { summary?: string; bullets?: string[] };
    const bullets =
      Array.isArray(data.bullets) && data.bullets.length
        ? limitConsiderationBullets(data.bullets)
        : null;
    if (!bullets?.length && !data.summary?.trim()) throw new Error("empty summary");
    return {
      ...program,
      summary_notes: data.summary?.trim() || null,
      summary_bullets: bullets,
    };
  } catch {
    return {
      ...program,
      summary_notes: null,
      summary_bullets: limitConsiderationBullets(rawNotes),
    };
  }
}

/** Pre-start composer hint — enabled once the welcome message finishes streaming. */
const FORM_WELCOME_COMPOSER_HINT = "Input Start or upload 1003 / URLA v3.4…";

/** Chat UI one step smaller below `md` (mobile). */
const MOB = {
  t14: "text-[13px] md:text-[14px]",
  t13: "text-[12px] md:text-[13px]",
  t12: "text-[11px] md:text-[12px]",
  t15: "text-[14px] md:text-[15px]",
  cardPad: "px-3 py-2.5 md:px-4 md:py-3",
  optionPad: "px-2.5 py-2 md:px-3 md:py-2.5",
  inputH: "h-10 md:h-11",
  actionPad: "p-2.5 md:p-3",
  btn13: "text-[12px] md:text-[13px]",
} as const;

/** Question ids with stored form values (sidebar, resume, history restore). */
function formAnsweredQIdsFromForm(form: WizardForm, messageIds?: Set<string>): Set<string> {
  const s = new Set<string>();
  for (const q of FORM_CHAT_QUESTIONS) {
    if (isFormChatQuestionAnswered(form, q, messageIds)) s.add(q.id);
  }
  return s;
}

/** Reconstruct an answered question's bubble label from stored form data (resume / vault load). */
function reconstructAnswerLabel(form: WizardForm, q: FormChatQuestion): string {
  const get = (k: string) => String((form as Record<string, unknown>)[k] ?? "").trim();
  if (q.special === "triangle") {
    const parts: string[] = [];
    if (get("valueSalesPrice")) parts.push(`Value ${money(get("valueSalesPrice"))}`);
    if (get("loanAmount")) parts.push(`Loan ${money(get("loanAmount"))}`);
    if (get("ltv")) parts.push(`LTV ${get("ltv")}%`);
    if (get("cltv")) parts.push(`CLTV ${get("cltv")}%`);
    if (get("cashInHandRequest")) parts.push(`Cash-out ${money(get("cashInHandRequest"))}`);
    if (get("helocInitialDraw")) parts.push(`Draw ${money(get("helocInitialDraw"))}`);
    return parts.join(" · ") || "Loan details";
  }
  if (q.special === "credit_events") {
    const n = (form.creditEvents ?? []).length;
    return `${n} event${n !== 1 ? "s" : ""}`;
  }
  if (q.special === "capacity_dti_bundle") {
    const parts: string[] = [];
    if (form.nonOccupantCoBorrower === "Yes") {
      parts.push(`NOCB Yes · ${form.noCbRelationship}`);
      if (get("combinedDti")) parts.push(`Combined DTI ${get("combinedDti")}%`);
    } else if (form.nonOccupantCoBorrower === "No") {
      parts.push("NOCB No");
    }
    if (get("householdSize")) {
      parts.push(
        `Household ${get("householdSize")} · ${money(get("monthlyResidualIncome"))}/mo residual`,
      );
    }
    return parts.join(" · ") || "Capacity details";
  }
  if (q.special === "geo_followup") {
    const vals = geoSidebarSlotsForForm(form)
      .filter((s) => s.value.trim())
      .map((s) => s.displayValue || s.value);
    return vals.join(" · ") || "Location details";
  }
  if (q.special === "county_search") {
    return form.stateCounty.trim() || "";
  }
  if (isFormChatProductPrefQuestion(q)) return productPrefAnswerLabel(q.id, form);
  if (q.id === "documentationTimeframe") {
    const val = get(q.id);
    return formatDocumentationTimeframeDisplay(val) || val;
  }
  if (q.kind === "enum" || q.kind === "yesno" || q.kind === "state") {
    const val = get(q.id);
    const opt = optionsFor(form, q).find((o) => o.value === val);
    return opt?.label ?? val;
  }
  const val = get(q.id);
  return `${q.prefix ?? ""}${val}${q.suffix ? ` ${q.suffix}` : ""}`;
}

/**
 * Rebuild the answered-question transcript (each with a Change button) from stored
 * form data, so a resumed / vault-loaded / post-submit chat shows the full history.
 */
function buildAnsweredMessagesFromForm(
  form: WizardForm,
  opts?: { contiguousOnly?: boolean; answeredQIds?: Set<string>; includeOptional?: boolean },
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const flowOpts = {
    includeOptional: opts?.includeOptional ?? false,
    answeredQIds: opts?.answeredQIds,
  };
  const questions = opts?.contiguousOnly
    ? formChatQuestionsInFlowOrder(form, flowOpts)
    : FORM_CHAT_QUESTIONS;

  for (const q of questions) {
    if (q.special === "capacity_dti_notice") continue; // intro line, not an answer
    if (!includeFormChatQuestionInFlow(q, !!flowOpts.includeOptional)) continue;
    if (!opts?.contiguousOnly && q.showIf && !q.showIf(form)) continue;
    if (opts?.contiguousOnly && !isFormChatQuestionAnswered(form, q, opts.answeredQIds)) {
      break;
    }
    if (!isAnswered(form, q) && !opts?.answeredQIds?.has(q.id)) continue;
    out.push({
      kind: "answered",
      id: `boot-${q.id}`,
      qId: q.id,
      prompt: resolveFormChatPrompt(form, q),
      section: q.section,
      sectionName: q.sectionName,
      answerLabel: reconstructAnswerLabel(form, q),
    });
  }
  // Scenario notes — labelled, editable bubble at the end of the answered transcript.
  const notes = (form.scenarioNotes ?? "").trim();
  const mandatoryDone =
    nextFormChatQuestion(form, {
      includeOptional: opts?.includeOptional ?? false,
      answeredQIds: opts?.answeredQIds,
    }) === null;
  if (notes) {
    out.push({ kind: "scenario-note", id: "boot-scenario-note", text: notes });
  } else if (mandatoryDone) {
    out.push({ kind: "scenario-note", id: "boot-scenario-note", text: "", empty: true });
  }
  return out;
}

function stepBeginGreeting(q: FormChatQuestion | null): string {
  return q
    ? `Great — let's begin with Step ${q.section}: ${q.sectionName}. About 90 seconds.`
    : "Great — let's take a look.";
}

// One-line description of what each step covers, shown in step intros / transitions.
const SECTION_BLURB: Record<string, string> = {
  Basics: "who's borrowing, what they want, and how much",
  Capacity: "the borrower's income, DTI, and ability to repay",
  Credit: "payment history and any prior credit events",
  Collateral: "the property — its type, condition, and location",
  Considerations: "product preferences and any special conditions",
};
const sectionIntro = (name: string) =>
  SECTION_BLURB[name] ? `${name}: ${SECTION_BLURB[name]}` : name;

const letter = (i: number) => String.fromCharCode(65 + i);

const LOAN_TERM_NO_PREF = "No preference";

/** Empty form default ("No preference") must not appear selected until the user answers. */
function loanTermDraftFromForm(form: WizardForm, questionAnswered: boolean): string {
  const raw = (form.loanTerm ?? "").trim();
  if (!questionAnswered && (!raw || isNoProductPreference(form.loanTerm))) return "";
  return form.loanTerm ?? "";
}

const CREDIT_EVENT_TIMELINE_CHIP = "CREDIT · QUESTION CREDIT EVENT TIMELINE";

function creditEventTimingFilled(form: WizardForm, code: string): boolean {
  const d = form.creditEventDates?.[code]?.trim() ?? "";
  const y = form.creditEventYears?.[code]?.trim() ?? "";
  if (y) return true;
  return !!d && !validateMmYyyy(d);
}

function creditEventQuestionView(
  q: FormChatQuestion,
  timelineOpen: boolean,
  timelineIdx: number,
): { q: FormChatQuestion; chipOverride?: string; keySuffix: string } {
  if (q.special !== "credit_events" || !timelineOpen) {
    return { q, keySuffix: "" };
  }
  return {
    q: { ...q, prompt: "" },
    chipOverride: CREDIT_EVENT_TIMELINE_CHIP,
    keySuffix: `:timeline:${timelineIdx}`,
  };
}

/** Pre-fill chat controls when re-opening a question (Change / sidebar edit). */
function seedControlsFromForm(
  q: FormChatQuestion,
  form: WizardForm,
): {
  draft: string;
  eventSel: string[];
  creditEventsTimelineOpen: boolean;
  creditEventTimelineIdx: number;
  loanTermDraft: string;
} {
  if (q.special === "credit_events") {
    const events = [...new Set(form.creditEvents ?? [])];
    const incompleteIdx = events.findIndex((ev) => !creditEventTimingFilled(form, ev));
    // Only jump straight to the timeline when timing is still missing.
    const timelineOpen = events.length > 0 && incompleteIdx >= 0;
    return {
      draft: "",
      eventSel: events,
      creditEventsTimelineOpen: timelineOpen,
      creditEventTimelineIdx: timelineOpen ? (incompleteIdx >= 0 ? incompleteIdx : 0) : 0,
      loanTermDraft: form.loanTerm || "No preference",
    };
  }
  if (q.id === "loanTerm" && q.special === "product_pref") {
    return {
      draft: "",
      eventSel: [],
      creditEventsTimelineOpen: false,
      creditEventTimelineIdx: 0,
      loanTermDraft: form.loanTerm || "No preference",
    };
  }
  if (q.kind === "currency" || q.kind === "number") {
    const raw = String((form as Record<string, unknown>)[q.id] ?? "").trim();
    return {
      draft: raw,
      eventSel: [],
      creditEventsTimelineOpen: false,
      creditEventTimelineIdx: 0,
      loanTermDraft: loanTermDraftFromForm(form, false),
    };
  }
  return {
    draft: "",
    eventSel: [],
    creditEventsTimelineOpen: false,
    creditEventTimelineIdx: 0,
    loanTermDraft: loanTermDraftFromForm(form, false),
  };
}

function formFieldValue(form: WizardForm, q: FormChatQuestion): string {
  if (q.special === "county_search") {
    return form.stateCounty.trim();
  }
  if (q.special === "geo_followup") {
    const field = nextRequiredGeoField(form);
    if (!field) return "";
    return String((form as Record<string, unknown>)[field.form_key] ?? "").trim();
  }
  return String((form as Record<string, unknown>)[q.id] ?? "").trim();
}

const money = (v: string | number) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : String(v);
};

// ── chatbox parsing for the value / loan / LTV triangle ──────────────────────
// Lets the loan-details numbers be typed in the message box instead of the
// grouped fields, e.g. "value 500k, loan 400k", "500,000 at 80%", "500000 400000".
const TRI_AMT = String.raw`\$?\s*([0-9][\d,]*(?:\.\d+)?)\s*([kKmM])?`;

function parseAmountToken(numStr: string, unit?: string): number {
  const n = Number(numStr.replace(/,/g, ""));
  if (!Number.isFinite(n)) return NaN;
  const u = (unit ?? "").toLowerCase();
  if (u === "k") return n * 1_000;
  if (u === "m") return n * 1_000_000;
  return n;
}

/**
 * Parse a free-text loan-details answer into a triangle patch. Recognises any two
 * of value / loan / LTV (the third is derived), plus down payment, cash-out, and
 * existing-first-lien when labelled. Returns null when fewer than two of
 * value/loan/LTV can be resolved. Mirrors the grouped LoanDetails compute + patch.
 */
function parseTriangleText(
  form: WizardForm,
  text: string,
): { patch: Partial<WizardForm>; label: string } | null {
  let work = ` ${text} `;
  const mask = (idx: number, len: number) => {
    work = work.slice(0, idx) + " ".repeat(len) + work.slice(idx + len);
  };
  // Labelled money field: only accepts a value ≥ 1,000 or with a k/m/$ unit, so a
  // bare small number ("value 80") is left for the LTV detector instead.
  const takeMoney = (alt: string): number | null => {
    const re = new RegExp(`(?:${alt})\\s*(?:of|is|:|=|at|~|->|to)?\\s*${TRI_AMT}`, "i");
    const m = re.exec(work);
    if (!m) return null;
    const value = parseAmountToken(m[1], m[2]);
    if (!Number.isFinite(value)) return null;
    const hadUnit = !!m[2] || m[0].includes("$");
    if (!(value >= 1000 || hadUnit)) return null;
    mask(m.index, m[0].length);
    return value;
  };

  // LTV: explicit label, then a "NN%" anywhere, then (later) a lone small number.
  let ltv: number | null = null;
  {
    const re =
      /(?:ltv|loan[- ]?to[- ]?value|l\.?t\.?v\.?)\s*(?:of|is|:|=|at|~|->|to)?\s*([0-9]{1,3}(?:\.\d+)?)\s*%?/i;
    const m = re.exec(work);
    if (m) {
      ltv = Number(m[1]);
      mask(m.index, m[0].length);
    }
  }
  const efl = takeMoney(
    "existing\\s*first\\s*lien(?:\\s*balance)?|first\\s*lien\\s*balance|existing\\s*first",
  );
  const cash = takeMoney("cash[- ]?out|cash[- ]?in[- ]?hand|cash");
  const down = takeMoney("down\\s*payment|down|\\bdp\\b");
  let pv = takeMoney(
    "property\\s*value|appraised\\s*value|sales?\\s*price|purchase\\s*price|home\\s*value|value|price",
  );
  let la = takeMoney("loan\\s*amount|new\\s*first(?:\\s*amount)?|\\bloan\\b|\\bmortgage\\b");

  if (ltv == null) {
    const pm = /([0-9]{1,3}(?:\.\d+)?)\s*%/.exec(work);
    if (pm) {
      ltv = Number(pm[1]);
      mask(pm.index, pm[0].length);
    }
  }
  // Remaining unlabelled numbers: large/unit ones fill value then loan (in field
  // order); a lone small number with no LTV yet is taken as the LTV.
  const bare: number[] = [];
  const g = new RegExp(TRI_AMT, "g");
  let mm: RegExpExecArray | null;
  while ((mm = g.exec(work))) {
    const v = parseAmountToken(mm[1], mm[2]);
    if (!Number.isFinite(v)) continue;
    if (mm[2] || v >= 1000) bare.push(v);
    else if (ltv == null && v <= 100) ltv = v;
  }
  let bi = 0;
  if (pv == null && bi < bare.length) pv = bare[bi++];
  if (la == null && bi < bare.length) la = bare[bi++];

  // Solve the triangle from any two knowns (down payment bridges value↔loan).
  let P = pv ?? 0;
  let L = la ?? 0;
  let V = ltv ?? 0;
  if (down && down > 0) {
    if (P > 0 && L === 0) L = Math.max(0, P - down);
    else if (L > 0 && P === 0) P = L + down;
  }
  const capLtv = (n: number) => Math.min(100, Math.max(0, n));
  if (P > 0 && L > 0) V = capLtv(Math.round((L / P) * 100));
  else if (P > 0 && V > 0) L = Math.round(P * (V / 100));
  else if (L > 0 && V > 0) P = Math.round(L / (V / 100));
  if (!(P > 0 && L > 0)) return null;

  const spec = loanDetailsFieldSpec(form);
  const showEFL = spec.showExistingFirstLien;
  const showHCLTV = spec.showCltv;
  const showCash = spec.showCash;

  const patch: Partial<WizardForm> = {
    valueSalesPrice: String(P),
    loanAmount: String(L),
    ltv: String(V),
  };
  let eflNum = 0;
  if (showEFL) {
    eflNum = efl ?? (Number(String(form.existingFirstLien).replace(/[^0-9.]/g, "")) || 0);
    if (efl != null) patch.existingFirstLien = String(efl);
  }
  if (showHCLTV) patch.cltv = String(P > 0 ? Math.round(((L + eflNum) / P) * 100) : 0);
  if (showCash && cash != null) patch.cashInHandRequest = String(cash);
  // Standalone HELOC: a typed cash figure is the day-one draw, not a cash-out request.
  if (spec.showHelocDraw && cash != null) patch.helocInitialDraw = String(cash);

  const parts = [`Value ${money(P)}`, `Loan ${money(L)}`, `LTV ${V}%`];
  if (showHCLTV && patch.cltv) parts.push(`CLTV ${patch.cltv}%`);
  if (showCash && cash != null) parts.push(`Cash-out ${money(cash)}`);
  if (spec.showHelocDraw && cash != null) parts.push(`Draw ${money(cash)}`);
  return { patch, label: parts.join(" · ") };
}

/** Context-aware placeholder for the composer, hinting what the active question accepts. */
function composerHint(q: FormChatQuestion | null, form: WizardForm): string {
  if (!q) return "Type your answer, or an option letter (A, B, C…)";
  if (q.special === "triangle")
    return "Type the figures — e.g. “value 500k, loan 400k” or “500,000 at 80%”";
  if (q.kind === "state") return "Type the state — e.g. Texas or TX";
  if (q.special === "county_search") return "Search for the county in the selected state";
  if (q.special === "geo_followup") {
    const fld = nextRequiredGeoField(form);
    if (fld?.widget === "select") return "Pick a letter (A, B, C…) or type the option name";
    if (fld?.widget === "zip") return "Enter the 5-digit ZIP code";
    return "Type the city / ZIP, or pick from the list";
  }
  if (q.id === "decisionCreditScore") return "Type the credit score — e.g. 720";
  if (q.kind === "currency" || q.kind === "number")
    return `Type a number${q.placeholder ? ` — ${q.placeholder}` : ""}…`;
  // The bundle is the only special card that can't take chat input; credit-event
  // and product-pref cards accept letter answers, so they use the default hint.
  if (q.special === "capacity_dti_bundle") return "Use the options above to answer this one";
  if (q.priority === "optional") return "Type an option letter (A, B…), or Skip";
  return "Type your answer, or an option letter (A, B, C…)";
}

// ── Message transcript model ─────────────────────────────────────────────────
type ChatMessage =
  | {
      kind: "assistant";
      id: string;
      paragraphs?: readonly string[];
      text?: string;
      /** Compact status bubble (Know More / follow-up RAG). */
      variant?: "thinking" | "default" | "submit-gate";
      thinkingLabel?: string;
      /** Cycled status lines while loading (RAG / Know More fetch). */
      thinkingLabels?: readonly string[];
      /** Post-submit reply from `/api/chat` (results Q&A). */
      ragReply?: boolean;
    }
  | { kind: "user"; id: string; text: string }
  | {
      kind: "answered";
      id: string;
      qId: string;
      prompt: string;
      section: number;
      sectionName: string;
      answerLabel: string;
    }
  // Labelled scenario-notes bubble ("Scenario Notes : …") with a Change button.
  | { kind: "scenario-note"; id: string; text: string; empty?: boolean }
  // Post-submit results, rendered in-chat (see the results experience stages).
  | { kind: "results"; id: string; programs: EligibleProgram[] }
  | { kind: "suggestion"; id: string }
  | { kind: "program-detail"; id: string; program: EligibleProgram }
  | { kind: "exclusions"; id: string };

// Minimal shape of the Web Speech API we rely on (avoids depending on lib.dom types).
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
}

export function FormChatFlow({
  form,
  setForm,
  mode,
  onComplete,
  eligibleCount,
  totalCount = 30,
  previewOpen = false,
  previewLoading = false,
  previewPrograms = [],
  onTogglePreview,
  onResetScenario,
  submitted = false,
  loading = false,
  matched = [],
  dirtySinceSubmit = false,
  canResubmit = false,
  highlightProfileGaps = false,
  onResubmit,
  onDownloadPdf,
  onSaveScenario,
  saveLabel = "Save Scenario",
  canSaveToVault = true,
  onClearRestart,
  onGoHome,
  onFormImported,
  onBackToVault,
  vaultScenarioOpen = false,
  reloadingSavedResults = false,
  resultsReady = false,
  productPrefs,
  geoExclusions = [],
  overlayExclusions = [],
  nearMisses = [],
  onAsk,
  priorChatThread = [],
}: {
  form: WizardForm;
  setForm: (updater: (prev: WizardForm) => WizardForm) => void;
  mode: FormChatMode;
  onComplete: () => void;
  /** Real-time eligible-program count (from the quick-scan). */
  eligibleCount: number;
  totalCount?: number;
  previewOpen?: boolean;
  previewLoading?: boolean;
  previewPrograms?: EligibleProgram[];
  onTogglePreview?: () => void;
  /** Reset the owner's eligibility state (programs + counter) on a scenario reset. */
  onResetScenario?: () => void;
  // ── Post-submit results (rendered in-chat) ──
  /** True once the owner has run final eligibility. */
  submitted?: boolean;
  /** Eligibility request in flight. */
  loading?: boolean;
  /** Final matched programs from the owner's eligibility run. */
  matched?: EligibleProgram[];
  /** Profile edited since the last submitted run (drives the Resubmit affordance). */
  dirtySinceSubmit?: boolean;
  /** All mandatory inputs present, so a resubmit would actually run. */
  canResubmit?: boolean;
  /** Highlight missing required rows in the profile sidebar (e.g. after a blocked submit). */
  highlightProfileGaps?: boolean;
  onResubmit?: () => void;
  onDownloadPdf?: () => void;
  onSaveScenario?: () => void;
  /** Label for the save/store pill — "Save Scenario" (new/clone) vs "Update Scenario" (edit). */
  saveLabel?: string;
  /** False when this scenario is already stored — re-enables after profile edits. */
  canSaveToVault?: boolean;
  onClearRestart?: () => void;
  /** Return to welcome home — hides profile sidebar, exits intake/results UI. */
  onGoHome?: () => void;
  /** After 1003 / URLA upload — e.g. open the profile sidebar. */
  onFormImported?: () => void;
  /** Return to Scenario Vault (replaces Reset in results actions when opened from vault). */
  onBackToVault?: () => void;
  /** A saved vault scenario is open — Reset leaves it unchanged and starts a new scenario at home. */
  vaultScenarioOpen?: boolean;
  /** Vault Edit/Clone — show reload copy instead of first-run eligibility messaging. */
  reloadingSavedResults?: boolean;
  /** Eligibility finished (`detailPhase === "complete"`) — restore results after refresh. */
  resultsReady?: boolean;
  /** Product-preference styling for the in-chat Know More card. */
  productPrefs?: ProductDisplayPrefs;
  /** Exclusion lists for the "Understand Exclusions" card. */
  geoExclusions?: ProgramExclusion[];
  overlayExclusions?: ProgramExclusion[];
  /** Programs that just missed eligibility (shown as "Just Missed"). */
  nearMisses?: NearMissProgram[];
  /** Results-mode follow-up Q&A (RAG). Pass `program` when Know More detail is open. */
  onAsk?: (question: string, opts?: { program?: EligibleProgram }) => Promise<string>;
  /** Retained /chat intake thread, rendered read-only above results so the chat isn't lost. */
  priorChatThread?: readonly ChatThreadMsg[];
}) {
  const includeOptional = mode === "underwriter";

  // Resume mid-intake (e.g. reload) or history restore — skip welcome when form already has data.
  const bootStarted = submitted || isAnswered(form, FORM_CHAT_QUESTIONS[0]);
  const mandatoryDoneAtBoot =
    bootStarted &&
    nextFormChatQuestion(form, {
      includeOptional,
      answeredQIds: formAnsweredQIdsFromForm(form),
    }) === null;
  const restoreResultsOnBoot = submitted && resultsReady;

  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const [hasStarted, setHasStarted] = useState(bootStarted);
  /** False until the welcome paragraphs finish streaming (Start button + Start input). */
  const [welcomeStreamDone, setWelcomeStreamDone] = useState(bootStarted);
  const [formUploadLoading, setFormUploadLoading] = useState(false);
  const [importedFieldKeys, setImportedFieldKeys] = useState<Set<string>>(() => new Set());
  const formFileInputRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Welcome stays at index 0 forever (hidden once started; only Reset wipes it).
    const welcome: ChatMessage = {
      kind: "assistant",
      id: "welcome",
      paragraphs: buildFormWelcomeParagraphs(isMobileWelcomeViewport()),
    };
    // Resume / vault load / post-submit: rebuild the answered transcript from the
    // form so the user can scroll up and Change any prior answer.
    const base = bootStarted
      ? [welcome, ...buildAnsweredMessagesFromForm(form, { includeOptional })]
      : [welcome];
    if (!restoreResultsOnBoot) return base;
    return [...base, ...buildRestoredResultsTail(matched)];
  });
  const [currentQ, setCurrentQ] = useState<FormChatQuestion | null>(() => {
    if (submitted) return null;
    if (!bootStarted) return null;
    const ids = formAnsweredQIdsFromForm(form);
    return nextFormChatQuestion(form, { includeOptional, answeredQIds: ids });
  });

  const [draft, setDraft] = useState("");
  const [chatInput, setChatInput] = useState("");
  const composerInputRef = useRef<HTMLInputElement>(null);
  /** True while Change on scenario notes — next send replaces (does not append). */
  const [scenarioNotesEditMode, setScenarioNotesEditMode] = useState(false);
  const [eventSel, setEventSel] = useState<string[]>([]);
  /** After Continue on event types — one event at a time on the timeline screen. */
  const [creditEventsTimelineOpen, setCreditEventsTimelineOpen] = useState(false);
  const [creditEventTimelineIdx, setCreditEventTimelineIdx] = useState(0);
  const [loanTermDraft, setLoanTermDraft] = useState("");
  // Bumped when a chatbox triangle answer needs an extra field, to remount the
  // grouped LoanDetails so it reflects the value/loan/LTV typed in the message box.
  const [triangleSeedKey, setTriangleSeedKey] = useState(0);
  // id of the answered message currently being re-asked in place (via Change / sidebar)
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  /** Set when editing via sidebar if we need the question spec without a transcript row. */
  const [editingQId, setEditingQId] = useState<string | null>(null);
  /** Specific sub-field clicked in the sidebar (e.g. a capacity field), so a grouped
   *  question can open directly at that field instead of from its first step. */
  const [editFieldHint, setEditFieldHint] = useState<string | null>(null);
  const [highlightGapsLocal, setHighlightGapsLocal] = useState(false);
  const showProfileGaps = highlightProfileGaps || highlightGapsLocal;

  const idRef = useRef(restoreResultsOnBoot ? 100 : 0);
  const nextId = () => `m${++idRef.current}`;
  /** Question to show only after a specific assistant line finishes streaming. */
  const pendingRevealQRef = useRef<FormChatQuestion | null>(null);
  const streamGateMsgIdRef = useRef<string | null>(null);
  const [streamGateMsgId, setStreamGateMsgId] = useState<string | null>(null);
  /** After a streamed results headline, append the table + suggestion pills. */
  type ResultsTailPending = {
    introId: string;
    resultsId: string;
    suggestionId: string;
    programs: EligibleProgram[];
  };
  const exitResultsTailRef = useRef<ResultsTailPending | null>(null);
  /** Program picked for Know More before the detail card is appended (API scoping only). */
  const knowMoreFocusProgramRef = useRef<EligibleProgram | null>(null);
  const eligibleResultsTailRef = useRef<ResultsTailPending | null>(null);
  const revealQuestionDelayRef = useRef<number | null>(null);
  const resultsRevealDelayRef = useRef<number | null>(null);
  /** Pre-submit line id — eligibility starts only after this bubble finishes streaming. */
  const preSubmitGateMsgIdRef = useRef<string | null>(null);
  /** Scenario-notes invite line — scroll again when streaming finishes. */
  const scenarioNotesPromptMsgIdRef = useRef<string | null>(null);
  const pendingSubmitAfterPreludeRef = useRef<string | null>(null);
  const pendingSubmitAfterPreludeTimerRef = useRef<number | null>(null);
  /** Guards against duplicate onComplete (button/Enter vs. prelude stream callback). */
  const eligibilitySubmitStartedRef = useRef(false);
  /** True while the pre-submit prelude is streaming — hides the manual Submit CTA. */
  const [awaitingPreludeSubmit, setAwaitingPreludeSubmit] = useState(false);
  useEffect(
    () => () => {
      if (revealQuestionDelayRef.current != null) {
        window.clearTimeout(revealQuestionDelayRef.current);
      }
      if (resultsRevealDelayRef.current != null) {
        window.clearTimeout(resultsRevealDelayRef.current);
      }
      if (pendingSubmitAfterPreludeTimerRef.current != null) {
        window.clearTimeout(pendingSubmitAfterPreludeTimerRef.current);
      }
    },
    [],
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  /** Sentinel at the end of the thread — scrollIntoView works more reliably on mobile Safari than scrollTop alone. */
  const chatEndRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  /** When true, chat scroll stays pinned to a panel rather than auto-following to bottom. */
  const pinScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);

  // The question currently being edited in place (if any).
  const editingMsg = editingMsgId
    ? messages.find((m) => m.id === editingMsgId && m.kind === "answered")
    : undefined;
  const editedQ =
    editingMsg && editingMsg.kind === "answered"
      ? (FORM_CHAT_QUESTIONS.find((q) => q.id === editingMsg.qId) ?? null)
      : editingQId
        ? (FORM_CHAT_QUESTIONS.find((q) => q.id === editingQId) ?? null)
        : null;
  const isEditing = !!(editingMsgId || editingQId);
  // Keyboard / chat input answer the edited question while editing, else the active one.
  const targetQ = editedQ ?? currentQ;

  // Truly complete only when no question remains and we're not mid-edit — independent of
  // the brief gap while a question waits to reveal after a streamed assistant line.
  const answeredQIds = useMemo(() => {
    const fromMessages = new Set<string>();
    for (const m of messages) if (m.kind === "answered") fromMessages.add(m.qId);
    // Welcome home: don't mirror orphan form values into the sidebar — only chat turns count.
    if (!hasStarted && !submitted) return fromMessages;
    if (submitted) return formAnsweredQIdsFromForm(form, fromMessages);
    const merged = new Set(fromMessages);
    for (const id of formAnsweredQIdsFromForm(form, fromMessages)) merged.add(id);
    return merged;
  }, [form, messages, submitted, hasStarted]);

  /** Reset enabled once intake started, results are showing, or the profile has data. */
  const profileResetActive = useMemo(
    () =>
      submitted || hasStarted || answeredQIds.size > 0 || formAnsweredQIdsFromForm(form).size > 0,
    [submitted, hasStarted, answeredQIds, form],
  );

  /** Set when an upstream edit prunes or invalidates downstream answers. */
  const [flowInvalidatedByEdit, setFlowInvalidatedByEdit] = useState(false);

  const staleAnswersAfterGap = useMemo(
    () => formChatHasStaleAnswersAfterGap(form, answeredQIds, includeOptional),
    [form, answeredQIds, includeOptional],
  );

  const formInconsistent = useMemo(() => {
    if (isEditing) return false;
    if (hasStarted && !submitted && flowInvalidatedByEdit && staleAnswersAfterGap) return true;
    return false;
  }, [isEditing, submitted, hasStarted, flowInvalidatedByEdit, staleAnswersAfterGap]);

  useEffect(() => {
    if (!flowInvalidatedByEdit) return;
    if (!staleAnswersAfterGap && mandatoryComplete(form)) {
      setFlowInvalidatedByEdit(false);
    }
  }, [flowInvalidatedByEdit, staleAnswersAfterGap, form]);

  useEffect(() => {
    if (submitted && dirtySinceSubmit && canResubmit) {
      setFlowInvalidatedByEdit(false);
    }
  }, [submitted, dirtySinceSubmit, canResubmit]);

  /** Pruned transcript rows leave a stale editingMsgId — fall back to editingQId UI. */
  useEffect(() => {
    if (!editingMsgId) return;
    const exists = messages.some((m) => m.id === editingMsgId && m.kind === "answered");
    if (!exists) setEditingMsgId(null);
  }, [editingMsgId, messages]);

  /** Program detail or exclusions is open above the latest results table — lock scenario actions. */
  const resultsSubPanelOpen = useMemo(() => isViewingResultsSubPanel(messages), [messages]);

  /** Only the latest results / suggestion row stays actionable after Back to All Matches. */
  const lastResultsMsgId = useMemo(() => lastMessageIdOfKind(messages, "results"), [messages]);
  const lastSuggestionMsgId = useMemo(
    () => lastMessageIdOfKind(messages, "suggestion"),
    [messages],
  );
  const activeProgramDetailId = useMemo(() => {
    if (!resultsSubPanelOpen) return null;
    const lastResultsIdx = lastResultsMessageIndex(messages);
    if (lastResultsIdx < 0) return null;
    let exitBeforeIdx = messages.length;
    for (let i = messages.length - 1; i > lastResultsIdx; i--) {
      const m = messages[i];
      if (m.kind === "results") break;
      if (m.kind === "assistant" && m.text?.trim() === BACK_TO_RESULTS_LIST_TEXT) {
        exitBeforeIdx = i;
        break;
      }
    }
    for (let i = exitBeforeIdx - 1; i > lastResultsIdx; i--) {
      if (messages[i].kind === "program-detail") return messages[i].id;
    }
    return null;
  }, [messages, resultsSubPanelOpen]);

  /** Program card open after Know More — follow-up Q&A must stay scoped to this program only. */
  const focusedResultsProgram = useMemo((): EligibleProgram | null => {
    if (!resultsSubPanelOpen) return null;
    return programDetailAfterResults(messages) ?? knowMoreFocusProgramRef.current;
  }, [messages, resultsSubPanelOpen]);

  useEffect(() => {
    if (!resultsSubPanelOpen) knowMoreFocusProgramRef.current = null;
  }, [resultsSubPanelOpen]);

  const activeExclusionId = useMemo(
    () => (resultsSubPanelOpen ? lastMessageIdOfKind(messages, "exclusions") : null),
    [messages, resultsSubPanelOpen],
  );

  const questionsDone =
    hasStarted &&
    !isEditing &&
    nextFormChatQuestion(form, { includeOptional, answeredQIds }) === null;

  /** Post-submit: intake re-ask finished (no gaps, not mid-edit). */
  const intakeFlowComplete = questionsDone && !staleAnswersAfterGap;

  // The bar shows for ANY dirty post-submit state; the button disables (with a
  // pointer at the gaps) until the re-asked fields are answered — hiding it
  // entirely left users with no resubmit affordance mid-edit.
  const showResubmitBar = submitted && dirtySinceSubmit;
  const resubmitReady = intakeFlowComplete && canResubmit;

  type ScenarioNotesPhase = "idle" | "prompted" | "processing" | "pre_submit" | "ready";
  const [scenarioNotesPhase, setScenarioNotesPhase] = useState<ScenarioNotesPhase>(() => {
    if (submitted) return "idle";
    return "idle";
  });
  /** True once the LO explicitly skipped scenario notes (shows "No inputs" in the sidebar). */
  const [scenarioNotesSkipped, setScenarioNotesSkipped] = useState(() => {
    const notes = (form.scenarioNotes ?? "").trim();
    return !notes && mandatoryDoneAtBoot && bootStarted;
  });
  const scenarioNotesPromptedRef = useRef(mandatoryDoneAtBoot && bootStarted && !submitted);
  // ── message helpers ────────────────────────────────────────────────────────
  const pushAssistant = (text: string) => {
    const id = nextId();
    setMessages((m) => [...m, { kind: "assistant", id, text }]);
    // Assistant messages always append at the END of the thread — follow them.
    stickToBottomRef.current = true;
    scrollToBottom();
    return id;
  };

  /** Single stable thinking skeleton; optionally replaces a prior thinking message. */
  const pushThinkingLine = (opts?: {
    replaceId?: string;
    label?: string;
    labels?: readonly string[];
  }) => {
    const id = nextId();
    setMessages((m) => [
      ...(opts?.replaceId ? m.filter((msg) => msg.id !== opts.replaceId) : m),
      {
        kind: "assistant",
        id,
        variant: "thinking",
        thinkingLabel: opts?.label,
        thinkingLabels: opts?.labels,
      },
    ]);
    return id;
  };

  const clearRevealQuestionDelay = () => {
    if (revealQuestionDelayRef.current != null) {
      window.clearTimeout(revealQuestionDelayRef.current);
      revealQuestionDelayRef.current = null;
    }
  };

  /** Brief pause after an answer (or streamed intro) before the next question card shows. */
  const scheduleRevealQuestion = (q: FormChatQuestion | null) => {
    clearRevealQuestionDelay();
    setCurrentQ(null);
    if (!q) return;
    revealQuestionDelayRef.current = window.setTimeout(() => {
      revealQuestionDelayRef.current = null;
      setCurrentQ(q);
      // Revealing a question is an intentional content change — always follow it
      // (state/county cards were appearing below the fold when the follow had
      // been released by an earlier scroll).
      stickToBottomRef.current = true;
      scrollToBottom();
    }, QUESTION_REVEAL_DELAY_MS);
  };

  const onAssistantStreamDone = (msgId: string) => {
    if (streamGateMsgIdRef.current !== msgId) return;
    streamGateMsgIdRef.current = null;
    setStreamGateMsgId(null);
    const q = pendingRevealQRef.current;
    pendingRevealQRef.current = null;
    scheduleRevealQuestion(q);
  };

  const triggerEligibilitySubmit = (opts?: { delayMs?: number }) => {
    if (eligibilitySubmitStartedRef.current || submitted) return;
    eligibilitySubmitStartedRef.current = true;
    pendingSubmitAfterPreludeRef.current = null;
    if (pendingSubmitAfterPreludeTimerRef.current != null) {
      window.clearTimeout(pendingSubmitAfterPreludeTimerRef.current);
      pendingSubmitAfterPreludeTimerRef.current = null;
    }
    const run = () => onComplete();
    const delay = opts?.delayMs ?? 0;
    if (delay > 0) {
      pendingSubmitAfterPreludeTimerRef.current = window.setTimeout(() => {
        pendingSubmitAfterPreludeTimerRef.current = null;
        run();
      }, delay);
    } else {
      run();
    }
  };

  const scheduleSubmitAfterPrelude = (msgId: string) => {
    if (pendingSubmitAfterPreludeRef.current !== msgId) return;
    pendingSubmitAfterPreludeRef.current = null;
    triggerEligibilitySubmit({ delayMs: PRE_SUBMIT_TO_SCAN_DELAY_MS });
  };

  /** Hide the active question until ``assistantMsgId`` has finished streaming. */
  const queueQuestionAfterStream = (q: FormChatQuestion | null, assistantMsgId: string) => {
    clearRevealQuestionDelay();
    setCurrentQ(null);
    if (!q) {
      pendingRevealQRef.current = null;
      streamGateMsgIdRef.current = null;
      setStreamGateMsgId(null);
      return;
    }
    pendingRevealQRef.current = q;
    streamGateMsgIdRef.current = assistantMsgId;
    setStreamGateMsgId(assistantMsgId);
  };
  const pushUser = (text: string) => {
    setMessages((m) => [...m, { kind: "user", id: nextId(), text }]);
    // The user's own entry always pulls the thread down (mirrors pushAssistant).
    stickToBottomRef.current = true;
    scrollToBottom();
  };
  const pushAnswered = (q: FormChatQuestion, answerLabel: string) =>
    setMessages((m) => [
      ...m,
      {
        kind: "answered",
        id: nextId(),
        qId: q.id,
        prompt: resolveFormChatPrompt(form, q),
        section: q.section,
        sectionName: q.sectionName,
        answerLabel,
      },
    ]);

  useEffect(() => {
    if (!submitted) {
      eligibilitySubmitStartedRef.current = false;
      return;
    }
    setAwaitingPreludeSubmit(false);
  }, [submitted]);

  // History restore / post-submit: stay on results — don't re-ask intake questions.
  useEffect(() => {
    if (!submitted) return;
    setHasStarted(true);
    setWelcomeStreamDone(true);
    setCurrentQ(null);
    setEditingMsgId(null);
    setEditingQId(null);
    setCreditEventsTimelineOpen(false);
    clearRevealQuestionDelay();
  }, [submitted]);

  // ── Post-submit: surface eligibility results inside the chat ───────────────
  // The owner (LoanWizard) runs the real eligibility request when onComplete
  // fires; we watch `submitted`/`loading`/`matched` and push the results +
  // suggestion messages once the run settles.
  const resultsPhaseRef = useRef<"idle" | "running" | "shown">(
    restoreResultsOnBoot ? "shown" : "idle",
  );
  const runningMsgIdRef = useRef<string | null>(null);
  const rerunRef = useRef(false);
  useEffect(() => {
    if (!submitted) {
      resultsPhaseRef.current = "idle";
      runningMsgIdRef.current = null;
      rerunRef.current = false;
      eligibleResultsTailRef.current = null;
      return;
    }
    if (loading) {
      // First run (idle→running) AND a resubmit after edits (shown→running).
      if (resultsPhaseRef.current !== "running") {
        rerunRef.current = resultsPhaseRef.current === "shown";
        resultsPhaseRef.current = "running";
        const id = nextId();
        runningMsgIdRef.current = id;
        setMessages((m) => {
          // On a resubmit, drop the previous results conversation so the new
          // run replaces it instead of stacking below.
          const base = rerunRef.current ? m.filter((msg) => !isResultsConversationMsg(msg)) : m;
          return [
            ...base,
            {
              kind: "assistant",
              id,
              variant: "thinking",
              thinkingLabels: rerunRef.current
                ? ELIGIBILITY_REFRESH_LABELS
                : reloadingSavedResults
                  ? ELIGIBILITY_RELOAD_LABELS
                  : ELIGIBILITY_THINKING_LABELS,
            },
          ];
        });
        stickToBottomRef.current = true;
        scrollToBottom();
      }
      return;
    }
    // Only show results once we've actually observed the run (loading=true),
    // so a transient submitted=true / loading=false render with no programs
    // yet can't post a premature "Found 0 programs".
    if (resultsPhaseRef.current === "running") {
      resultsPhaseRef.current = "shown";
      const runId = runningMsgIdRef.current;
      runningMsgIdRef.current = null;
      const n = matched.length;
      const introId = nextId();
      eligibleResultsTailRef.current = {
        introId,
        resultsId: nextId(),
        suggestionId: nextId(),
        programs: matched,
      };
      setMessages((m) => [
        ...m.filter((msg) => msg.id !== runId),
        { kind: "assistant", id: introId, text: eligibilityResultsHeadline(n) },
      ]);
      stickToBottomRef.current = true;
      scrollToBottom();
    } else if (
      resultsPhaseRef.current === "idle" &&
      resultsReady &&
      !messages.some((m) => m.kind === "results")
    ) {
      // Saved scenario reopen (FormChatFlow remounted after eligibility already ran).
      resultsPhaseRef.current = "shown";
      const n = matched.length;
      const introId = nextId();
      eligibleResultsTailRef.current = {
        introId,
        resultsId: nextId(),
        suggestionId: nextId(),
        programs: matched,
      };
      setMessages((m) => [
        ...m.filter((msg) => !isResultsConversationMsg(msg)),
        { kind: "assistant", id: introId, text: eligibilityResultsHeadline(n) },
      ]);
      stickToBottomRef.current = true;
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, loading, matched]);

  // Borrower snapshot the Know More card compares program limits against.
  const scenarioSnapshot = useMemo<ScenarioSnapshot>(
    () => ({
      fico: form.decisionCreditScore ? Number(form.decisionCreditScore) : null,
      loanAmount: form.loanAmount ? Number(String(form.loanAmount).replace(/[,$\s]/g, "")) : null,
      ltv: form.ltv ? Number(form.ltv) : null,
      cltv: form.cltv ? Number(form.cltv) : null,
      usesCltvLeverage: usesCltvLeverageField(form.isSecondLien, form.existingSecondLien),
      dti: form.estimatedDti ? Number(form.estimatedDti) : null,
      dscr: form.dscr ? Number(form.dscr) : null,
      occupancy: form.occupancy || null,
      docType: form.documentationType || null,
    }),
    [form],
  );

  // Know More → status placeholders while summarize-notes runs, then stream the card.
  const handleKnowMore = (program: EligibleProgram) => {
    if (isViewingResultsSubPanel(messages)) return;
    pinScrollRef.current = false;
    knowMoreFocusProgramRef.current = program;
    const displayName = programDisplayName(program);
    pushUser(`Know more: ${displayName}`);
    pinChatToBottom("smooth");

    const detailId = nextId();
    const rawNotes = [
      ...(program.special_overlay ? [program.special_overlay] : []),
      ...filterNotesForSummarize(program.rag_notes ?? []),
    ];

    const thinkingId = pushThinkingLine({ labels: KNOW_MORE_THINKING_LABELS });
    pinChatToBottom("smooth");

    void (async () => {
      const progReady = await summarizeProgramNotes(program, rawNotes);

      setMessages((m) => [
        ...m.filter((msg) => msg.id !== thinkingId),
        { kind: "program-detail", id: detailId, program: progReady },
      ]);
      pinChatToBottom("smooth");
      scrollThreadBlockIntoView(`[data-detail="${detailId}"]`);
    })();
  };
  // Back to All Matches: keep ALL history, append a note + repopulate the results
  // table and option pills below so everything stays in the one chat thread.
  const handleExitProgram = () => {
    knowMoreFocusProgramRef.current = null;
    const lastResults = [...messages].reverse().find((m) => m.kind === "results");
    const programs = lastResults && lastResults.kind === "results" ? lastResults.programs : matched;
    const introId = nextId();
    exitResultsTailRef.current = {
      introId,
      resultsId: nextId(),
      suggestionId: nextId(),
      programs,
    };
    setMessages((prev) => [
      ...prev,
      { kind: "assistant", id: introId, text: BACK_TO_RESULTS_LIST_TEXT },
    ]);
    stickToBottomRef.current = true;
    scrollToBottom();
  };

  const handleShowExclusions = () => {
    if (isViewingResultsSubPanel(messages)) return;
    pushUser("Understand exclusions");
    setMessages((m) => [...m, { kind: "exclusions", id: nextId() }]);
  };

  // Post-submit follow-up Q&A (RAG) — keeps everything in the one chat thread.
  const [asking, setAsking] = useState(false);
  /** Program-detail cards whose product/considerations stream has finished. */
  const [knowMoreStreamReadyIds, setKnowMoreStreamReadyIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [messageFeedback, setMessageFeedback] = useState<Record<string, "up" | "down">>({});
  const setFeedbackVote = useCallback((id: string, vote: MessageFeedbackVote) => {
    setMessageFeedback((prev) => {
      if (vote == null) {
        if (!(id in prev)) return prev;
        const { [id]: _removed, ...rest } = prev;
        return rest;
      }
      if (prev[id] === vote) return prev;
      return { ...prev, [id]: vote };
    });
  }, []);
  const markKnowMoreStreamReady = (detailId: string) => {
    setKnowMoreStreamReadyIds((prev) => {
      if (prev.has(detailId)) return prev;
      const next = new Set(prev);
      next.add(detailId);
      return next;
    });
  };
  const deleteRagExchange = (assistantMsgId: string) => {
    setMessageFeedback((prev) => {
      if (!(assistantMsgId in prev)) return prev;
      const { [assistantMsgId]: _removed, ...rest } = prev;
      return rest;
    });
    setMessages((m) => {
      const idx = m.findIndex((msg) => msg.id === assistantMsgId);
      if (idx < 0) return m;
      const copy = [...m];
      if (idx > 0 && copy[idx - 1]?.kind === "user") {
        copy.splice(idx - 1, 2);
      } else {
        copy.splice(idx, 1);
      }
      return copy;
    });
  };

  const askResultsQuestion = async (question: string) => {
    const q = question.trim();
    if (!q || asking) return;

    if (isResultsNavigationCommand(q)) {
      if (isViewingResultsSubPanel(messages)) {
        pushUser(q);
        handleExitProgram();
      }
      return;
    }

    if (!onAsk) return;

    // Scope follow-up to the focused program using the canonical program title
    // (not the aliased display label) so retrieval anchors to guideline text.
    const canonicalProgramName = focusedResultsProgram
      ? formatMortgageAcronyms(
          (
            focusedResultsProgram.program_name_np ||
            focusedResultsProgram.program_name ||
            ""
          ).trim(),
        )
      : "";
    const cleanQ = q.replace(/^for\s+[^:]+:\s*/i, "").trim();
    const focusName = canonicalProgramName || (focusedResultsProgram ? programDisplayName(focusedResultsProgram) : "");
    const scopedQ =
      focusName && !cleanQ.toLowerCase().startsWith(`${focusName.toLowerCase()}:`)
        ? `${focusName}: ${cleanQ}`
        : cleanQ;
    const focusDisplayName = focusedResultsProgram ? programDisplayName(focusedResultsProgram) : "";
    const uiQ =
      focusDisplayName && !cleanQ.toLowerCase().startsWith(`${focusDisplayName.toLowerCase()}:`)
        ? `${focusDisplayName}: ${cleanQ}`
        : cleanQ;

    pinScrollRef.current = false;
    pushUser(uiQ);
    const loadingId = pushThinkingLine({ labels: RAG_FOLLOWUP_LABELS });
    setAsking(true);
    pinChatToBottom("smooth");
    try {
      const reply = await onAsk(scopedQ, {
        program: focusedResultsProgram ?? undefined,
      });
      const replyId = nextId();
      setMessages((m) => [
        ...m.filter((msg) => msg.id !== loadingId),
        { kind: "assistant", id: replyId, text: reply, ragReply: true },
      ]);
    } catch {
      setMessages((m) => [
        ...m.filter((msg) => msg.id !== loadingId),
        {
          kind: "assistant",
          id: nextId(),
          text: "Sorry — I couldn't fetch that right now. Please try again.",
          ragReply: true,
        },
      ]);
    } finally {
      setAsking(false);
      pinChatToBottom("smooth");
    }
  };

  // Re-evaluate the active question when underwriter mode toggles (optionals on/off).
  // Do NOT depend on `messages` / answeredQIds — a new Set each render was re-opening
  // the current question while the step intro was still streaming.
  useEffect(() => {
    if (submitted || !hasStarted || streamGateMsgIdRef.current) return;
    setCurrentQ((prev) => {
      if (
        prev &&
        (prev.priority === "mandatory" || includeOptional || isFormChatProductPrefQuestion(prev))
      ) {
        return prev;
      }
      return nextFormChatQuestion(form, { includeOptional, answeredQIds });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeOptional, submitted]);

  // Auto-scroll: follow the latest content as the chat grows (new messages,
  // streaming text, revealed controls). We track "stick to bottom" from the user's
  // own scrolling — so a tall new question still pins to the bottom, but scrolling
  // up to re-read releases the follow until they return to the bottom.
  useEffect(() => {
    const el = scrollContainerRef.current;
    const content = scrollContentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const onScroll = () => {
      const sh = el.scrollHeight;
      if (pinScrollRef.current) {
        lastScrollTopRef.current = el.scrollTop;
        lastScrollHeightRef.current = sh;
        return;
      }
      const dist = sh - el.scrollTop - el.clientHeight;
      // A genuine user scroll-up releases the auto-follow. But when a tall question
      // collapses to a chip the content shrinks and the browser clamps scrollTop
      // down — ignore that (scrollHeight shrank) so it isn't mistaken for a scroll-up.
      const userScrolledUp =
        el.scrollTop < lastScrollTopRef.current - 1 && sh >= lastScrollHeightRef.current - 1;
      if (userScrolledUp) stickToBottomRef.current = false;
      else if (dist < 40) stickToBottomRef.current = true;
      lastScrollTopRef.current = el.scrollTop;
      lastScrollHeightRef.current = sh;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      if (pinScrollRef.current || !stickToBottomRef.current) return;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTo({ top: max, behavior: "auto" });
    });
    ro.observe(content);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  // Warm geo config + refresh sidebar when API fields arrive (county labels, etc.).
  const [geoConfigRevision, setGeoConfigRevision] = useState(0);
  useEffect(() => {
    void fetchGeoConfig()
      .then(() => setGeoConfigRevision((r) => r + 1))
      .catch(() => {});
  }, []);

  // County/city/zip must come before rural & other collateral — re-surface if skipped
  // while config was still loading, after a state change, or post-submit re-ask.
  useEffect(() => {
    if (!hasStarted || editingMsgId || editingQId) return;

    const countyQ = FORM_CHAT_QUESTIONS.find((x) => x.special === "county_search");
    if (
      countyQ &&
      form.state.trim() &&
      !isFormChatQuestionAnswered(form, countyQ, answeredQIds) &&
      currentQ?.special !== "county_search" &&
      editingQId !== countyQ.id
    ) {
      const next = nextFormChatQuestion(form, { includeOptional, answeredQIds });
      if (next?.special === "county_search") {
        clearRevealQuestionDelay();
        streamGateMsgIdRef.current = null;
        setStreamGateMsgId(null);
        if (submitted) {
          editByQId(countyQ.id, undefined, { formSnapshot: form });
        } else {
          setCurrentQ(next);
          stickToBottomRef.current = true;
          scrollToBottom();
        }
        return;
      }
    }

    const geoQ = FORM_CHAT_QUESTIONS.find((x) => x.special === "geo_followup");
    if (!geoQ || !form.state.trim() || !countyNeedsGeoFollowUp(form.state, form.stateCounty))
      return;
    if (isFormChatQuestionAnswered(form, geoQ, answeredQIds)) return;
    const next = nextFormChatQuestion(form, { includeOptional, answeredQIds });
    if (next?.special !== "geo_followup" || currentQ?.special === "geo_followup") return;
    clearRevealQuestionDelay();
    streamGateMsgIdRef.current = null;
    setStreamGateMsgId(null);
    if (submitted) {
      editByQId(geoQ.id, undefined, { formSnapshot: form });
    } else {
      setCurrentQ(next);
      stickToBottomRef.current = true;
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    geoConfigRevision,
    form.state,
    form.stateCounty,
    form.stateCity,
    form.stateBorough,
    form.stateZipCode,
    form.isInBaltimoreCity,
    form.isInIndianapolis,
    form.isInPhiladelphia,
    form.isInMemphis,
    form.isInLubbock,
    hasStarted,
    submitted,
    includeOptional,
    answeredQIds,
    editingMsgId,
    editingQId,
    currentQ?.special,
  ]);

  // After structured questions, invite optional scenario notes via the bottom bar (once).
  useEffect(() => {
    if (!questionsDone || scenarioNotesPromptedRef.current || submitted) return;
    scenarioNotesPromptedRef.current = true;
    setScenarioNotesPhase("prompted");
    scenarioNotesPromptMsgIdRef.current = pushAssistant(FORM_SCENARIO_NOTES_PROMPT);
    pinChatToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionsDone]);

  // Underwriter-only mandatory questions (POA, non-arm's, tradelines, liquid assets) — not asked in LO.
  const skipOptionalQuestion = (q: FormChatQuestion) => {
    if (!canSkipFormChatQuestion(q, includeOptional)) return;
    const ids = new Set(answeredQIds);
    ids.add(q.id);
    if (editingMsgId || editingQId) {
      const editId =
        editingMsgId ?? messages.find((m) => m.kind === "answered" && m.qId === q.id)?.id ?? null;
      if (editId) {
        setMessages((m) =>
          m.map((msg) =>
            msg.kind === "answered" && msg.id === editId
              ? { ...msg, answerLabel: FORM_CHAT_SKIP_LABEL }
              : msg,
          ),
        );
        setEditingQId(null);
        setEditingMsgId(null);
        setEditFieldHint(null);
        scheduleRevealQuestion(nextFormChatQuestion(form, { includeOptional, answeredQIds: ids }));
        return;
      }
    }
    pushAnswered(q, FORM_CHAT_SKIP_LABEL);
    stickToBottomRef.current = true;
    scrollToBottom();
    advance(form, q, ids);
  };

  const offerPreSubmitGate = () => {
    if (submitted) return;
    setScenarioNotesPhase("pre_submit");
    const id = nextId();
    preSubmitGateMsgIdRef.current = id;
    setMessages((m) => [
      ...m,
      { kind: "assistant", id, text: PRE_SUBMIT_ASSISTANT_TEXT, variant: "submit-gate" },
    ]);
    pinChatToBottom("auto");
  };

  const finishScenarioNotesFlow = (opts?: { editing?: boolean }) => {
    if (opts?.editing) {
      if (!submitted) {
        offerPreSubmitGate();
        return;
      }
      setScenarioNotesPhase("idle");
      return;
    }
    if (!submitted) {
      offerPreSubmitGate();
      return;
    }
    setScenarioNotesPhase("idle");
  };

  /** Manual gate — eligibility runs only after Submit Profile (prelude already shown). */
  const beginProfileSubmit = () => {
    if (eligibilitySubmitStartedRef.current || submitted || scenarioNotesPhase !== "ready") return;
    if (!mandatoryComplete(form, { answeredQIds })) {
      setHighlightGapsLocal(true);
      toast.error("Please complete the required fields highlighted in your Mortgage Profile.");
      const next = nextFormChatQuestion(form, { includeOptional, answeredQIds });
      if (next) editByQId(next.id);
      return;
    }
    setScenarioNotesPhase("processing");
    triggerEligibilitySubmit({ delayMs: PRE_SUBMIT_TO_SCAN_DELAY_MS });
  };

  // Add/update the single labelled scenario-notes bubble in the chat (kept even when empty).
  const upsertScenarioNoteBubble = (notesText: string, opts?: { empty?: boolean }) => {
    const text = notesText.trim();
    const empty = opts?.empty ?? !text;
    setMessages((m) => {
      const idx = m.findIndex((msg) => msg.kind === "scenario-note");
      if (idx >= 0) {
        const copy = [...m];
        copy[idx] = {
          kind: "scenario-note",
          id: m[idx].id,
          text,
          empty: empty || undefined,
        };
        return copy;
      }
      return [...m, { kind: "scenario-note", id: nextId(), text, empty: empty || undefined }];
    });
  };

  const scrollScenarioNoteIntoView = () => {
    requestAnimationFrame(() => {
      scrollContentRef.current
        ?.querySelector('[data-scenario-note="true"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const openScenarioNotesComposer = (previous: string) => {
    setChatInput(previous);
    setScenarioNotesEditMode(true);
    setScenarioNotesSkipped(false);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const SCENARIO_NOTES_EDIT_ASSISTANT = "Please Edit your scenario below and resubmit.";

  // "Change" on the scenario-notes bubble / sidebar row — prepopulate composer for replace-edit.
  const handleEditScenarioNotes = () => {
    setMobileProfileOpen(false);
    const previous = (form.scenarioNotes ?? "").trim();
    upsertScenarioNoteBubble(previous, { empty: !previous });
    scrollScenarioNoteIntoView();
    openScenarioNotesComposer(previous);

    if (scenarioNotesPhase === "prompted") return;

    scenarioNotesPromptedRef.current = true;
    setScenarioNotesPhase("prompted");
    if (!submitted) {
      pushAssistant(SCENARIO_NOTES_EDIT_ASSISTANT);
      stickToBottomRef.current = true;
      scrollToBottom();
    }
  };

  const applyScenarioNotesAsEmpty = (isEdit: boolean) => {
    setScenarioNotesSkipped(true);
    setForm((prev) => ({ ...prev, scenarioNotes: "" }));
    upsertScenarioNoteBubble("", { empty: true });
    if (isEdit && submitted) {
      pushAssistant("Scenario notes cleared.");
    }
    finishScenarioNotesFlow({ editing: isEdit });
  };

  const submitOptionalScenarioNotes = async (raw: string) => {
    const val = raw.trim();
    if (!val || scenarioNotesPhase !== "prompted") return;
    const isEdit = scenarioNotesEditMode;
    setScenarioNotesEditMode(false);
    setChatInput("");
    pushUser(val);
    if (shouldTreatScenarioNotesAsSkip(val)) {
      applyScenarioNotesAsEmpty(isEdit);
      return;
    }
    setScenarioNotesSkipped(false);
    setScenarioNotesPhase("processing");
    pushAssistant("Got it — summarizing for your scenario notes…");
    let added: { text: string; paraphrase: string }[] = [];
    try {
      const extracted = await extractScenarioNotes(val, { source: "form" });
      if (extracted.length === 0) {
        applyScenarioNotesAsEmpty(isEdit);
        return;
      }
      added = extracted;
    } catch {
      if (isScenarioNotesGibberish(val)) {
        applyScenarioNotesAsEmpty(isEdit);
        return;
      }
      added = [{ text: val, paraphrase: val.length > 120 ? `${val.slice(0, 117)}…` : val }];
    }
    let nextNotes = "";
    const linesFromAdded = added.map((n) => n.paraphrase.trim()).filter(Boolean);
    setForm((prev) => {
      nextNotes = isEdit
        ? linesFromAdded.length
          ? linesFromAdded.join("\n")
          : val
        : mergeScenarioNotesText(prev.scenarioNotes, added);
      return { ...prev, scenarioNotes: nextNotes };
    });
    upsertScenarioNoteBubble(nextNotes, { empty: false });
    if (isEdit && submitted) {
      pushAssistant("Scenario notes updated.");
    }
    finishScenarioNotesFlow({ editing: isEdit });
  };

  const flushChatScroll = (behavior: ScrollBehavior = "auto") => {
    const container = scrollContainerRef.current;
    if (container) {
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTo({ top: max, behavior });
    }
    chatEndRef.current?.scrollIntoView({ behavior, block: "end" });
  };

  /** Scroll a newly appended block (Know More card, RAG reply) into the chat viewport. */
  const scrollThreadBlockIntoView = (selector: string) => {
    const run = () => {
      const container = scrollContainerRef.current;
      const el = scrollContentRef.current?.querySelector(selector) as HTMLElement | null;
      if (!container || !el) {
        flushChatScroll("smooth");
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const margin = 12;
      if (
        elRect.bottom > containerRect.bottom - margin ||
        elRect.top < containerRect.top + margin
      ) {
        const targetTop = elRect.top - containerRect.top + container.scrollTop - margin;
        const max = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTo({
          top: Math.min(max, Math.max(0, targetTop)),
          behavior: "smooth",
        });
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
    window.setTimeout(run, 150);
    window.setTimeout(run, 400);
  };

  // Snap to the bottom (after paint) when stuck — used by structural changes and
  // when a question reveals its controls. Retries through 600ms so tall option
  // grids (e.g. documentation type after Basics → Capacity) finish layout first.
  const flushChatScrollDeferred = (behavior: ScrollBehavior = "auto") => {
    const run = () => {
      if (!stickToBottomRef.current || pinScrollRef.current) return;
      flushChatScroll(behavior);
    };
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
    for (const ms of [100, 300, 600]) {
      window.setTimeout(run, ms);
    }
  };

  const scrollToBottom = () => {
    if (!stickToBottomRef.current) return;
    flushChatScrollDeferred("auto");
  };

  // ANY newly revealed question pulls the thread down — one rule for every reveal
  // path (answer flow, step transition, county/geo re-surface, optional picker).
  // Edit cards open in place mid-thread, so they're excluded.
  useEffect(() => {
    if (!currentQ || editingMsgId || editingQId || pinScrollRef.current) return;
    stickToBottomRef.current = true;
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQ?.id]);

  /** Center the eligible-programs table in the chat viewport (no auto-follow to bottom). */
  const scrollResultsTableIntoView = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        const anchors = scrollContentRef.current?.querySelectorAll('[data-results-anchor="true"]');
        const anchor = anchors?.length ? (anchors[anchors.length - 1] as HTMLElement) : null;
        if (!container || !anchor) return;
        const target =
          (anchor.querySelector('[data-results-programs="true"]') as HTMLElement | null) ?? anchor;
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetTop = targetRect.top - containerRect.top + container.scrollTop;
        const viewport = container.clientHeight;
        const maxScroll = Math.max(0, container.scrollHeight - viewport);
        const centered = targetTop + targetRect.height / 2 - viewport / 2;
        container.scrollTo({
          top: Math.min(maxScroll, Math.max(0, centered)),
          behavior: "smooth",
        });
      });
    });
  };

  const revealResultsTableAfterHeadline = (pending: ResultsTailPending) => {
    stickToBottomRef.current = false;
    if (resultsRevealDelayRef.current != null) {
      window.clearTimeout(resultsRevealDelayRef.current);
    }
    resultsRevealDelayRef.current = window.setTimeout(() => {
      resultsRevealDelayRef.current = null;
      setMessages((prev) => [
        ...prev,
        { kind: "results", id: pending.resultsId, programs: pending.programs },
        { kind: "suggestion", id: pending.suggestionId },
      ]);
      scrollResultsTableIntoView();
    }, RESULTS_TABLE_REVEAL_DELAY_MS);
  };

  // Bring the in-place edit into view (centered) — used when a question is re-opened
  // from the sidebar or "Change", so it scrolls UP to that question rather than to
  // the bottom of the chat, leaving any later answers visible below it.
  const scrollEditedIntoView = () => {
    requestAnimationFrame(() => {
      const el = scrollContentRef.current?.querySelector('[data-editing="true"]');
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  /** Pin chat scroll to the bottom of the thread (Know More, follow-up Q&A, streaming replies). */
  const pinChatToBottom = (behavior: ScrollBehavior = "auto") => {
    stickToBottomRef.current = true;
    pinScrollRef.current = false;
    flushChatScrollDeferred(behavior);
  };

  // Also follow to the bottom on structural changes (new message, step transition,
  // question reveal) — the ResizeObserver alone can miss these on mobile.
  useLayoutEffect(() => {
    if (isEditing || pinScrollRef.current) return;
    const inScenarioNotesTail =
      scenarioNotesPhase === "prompted" ||
      scenarioNotesPhase === "pre_submit" ||
      scenarioNotesPhase === "ready";
    if (inScenarioNotesTail) stickToBottomRef.current = true;
    if (!stickToBottomRef.current) return;
    flushChatScrollDeferred("auto");
  }, [
    messages,
    currentQ,
    scenarioNotesPhase,
    isEditing,
    creditEventsTimelineOpen,
    creditEventTimelineIdx,
    eventSel,
    form.creditEventDates,
    form.creditEventYears,
  ]);

  // ── start gate / 1003 · URLA upload ───────────────────────────────────────
  const beginIntakeFromPrefill = (
    merged: WizardForm,
    sourceLabel: string,
    filledCount: number,
    importedKeys: Set<string>,
  ) => {
    setHasStarted(true);
    setWelcomeStreamDone(true);
    setImportedFieldKeys(importedKeys);
    setCurrentQ(null);
    setEditingMsgId(null);
    setEditingQId(null);
    setCreditEventsTimelineOpen(false);
    clearRevealQuestionDelay();

    const ids = formAnsweredQIdsFromForm(merged);
    const first = nextFormChatQuestion(merged, { includeOptional, answeredQIds: ids });
    const prefilledTranscript = buildAnsweredMessagesFromForm(merged, {
      contiguousOnly: true,
      answeredQIds: ids,
      includeOptional,
    });
    const intro = `I imported your ${sourceLabel} and pre-filled ${filledCount} field${filledCount === 1 ? "" : "s"} in your profile (highlighted on the left). Below are the answers I pulled from the file — I'll only ask about what's still missing.`;
    const userMsgId = nextId();
    const introMsgId = nextId();
    const greetMsgId = nextId();

    setMessages([
      {
        kind: "assistant",
        id: "welcome",
        paragraphs: buildFormWelcomeParagraphs(isMobileWelcomeViewport()),
      },
      { kind: "user" as const, id: userMsgId, text: `Uploaded ${sourceLabel}` },
      { kind: "assistant" as const, id: introMsgId, text: intro },
      ...prefilledTranscript,
      ...(first
        ? [{ kind: "assistant" as const, id: greetMsgId, text: stepBeginGreeting(first) }]
        : []),
    ]);

    if (first) {
      queueQuestionAfterStream(first, greetMsgId);
    }
    stickToBottomRef.current = true;
    scrollToBottom();
    onFormImported?.();
  };

  const handleFormUpload = async (file: File) => {
    if (formUploadLoading || hasStarted || submitted) return;
    setFormUploadLoading(true);
    try {
      const result = await parseLoanFormFile(file);
      const patch = loanFormExtractToWizardPatch(result.fields);
      const merged = { ...form, ...patch } as WizardForm;
      setForm((prev) => ({ ...prev, ...patch }));
      const label = /\.pdf$/i.test(file.name) ? "1003 form" : "Fannie URLA file";
      beginIntakeFromPrefill(
        merged,
        label,
        result.filled_count,
        importedKeysFromExtract(result.fields, patch),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that loan file.");
    } finally {
      setFormUploadLoading(false);
      if (formFileInputRef.current) formFileInputRef.current.value = "";
    }
  };

  const handleStart = (typedValue?: string) => {
    if (hasStarted) return;
    const userText = typedValue?.trim() ? typedValue.trim() : "Start";
    setHasStarted(true);
    const first = nextFormChatQuestion(form, { includeOptional, answeredQIds });
    const greeting = stepBeginGreeting(first);
    const userMsgId = nextId();
    const greetingMsgId = nextId();
    setMessages((m) => [
      ...m,
      { kind: "user" as const, id: userMsgId, text: userText },
      { kind: "assistant" as const, id: greetingMsgId, text: greeting },
    ]);
    stickToBottomRef.current = true;
    scrollToBottom();
    queueQuestionAfterStream(first, greetingMsgId);
  };

  // ── advance to the next question (with a step-transition note) ─────────────
  const advance = (merged: WizardForm, fromQ: FormChatQuestion, ids: Set<string>) => {
    const next = nextFormChatQuestion(merged, { includeOptional, answeredQIds: ids });
    setDraft("");
    setEventSel([]);
    setCreditEventsTimelineOpen(false);
    setCreditEventTimelineIdx(0);
    setLoanTermDraft(loanTermDraftFromForm(merged, ids.has("loanTerm")));
    if (next?.special === "triangle") setTriangleSeedKey((k) => k + 1);
    // On a step change, stream the transition line first, then reveal the question.
    if (next && next.section !== fromQ.section) {
      const transition = `${fromQ.sectionName} done ✓ — now moving on to ${sectionIntro(next.sectionName)}.`;
      const transitionMsgId = pushAssistant(transition);
      queueQuestionAfterStream(next, transitionMsgId);
    } else {
      scheduleRevealQuestion(next);
    }
  };

  // Commit an answer — as a new turn during normal flow, or as an in-place edit.
  const commitAnswer = (q: FormChatQuestion, patch: Partial<WizardForm>, label: string) => {
    const scenarioCascade = formChatScenarioCascadePatch(q.id, form, patch);
    if (editingMsgId || editingQId) {
      const editId =
        editingMsgId ?? messages.find((m) => m.kind === "answered" && m.qId === q.id)?.id ?? null;
      if (editId) {
        applyEdit(editId, q, patch, label);
        return;
      }
      setForm((prev) => ({
        ...prev,
        ...patch,
        ...formChatScenarioCascadePatch(q.id, prev, patch),
      }));
      setImportedFieldKeys((prev) =>
        stripImportedKeys(prev, { ...patch, ...scenarioCascade }, form),
      );
      setEditingQId(null);
      setEditFieldHint(null);
      setDraft("");
      setEventSel([]);
      setCreditEventsTimelineOpen(false);
      setCreditEventTimelineIdx(0);
      const ids = new Set(answeredQIds);
      ids.add(q.id);
      setLoanTermDraft(
        loanTermDraftFromForm(
          { ...form, ...patch, ...scenarioCascade } as WizardForm,
          ids.has("loanTerm"),
        ),
      );
      stickToBottomRef.current = true;
      scrollToBottom();
      scheduleRevealQuestion(
        nextFormChatQuestion({ ...form, ...patch, ...scenarioCascade } as WizardForm, {
          includeOptional,
          answeredQIds: ids,
        }),
      );
      return;
    }
    const merged = { ...form, ...patch, ...scenarioCascade } as WizardForm;
    const ids = new Set(answeredQIds);
    ids.add(q.id);
    setForm((prev) => ({ ...prev, ...patch, ...formChatScenarioCascadePatch(q.id, prev, patch) }));
    setImportedFieldKeys((prev) => stripImportedKeys(prev, { ...patch, ...scenarioCascade }, form));
    pushAnswered(q, label);
    stickToBottomRef.current = true;
    scrollToBottom();
    advance(merged, q, ids);
  };

  const answerWith = (q: FormChatQuestion, value: string, label: string) =>
    commitAnswer(q, applyFormChatAnswer(form, q, value), label);

  const submitValueDraft = (q: FormChatQuestion) => {
    const v = draft.trim();
    if (!v) return;
    if (q.id === "decisionCreditScore" && !isDecisionCreditScoreInRange(v)) return;
    answerWith(q, v, `${q.prefix ?? ""}${v}${q.suffix ? ` ${q.suffix}` : ""}`);
  };

  // ── value / loan / LTV triangle ────────────────────────────────────────────
  const answerTriangle = (q: FormChatQuestion, patch: Partial<WizardForm>, label: string) =>
    commitAnswer(q, patch, label);

  // ── credit-events: select types → timeline (all rows) → Confirm ──
  const toggleCreditEvent = (code: string) =>
    setEventSel((sel) => (sel.includes(code) ? sel.filter((c) => c !== code) : [...sel, code]));

  const toggleLoanTermDraft = (termValue: string) => {
    if (isNoProductPreference(termValue)) {
      setLoanTermDraft(LOAN_TERM_NO_PREF);
      return;
    }
    const n = parseInt(termValue, 10);
    setLoanTermDraft((prev) => {
      const selected = parseLoanTermSelection(prev);
      const noPreference = selected.length === 0;
      const base = noPreference ? [] : selected;
      const next = base.includes(n)
        ? base.filter((t) => t !== n)
        : [...base, n].sort((a, b) => a - b);
      return formatLoanTermStorage(next);
    });
  };

  const commitLoanTermDraft = (q: FormChatQuestion) => {
    const patch = { loanTerm: loanTermDraft };
    answerTriangle(q, patch, productPrefAnswerLabel("loanTerm", { ...form, ...patch }));
  };

  const commitProductPrefOption = (q: FormChatQuestion, value: string) => {
    const patch = { [q.id]: value } as Partial<WizardForm>;
    answerTriangle(q, patch, productPrefAnswerLabel(q.id, { ...form, ...patch }));
  };

  const confirmEventSelection = () => {
    if (eventSel.length === 0) return;
    setForm((prev) => ({
      ...prev,
      hasCreditEvent: "Yes",
      creditEvents: [...eventSel],
    }));
    setCreditEventTimelineIdx(0);
    setCreditEventsTimelineOpen(true);
  };

  const backCreditEventTimeline = () => {
    if (creditEventTimelineIdx > 0) {
      setCreditEventTimelineIdx((i) => i - 1);
      return;
    }
    setCreditEventsTimelineOpen(false);
  };

  const nextCreditEventTimeline = (events: string[]) => {
    setCreditEventTimelineIdx((i) => Math.min(i + 1, events.length - 1));
  };

  const pickCreditEventBucket = (code: string, bucket: string) => {
    setForm((s) => {
      const nextDates = { ...s.creditEventDates };
      delete nextDates[code];
      return {
        ...s,
        creditEventYears: { ...s.creditEventYears, [code]: bucket },
        creditEventDates: nextDates,
      };
    });
  };

  const clearCreditEventTiming = (code: string) => {
    setForm((s) => {
      const nextYears = { ...s.creditEventYears };
      const nextDates = { ...s.creditEventDates };
      delete nextYears[code];
      delete nextDates[code];
      return { ...s, creditEventYears: nextYears, creditEventDates: nextDates };
    });
  };

  const clearProductPref = (qId: string) => {
    if (qId === "loanTerm") {
      setLoanTermDraft("");
      return;
    }
    setForm((s) => ({ ...s, [qId]: "" }));
  };

  const clearFormChatAnswer = (q: FormChatQuestion) => {
    setForm((s) => ({ ...s, ...applyFormChatAnswer(s, q, "") }));
  };

  const updateCreditEventDate = (code: string, raw: string) => {
    const v = formatMmYyyyInput(raw);
    const bucket = !validateMmYyyy(v) ? computeYearsSinceBucket(v) : "";
    setForm((s) => {
      const nextYears = { ...s.creditEventYears };
      if (bucket) nextYears[code] = bucket;
      else delete nextYears[code];
      return {
        ...s,
        creditEventDates: { ...s.creditEventDates, [code]: v },
        creditEventYears: nextYears,
      };
    });
  };

  const confirmCreditTimeline = (q: FormChatQuestion) => {
    const events = [...new Set(form.creditEvents.length ? form.creditEvents : eventSel)];
    if (!events.length || !isAnswered(form, q)) return;
    commitAnswer(
      q,
      {
        hasCreditEvent: "Yes",
        creditEvents: events,
        creditEventDates: { ...form.creditEventDates },
        creditEventYears: { ...form.creditEventYears },
      },
      `${events.length} event${events.length !== 1 ? "s" : ""}`,
    );
    setCreditEventsTimelineOpen(false);
    setCreditEventTimelineIdx(0);
    setEventSel([]);
  };

  // ── editing a prior answer (in place) ──────────────────────────────────────
  /** Sync downstream clears when an upstream answer changes (mirrors LoanWizard cascades). */
  const cascadePatchForEdit = (qId: string, patch: Partial<WizardForm>): Partial<WizardForm> =>
    buildCascadePatchForFormEdit(form, qId, patch);

  const clearFieldsFor = (qId: string, target: Record<string, unknown>) => {
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
      // Follow-up sub-fields only — county is owned by county_search and must
      // survive follow-up invalidation.
      for (const k of geoSubFieldKeys()) {
        if (k !== "stateCounty") target[k] = "";
      }
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
  };

  // A prior answer is still valid if its question still shows AND (for enums) its
  // stored value is still an allowed option under the updated scenario.
  const stillValid = (qq: FormChatQuestion, f: WizardForm) => {
    if (qq.special === "county_search") {
      return !!f.state.trim();
    }
    if (qq.special === "geo_followup") {
      // Question no longer exists for this state → the bubble is stale; prune it.
      if (
        !f.state.trim() ||
        !f.stateCounty.trim() ||
        !countyNeedsGeoFollowUp(f.state, f.stateCounty)
      )
        return false;
      // With a county present, a pending/partial follow-up is NOT stale — keep it.
      return !!f.stateCounty.trim();
    }
    if (qq.showIf && !qq.showIf(f)) return false;
    if (!qq.special && qq.kind === "enum") {
      const val = (f as Record<string, unknown>)[qq.id];
      if (typeof val === "string" && val && !optionsFor(f, qq).some((o) => o.value === val))
        return false;
    }
    return true;
  };

  const openEditForQuestion = (q: FormChatQuestion, formSnap: WizardForm = form) => {
    const seed = seedControlsFromForm(q, formSnap);
    setDraft(seed.draft);
    setEventSel(seed.eventSel);
    setCreditEventsTimelineOpen(seed.creditEventsTimelineOpen);
    setCreditEventTimelineIdx(seed.creditEventTimelineIdx);
    setLoanTermDraft(seed.loanTermDraft);
  };

  // Re-ask a question in place (from "Change" or a sidebar row click).
  const beginEdit = (msg: ChatMessage) => {
    if (msg.kind !== "answered") return;
    const q = FORM_CHAT_QUESTIONS.find((x) => x.id === msg.qId);
    if (q) openEditForQuestion(q);
    else {
      setDraft("");
      setEventSel([]);
      setCreditEventsTimelineOpen(false);
      setCreditEventTimelineIdx(0);
      setLoanTermDraft(loanTermDraftFromForm(form, true));
    }
    setEditingQId(msg.qId);
    setEditingMsgId(msg.id);
  };
  const editByQId = (
    qId: string,
    fieldId?: string,
    opts?: { skipMsgIds?: Set<string>; formSnapshot?: WizardForm },
  ) => {
    setEditFieldHint(fieldId ?? null);
    const snap = opts?.formSnapshot ?? form;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (opts?.skipMsgIds?.has(m.id)) continue;
      if (m.kind === "answered" && m.qId === qId) {
        openEditForQuestion(
          FORM_CHAT_QUESTIONS.find((x) => x.id === qId) ?? ({ id: qId } as FormChatQuestion),
          snap,
        );
        setEditingQId(qId);
        setEditingMsgId(m.id);
        return;
      }
    }
    const q = FORM_CHAT_QUESTIONS.find((x) => x.id === qId);
    if (!q) return;
    // No transcript row yet (e.g. answered before a resume/restore, or via a bulk
    // fill). Insert one at its correct chronological position so the edit opens in
    // place — with any later answers staying below it — then edit it in place.
    const order = (id: string) => {
      const idx = FORM_CHAT_QUESTIONS.findIndex((x) => x.id === id);
      return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
    };
    const target = order(qId);
    const newId = nextId();
    const synthesized: ChatMessage = {
      kind: "answered",
      id: newId,
      qId,
      prompt: resolveFormChatPrompt(form, q),
      section: q.section,
      sectionName: q.sectionName,
      answerLabel: formFieldValue(snap, q),
    };
    setMessages((prev) => {
      let insertAt = prev.length;
      for (let i = 0; i < prev.length; i++) {
        const m = prev[i];
        if (m.kind === "answered" && order(m.qId) > target) {
          insertAt = i;
          break;
        }
      }
      return [...prev.slice(0, insertAt), synthesized, ...prev.slice(insertAt)];
    });
    openEditForQuestion(q, snap);
    setEditingMsgId(newId);
    setEditingQId(qId);
  };

  // Apply an in-place edit: set the new value, prune ONLY the answers that are no
  // longer valid (showIf fails or value left the option set), then resume the flow.
  const applyEdit = (
    editId: string,
    q: FormChatQuestion,
    patch: Partial<WizardForm>,
    label: string,
  ) => {
    const cascadeExtra = cascadePatchForEdit(q.id, patch);
    const merged0 = {
      ...form,
      ...patch,
      ...cascadeExtra,
    } as WizardForm;
    const prunedIds = new Set<string>();
    const clearPatch: Record<string, unknown> = {};
    const triangleQ = FORM_CHAT_QUESTIONS.find((x) => x.id === "valueLoanLtv");
    const purposeOrLienEdit = PURPOSE_LIEN_CASCADE_IDS.has(q.id);
    const purposeChanged =
      (q.id === "loanPurpose" || q.id === "primaryLoanPurpose") &&
      primaryLoanPurposeChanged(form, { ...patch, ...cascadeExtra });
    const lienPositionChanged =
      q.id === "lienPosition" &&
      String(patch.lienPosition ?? "").trim() !== String(form.lienPosition ?? "").trim();
    const forceLoanDetailsReset = purposeChanged || lienPositionChanged;
    const prevState = String(form.state ?? "").trim();
    const nextState = String((patch as Record<string, unknown>).state ?? form.state ?? "").trim();
    const stateChanged = q.id === "state" && nextState !== prevState;
    const countyChanged =
      q.id === "stateCounty" &&
      String((patch as Record<string, unknown>).stateCounty ?? "").trim() !==
        String(form.stateCounty ?? "").trim();

    for (const m of messages) {
      if (m.kind !== "answered" || m.id === editId) continue;
      const qq = FORM_CHAT_QUESTIONS.find((x) => x.id === m.qId);
      if (qq && !stillValid(qq, merged0)) {
        prunedIds.add(m.id);
        clearFieldsFor(m.qId, clearPatch);
      }
      // Purpose / lien change — drop stale Loan Details bubble and re-open the form.
      if (purposeOrLienEdit && triangleQ && m.qId === "valueLoanLtv") {
        if (forceLoanDetailsReset || !isAnswered(merged0, triangleQ)) {
          prunedIds.add(m.id);
          applyLoanDetailsFieldClear(clearPatch);
        }
      }
      if (purposeChanged && (m.qId === "lienPosition" || m.qId === "secondLienProduct")) {
        prunedIds.add(m.id);
        clearFieldsFor(m.qId, clearPatch);
      }
      // Product prefs survive purpose changes (see buildCascadePatchForFormEdit).
    }
    if (stateChanged) {
      for (const m of messages) {
        if (m.kind !== "answered" || m.id === editId) continue;
        if ((LOCATION_DOWNSTREAM_Q_IDS as readonly string[]).includes(m.qId)) {
          prunedIds.add(m.id);
          clearFieldsFor(m.qId, clearPatch);
        }
      }
    }
    if (countyChanged) {
      for (const m of messages) {
        if (m.kind !== "answered" || m.id === editId) continue;
        if (m.qId === "stateGeoFollowup") {
          prunedIds.add(m.id);
          clearFieldsFor(m.qId, clearPatch);
        }
      }
    }
    const merged = { ...merged0, ...clearPatch } as WizardForm;
    setForm((prev) => ({ ...prev, ...patch, ...cascadeExtra, ...clearPatch }));
    setImportedFieldKeys((prev) => stripImportedKeys(prev, { ...patch, ...clearPatch }, form));
    setMessages((prev) =>
      prev
        .filter((m) => !prunedIds.has(m.id))
        .map((m) => (m.id === editId && m.kind === "answered" ? { ...m, answerLabel: label } : m)),
    );
    setEditingMsgId(null);
    setEditingQId(null);
    setEditFieldHint(null);
    setDraft("");
    setEventSel([]);
    setCreditEventsTimelineOpen(false);
    setCreditEventTimelineIdx(0);

    if (prunedIds.size > 0 || PURPOSE_LIEN_CASCADE_IDS.has(q.id) || stateChanged || countyChanged) {
      setFlowInvalidatedByEdit(true);
    }

    const newIds = new Set<string>();
    for (const m of messages) {
      if (m.kind === "answered" && !prunedIds.has(m.id)) newIds.add(m.qId);
    }
    const edited = messages.find((m) => m.id === editId && m.kind === "answered");
    if (edited?.kind === "answered") newIds.add(edited.qId);
    for (const id of formAnsweredQIdsFromForm(merged, newIds)) newIds.add(id);

    setLoanTermDraft(loanTermDraftFromForm(merged, newIds.has("loanTerm")));

    // Re-ask the first mandatory gap: newly visible fields (e.g. Primary → Investment),
    // cascade clears, or pruned answers — same driver as the initial intake flow.
    const next = nextFormChatQuestion(merged, {
      includeOptional,
      answeredQIds: newIds,
    });
    if (next) {
      setCurrentQ(null);
      if (next.special === "triangle") setTriangleSeedKey((k) => k + 1);
      if (!submitted && (next.special === "county_search" || next.special === "geo_followup")) {
        scheduleRevealQuestion(next);
        stickToBottomRef.current = true;
        scrollToBottom();
        return;
      }
      editByQId(next.id, undefined, { skipMsgIds: prunedIds, formSnapshot: merged });
      return;
    }

    stickToBottomRef.current = true;
    scrollToBottom();
    scheduleRevealQuestion(null);
  };

  // ── reset / clear scenario ───────────────────────────────────────────────
  // Reset asks for confirmation via an in-app modal (not the browser dialog).
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const canGoHome = hasStarted || submitted;

  const handleRestart = () => {
    if (!profileResetActive) return;
    setConfirmResetOpen(true);
  };

  /** Welcome screen (Start / Upload) — clears intake UI; form fields stay until Reset. */
  const handleGoHome = () => {
    if (!canGoHome) return;
    setHasStarted(false);
    setWelcomeStreamDone(true);
    setImportedFieldKeys(new Set());
    setScenarioNotesPhase("idle");
    setScenarioNotesSkipped(false);
    setScenarioNotesEditMode(false);
    scenarioNotesPromptedRef.current = false;
    setDraft("");
    setChatInput("");
    setEventSel([]);
    setCreditEventsTimelineOpen(false);
    setCreditEventTimelineIdx(0);
    setLoanTermDraft("");
    setEditingMsgId(null);
    setEditingQId(null);
    setCurrentQ(null);
    pendingRevealQRef.current = null;
    streamGateMsgIdRef.current = null;
    setStreamGateMsgId(null);
    clearRevealQuestionDelay();
    if (resultsRevealDelayRef.current != null) {
      window.clearTimeout(resultsRevealDelayRef.current);
      resultsRevealDelayRef.current = null;
    }
    preSubmitGateMsgIdRef.current = null;
    scenarioNotesPromptMsgIdRef.current = null;
    pendingSubmitAfterPreludeRef.current = null;
    if (pendingSubmitAfterPreludeTimerRef.current != null) {
      window.clearTimeout(pendingSubmitAfterPreludeTimerRef.current);
      pendingSubmitAfterPreludeTimerRef.current = null;
    }
    eligibilitySubmitStartedRef.current = false;
    setAwaitingPreludeSubmit(false);
    eligibleResultsTailRef.current = null;
    exitResultsTailRef.current = null;
    resultsPhaseRef.current = "idle";
    runningMsgIdRef.current = null;
    setMessageFeedback({});
    setKnowMoreStreamReadyIds(new Set());
    setMobileProfileOpen(false);
    setMessages([
      {
        kind: "assistant",
        id: nextId(),
        paragraphs: buildFormWelcomeParagraphs(isMobileWelcomeViewport()),
      },
    ]);
    onResetScenario?.();
    onGoHome?.();
  };

  const performRestart = () => {
    setConfirmResetOpen(false);
    // Delegate to LoanWizard — clears form, chat, sidebar, vault context, and remounts this flow.
    if (onClearRestart) {
      onClearRestart();
      return;
    }
    // Fallback when owner does not wire a full reset (should not happen in production UI).
    setFlowInvalidatedByEdit(false);
    setHasStarted(false);
    setWelcomeStreamDone(false);
    setScenarioNotesPhase("idle");
    setScenarioNotesSkipped(false);
    setScenarioNotesEditMode(false);
    scenarioNotesPromptedRef.current = false;
    setDraft("");
    setChatInput("");
    setEventSel([]);
    setCreditEventsTimelineOpen(false);
    setCreditEventTimelineIdx(0);
    setLoanTermDraft("");
    setEditingMsgId(null);
    setEditingQId(null);
    setCurrentQ(null);
    pendingRevealQRef.current = null;
    streamGateMsgIdRef.current = null;
    setStreamGateMsgId(null);
    clearRevealQuestionDelay();
    if (resultsRevealDelayRef.current != null) {
      window.clearTimeout(resultsRevealDelayRef.current);
      resultsRevealDelayRef.current = null;
    }
    preSubmitGateMsgIdRef.current = null;
    scenarioNotesPromptMsgIdRef.current = null;
    pendingSubmitAfterPreludeRef.current = null;
    if (pendingSubmitAfterPreludeTimerRef.current != null) {
      window.clearTimeout(pendingSubmitAfterPreludeTimerRef.current);
      pendingSubmitAfterPreludeTimerRef.current = null;
    }
    eligibilitySubmitStartedRef.current = false;
    setAwaitingPreludeSubmit(false);
    eligibleResultsTailRef.current = null;
    exitResultsTailRef.current = null;
    resultsPhaseRef.current = "idle";
    runningMsgIdRef.current = null;
    onResetScenario?.();
    setMessageFeedback({});
    setKnowMoreStreamReadyIds(new Set());
    setMobileProfileOpen(false);
    setImportedFieldKeys(new Set());
    setMessages([
      {
        kind: "assistant",
        id: nextId(),
        paragraphs: buildFormWelcomeParagraphs(isMobileWelcomeViewport()),
      },
    ]);
    setForm((prev) => {
      const cleared = { ...prev } as Record<string, unknown>;
      for (const q of FORM_CHAT_QUESTIONS) cleared[q.id] = "";
      cleared.valueSalesPrice = "";
      cleared.loanAmount = "";
      cleared.creditEvents = [];
      cleared.creditEventYears = {};
      cleared.creditEventDates = {};
      cleared.primaryLoanPurpose = "";
      cleared.isSecondLien = "";
      cleared.ltv = "";
      cleared.cltv = "";
      cleared.loanTerm = "No preference";
      cleared.rateTypePref = "No Preference";
      cleared.interestOnlyPref = "No preference";
      return cleared as WizardForm;
    });
  };

  // Notes-phase locks apply only before final submit — not during results / Know More Q&A.
  const showSubmitProfileGate =
    !submitted && !eligibilitySubmitStartedRef.current && scenarioNotesPhase === "ready";

  const notesPhaseLocksChat =
    !submitted &&
    (scenarioNotesPhase === "processing" ||
      scenarioNotesPhase === "pre_submit" ||
      awaitingPreludeSubmit);
  const scenarioNotesEditing =
    scenarioNotesPhase === "prompted" || scenarioNotesPhase === "processing";

  // ── bottom chat input bar ──────────────────────────────────────────────────
  const submitChatInput = () => {
    const val = chatInput.trim();
    if (!val) return;

    // Know More / exclusions: Exit or Back to Programs Summary returns to the program summary.
    if (submitted && isViewingResultsSubPanel(messages) && isResultsNavigationCommand(val)) {
      setChatInput("");
      pushUser(val);
      handleExitProgram();
      return;
    }

    // Scenario-notes prompt (initial or re-edit) — must run before post-submit Q&A routing.
    if (scenarioNotesPhase === "prompted") {
      void submitOptionalScenarioNotes(val);
      return;
    }
    if (scenarioNotesPhase === "processing") {
      return;
    }

    // Post-submit (results / Know More): route typed questions to results Q&A.
    if (submitted) {
      if (onAsk && !asking) {
        setChatInput("");
        void askResultsQuestion(val);
      }
      return;
    }

    if (scenarioNotesPhase === "ready") {
      return;
    }

    if (!hasStarted) {
      if (!welcomeStreamDone) return;
      const lower = val.toLowerCase();
      if (lower === "start" || lower === "go" || lower === "begin") {
        setChatInput("");
        handleStart(val);
        return;
      }
      if (lower === "upload" || lower.startsWith("upload ")) {
        setChatInput("");
        formFileInputRef.current?.click();
        return;
      }
      pushUser(val);
      pushAssistant(`${FORM_WELCOME_COMPOSER_HINT} when you're ready to begin.`);
      setChatInput("");
      return;
    }

    if (!targetQ) {
      setChatInput("");
      return;
    }

    if (canSkipFormChatQuestion(targetQ, includeOptional) && isFormChatSkipMessage(val)) {
      setChatInput("");
      skipOptionalQuestion(targetQ);
      return;
    }

    // Credit events — letter toggles multi-select; timeline step uses the cards only.
    if (targetQ.special === "credit_events") {
      if (creditEventsTimelineOpen) {
        const events = [...new Set(form.creditEvents.length ? form.creditEvents : eventSel)];
        const ev = events[creditEventTimelineIdx];
        if (ev && val.length === 1 && /^[A-Za-z]$/.test(val)) {
          const i = val.toUpperCase().charCodeAt(0) - 65;
          if (i >= 0 && i < CREDIT_EVENT_YEAR_BUCKETS.length) {
            pickCreditEventBucket(ev, CREDIT_EVENT_YEAR_BUCKETS[i]);
            setChatInput("");
            return;
          }
        }
        pushUser(val);
        pushAssistant("Use the lettered time buckets (A–F) or enter MM/YYYY above.");
        setChatInput("");
        return;
      }
      const opts = optionsFor(form, targetQ);
      if (val.length === 1 && /^[A-Za-z]$/.test(val)) {
        const i = val.toUpperCase().charCodeAt(0) - 65;
        if (i >= 0 && i < opts.length) {
          toggleCreditEvent(opts[i].value);
          setChatInput("");
          return;
        }
      }
      pushUser(val);
      pushAssistant("Use the lettered cards (A, B, C…) to toggle events, then Continue.");
      setChatInput("");
      return;
    }

    if (targetQ.special === "product_pref") {
      const opts = productPrefCardOptions(targetQ);
      if (targetQ.id === "loanTerm") {
        if (val.length === 1 && /^[A-Za-z]$/.test(val)) {
          const i = val.toUpperCase().charCodeAt(0) - 65;
          if (i >= 0 && i < opts.length) {
            const opt = opts[i];
            if (isNoProductPreference(opt.value)) {
              setChatInput("");
              answerTriangle(targetQ, { loanTerm: LOAN_TERM_NO_PREF }, "No preference");
              return;
            }
            toggleLoanTermDraft(opt.value);
            setChatInput("");
            return;
          }
        }
        const lower = val.toLowerCase();
        if (lower === "continue" && parseLoanTermSelection(loanTermDraft).length > 0) {
          setChatInput("");
          commitLoanTermDraft(targetQ);
          return;
        }
        pushUser(val);
        pushAssistant(
          "Select all that apply: A = no preference, or toggle B–G then type Continue.",
        );
        setChatInput("");
        return;
      }
      if (val.length === 1 && /^[A-Za-z]$/.test(val)) {
        const i = val.toUpperCase().charCodeAt(0) - 65;
        if (i >= 0 && i < opts.length) {
          setChatInput("");
          commitProductPrefOption(targetQ, opts[i].value);
          return;
        }
      }
      const match = opts.find(
        (o) =>
          o.label.toLowerCase() === val.toLowerCase() ||
          o.value.toLowerCase() === val.toLowerCase(),
      );
      if (match) {
        setChatInput("");
        commitProductPrefOption(targetQ, match.value);
        return;
      }
      pushUser(val);
      pushAssistant("Pick an option above or type its letter (A, B, C…).");
      setChatInput("");
      return;
    }

    // Value / loan / LTV triangle — accept the figures typed in the message box.
    if (targetQ.special === "triangle") {
      const parsed = parseTriangleText(form, val);
      if (!parsed) {
        pushUser(val);
        pushAssistant(
          'Enter at least two of property value, loan amount, or LTV — e.g. "value 500k, loan 400k" or "500,000 at 80%". Amounts under 1,000 need a unit like "k".',
        );
        setChatInput("");
        return;
      }
      const merged = { ...form, ...parsed.patch } as WizardForm;
      if (isAnswered(merged, targetQ)) {
        setChatInput("");
        answerTriangle(targetQ, parsed.patch, parsed.label);
        return;
      }
      // value/loan/LTV resolved, but this scenario needs an extra field — seed the
      // grouped fields (remount via triangleSeedKey) and ask for the remainder.
      const missing: string[] = [];
      const purpose = effectivePrimaryLoanPurpose(merged);
      const cashOut = purpose === "Cash-Out Refinance";
      const refi = purpose === "Refinance" || cashOut;
      if (form.isSecondLien === "yes" && !merged.existingFirstLien.trim())
        missing.push("existing first-lien balance");
      if (cashOut && !merged.cashInHandRequest.trim()) missing.push("cash-in-hand amount");
      if (
        form.isSecondLien !== "yes" &&
        refi &&
        merged.existingFirstLien.trim() &&
        !merged.existingSecondLien.trim()
      )
        missing.push("existing second lien");
      setForm((prev) => ({ ...prev, ...parsed.patch }));
      setTriangleSeedKey((k) => k + 1);
      pushUser(val);
      pushAssistant(
        missing.length
          ? `Got it — value, loan, and LTV set. Add the ${missing.join(" and ")} in the fields above to continue.`
          : "Got it — add the remaining detail in the fields above to continue.",
      );
      setChatInput("");
      return;
    }

    // Geo follow-up (county / city / ZIP) — accept the typed/spoken value.
    if (targetQ.special === "geo_followup") {
      const field = nextRequiredGeoField(form);
      if (!field) {
        setChatInput("");
        return;
      }
      if (field.widget === "select") {
        const opts = geoSelectOptions(form.state, field.form_key);
        const needle = val.toLowerCase();
        let match = opts.find(
          (o) => o.value.toLowerCase() === needle || o.label.toLowerCase() === needle,
        );
        if (!match && needle.length >= 2) {
          const hits = opts.filter((o) => o.label.toLowerCase().includes(needle));
          if (hits.length === 1) match = hits[0];
        }
        if (match) {
          setChatInput("");
          answerTriangle(
            targetQ,
            { [field.form_key]: match.value } as Partial<WizardForm>,
            match.label,
          );
          return;
        }
        pushUser(val);
        pushAssistant(
          `Pick a valid ${field.label.toLowerCase()} from the list above, or type its name.`,
        );
        setChatInput("");
        return;
      }
      // Free-text geo field (e.g. ZIP code).
      const value = val.trim();
      setChatInput("");
      answerTriangle(targetQ, { [field.form_key]: value } as Partial<WizardForm>, value);
      return;
    }

    if (targetQ.special) {
      pushUser(val);
      pushAssistant("Please use the fields above to answer this one.");
      setChatInput("");
      return;
    }

    // enum / yes-no — match a single letter, or an option label / value.
    if (targetQ.kind === "enum" || targetQ.kind === "yesno") {
      const opts = optionsFor(form, targetQ);
      if (val.length === 1 && /^[A-Za-z]$/.test(val)) {
        const i = val.toUpperCase().charCodeAt(0) - 65;
        if (i >= 0 && i < opts.length) {
          setChatInput("");
          answerWith(targetQ, opts[i].value, opts[i].label);
          return;
        }
      }
      const match = opts.find(
        (o) =>
          o.label.toLowerCase() === val.toLowerCase() ||
          o.value.toLowerCase() === val.toLowerCase(),
      );
      if (match) {
        setChatInput("");
        answerWith(targetQ, match.value, match.label);
        return;
      }
      pushUser(val);
      pushAssistant("I didn't catch that — pick an option above or type its letter (A, B, C…).");
      setChatInput("");
      return;
    }

    if (targetQ.kind === "state") {
      const opts = optionsFor(form, targetQ);
      const match = matchStateOption(opts, val);
      if (match) {
        setChatInput("");
        answerWith(targetQ, match.value, match.label);
        return;
      }
      pushUser(val);
      pushAssistant("Please enter a valid US state (e.g. CA or Texas) or pick it from the list.");
      setChatInput("");
      return;
    }

    // currency / number — FICO must be 300–800 before accepting.
    const numeric =
      targetQ.id === "decisionCreditScore" ? val.replace(/\D/g, "") : val.replace(/[^0-9.]/g, "");
    if (numeric) {
      if (targetQ.id === "decisionCreditScore" && !isDecisionCreditScoreInRange(numeric)) {
        pushUser(val);
        pushAssistant(DECISION_CREDIT_SCORE_CAUTION);
        setChatInput("");
        return;
      }
      const label = `${targetQ.prefix ?? ""}${numeric}${targetQ.suffix ? ` ${targetQ.suffix}` : ""}`;
      setChatInput("");
      answerWith(targetQ, numeric, label);
      return;
    }
    pushUser(val);
    pushAssistant("Please enter a number.");
    setChatInput("");
  };

  // ── voice input (Web Speech API) ───────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const toggleVoice = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      pushAssistant("Voice input isn't supported in this browser — try Chrome or Edge.");
      return;
    }
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      setChatInput(transcript);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  // ── keyboard shortcuts — Enter confirms; letter keys pick enum options ─────
  useEffect(() => {
    const submitActiveConfirmForm = () => {
      const root = scrollContentRef.current;
      if (!root) return false;
      const forms = root.querySelectorAll<HTMLFormElement>("form[data-chat-confirm]");
      const form = forms[forms.length - 1];
      if (!form) return false;
      form.requestSubmit();
      return true;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Enter") {
        const active = document.activeElement;
        if (active === composerInputRef.current) return;
        if (active?.closest("[data-results-program-row]")) return;
        const tag = (active?.tagName ?? "").toUpperCase();
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
          const form = active?.closest<HTMLFormElement>("form[data-chat-confirm]");
          if (form) {
            e.preventDefault();
            form.requestSubmit();
          }
          return;
        }
        if (submitActiveConfirmForm()) e.preventDefault();
        return;
      }

      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key.length !== 1) return;
      const code = e.key.toUpperCase().charCodeAt(0);
      if (code < 65 || code > 90) return;
      const i = code - 65;
      if (!targetQ) return;
      if (targetQ.special === "credit_events") {
        if (creditEventsTimelineOpen) {
          const events = [...new Set(form.creditEvents.length ? form.creditEvents : eventSel)];
          const ev = events[creditEventTimelineIdx];
          if (ev && i < CREDIT_EVENT_YEAR_BUCKETS.length) {
            pickCreditEventBucket(ev, CREDIT_EVENT_YEAR_BUCKETS[i]);
          }
          return;
        }
        const opts = optionsFor(form, targetQ);
        if (i < opts.length) toggleCreditEvent(opts[i].value);
        return;
      }
      if (targetQ.special === "product_pref") {
        const opts = productPrefCardOptions(targetQ);
        if (targetQ.id === "loanTerm") {
          if (i < opts.length) {
            const opt = opts[i];
            if (isNoProductPreference(opt.value)) {
              answerTriangle(targetQ, { loanTerm: LOAN_TERM_NO_PREF }, "No preference");
            } else {
              toggleLoanTermDraft(opt.value);
            }
          }
          return;
        }
        if (i < opts.length) commitProductPrefOption(targetQ, opts[i].value);
        return;
      }
      if (targetQ.special) return;
      if (targetQ.kind !== "enum" && targetQ.kind !== "yesno") return;
      const opts = optionsFor(form, targetQ);
      if (i < opts.length) answerWith(targetQ, opts[i].value, opts[i].label);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    targetQ,
    form,
    includeOptional,
    creditEventsTimelineOpen,
    creditEventTimelineIdx,
    scenarioNotesPhase,
    submitted,
    onComplete,
  ]);

  // Bring the in-place edit into view when it opens (e.g. clicked from the sidebar).
  // Release the "stick to bottom" pin first, or the ResizeObserver snaps the chat
  // back to the bottom (the content height changes as the question re-opens).
  useEffect(() => {
    if (!editingMsgId && !editingQId) return;
    stickToBottomRef.current = false;
    scrollEditedIntoView();
    // A second pass after layout settles (the re-opened controls change height).
    const t = window.setTimeout(scrollEditedIntoView, 60);
    return () => window.clearTimeout(t);
  }, [editingMsgId, editingQId]);

  const productPrefSelectionCommitted = (qId: string) => {
    if (answeredQIds.has(qId)) return true;
    if (editingQId === qId) return true;
    const editing = editingMsgId
      ? messages.find((m) => m.id === editingMsgId && m.kind === "answered")
      : undefined;
    return editing?.kind === "answered" && editing.qId === qId;
  };

  // Answer controls for a question — shared by the active question and in-place edits.
  const renderControls = (q: FormChatQuestion, controlKey: string) => (
    <QuestionControls
      key={controlKey}
      q={q}
      form={form}
      draft={draft}
      setDraft={setDraft}
      onPickOption={(opt) => answerWith(q, opt.value, opt.label)}
      onSubmitValue={() => submitValueDraft(q)}
      onTriangle={(patch, label) => answerTriangle(q, patch, label)}
      onSkip={
        canSkipFormChatQuestion(q, includeOptional) ? () => skipOptionalQuestion(q) : undefined
      }
      eventSel={eventSel}
      creditEventsTimelineOpen={creditEventsTimelineOpen}
      creditEventTimelineIdx={creditEventTimelineIdx}
      onToggleCreditEvent={toggleCreditEvent}
      onConfirmEventSelection={confirmEventSelection}
      onPickCreditEventBucket={pickCreditEventBucket}
      onUpdateCreditEventDate={updateCreditEventDate}
      onBackCreditEventTimeline={backCreditEventTimeline}
      onNextCreditEventTimeline={nextCreditEventTimeline}
      onConfirmCreditTimeline={() => confirmCreditTimeline(q)}
      loanTermDraft={loanTermDraft}
      onToggleLoanTerm={toggleLoanTermDraft}
      onClearProductPref={() => clearProductPref(q.id)}
      onClearFormAnswer={() => clearFormChatAnswer(q)}
      onClearCreditEvents={() => setEventSel([])}
      onClearCreditEventTiming={clearCreditEventTiming}
      productPrefSelectionCommitted={
        isFormChatProductPrefQuestion(q) ? productPrefSelectionCommitted(q.id) : false
      }
      capacityInitialField={editFieldHint}
    />
  );

  useEffect(() => {
    if (!mobileProfileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileProfileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileProfileOpen]);

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 max-w-full overflow-hidden bg-card">
      <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <AlertDialogContent className="gap-4">
          <AlertDialogHeader className="space-y-3 text-left">
            <AlertDialogTitle>
              {vaultScenarioOpen ? "Leave saved scenario?" : "Start a new scenario?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Confirm reset of the current intake session.
            </AlertDialogDescription>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {vaultScenarioOpen
                ? "You'll return to the home screen to create a new scenario. The saved scenario in your vault will not be changed."
                : "All answers and results will be cleared so you can begin fresh. This can't be undone."}
            </p>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="text-[13px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={performRestart}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "mt-2 gap-1.5 text-[13px] font-medium text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:mt-0",
              )}
            >
              <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {mobileProfileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Close Mortgage Profile"
          onClick={() => setMobileProfileOpen(false)}
        />
      ) : null}
      <FormProfileSidebar
        form={form}
        answeredQIds={answeredQIds}
        submitted={submitted}
        eligibleCount={eligibleCount}
        totalCount={totalCount}
        previewOpen={previewOpen}
        previewLoading={previewLoading}
        previewPrograms={previewPrograms}
        onTogglePreview={onTogglePreview}
        onReset={handleRestart}
        onEditField={editByQId}
        resetActive={profileResetActive}
        importedFieldKeys={importedFieldKeys}
        includeOptional={includeOptional}
        highlightGaps={
          showProfileGaps ||
          (submitted && dirtySinceSubmit && (!intakeFlowComplete || !canResubmit))
        }
        showScenarioNotes={questionsDone || submitted}
        scenarioNotesSkipped={scenarioNotesSkipped}
        onScenarioNotesEdit={handleEditScenarioNotes}
        mobileOpen={mobileProfileOpen}
        onMobileClose={() => setMobileProfileOpen(false)}
        geoConfigRevision={geoConfigRevision}
      />

      {/* ── Chat pane (centered column, Claude-style) ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#eef2f7]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileProfileOpen(true)}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-[#012a5b] transition-colors hover:bg-muted/50"
            aria-label="Open Mortgage Profile"
          >
            <Home className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Mortgage Profile</span>
          </button>
          <span
            className={cn(
              "shrink-0 text-[17px] font-semibold tabular-nums",
              eligibleCount > 5
                ? "text-emerald-600"
                : eligibleCount > 2
                  ? "text-amber-500"
                  : "text-red-500",
            )}
            title="Program summary (preliminary)"
          >
            {eligibleCount}
            <span className="text-[11px] font-normal text-muted-foreground"> / {totalCount}</span>
          </span>
        </div>
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", FORM_CHAT_H_PAD)}>
          <div
            ref={scrollContainerRef}
            className={cn(
              "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto",
              FORM_CHAT_SCROLL_PAD,
            )}
          >
            <div
              ref={scrollContentRef}
              className={cn(FORM_CHAT_COLUMN, FORM_CHAT_MESSAGE_STACK, "text-[#1f2937]")}
            >
              {priorChatThread.length > 0 && <RetainedChatThread messages={priorChatThread} />}
              {messages.map((msg) => {
                if (msg.kind === "assistant") {
                  // After Start, drop the long welcome intro — only the step line + one question show.
                  if (hasStarted && msg.paragraphs) return null;
                  const eligibilityThinking = eligibilityThinkingLabel(msg);
                  if (msg.variant === "thinking" || eligibilityThinking) {
                    return (
                      <ThinkingBubble
                        key={msg.id}
                        label={eligibilityThinking ?? msg.thinkingLabel}
                        labels={msg.thinkingLabels}
                      />
                    );
                  }
                  const resultsHeadline = resultsHeadlineVariant(msg.text);
                  if (resultsHeadline) {
                    return (
                      <FormChatBotRow key={msg.id}>
                        <ResultsHeadlineBanner
                          variant={resultsHeadline}
                          text={msg.text ?? ""}
                          onStreamDone={() => {
                            const pending = eligibleResultsTailRef.current;
                            if (pending?.introId === msg.id) {
                              eligibleResultsTailRef.current = null;
                              revealResultsTableAfterHeadline(pending);
                            }
                          }}
                        />
                      </FormChatBotRow>
                    );
                  }
                  if (msg.ragReply && msg.text) {
                    return (
                      <RagAssistantReply
                        key={msg.id}
                        text={msg.text}
                        vote={messageFeedback[msg.id] ?? null}
                        onVoteChange={(v) => setFeedbackVote(msg.id, v)}
                        onStreamDone={() => pinChatToBottom("smooth")}
                        onDelete={() => deleteRagExchange(msg.id)}
                      />
                    );
                  }
                  return (
                    <FormChatBotRow key={msg.id}>
                      <BotBubble card>
                        <StreamingBubbleText
                          paragraphs={msg.paragraphs}
                          text={msg.text}
                          onStreamDone={() => {
                            if (streamGateMsgIdRef.current === msg.id) {
                              onAssistantStreamDone(msg.id);
                              return;
                            }
                            if (scenarioNotesPromptMsgIdRef.current === msg.id) {
                              scenarioNotesPromptMsgIdRef.current = null;
                              pinChatToBottom("auto");
                              return;
                            }
                            if (preSubmitGateMsgIdRef.current === msg.id) {
                              preSubmitGateMsgIdRef.current = null;
                              setScenarioNotesPhase("ready");
                              pinChatToBottom("auto");
                              return;
                            }
                            if (pendingSubmitAfterPreludeRef.current === msg.id) {
                              scheduleSubmitAfterPrelude(msg.id);
                              return;
                            }
                            const pending = exitResultsTailRef.current;
                            if (pending?.introId === msg.id) {
                              exitResultsTailRef.current = null;
                              revealResultsTableAfterHeadline(pending);
                              return;
                            }
                            if (!hasStarted && msg.paragraphs) setWelcomeStreamDone(true);
                          }}
                        />
                        {msg.variant === "submit-gate" && showSubmitProfileGate ? (
                          <ProfileSubmitGateActions
                            onSubmit={beginProfileSubmit}
                            onReset={handleRestart}
                          />
                        ) : null}
                      </BotBubble>
                    </FormChatBotRow>
                  );
                }
                if (msg.kind === "user") {
                  return <UserBubble key={msg.id}>{msg.text}</UserBubble>;
                }
                if (msg.kind === "scenario-note") {
                  const empty = msg.empty || !msg.text.trim();
                  const noteLines = msg.text
                    .split(/\n+/)
                    .map((l) => l.trim())
                    .filter(Boolean);
                  return (
                    <div key={msg.id} data-scenario-note="true">
                      <UserBubble onEdit={handleEditScenarioNotes}>
                        {empty ? (
                          <span className="text-muted-foreground">
                            Scenario Notes : No inputs for scenario notes.
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <span className="font-medium text-foreground">Scenario Notes</span>
                            {noteLines.map((line, i) => (
                              <div key={i} className="text-[13px] leading-snug text-foreground/90">
                                • {line}
                              </div>
                            ))}
                          </div>
                        )}
                      </UserBubble>
                    </div>
                  );
                }
                if (msg.kind === "results") {
                  return (
                    <div
                      key={msg.id}
                      data-results-anchor="true"
                      className="min-w-0 w-full max-w-full"
                    >
                      <ResultsCard
                        programs={msg.programs}
                        onKnowMore={handleKnowMore}
                        knowMoreDisabled={resultsSubPanelOpen || msg.id !== lastResultsMsgId}
                      />
                    </div>
                  );
                }
                if (msg.kind === "suggestion") {
                  return (
                    <FormChatBotRow key={msg.id}>
                      <SuggestionPills
                        onDownloadPdf={onDownloadPdf}
                        onSaveScenario={onSaveScenario}
                        saveLabel={saveLabel}
                        canSaveToVault={canSaveToVault}
                        onShowExclusions={handleShowExclusions}
                        onBackToVault={onBackToVault}
                        onClearRestart={handleRestart}
                        disabled={resultsSubPanelOpen || msg.id !== lastSuggestionMsgId}
                        stale={msg.id !== lastSuggestionMsgId}
                      />
                    </FormChatBotRow>
                  );
                }
                if (msg.kind === "program-detail") {
                  const name = programDisplayName(msg.program);
                  const detailStale = !resultsSubPanelOpen || msg.id !== activeProgramDetailId;
                  return (
                    <div key={msg.id} data-detail={msg.id} className="mt-3">
                      <div className="rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
                        <div className="mb-2 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
                          <span className="text-[15px] font-semibold text-foreground">{name}</span>
                          <button
                            type="button"
                            disabled={detailStale}
                            onClick={handleExitProgram}
                            title={
                              detailStale
                                ? "Use Back to Programs Summary on the open program card, or scroll to your latest results."
                                : undefined
                            }
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-[#012a5b] transition-colors hover:border-[#012a5b]/40 hover:bg-muted/40 dark:text-sky-300",
                              detailStale && "cursor-not-allowed opacity-50 hover:bg-card",
                            )}
                          >
                            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                            Back to Programs Summary
                          </button>
                        </div>
                        <ProgramKnowMoreDetail
                          key={msg.id}
                          prog={msg.program}
                          productPrefs={productPrefs}
                          scenario={scenarioSnapshot}
                          hideTitle
                          showFollowupHint={false}
                          onStreamComplete={() => {
                            markKnowMoreStreamReady(msg.id);
                            stickToBottomRef.current = true;
                            window.setTimeout(() => pinChatToBottom("smooth"), 0);
                          }}
                        />
                        {onAsk && knowMoreStreamReadyIds.has(msg.id) && (
                          <div
                            className={cn(
                              "mt-3 border-t border-border/50 pt-3",
                              detailStale && "pointer-events-none opacity-55",
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[12px] text-muted-foreground">Ask:</span>
                              {programFollowupQuestions().map((qq) => (
                                <button
                                  key={qq}
                                  type="button"
                                  disabled={asking || detailStale}
                                  onClick={() => {
                                    pinChatToBottom("smooth");
                                    void askResultsQuestion(qq);
                                  }}
                                  className="rounded-lg border border-[#012a5b]/20 bg-[#012a5b]/[0.05] px-3 py-1.5 text-[13px] text-[#012a5b] transition-colors hover:bg-[#012a5b]/10 disabled:opacity-50 dark:text-sky-300"
                                >
                                  {qq}
                                </button>
                              ))}
                            </div>
                            <KnowMoreFollowupHint className="mt-3" />
                          </div>
                        )}
                      </div>
                      {knowMoreStreamReadyIds.has(msg.id) ? (
                        <ChatMessageActions
                          copyText={programDetailText(msg.program)}
                          vote={messageFeedback[msg.id] ?? null}
                          onVoteChange={(v) => setFeedbackVote(msg.id, v)}
                        />
                      ) : null}
                    </div>
                  );
                }
                if (msg.kind === "exclusions") {
                  const hasExclusions = geoExclusions.length > 0 || overlayExclusions.length > 0;
                  const exclusionStale = !resultsSubPanelOpen || msg.id !== activeExclusionId;
                  return (
                    <div
                      key={msg.id}
                      className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
                    >
                      <div className="mb-4 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
                        <span className="text-[15px] font-semibold text-foreground">
                          Understand Exclusions
                        </span>
                        <button
                          type="button"
                          disabled={exclusionStale}
                          onClick={handleExitProgram}
                          title={
                            exclusionStale
                              ? "Scroll to your latest results to use current actions."
                              : undefined
                          }
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-[#012a5b] transition-colors hover:border-[#012a5b]/40 hover:bg-muted/40 dark:text-sky-300",
                            exclusionStale && "cursor-not-allowed opacity-50 hover:bg-card",
                          )}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                          Back to Programs Summary
                        </button>
                      </div>

                      {/* Just Missed — human-fixable gaps (FICO, LTV, DTI). */}
                      <div className="mb-4">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-foreground">
                            Just Missed
                          </span>
                          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground">
                            {nearMisses.length}
                          </span>
                        </div>
                        {nearMisses.length > 0 ? (
                          <div className="space-y-2">
                            {nearMisses.map((p, i) => (
                              <div
                                key={`${programDisplayName(p)}-${i}`}
                                className="rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20"
                              >
                                <div className="text-[13px] font-medium text-foreground">
                                  {programDisplayName(p)}
                                </div>
                                {p.near_miss_hint && (
                                  <p className="mt-0.5 text-[12px] leading-snug text-amber-800 dark:text-amber-200/90">
                                    {p.near_miss_hint}
                                  </p>
                                )}
                                {p.near_miss_suggestion && (
                                  <p className="mt-1 inline-flex items-start gap-1 rounded-md bg-amber-100/70 px-2 py-1 text-[12px] font-medium leading-snug text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                                    <Lightbulb
                                      className="mt-0.5 h-3 w-3 shrink-0"
                                      aria-hidden="true"
                                    />
                                    {p.near_miss_suggestion}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[13px] text-muted-foreground">
                            None — no additional programs were within reach on credit score, LTV, or
                            DTI for this scenario.
                          </p>
                        )}
                      </div>

                      {/* Exclusions — geo + overlay rule blocks. */}
                      <div className="border-t border-border/60 pt-4">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-foreground">
                            Exclusions
                          </span>
                          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground">
                            {geoExclusions.length + overlayExclusions.length}
                          </span>
                        </div>
                        {hasExclusions ? (
                          <EligibilityExclusionDetails
                            geoExclusions={geoExclusions}
                            overlayExclusions={overlayExclusions}
                          />
                        ) : (
                          <p className="text-[13px] text-muted-foreground">
                            None — no programs were blocked by geographic or overlay rules.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }
                // answered — when this one is being edited, re-ask it in place; otherwise
                // the question collapses to just the answer chip ("Change" re-asks it).
                if (editingMsgId === msg.id && editedQ) {
                  const creditView = creditEventQuestionView(
                    editedQ,
                    creditEventsTimelineOpen,
                    creditEventTimelineIdx,
                  );
                  return (
                    <div key={msg.id} data-editing="true">
                      <QuestionBubble
                        q={creditView.q}
                        form={form}
                        chipOverride={creditView.chipOverride}
                        stream={false}
                        controls={renderControls(editedQ, `edit-${msg.id}${creditView.keySuffix}`)}
                        onReveal={scrollEditedIntoView}
                      />
                    </div>
                  );
                }
                return (
                  <UserBubble
                    key={msg.id}
                    onEdit={() => {
                      setEditFieldHint(null);
                      beginEdit(msg);
                    }}
                  >
                    {answeredBubbleLabel(msg.qId, msg.answerLabel)}
                  </UserBubble>
                );
              })}

              {editedQ && editingQId && !editingMsgId && (
                <div data-editing="true">
                  {(() => {
                    const creditView = creditEventQuestionView(
                      editedQ,
                      creditEventsTimelineOpen,
                      creditEventTimelineIdx,
                    );
                    return (
                      <QuestionBubble
                        q={creditView.q}
                        form={form}
                        chipOverride={creditView.chipOverride}
                        stream={false}
                        controls={renderControls(
                          editedQ,
                          `sidebar-${editingQId}${creditView.keySuffix}`,
                        )}
                        onReveal={scrollEditedIntoView}
                      />
                    );
                  })()}
                </div>
              )}

              {currentQ &&
                !submitted &&
                !streamGateMsgId &&
                !isEditing &&
                (() => {
                  // Geo follow-ups share one question id — key per active sub-field.
                  let key: string = currentQ.id;
                  if (currentQ.special === "geo_followup") {
                    const f = nextRequiredGeoField(form);
                    if (f) key = `${currentQ.id}:${f.form_key}`;
                  }
                  const creditView = creditEventQuestionView(
                    currentQ,
                    creditEventsTimelineOpen,
                    creditEventTimelineIdx,
                  );
                  key = `${key}${creditView.keySuffix || ""}`;
                  const geoChipOverride =
                    currentQ.special === "geo_followup"
                      ? (() => {
                          const f = nextRequiredGeoField(form);
                          return f ? `${currentQ.sectionName} · ${f.label}` : undefined;
                        })()
                      : undefined;
                  return (
                    <QuestionBubble
                      key={key}
                      q={creditView.q}
                      form={form}
                      chipOverride={creditView.chipOverride ?? geoChipOverride}
                      controls={renderControls(
                        currentQ,
                        `active-${key}${currentQ.special === "triangle" ? `:seed${triangleSeedKey}` : ""}`,
                      )}
                      onReveal={() => pinChatToBottom("auto")}
                    />
                  );
                })()}
              <div ref={chatEndRef} aria-hidden className="h-px w-full shrink-0" />
            </div>
          </div>

          {/* ── Start gate (after welcome finishes streaming) ── */}
          {!hasStarted && welcomeStreamDone && (
            <div className="pb-3">
              <input
                ref={formFileInputRef}
                type="file"
                accept=".pdf,.xml,.html,.htm,application/pdf,text/xml,application/xml,text/html"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFormUpload(file);
                }}
              />
              <div
                className={cn(
                  FORM_CHAT_COLUMN,
                  "flex flex-wrap items-center justify-end gap-2 sm:gap-3",
                )}
              >
                <Button
                  type="button"
                  onClick={() => handleStart()}
                  disabled={formUploadLoading}
                  className="bg-[#012a5b] px-5 text-[13px] hover:bg-[#01234d]"
                >
                  Start
                </Button>
                <span className="text-[13px] text-muted-foreground">or</span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={formUploadLoading}
                  onClick={() => formFileInputRef.current?.click()}
                  title="Upload Form 1003 (PDF) or Fannie URLA v3.4 (XML/HTML)"
                  className="gap-2 border-[#012a5b]/30 text-[13px] text-[#012a5b] hover:bg-[#012a5b]/5"
                >
                  <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {formUploadLoading ? "Reading form…" : "Upload 1003 / URLA v3.4"}
                </Button>
              </div>
              <p
                className={cn(
                  FORM_CHAT_COLUMN,
                  "mt-2 text-right text-[11px] text-muted-foreground",
                )}
              >
                PDF (1003) · XML or HTML (Fannie 3.4)
              </p>
            </div>
          )}

          {/* ── Resubmit affordance — any post-submit edit, once the intake flow has no gaps ── */}
          {showResubmitBar && (
            <div className="pt-1">
              <div
                className={cn(
                  FORM_CHAT_COLUMN,
                  "flex min-w-0 flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 dark:border-amber-900/50 dark:bg-amber-950/30",
                )}
              >
                <span className="min-w-0 break-words text-[13px] text-amber-900 dark:text-amber-100">
                  {resubmitReady
                    ? "Your profile has changed since the last run — resubmit to refresh program matches."
                    : "Your profile has changed — answer the re-asked questions above (or the highlighted fields in the sidebar) to resubmit."}
                </span>
                <Button
                  type="button"
                  onClick={() => onResubmit?.()}
                  disabled={loading || !resubmitReady}
                  title={resubmitReady ? undefined : "Complete the highlighted fields first"}
                  className="shrink-0 gap-1.5 self-end bg-[#012a5b] text-[13px] hover:bg-[#01234d] sm:self-auto"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Resubmit
                </Button>
              </div>
            </div>
          )}

          {/* ── Inconsistent profile after upstream edits — reset to start fresh ── */}
          {formInconsistent && (
            <div className="pt-1">
              <div
                className={cn(
                  FORM_CHAT_COLUMN,
                  "flex items-center justify-between gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-3 py-2.5 shadow-sm dark:border-yellow-800/50 dark:bg-yellow-950/30",
                )}
              >
                <span className="text-[13px] text-yellow-950 dark:text-yellow-100">
                  Because of previous edits, this form is in an inconsistent state. Reset to answer
                  again from the beginning.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRestart}
                  disabled={!profileResetActive}
                  className="shrink-0 gap-1.5 border-yellow-400 bg-white text-[13px] text-yellow-950 hover:bg-yellow-100 dark:border-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-50 dark:hover:bg-yellow-900/40"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset
                </Button>
              </div>
            </div>
          )}

          {/* ── Chat input bar (Claude-style composer) ── */}
          <div className={FORM_CHAT_COMPOSER_SHELL}>
            <div className={FORM_CHAT_COLUMN}>
              <div className={FORM_CHAT_COMPOSER_CARD}>
                <input
                  ref={composerInputRef}
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitChatInput();
                    }
                  }}
                  placeholder={
                    scenarioNotesPhase === "prompted"
                      ? scenarioNotesEditMode
                        ? "Edit your scenario below and resubmit, or type Skip to clear…"
                        : submitted
                          ? "Updated scenario details, or type Skip to clear…"
                          : "Optional scenario details, or type Skip…"
                      : submitted
                        ? onAsk
                          ? knowMoreComposerPlaceholder(
                              focusedResultsProgram
                                ? programDisplayName(focusedResultsProgram)
                                : undefined,
                            )
                          : "Edit a field in the sidebar, then Resubmit"
                        : scenarioNotesPhase === "pre_submit"
                          ? "One moment…"
                          : scenarioNotesPhase === "processing" || awaitingPreludeSubmit
                            ? awaitingPreludeSubmit
                              ? "Preparing your results…"
                              : "Summarizing your notes…"
                            : showSubmitProfileGate
                              ? "Use the buttons above to submit or restart"
                              : hasStarted
                                ? composerHint(targetQ, form)
                                : welcomeStreamDone
                                  ? FORM_WELCOME_COMPOSER_HINT
                                  : "Please wait…"
                  }
                  disabled={
                    (!hasStarted && !submitted && !welcomeStreamDone) ||
                    (submitted && !onAsk && !scenarioNotesEditing) ||
                    notesPhaseLocksChat
                  }
                  className={FORM_CHAT_COMPOSER_INPUT}
                />
                <div className={FORM_CHAT_COMPOSER_CONTROLS}>
                  <button
                    type="button"
                    onClick={toggleVoice}
                    disabled={
                      (!hasStarted && !submitted && !welcomeStreamDone) ||
                      (notesPhaseLocksChat && !scenarioNotesEditing)
                    }
                    aria-label={isRecording ? "Stop recording" : "Voice input"}
                    title={isRecording ? "Stop recording" : "Voice input"}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                      isRecording
                        ? "animate-pulse bg-red-600 text-white"
                        : "text-muted-foreground hover:bg-muted hover:text-[#012a5b]",
                      ((!hasStarted && !submitted && !welcomeStreamDone) ||
                        (notesPhaseLocksChat && !scenarioNotesEditing)) &&
                        "pointer-events-none opacity-40",
                    )}
                  >
                    {isRecording ? (
                      <Square className="h-[15px] w-[15px] fill-current" aria-hidden="true" />
                    ) : (
                      <Mic className="h-[18px] w-[18px]" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={submitChatInput}
                    disabled={
                      !chatInput.trim() ||
                      (!hasStarted && !submitted && !welcomeStreamDone) ||
                      (submitted && asking && !scenarioNotesEditing) ||
                      notesPhaseLocksChat ||
                      scenarioNotesPhase === "processing"
                    }
                    aria-label="Send"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[#012a5b] text-white transition-colors hover:bg-[#01234d] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowUp className="h-[18px] w-[18px]" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const PRODUCT_PREF_QUESTION_CHIPS: Record<string, string> = {
  loanTerm: "LOAN_TERM_PREF",
  rateTypePref: "RATE_TYPE_PREF",
  interestOnlyPref: "IO_PREF",
};

const questionChip = (sectionName: string, qId: string) => {
  if (qId === "decisionCreditScore") {
    return `${sectionName.toUpperCase()} · QUESTION CREDIT SCORE`;
  }
  if (qId === "dtiCapacityExtras") {
    return `${sectionName} · Additional Details`;
  }
  const prefChip = PRODUCT_PREF_QUESTION_CHIPS[qId];
  if (prefChip) {
    return `${sectionName.toUpperCase()} · QUESTION ${prefChip.replace(/_/g, " ")}`;
  }
  return `${sectionName} · ${humanizeField(qId)}`;
};

const STREAM_CHARS_PER_TICK = 2;
const STREAM_TICK_MS = 12;
/** Pause before each new question card appears (after answer or streamed intro). */
const QUESTION_REVEAL_DELAY_MS = 200;

/** Reveal `text` character-by-character on mount; calls onDone when finished. */
function useStreamedLength(text: string, onDone?: () => void) {
  const [shown, setShown] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!text.length) return;
    setShown(0);
    let i = 0;
    let done = false;
    const id = window.setInterval(() => {
      i += STREAM_CHARS_PER_TICK;
      setShown(i);
      if (i >= text.length) {
        window.clearInterval(id);
        if (!done) {
          done = true;
          doneRef.current?.();
        }
      }
    }, STREAM_TICK_MS);
    return () => window.clearInterval(id);
  }, [text]);
  return Math.min(shown, text.length);
}

/** Post-submit RAG reply — copy / thumbs / delete after the bubble finishes streaming. */
function RagAssistantReply({
  text,
  vote,
  onVoteChange,
  onStreamDone,
  onDelete,
}: {
  text: string;
  vote?: MessageFeedbackVote;
  onVoteChange?: (vote: MessageFeedbackVote) => void;
  onStreamDone?: () => void;
  onDelete?: () => void;
}) {
  const [actionsReady, setActionsReady] = useState(!text.length);
  const handleStreamDone = () => {
    setActionsReady(true);
    onStreamDone?.();
  };
  return (
    <div>
      <BotBubble card>
        <RagStreamingAnswer text={text} onStreamDone={handleStreamDone} />
      </BotBubble>
      {actionsReady ? (
        <ChatMessageActions
          copyText={text}
          vote={vote}
          onVoteChange={onVoteChange}
          onDelete={onDelete}
        />
      ) : null}
    </div>
  );
}

/** RAG / Know More reply — stream plain text, then bold bullet labels (Appraisals:, Assets:, …). */
function RagStreamingAnswer({ text, onStreamDone }: { text: string; onStreamDone?: () => void }) {
  const shown = useStreamedLength(text, onStreamDone);
  const done = shown >= text.length;
  if (!done) {
    return (
      <p className={cn(MOB.t14, "leading-relaxed whitespace-pre-wrap text-foreground")}>
        {text.slice(0, shown)}
      </p>
    );
  }
  return <div className={cn(MOB.t14, "text-foreground")}>{renderChatAnswer(text)}</div>;
}

/** Single-line streamed text. */
function StreamingText({ text, onDone }: { text: string; onDone?: () => void }) {
  const shown = useStreamedLength(text, onDone);
  return <>{text.slice(0, shown)}</>;
}

/** Streams an assistant bubble (welcome paragraphs or a single line). Renders the
 *  SAME paragraph markup throughout — revealing characters in place — so the bubble
 *  never changes height/spacing when streaming finishes (Start / Upload terms bold). */
function StreamingBubbleText({
  paragraphs,
  text,
  preWrap = false,
  onStreamDone,
}: {
  paragraphs?: readonly string[];
  text?: string;
  /** Preserve newlines and "- " bullets (post-submit RAG replies). */
  preWrap?: boolean;
  onStreamDone?: () => void;
}) {
  const parts = paragraphs ? [...paragraphs] : text != null ? [text] : [];
  const full = parts.join("\n\n");
  const shown = useStreamedLength(full, onStreamDone);
  const done = shown >= full.length;

  let offset = 0;
  return (
    <>
      {parts.map((p, i) => {
        const start = offset;
        offset += p.length + (i < parts.length - 1 ? 2 : 0); // +2 for the "\n\n" join
        const sliceLen = Math.max(0, Math.min(p.length, shown - start));
        const slice = p.slice(0, sliceLen);
        return (
          <p
            key={i}
            className={cn(
              MOB.t14,
              "leading-relaxed",
              preWrap && "whitespace-pre-wrap",
              i < parts.length - 1 && "mb-3",
            )}
          >
            {preWrap || !done ? slice : formatWelcomeParagraph(p)}
          </p>
        );
      })}
    </>
  );
}

/** Current question (white card): streams the prompt, then reveals the answer
 *  controls, with any hint/instruction shown below the controls. */
function QuestionBubble({
  q,
  form,
  controls,
  stream = true,
  chipOverride,
  onReveal,
}: {
  q: FormChatQuestion;
  form: WizardForm;
  controls: React.ReactNode;
  stream?: boolean;
  chipOverride?: string;
  /** Fires once the answer controls become visible (so the parent can scroll to them). */
  onReveal?: () => void;
}) {
  const prompt = resolveFormChatPrompt(form, q);
  const hasPrompt = prompt.trim().length > 0;
  const geoHint =
    q.special === "geo_followup" ? nextRequiredGeoField(form)?.hint?.trim() : undefined;
  const hint = geoHint || q.hint;
  const [promptDone, setPromptDone] = useState(!stream || !hasPrompt);
  useEffect(() => {
    if (!promptDone) return;
    onReveal?.();
    // Option cards (doc type, etc.) mount after the prompt — follow layout growth.
    const t1 = window.setTimeout(() => onReveal?.(), 300);
    const t2 = window.setTimeout(() => onReveal?.(), 600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptDone]);
  const chip =
    chipOverride ??
    (q.special === "geo_followup"
      ? (() => {
          const f = nextRequiredGeoField(form);
          return f ? `${q.sectionName} · ${f.label}` : questionChip(q.sectionName, q.id);
        })()
      : questionChip(q.sectionName, q.id));
  const isCreditTimeline = chip === CREDIT_EVENT_TIMELINE_CHIP;
  return (
    <BotBubble chip={chip} chipVariant={isCreditTimeline ? "accent" : "default"} card>
      {hasPrompt ? (
        <p className={cn(MOB.t14, "font-normal leading-relaxed text-[#475569]")}>
          {stream ? <StreamingText text={prompt} onDone={() => setPromptDone(true)} /> : prompt}
        </p>
      ) : null}
      {promptDone && q.promptSubline ? (
        <p className={cn("mt-1.5 leading-relaxed text-muted-foreground", MOB.t13)}>
          {q.promptSubline}
        </p>
      ) : null}
      {promptDone && controls}
      {promptDone && hint && q.special !== "triangle" && (
        <p className={cn("mt-2.5 text-muted-foreground", MOB.t12)}>{hint}</p>
      )}
    </BotBubble>
  );
}

/** Inline value field with a square navy enter key (matches ChatIntake-style composer). */
function InlineEnterField({
  value,
  onChange,
  onSubmit,
  placeholder,
  inputMode = "text",
  prefix,
  suffix,
  caution,
  cautionDelayMs,
  submitDisabled,
  fullWidth = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
  prefix?: string;
  suffix?: string;
  caution?: string;
  /** Delay showing `caution` after the last keystroke (ms). Omit for immediate display. */
  cautionDelayMs?: number;
  submitDisabled?: boolean;
  /** Full-width row (decision credit score layout). */
  fullWidth?: boolean;
}) {
  const disabled = submitDisabled ?? !value.trim();
  const [visibleCaution, setVisibleCaution] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!caution) {
      setVisibleCaution(undefined);
      return;
    }
    if (!cautionDelayMs) {
      setVisibleCaution(caution);
      return;
    }
    setVisibleCaution(undefined);
    const t = window.setTimeout(() => setVisibleCaution(caution), cautionDelayMs);
    return () => window.clearTimeout(t);
  }, [caution, cautionDelayMs, value]);

  return (
    <form
      data-chat-confirm
      className="mt-3 flex w-full flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      <div className={cn("flex items-stretch gap-2", fullWidth ? "w-full" : "flex-wrap")}>
        {prefix ? <span className={cn(MOB.t14, "text-muted-foreground")}>{prefix}</span> : null}
        {fullWidth ? (
          <>
            <div
              className={cn(
                "min-w-0 flex-1 rounded-lg border bg-card shadow-sm transition-colors focus-within:border-[#012a5b]/50",
                visibleCaution ? "border-red-400" : "border-border",
              )}
            >
              <input
                type="text"
                inputMode={inputMode}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={cn(
                  MOB.inputH,
                  MOB.t14,
                  "w-full border-0 bg-transparent px-3 outline-none placeholder:text-muted-foreground/40",
                )}
                autoFocus
              />
            </div>
            {suffix ? (
              <span className={cn("shrink-0 self-center text-muted-foreground", MOB.t14)}>
                {suffix}
              </span>
            ) : null}
            <button
              type="submit"
              disabled={disabled}
              aria-label="Submit answer"
              className={cn(
                MOB.inputH,
                "flex w-10 shrink-0 items-center justify-center rounded-lg bg-[#012a5b] text-white shadow-sm transition-colors hover:bg-[#01234d] disabled:cursor-not-allowed disabled:opacity-40 md:w-11",
              )}
            >
              <CornerDownLeft className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </>
        ) : (
          <div
            className={cn(
              "flex min-w-0 overflow-hidden rounded-lg border bg-card shadow-sm transition-colors",
              visibleCaution ? "border-red-400" : "border-border focus-within:border-[#012a5b]/50",
            )}
          >
            <input
              type="text"
              inputMode={inputMode}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className={cn(
                MOB.t14,
                "h-9 w-[min(100%,12.5rem)] min-w-0 flex-1 border-0 bg-transparent px-3 outline-none placeholder:text-muted-foreground/40 md:h-10",
              )}
              autoFocus
            />
            <button
              type="submit"
              disabled={disabled}
              aria-label="Submit answer"
              className="flex h-9 w-9 shrink-0 items-center justify-center bg-[#012a5b] text-white transition-colors hover:bg-[#01234d] disabled:cursor-not-allowed disabled:opacity-40 md:h-10 md:w-10"
            >
              <CornerDownLeft className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        )}
        {!fullWidth && suffix ? (
          <span className={cn(MOB.t14, "text-muted-foreground")}>{suffix}</span>
        ) : null}
      </div>
      {visibleCaution ? <p className="text-[11px] text-red-500">{visibleCaution}</p> : null}
    </form>
  );
}

/** Blue panel wrapper — matches credit-event / loan-term action blocks. */
const CHAT_ACTION_PANEL = cn(
  "mt-3 rounded-lg border border-blue-200/80 bg-blue-50/40 dark:border-blue-900/40 dark:bg-blue-950/20",
  MOB.actionPad,
);

const PRIMARY_ACTION_BTN = cn("gap-1.5 bg-[#012a5b] hover:bg-[#01234d]", MOB.btn13);

/** White pill reset — matches results / vault action row. */
const RESET_PILL_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-[13px] font-medium text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 dark:bg-card dark:hover:bg-red-950/30";

/** Primary confirm — always shows the forward arrow. */
function ConfirmButton({
  className,
  type = "button",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button type={type} className={cn(PRIMARY_ACTION_BTN, className)} {...props}>
      Confirm <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

/** Primary continue — always shows the forward arrow. */
function ContinueButton({
  className,
  type = "button",
  children = "Continue",
  ...props
}: React.ComponentProps<typeof Button> & { children?: React.ReactNode }) {
  return (
    <Button type={type} className={cn(PRIMARY_ACTION_BTN, className)} {...props}>
      {children} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

/** Number / currency entry — same full-width input + enter key as decision credit score. */
function ChatNumberEnterPanel({
  value,
  onChange,
  onSubmit,
  placeholder,
  prefix,
  suffix,
  inputMode = "decimal",
  submitDisabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  inputMode?: "decimal" | "numeric";
  submitDisabled?: boolean;
}) {
  return (
    <InlineEnterField
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder={placeholder}
      prefix={prefix}
      suffix={suffix}
      inputMode={inputMode}
      submitDisabled={submitDisabled}
      fullWidth
    />
  );
}

/** Step 1 — pick which credit events apply. */
function CreditEventSelectPanel({
  eventSel,
  options,
  onToggle,
  onClearAll,
  onContinue,
}: {
  eventSel: string[];
  options: ReadonlyArray<FormChatOption>;
  onToggle: (code: string) => void;
  onClearAll: () => void;
  onContinue: () => void;
}) {
  return (
    <div className={CHAT_ACTION_PANEL}>
      <div className={cn("grid gap-1.5", options.length > 5 ? "sm:grid-cols-2" : "grid-cols-1")}>
        {options.map((opt, i) => (
          <OptionCard
            key={opt.value}
            letter={letter(i)}
            label={opt.label}
            description={opt.description}
            active={eventSel.includes(opt.value)}
            multi
            onClick={() => onToggle(opt.value)}
            onDeselect={onClearAll}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <form
          data-chat-confirm
          onSubmit={(e) => {
            e.preventDefault();
            if (eventSel.length > 0) onContinue();
          }}
        >
          <ContinueButton type="submit" disabled={eventSel.length === 0}>
            Continue ({eventSel.length})
          </ContinueButton>
        </form>
      </div>
    </div>
  );
}

/** Loan term — multi-select (matches wizard FLoanTermMultiSelect); A = no preference. */
function LoanTermMultiSelectPanel({
  termDraft,
  options,
  onToggle,
  onClearAll,
  onNoPreference,
  onContinue,
}: {
  termDraft: string;
  options: ReadonlyArray<FormChatOption>;
  onToggle: (termValue: string) => void;
  onClearAll: () => void;
  onNoPreference: () => void;
  onContinue: () => void;
}) {
  const termSelected = parseLoanTermSelection(termDraft);
  return (
    <div className={CHAT_ACTION_PANEL}>
      <div className="grid grid-cols-1 gap-1.5">
        {options.map((opt, i) => {
          const active = isNoProductPreference(opt.value)
            ? termDraft.trim() !== "" && isNoProductPreference(termDraft)
            : termSelected.includes(parseInt(opt.value, 10));
          return (
            <OptionCard
              key={opt.value}
              letter={letter(i)}
              label={opt.label}
              active={active}
              multi={!isNoProductPreference(opt.value)}
              onClick={() => {
                if (isNoProductPreference(opt.value)) onNoPreference();
                else onToggle(opt.value);
              }}
              onDeselect={onClearAll}
            />
          );
        })}
      </div>
      {termSelected.length > 0 && (
        <div className="mt-3 flex justify-end">
          <form
            data-chat-confirm
            onSubmit={(e) => {
              e.preventDefault();
              onContinue();
            }}
          >
            <ContinueButton type="submit">Continue ({termSelected.length})</ContinueButton>
          </form>
        </div>
      )}
    </div>
  );
}

/** One credit event at a time — lettered bucket cards, OR, MM/YYYY, Back / Continue. */
function CreditEventsTimelinePanel({
  form,
  events,
  options,
  eventIndex,
  canConfirmAll,
  onPickBucket,
  onClearTiming,
  onDateChange,
  onBack,
  onNext,
  onConfirm,
}: {
  form: WizardForm;
  events: string[];
  options: ReadonlyArray<FormChatOption>;
  eventIndex: number;
  canConfirmAll: boolean;
  onPickBucket: (code: string, bucket: string) => void;
  onClearTiming: (code: string) => void;
  onDateChange: (code: string, raw: string) => void;
  onBack: () => void;
  onNext: () => void;
  onConfirm: () => void;
}) {
  const ev = events[eventIndex];
  if (!ev) return null;

  const label = options.find((o) => o.value === ev)?.label ?? creditEventLabel(ev);
  const dateVal = form.creditEventDates?.[ev] ?? "";
  const yearsVal = form.creditEventYears?.[ev] ?? "";
  const dateErr = validateMmYyyy(dateVal);
  const bucketFromDate = dateVal.trim() && !dateErr ? computeYearsSinceBucket(dateVal) : "";
  const activeBucket = normalizeCreditEventYearBucket(
    bucketFromDate || (dateVal.trim() ? "" : yearsVal),
  );
  const currentComplete = creditEventTimingFilled(form, ev);
  const isLast = eventIndex >= events.length - 1;

  return (
    <form
      data-chat-confirm
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (isLast) {
          if (canConfirmAll) onConfirm();
        } else if (currentComplete) {
          onNext();
        }
      }}
    >
      <p className={cn(MOB.t15, "font-semibold leading-snug text-foreground")}>
        Event {eventIndex + 1} of {events.length} — how long ago was this?
      </p>
      <p className={cn("mt-1 text-muted-foreground", MOB.t13)}>{label}</p>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {CREDIT_EVENT_YEAR_BUCKETS.map((bucket, i) => (
          <OptionCard
            key={bucket}
            letter={letter(i)}
            label={bucket}
            active={activeBucket === bucket}
            onClick={() => onPickBucket(ev, bucket)}
            onDeselect={() => onClearTiming(ev)}
          />
        ))}
      </div>

      <p className="my-3 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        OR
      </p>

      <label className={cn("mb-1.5 block font-medium text-foreground", MOB.t12)}>
        Enter Month of the Event
      </label>
      <Input
        value={dateVal}
        placeholder="MM/YYYY"
        maxLength={7}
        onChange={(e) => onDateChange(ev, e.target.value)}
        className={cn(
          MOB.t14,
          "h-9 w-full placeholder:text-muted-foreground/40 md:h-10",
          dateErr && dateVal.length >= 4 && "border-red-400",
        )}
      />
      {dateErr && dateVal.length >= 4 ? (
        <p className="mt-1 text-[11px] text-red-500">{dateErr}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack} className="gap-1.5 text-[13px]">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        {isLast ? (
          <ConfirmButton type="submit" disabled={!canConfirmAll} onClick={onConfirm} />
        ) : (
          <ContinueButton type="submit" disabled={!currentComplete} onClick={onNext} />
        )}
      </div>
    </form>
  );
}

/** Render welcome copy with Start / Upload / form-type labels emphasized. */
function formatWelcomeParagraph(text: string) {
  return text.split(/(Start|Upload|Form 1003|URLA v3\.4)/g).map((part, i) =>
    part === "Start" || part === "Upload" || part === "Form 1003" || part === "URLA v3.4" ? (
      <strong key={i} className="font-semibold text-foreground">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// Compound / notice answers already embed their own field labels (e.g. the
// "Value $X · Loan $Y · LTV Z%" triangle summary); single-field answers get a
// "Metric : Value" prefix taken from the same label the sidebar uses.
const SELF_LABELED_SPECIALS = new Set([
  "triangle",
  "capacity_dti_bundle",
  "capacity_dti_notice",
  "credit_events",
  "geo",
  "geo_followup",
]);

function answeredBubbleLabel(qId: string, answerLabel: string): string {
  const q = FORM_CHAT_QUESTIONS.find((x) => x.id === qId);
  if (!q) return answerLabel;
  if (q.special && SELF_LABELED_SPECIALS.has(q.special)) return answerLabel;
  return `${humanizeField(q.id)} : ${answerLabel}`;
}

// ── state searchable combobox (full width) ───────────────────────────────────
function StateDropdown({
  options,
  value = "",
  onPick,
}: {
  options: ReadonlyArray<FormChatOption>;
  value?: string;
  onPick: (opt: FormChatOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sel = options.find((o) => o.value === value);
    setQuery(sel ? sel.label : "");
  }, [value, options]);

  const q = query.trim().toLowerCase();
  const matches = (
    q
      ? options.filter(
          (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
        )
      : options
  ).slice(0, 60);

  const items: SearchablePickerItem[] = matches.map((o) => ({
    key: o.value,
    value: o.value,
    label: o.label,
  }));

  const tryCommitQuery = () => {
    const match = matchStateOption(options, query);
    if (match && match.value !== value) {
      onPick(match);
      setQuery(match.label);
    }
  };

  return (
    <div className="mt-3 w-full">
      <SearchablePicker
        query={query}
        onQueryChange={setQuery}
        selectedValue={value}
        items={items}
        open={open}
        onOpenChange={setOpen}
        onSelect={(item) => {
          const opt = options.find((o) => o.value === item.value);
          if (opt) {
            onPick(opt);
            setQuery(opt.label);
          }
        }}
        onBlurCommit={tryCommitQuery}
        placeholder="Type a state — e.g. Texas or TX"
        mobileTitle="Select state"
        emptyMessage="No state found — try the full name or 2-letter code."
      />
    </div>
  );
}

// ── A single geo follow-up field (county / city / zip / yes-no) ───────────────
function GeoFieldControl({
  field,
  state,
  value = "",
  onPick,
  onClear,
}: {
  field: GeoFieldConfig;
  state: string;
  value?: string;
  onPick: (value: string) => void;
  onClear: () => void;
}) {
  const [zip, setZip] = useState(field.widget === "zip" ? value : "");
  if (field.widget === "yes_no") {
    return (
      <div className="mt-3 flex flex-col gap-1.5">
        {["Yes", "No"].map((v, i) => (
          <OptionCard
            key={v}
            letter={letter(i)}
            label={v}
            active={value === v}
            onClick={() => onPick(v)}
            onDeselect={onClear}
          />
        ))}
      </div>
    );
  }
  if (field.widget === "county_search") {
    return (
      <div className="mt-3">
        <CountySearchControl state={state} value={value} onPick={onPick} />
      </div>
    );
  }
  if (field.widget === "zip") {
    const valid = zip.replace(/\D/g, "").length === 5;
    return (
      <form
        data-chat-confirm
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onPick(zip.replace(/\D/g, ""));
        }}
      >
        <Input
          type="text"
          inputMode="numeric"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="ZIP code"
          className="h-10 max-w-[160px] text-[14px] placeholder:text-muted-foreground/40"
          autoFocus
        />
        <Button
          type="submit"
          size="sm"
          disabled={!valid}
          className="bg-[#012a5b] text-[13px] hover:bg-[#01234d]"
        >
          Enter
        </Button>
      </form>
    );
  }
  const opts = geoSelectOptions(state, field.form_key);
  const twoCol = opts.length > 5;
  return (
    <div className="mt-3">
      <div className={cn("grid gap-1.5", twoCol ? "sm:grid-cols-2" : "grid-cols-1")}>
        {opts.map((o, i) => (
          <OptionCard
            key={o.value}
            letter={letter(i)}
            label={o.label}
            active={value === o.value}
            onClick={() => onPick(o.value)}
            onDeselect={onClear}
          />
        ))}
      </div>
    </div>
  );
}

const CAPACITY_GREY_BOX =
  "mt-3 space-y-5 rounded-lg border border-border bg-muted/45 px-3 py-3.5 dark:bg-muted/25";

/**
 * Capacity extras when DTI > 43% — progressive, one decision per view:
 *   NOCB? (lettered Yes/No, no Confirm) → on Yes: Relationship (lettered cards) →
 *   Combined DTI → Continue → Residual: Household size → Residual income → Confirm.
 * `initialField` (sidebar edit) jumps straight to the clicked field's view.
 */
function CapacityDtiBundle({
  form,
  onConfirm,
  initialField,
}: {
  form: WizardForm;
  onConfirm: (patch: Partial<WizardForm>, label: string) => void;
  /** When editing from the sidebar, open at the clicked field's step. */
  initialField?: string | null;
}) {
  const showNocb = nocbVisible(form);
  const showResidual = residualTriggered(form);
  const soloDti = parseFloat(form.estimatedDti) || 0;

  const [nocb, setNocb] = useState(form.nonOccupantCoBorrower || "");
  const [relationship, setRelationship] = useState(form.noCbRelationship || "");
  const [combined, setCombined] = useState(form.combinedDti || "");
  const [size, setSize] = useState(form.householdSize || "");
  const [netIncome, setNetIncome] = useState(form.monthlyResidualIncome || "");

  const editingResidualField =
    initialField === "householdSize" || initialField === "monthlyResidualIncome";
  const editingNocbChoice = initialField === "nonOccupantCoBorrower";

  // Show NOCB first, then Residual — never both at once. A sidebar edit on a
  // residual field jumps straight to that view (NOCB already answered).
  const [phase, setPhase] = useState<"nocb" | "residual">(
    !showNocb || (editingResidualField && !!form.nonOccupantCoBorrower) ? "residual" : "nocb",
  );
  // The Yes/No buttons show until a choice is made (or when re-editing the choice).
  const [choosing, setChoosing] = useState(!nocb || editingNocbChoice);

  const combinedNum = parseFloat(combined) || 0;
  const residualDti = nocb === "Yes" && combined.trim() ? combinedNum : soloDti;
  const sizeNum = parseInt(size, 10) || 0;
  const requiredResidual =
    sizeNum > 0
      ? (() => {
          const baseline = sizeNum === 1 ? 1500 : 2500 + Math.max(0, sizeNum - 2) * 150;
          return residualDti > 50 ? Math.max(baseline, 3500) : baseline;
        })()
      : null;

  const yesBranchOk =
    !!relationship.trim() && !!combined.trim() && combinedNum <= 50 && soloDti <= 65;
  const residualOk = !!size.trim() && !!netIncome.trim();

  const commit = (
    nocbVal: string,
    relVal: string,
    combVal: string,
    sizeVal: string,
    netVal: string,
  ) => {
    const nocbPatch: Partial<WizardForm> = showNocb
      ? {
          nonOccupantCoBorrower: nocbVal,
          noCbRelationship: nocbVal === "Yes" ? relVal : "",
          combinedDti: nocbVal === "Yes" ? combVal : "",
        }
      : {};
    const residualPatch: Partial<WizardForm> = showResidual
      ? { householdSize: sizeVal, monthlyResidualIncome: formatMoneyForInput(netVal) }
      : {};
    const parts: string[] = [];
    if (showNocb && nocbVal) {
      if (nocbVal === "Yes") {
        parts.push(`NOCB Yes · ${relVal}`);
        if (combVal.trim()) parts.push(`Combined DTI ${combVal}%`);
      } else {
        parts.push("NOCB No");
      }
    }
    if (showResidual && sizeVal.trim()) {
      parts.push(`Household ${sizeVal} · ${money(netVal)}/mo residual`);
    }
    onConfirm(
      { ...nocbPatch, ...residualPatch, noCbFico: "", noCbIncome: "" },
      parts.join(" · ") || "Capacity details",
    );
  };

  // Yes/No on the NOCB question — no Confirm; the choice advances the view.
  const pickNocb = (v: string) => {
    setChoosing(false);
    if (v === "Yes") {
      setNocb("Yes");
      return;
    }
    setNocb("No");
    setRelationship("");
    setCombined("");
    if (showResidual) setPhase("residual");
    else commit("No", "", "", size, netIncome);
  };

  // Continue from the NOCB-Yes branch.
  const continueFromNocb = () => {
    if (!yesBranchOk) return;
    if (showResidual) setPhase("residual");
    else commit("Yes", relationship, combined, size, netIncome);
  };

  const inputRow = "h-10 w-full flex-1 text-[14px]";

  return (
    <div className={CAPACITY_GREY_BOX}>
      {showNocb &&
        phase === "nocb" &&
        (choosing ? (
          <div className="space-y-3">
            <p className="text-[14px] font-normal leading-relaxed text-[#475569]">
              Do you have a Non-Occupant Co-borrower to help you qualify?
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              <OptionCard
                letter="A"
                label="Yes"
                active={nocb === "Yes"}
                onClick={() => pickNocb("Yes")}
                onDeselect={() => setNocb("")}
              />
              <OptionCard
                letter="B"
                label="No"
                active={nocb === "No"}
                onClick={() => pickNocb("No")}
                onDeselect={() => setNocb("")}
              />
            </div>
          </div>
        ) : nocb === "Yes" ? (
          <div className="space-y-3">
            {soloDti > 65 && (
              <p className="text-[11px] font-semibold text-red-700">
                Solo DTI exceeds 65% — NOCB is not permitted above this threshold.
              </p>
            )}
            <div>
              <p className="mb-2 text-[14px] font-normal leading-relaxed text-[#475569]">
                What is the co-borrower&apos;s relationship to the primary borrower?
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {NOCB_RELATIONSHIP_OPTIONS.map((o, i) => (
                  <OptionCard
                    key={o}
                    letter={letter(i)}
                    label={o}
                    active={relationship === o}
                    onClick={() => setRelationship(o)}
                    onDeselect={() => setRelationship("")}
                  />
                ))}
              </div>
            </div>

            {relationship && (
              <div>
                <label className="mb-1.5 block text-[13px] text-muted-foreground">
                  Combined DTI with NOCB included <span className="text-red-500">*</span>
                </label>
                <InlineEnterField
                  value={combined}
                  onChange={(v) => setCombined(v.replace(/[^0-9.]/g, ""))}
                  onSubmit={continueFromNocb}
                  placeholder="e.g. 38"
                  suffix="%"
                  inputMode="decimal"
                  submitDisabled={!yesBranchOk}
                />
                {combinedNum > 50 && (
                  <p className="mt-1 text-[11px] font-medium text-red-700">
                    Combined DTI must be 50% or less with a non-occupant co-borrower.
                  </p>
                )}
              </div>
            )}

            {relationship && (
              <form
                data-chat-confirm
                className="flex items-center justify-between pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (yesBranchOk) continueFromNocb();
                }}
              >
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setChoosing(true)}
                  className="gap-1.5 text-[13px]"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                {showResidual ? (
                  <ContinueButton type="submit" disabled={!yesBranchOk} />
                ) : (
                  <ConfirmButton type="submit" disabled={!yesBranchOk} />
                )}
              </form>
            )}
          </div>
        ) : null)}

      {phase === "residual" && showResidual && (
        <form
          data-chat-confirm
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (residualOk) commit(nocb, relationship, combined, size, netIncome);
          }}
        >
          <div>
            <label className="mb-1 block text-[13px] text-muted-foreground">
              Household size <span className="text-red-500">*</span>
            </label>
            <Input
              type="number"
              min={1}
              max={10}
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 3"
              className={inputRow}
            />
          </div>

          {sizeNum > 0 && (
            <div>
              <label className="mb-1 block text-[13px] text-muted-foreground">
                Monthly residual income (after housing + debts){" "}
                <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-1">
                <span className="text-[14px] text-muted-foreground">$</span>
                <Input
                  value={netIncome}
                  onChange={(e) => setNetIncome(formatMoneyForInput(e.target.value))}
                  placeholder="e.g. 2,500"
                  className={inputRow}
                />
              </div>
              {requiredResidual != null && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Minimum required residual: {money(requiredResidual)}
                </p>
              )}
            </div>
          )}

          {sizeNum > 0 && (
            <div className="flex items-center justify-between pt-1">
              {showNocb && !editingResidualField ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPhase("nocb")}
                  className="gap-1.5 text-[13px]"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
              ) : (
                <span />
              )}
              <ConfirmButton type="submit" disabled={!residualOk} />
            </div>
          )}
        </form>
      )}
    </div>
  );
}

const RATE_TYPE_PREF_CARD_OPTIONS: FormChatOption[] = [
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

const IO_PREF_CARD_OPTIONS: FormChatOption[] = [
  { value: "No preference", label: "No Preference" },
  {
    value: "Yes",
    label: "Yes — I want Interest-Only",
    description: "Lower initial payments",
  },
  { value: "No", label: "No — fully amortizing only" },
];

function productPrefCardOptions(q: FormChatQuestion): FormChatOption[] {
  if (q.id === "loanTerm") {
    return [
      { value: LOAN_TERM_NO_PREF, label: "No Preference" },
      ...LOAN_TERM_SELECT_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    ];
  }
  if (q.id === "rateTypePref") return RATE_TYPE_PREF_CARD_OPTIONS;
  if (q.id === "interestOnlyPref") return IO_PREF_CARD_OPTIONS;
  return [];
}

function productPrefCardActive(
  qId: string,
  opt: FormChatOption,
  form: WizardForm,
  opts: { termDraft?: string; selectionCommitted: boolean },
): boolean {
  if (!opts.selectionCommitted && qId !== "loanTerm") return false;

  if (qId === "loanTerm") {
    const stored = opts.termDraft ?? (opts.selectionCommitted ? form.loanTerm : "");
    if (isNoProductPreference(opt.value)) {
      return stored.trim() !== "" && isNoProductPreference(stored);
    }
    const terms = parseLoanTermSelection(stored);
    return terms.includes(parseInt(opt.value, 10));
  }
  if (qId === "rateTypePref") {
    const v = (form.rateTypePref ?? "").trim();
    if (isNoProductPreference(opt.value)) {
      return v !== "" && isNoProductPreference(v);
    }
    return v === opt.value;
  }
  if (qId === "interestOnlyPref") {
    const v = (form.interestOnlyPref ?? "").trim();
    if (isNoProductPreference(opt.value)) {
      return v !== "" && isNoProductPreference(v);
    }
    return v === opt.value;
  }
  return false;
}

function productPrefAnswerLabel(qId: string, form: WizardForm): string {
  if (qId === "loanTerm") {
    return isNoProductPreference(form.loanTerm)
      ? "No preference"
      : formatLoanTermDisplay(form.loanTerm);
  }
  if (qId === "rateTypePref") {
    if (isNoProductPreference(form.rateTypePref)) return "No preference";
    const opt = RATE_TYPE_PREF_CARD_OPTIONS.find((o) => o.value === form.rateTypePref);
    return opt?.label ?? form.rateTypePref;
  }
  if (qId === "interestOnlyPref") {
    if (isNoProductPreference(form.interestOnlyPref)) return "No preference";
    const opt = IO_PREF_CARD_OPTIONS.find((o) => o.value === form.interestOnlyPref);
    return opt?.label ?? form.interestOnlyPref;
  }
  return "No preference";
}

function ProductPrefStep({
  q,
  form,
  onConfirm,
  termDraft,
  onToggleTerm,
  onClearSelection,
  selectionCommitted,
}: {
  q: FormChatQuestion;
  form: WizardForm;
  onConfirm: (patch: Partial<WizardForm>, label: string) => void;
  termDraft: string;
  onToggleTerm: (termValue: string) => void;
  onClearSelection: () => void;
  selectionCommitted: boolean;
}) {
  const options = productPrefCardOptions(q);

  if (q.id === "loanTerm") {
    const commit = (term: string) => {
      const patch = { loanTerm: term };
      onConfirm(patch, productPrefAnswerLabel("loanTerm", { ...form, ...patch }));
    };
    return (
      <LoanTermMultiSelectPanel
        termDraft={termDraft}
        options={options}
        onToggle={onToggleTerm}
        onClearAll={onClearSelection}
        onNoPreference={() => commit(LOAN_TERM_NO_PREF)}
        onContinue={() => commit(termDraft)}
      />
    );
  }

  if (q.id === "rateTypePref" || q.id === "interestOnlyPref") {
    const commit = (value: string) => {
      const patch = { [q.id]: value } as Partial<WizardForm>;
      onConfirm(patch, productPrefAnswerLabel(q.id, { ...form, ...patch }));
    };
    return (
      <div className="mt-3">
        <div className="grid grid-cols-1 gap-1.5">
          {options.map((opt, i) => (
            <OptionCard
              key={opt.value}
              letter={letter(i)}
              label={opt.label}
              description={opt.description}
              active={productPrefCardActive(q.id, opt, form, { selectionCommitted })}
              onClick={() => commit(opt.value)}
              onDeselect={onClearSelection}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}

// ── value / loan / LTV triangle input ────────────────────────────────────────
// Grouped "Loan Details" — mirrors the wizard's value/loan/LTV block, surfacing the
// lien- and purpose-specific fields together (existing first lien + HCLTV for second
// liens, existing-second + cash-out for first-lien refis, down payment for purchases).
function LoanDetails({
  form,
  onConfirm,
  hint,
}: {
  form: WizardForm;
  onConfirm: (patch: Partial<WizardForm>, label: string) => void;
  hint?: string;
}) {
  // Labels + visibility come from the shared spec (loan_details_field_labels_spec) —
  // the chat-mode prompt and sidebars read the same source, so the modes can't drift.
  const fieldSpec = loanDetailsFieldSpec(form);

  const showDownPayment = fieldSpec.showDownPayment;
  const showEFL = fieldSpec.showExistingFirstLien;
  const eflMandatory = fieldSpec.existingFirstLienRequired;
  const showHCLTV = fieldSpec.showCltv;
  const showExistingSecond = fieldSpec.showExistingSecond;
  const showCash = fieldSpec.showCash;
  const showDraw = fieldSpec.showHelocDraw;

  const [pv, setPv] = useState(form.valueSalesPrice || "");
  const [la, setLa] = useState(form.loanAmount || "");
  const [ltv, setLtv] = useState(form.ltv || "");
  const [efl, setEfl] = useState(form.existingFirstLien || "");
  const [esl, setEsl] = useState(form.existingSecondLien || "");
  const [eslBal, setEslBal] = useState(form.existingSecondLienBalance || "");
  const [cash, setCash] = useState(form.cashInHandRequest || "");
  const [draw, setDraw] = useState(form.helocInitialDraw || "");

  // LTV is capped at 100%.
  const capLtv = (n: number) => Math.min(100, Math.max(0, n));
  const recalc = (field: "pv" | "la" | "ltv", raw: string) => {
    const value = field === "ltv" && raw !== "" ? String(capLtv(parseFloat(raw) || 0)) : raw;
    const numPv = parseFloat(field === "pv" ? value : pv) || 0;
    const numLa = parseFloat(field === "la" ? value : la) || 0;
    const numLtv = parseFloat(field === "ltv" ? value : ltv) || 0;
    if (field === "pv") setPv(value);
    if (field === "la") setLa(value);
    if (field === "ltv") setLtv(value);
    if (field === "pv" && numPv > 0) {
      if (numLa > 0) setLtv(String(capLtv(Math.round((numLa / numPv) * 100))));
      else if (numLtv > 0) setLa((numPv * (numLtv / 100)).toFixed(0));
    } else if (field === "la" && numLa > 0) {
      if (numPv > 0) setLtv(String(capLtv(Math.round((numLa / numPv) * 100))));
      else if (numLtv > 0) setPv((numLa / (numLtv / 100)).toFixed(0));
    } else if (field === "ltv" && numLtv > 0) {
      if (numPv > 0) setLa((numPv * (numLtv / 100)).toFixed(0));
      else if (numLa > 0) setPv((numLa / (numLtv / 100)).toFixed(0));
    }
  };

  const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
  // Comma-grouped display for whole-dollar amounts (state still holds raw digits).
  const fmt = (s: string) => {
    const digits = String(s).replace(/[^0-9]/g, "");
    return digits ? Number(digits).toLocaleString("en-US") : "";
  };
  // Actual LTV ratio (uncapped) for the warning, even if the field shows 100.
  const ltvRatio = num(pv) > 0 && num(la) > 0 ? Math.round((num(la) / num(pv)) * 100) : num(ltv);
  const subordinating = existingSecondLienNeedsSubordination(esl);
  // CLTV: 2nd lien → (new 2nd + other lien) ÷ value; first-lien refi → adds a
  // subordinating 2nd's balance, else equals LTV.
  const hcltv =
    num(pv) > 0
      ? form.isSecondLien === "yes"
        ? Math.round(((num(la) + num(efl)) / num(pv)) * 100)
        : subordinating
          ? Math.round(((num(la) + num(eslBal)) / num(pv)) * 100)
          : ltvRatio
      : 0;
  // Purchase: value − loan; piggyback purchase: value − new first − new second.
  const downPaymentNum = loanDetailsDownPayment({
    valueSalesPrice: pv,
    loanAmount: la,
    existingFirstLien: efl,
    lienPosition: form.lienPosition,
  });
  const downPayment = pv && la ? downPaymentNum.toLocaleString("en-US") : "—";
  const showESLBal = showExistingSecond && existingSecondLienNeedsSubordination(esl);
  const eslRequired = showExistingSecond && !!efl; // wizard: required once a 1st-lien balance is given

  const loanLabel = fieldSpec.loanAmount;
  const valueLabel = fieldSpec.propertyValue;

  const canSubmit =
    !!pv &&
    !!la &&
    !!ltv &&
    (!eflMandatory || !!efl) &&
    (!eslRequired || !!esl) &&
    (!showESLBal || !!eslBal) &&
    (!showCash || !!cash) &&
    (!showDraw || !!draw);

  const moneyRow = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    optional = false,
  ) => (
    <div className="grid grid-cols-[150px_auto_1fr] md:grid-cols-[180px_auto_1fr] items-center gap-2">
      <label className="text-[12px] font-medium text-foreground">
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </label>
      <span className="inline-block w-3 text-[14px] text-muted-foreground">$</span>
      <Input
        type="text"
        inputMode="numeric"
        value={fmt(value)}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder={placeholder}
        className="h-10 text-[14px] placeholder:text-muted-foreground/40"
      />
    </div>
  );

  const cltvRow = (
    <div>
      <div className="grid grid-cols-[150px_auto_1fr] md:grid-cols-[180px_auto_1fr] items-center gap-2">
        <label className="text-[12px] font-medium text-foreground">{fieldSpec.cltv}</label>
        <span aria-hidden className="w-3" />
        <div
          className={cn(
            "flex h-10 items-center gap-1 text-[14px] font-medium",
            hcltv > 100 ? "text-red-600" : hcltv > 90 ? "text-amber-600" : "text-foreground",
          )}
        >
          {hcltv || "—"}
          <span className="font-normal text-muted-foreground">%</span>
        </div>
      </div>
      {hcltv > 100 ? (
        <p className="mt-0.5 pl-[178px] md:pl-[208px] text-[11px] text-red-600">
          CLTV is over 100% — re-check the loan amount and existing lien balances.
        </p>
      ) : hcltv > 90 ? (
        <p className="mt-0.5 pl-[178px] md:pl-[208px] text-[11px] text-amber-600">
          CLTV is high (&gt;90%) — only a limited set of programs will qualify.
        </p>
      ) : null}
    </div>
  );

  const handleConfirm = () => {
    const patch: Partial<WizardForm> = { valueSalesPrice: pv, loanAmount: la, ltv };
    if (showEFL && efl) patch.existingFirstLien = efl;
    if (showHCLTV) patch.cltv = String(hcltv);
    if (showExistingSecond) {
      patch.existingSecondLien = esl;
      // Flipping back to "None"/"paid off" must WIPE the stale subordinated balance,
      // not just hide its row — otherwise old inputs leak into CLTV and eligibility.
      patch.existingSecondLienBalance = showESLBal ? eslBal : "";
    }
    if (showCash) patch.cashInHandRequest = cash;
    if (showDraw) patch.helocInitialDraw = draw;
    const parts = [`Value ${money(pv)}`, `Loan ${money(la)}`, `LTV ${ltv}%`];
    if (showHCLTV) parts.push(`CLTV ${hcltv}%`);
    if (showCash && cash) parts.push(`Cash-out ${money(cash)}`);
    if (showDraw && draw) parts.push(`Draw ${money(draw)}`);
    onConfirm(patch, parts.join(" · "));
  };

  return (
    <form
      data-chat-confirm
      className="mt-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) handleConfirm();
      }}
    >
      {moneyRow(valueLabel, pv, (v) => recalc("pv", v), "500,000")}
      {moneyRow(loanLabel, la, (v) => recalc("la", v), "400,000")}

      <div>
        <div className="grid grid-cols-[150px_auto_1fr] md:grid-cols-[180px_auto_1fr] items-center gap-2">
          <label className="text-[12px] font-medium text-foreground">{fieldSpec.ltv}</label>
          <span aria-hidden className="w-3" />
          <div className="flex min-w-0 items-center gap-1">
            <Input
              type="number"
              inputMode="numeric"
              value={ltv}
              onChange={(e) => recalc("ltv", e.target.value)}
              placeholder="80"
              className="h-10 min-w-0 flex-1 text-[14px] placeholder:text-muted-foreground/40"
            />
            <span className="shrink-0 text-[14px] text-muted-foreground">%</span>
          </div>
        </div>
        {ltvRatio > 100 ? (
          <p className="mt-0.5 pl-[178px] md:pl-[208px] text-[11px] text-red-600">
            LTV exceeds 100% — the loan is more than the property value.
          </p>
        ) : ltvRatio > 95 ? (
          <p className="mt-0.5 pl-[178px] md:pl-[208px] text-[11px] text-amber-600">
            LTV is over 95% — only a limited set of programs will qualify.
          </p>
        ) : null}
      </div>

      {showEFL && moneyRow(fieldSpec.existingFirstLien, efl, setEfl, "300,000", !eflMandatory)}

      {/* Second liens: CLTV right after the first-lien balance it derives from. */}
      {showHCLTV && form.isSecondLien === "yes" && cltvRow}

      {showExistingSecond && (
        <div className="grid grid-cols-[150px_auto_1fr] md:grid-cols-[180px_auto_1fr] items-center gap-2">
          <label className="text-[12px] font-medium text-foreground">
            {fieldSpec.existingSecondLien}
          </label>
          <span aria-hidden className="w-3" />
          <select
            value={esl}
            onChange={(e) => setEsl(e.target.value)}
            className="h-10 rounded-md border border-border bg-card px-3 text-[14px]"
          >
            <option value="" disabled>
              Select…
            </option>
            {EXISTING_SECOND_LIEN_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      )}

      {showESLBal && moneyRow("Existing Second Balance", eslBal, setEslBal, "60,000")}

      {showCash && moneyRow(fieldSpec.cashOut, cash, setCash, "50,000")}

      {showDraw && moneyRow("Initial Draw", draw, setDraw, "50,000")}

      {/* First-lien refis: CLTV LAST — it depends on the 2nd-lien answers above. */}
      {showHCLTV && form.isSecondLien !== "yes" && cltvRow}

      {showDownPayment && (
        <div className="grid grid-cols-[150px_auto_1fr] md:grid-cols-[180px_auto_1fr] items-center gap-2">
          <label className="text-[12px] font-medium text-foreground">Down Payment</label>
          <span className="inline-block w-3 text-[14px] text-muted-foreground">$</span>
          <div className="flex h-10 items-center text-[14px] font-medium text-foreground">
            {downPayment}
          </div>
        </div>
      )}

      <div className={cn("mt-1 flex items-center gap-3", hint ? "justify-between" : "justify-end")}>
        {hint ? (
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
        ) : null}
        <ConfirmButton type="submit" disabled={!canSubmit} className="shrink-0" />
      </div>
    </form>
  );
}

function OptionalSkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="mt-2.5 flex justify-end">
      <button
        type="button"
        onClick={onSkip}
        className="text-[12px] font-semibold text-[#012a5b] underline underline-offset-2 hover:text-[#01234d]"
      >
        Skip →
      </button>
    </div>
  );
}

// ── Question controls (cards / inline input / triangle / credit events) ───────
function QuestionControls({
  q,
  form,
  draft,
  setDraft,
  onPickOption,
  onSubmitValue,
  onTriangle,
  onSkip,
  eventSel,
  creditEventsTimelineOpen,
  creditEventTimelineIdx,
  onToggleCreditEvent,
  onConfirmEventSelection,
  onPickCreditEventBucket,
  onUpdateCreditEventDate,
  onBackCreditEventTimeline,
  onNextCreditEventTimeline,
  onConfirmCreditTimeline,
  loanTermDraft,
  onToggleLoanTerm,
  onClearProductPref,
  onClearFormAnswer,
  onClearCreditEvents,
  onClearCreditEventTiming,
  productPrefSelectionCommitted,
  capacityInitialField,
}: {
  q: FormChatQuestion;
  form: WizardForm;
  draft: string;
  setDraft: (v: string) => void;
  onPickOption: (opt: FormChatOption) => void;
  onSubmitValue: () => void;
  onTriangle: (patch: Partial<WizardForm>, label: string) => void;
  onSkip?: () => void;
  eventSel: string[];
  creditEventsTimelineOpen: boolean;
  creditEventTimelineIdx: number;
  onToggleCreditEvent: (code: string) => void;
  onConfirmEventSelection: () => void;
  onPickCreditEventBucket: (code: string, bucket: string) => void;
  onUpdateCreditEventDate: (code: string, raw: string) => void;
  onBackCreditEventTimeline: () => void;
  onNextCreditEventTimeline: (events: string[]) => void;
  onConfirmCreditTimeline: () => void;
  loanTermDraft: string;
  onToggleLoanTerm: (termValue: string) => void;
  onClearProductPref: () => void;
  onClearFormAnswer: () => void;
  onClearCreditEvents: () => void;
  onClearCreditEventTiming: (code: string) => void;
  productPrefSelectionCommitted: boolean;
  capacityInitialField?: string | null;
}) {
  const options = optionsFor(form, q);
  const selectedValue = formFieldValue(form, q);

  // Value / Loan / LTV — grouped Loan Details (with lien/purpose-specific fields)
  if (q.special === "triangle") {
    return <LoanDetails form={form} onConfirm={onTriangle} hint={q.hint} />;
  }

  if (q.special === "capacity_dti_notice") {
    return (
      <form
        data-chat-confirm
        className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30"
        onSubmit={(e) => {
          e.preventDefault();
          onTriangle({}, "Got it — let's continue");
        }}
      >
        <div className="flex justify-end">
          <Button type="submit" className="gap-1.5 bg-[#012a5b] text-[13px] hover:bg-[#01234d]">
            Got it, let&apos;s continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </form>
    );
  }

  if (q.special === "capacity_dti_bundle") {
    return (
      <CapacityDtiBundle form={form} onConfirm={onTriangle} initialField={capacityInitialField} />
    );
  }

  if (q.special === "product_pref") {
    return (
      <ProductPrefStep
        q={q}
        form={form}
        onConfirm={onTriangle}
        termDraft={loanTermDraft}
        onToggleTerm={onToggleLoanTerm}
        onClearSelection={onClearProductPref}
        selectionCommitted={productPrefSelectionCommitted}
      />
    );
  }

  if (q.special === "county_search") {
    return (
      <div className="mt-3">
        <CountySearchControl
          state={form.state}
          value={form.stateCounty}
          onPick={(county) => {
            const patch = applyFormChatAnswer(form, q, county);
            onTriangle(patch, county);
          }}
        />
      </div>
    );
  }

  // One geo follow-up field at a time (city / zip / yes-no gates), per the chosen state.
  if (q.special === "geo_followup") {
    const field = nextRequiredGeoField(form);
    if (!field) return null;
    return (
      <GeoFieldControl
        field={field}
        state={form.state}
        value={String((form as Record<string, unknown>)[field.form_key] ?? "").trim()}
        onClear={onClearFormAnswer}
        onPick={(value) => {
          const label =
            field.widget === "select"
              ? (geoSelectOptions(form.state, field.form_key).find((o) => o.value === value)
                  ?.label ?? value)
              : value;
          onTriangle({ [field.form_key]: value } as Partial<WizardForm>, label);
        }}
      />
    );
  }

  if (q.special === "credit_events") {
    const events = creditEventsTimelineOpen
      ? [...new Set(form.creditEvents.length ? form.creditEvents : eventSel)]
      : [];
    if (creditEventsTimelineOpen && events.length > 0) {
      const idx = Math.min(Math.max(0, creditEventTimelineIdx), events.length - 1);
      return (
        <CreditEventsTimelinePanel
          form={form}
          events={events}
          options={options}
          eventIndex={idx}
          canConfirmAll={isAnswered(form, q)}
          onPickBucket={onPickCreditEventBucket}
          onClearTiming={onClearCreditEventTiming}
          onDateChange={onUpdateCreditEventDate}
          onBack={onBackCreditEventTimeline}
          onNext={() => onNextCreditEventTimeline(events)}
          onConfirm={onConfirmCreditTimeline}
        />
      );
    }
    return (
      <CreditEventSelectPanel
        eventSel={eventSel}
        options={options}
        onToggle={onToggleCreditEvent}
        onClearAll={onClearCreditEvents}
        onContinue={onConfirmEventSelection}
      />
    );
  }

  // Value questions — constrained inline input
  if (q.kind === "currency" || q.kind === "number") {
    const isFico = q.id === "decisionCreditScore";
    const isDti = q.id === "estimatedDti";
    if (isFico) {
      const ficoCaution = showDecisionCreditScoreCaution(draft)
        ? DECISION_CREDIT_SCORE_CAUTION
        : undefined;
      const canSubmit = isDecisionCreditScoreInRange(draft);
      return (
        <InlineEnterField
          value={draft}
          onChange={(v) => setDraft(v.replace(/[^0-9]/g, ""))}
          onSubmit={onSubmitValue}
          placeholder={q.placeholder}
          inputMode="numeric"
          fullWidth
          caution={ficoCaution}
          cautionDelayMs={DECISION_CREDIT_SCORE_CAUTION_DELAY_MS}
          submitDisabled={!canSubmit}
        />
      );
    }
    return (
      <div>
        <InlineEnterField
          value={draft}
          onChange={(v) => setDraft(isDti ? v.replace(/[^0-9.]/g, "") : v)}
          onSubmit={onSubmitValue}
          placeholder={q.placeholder}
          prefix={q.prefix}
          suffix={q.suffix}
          inputMode={isDti ? "decimal" : "decimal"}
          fullWidth
        />
        {onSkip ? <OptionalSkipButton onSkip={onSkip} /> : null}
      </div>
    );
  }

  // State — simple dropdown; geo follow-ups (county / city / zip) come next.
  if (q.kind === "state") {
    return <StateDropdown options={options} value={selectedValue} onPick={onPickOption} />;
  }

  // enum / yes-no — lettered cards. With more than 5 options, lay them out 2 per row.
  const twoColumn = options.length > 5;
  return (
    <div className="mt-3">
      <div className={cn("grid gap-1.5", twoColumn ? "sm:grid-cols-2" : "grid-cols-1")}>
        {options.map((opt, i) => (
          <OptionCard
            key={opt.value}
            letter={letter(i)}
            label={opt.label}
            description={opt.description}
            active={selectedValue === opt.value}
            onClick={() => onPickOption(opt)}
            onDeselect={onClearFormAnswer}
          />
        ))}
      </div>
      {onSkip ? <OptionalSkipButton onSkip={onSkip} /> : null}
    </div>
  );
}

function OptionCard({
  letter: l,
  label,
  description,
  active = false,
  multi = false,
  onClick,
  onDeselect,
}: {
  letter: string;
  label: string;
  description?: string;
  active?: boolean;
  /** Multi-select rows show a checkbox; letter keys (A, B, C…) still toggle on click. */
  multi?: boolean;
  onClick: () => void;
  /** Double-click when active clears the selection (whole question or multi-select batch). */
  onDeselect?: () => void;
}) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    [],
  );

  const handleClick = () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onClick();
    }, 220);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (active && onDeselect) onDeselect();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border text-left transition-colors md:gap-3",
        MOB.optionPad,
        active
          ? "border-[#012a5b] bg-[#012a5b]/5"
          : "border-border bg-card hover:border-[#012a5b]/50 hover:bg-[#012a5b]/[0.06]",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#012a5b]/10 text-[11px] font-semibold text-[#012a5b] md:h-6 md:w-6 md:text-[12px]">
        {l}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-medium text-foreground", MOB.t13)}>{label}</span>
        {description && (
          <span className={cn("mt-0.5 block text-muted-foreground", MOB.t12)}>{description}</span>
        )}
      </span>
      {multi && (
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
            active ? "border-[#012a5b] bg-[#012a5b] text-white" : "border-border bg-card",
          )}
          aria-hidden="true"
        >
          {active ? <Check className="h-3.5 w-3.5 stroke-[2.5]" /> : null}
        </span>
      )}
    </button>
  );
}

/** Legacy text rows before `variant: "thinking"` — still render as compact status. */
function eligibilityThinkingLabel(msg: {
  variant?: "thinking" | "default";
  thinkingLabel?: string;
  thinkingLabels?: readonly string[];
  text?: string;
}): string | undefined {
  if (msg.variant === "thinking" || msg.thinkingLabel || msg.thinkingLabels?.length) {
    return undefined;
  }
  const t = stripLoadingEllipsis(msg.text ?? "");
  if (/^running eligibility/i.test(t)) return ELIGIBILITY_RUN_LABEL;
  if (/^refreshing eligibility/i.test(t)) return ELIGIBILITY_REFRESH_LABEL;
  if (/^reloading results/i.test(t)) return ELIGIBILITY_RELOAD_LABEL;
  return undefined;
}

function ThinkingBubble({
  label = "Thinking",
  labels,
}: {
  label?: string;
  labels?: readonly string[];
}) {
  return <CompactThinkingBubble label={label} labels={labels} />;
}

function FormChatBotRow({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0">{children}</div>;
}

function ProfileSubmitGateActions({
  onSubmit,
  onReset,
}: {
  onSubmit: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        onClick={onSubmit}
        className="gap-1.5 rounded-full bg-[#012a5b] px-5 text-[13px] shadow-sm hover:bg-[#01234d]"
      >
        Submit and Find Programs
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      <button type="button" onClick={onReset} className={RESET_PILL_BTN}>
        <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
        Reset
      </button>
    </div>
  );
}

function BotBubble({
  children,
  chip,
  chipVariant = "default",
  tag,
  card = false,
}: {
  children: React.ReactNode;
  chip?: string;
  chipVariant?: "default" | "accent";
  tag?: string;
  /** Wrap the content in a white card (used for the assistant's text messages). */
  card?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {(chip || tag) && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {chip && (
            <span
              className={cn(
                "inline-block rounded-md px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase",
                chipVariant === "accent"
                  ? "bg-[#012a5b]/10 text-[#012a5b]"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {chip}
            </span>
          )}
          {tag && (
            <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {tag}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          "min-w-0",
          card && "rounded-2xl border border-border bg-white shadow-sm",
          card && MOB.cardPad,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function UserBubble({ children, onEdit }: { children: React.ReactNode; onEdit?: () => void }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "flex max-w-[80%] items-center gap-2 rounded-xl bg-muted px-3 py-1.5 text-foreground md:px-3.5 md:py-2",
          MOB.t13,
        )}
      >
        {children}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Change this answer"
            className="ml-1 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" aria-hidden="true" /> Change
          </button>
        )}
      </div>
    </div>
  );
}
