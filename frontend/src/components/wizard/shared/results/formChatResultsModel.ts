/**
 * FormChatFlow results transcript — message kinds + pure helpers for the post-eligibility
 * state machine (Know More, RAG, LoanPASS, exclusions).
 */
import type { EligibleProgram } from "@/components/wizard/loanWizardEligibility";
import type { LoanpassDbProduct, LoanpassPricingPayload } from "@/lib/loanpass/pricingTable";
import { isScenarioNotesSkipMessage } from "@/lib/sessionNotes";

/** Shown when leaving Know More / exclusions back to the results table. */
export const BACK_TO_PROGRAMS_SUMMARY_TEXT = "Back to Programs Summary.";
/** @deprecated Use BACK_TO_PROGRAMS_SUMMARY_TEXT */
export const BACK_TO_RESULTS_LIST_TEXT = BACK_TO_PROGRAMS_SUMMARY_TEXT;

export function eligibilityResultsHeadline(matchCount: number): string {
  return matchCount > 0
    ? "Good News! We've found matching programs for you."
    : "Hard Luck! We couldn't find any matching programs.";
}

/** Post-submit message kinds embedded in the FormChatFlow intake transcript. */
export type FormChatResultsMessage =
  | {
      kind: "assistant";
      id: string;
      paragraphs?: readonly string[];
      text?: string;
      variant?: "thinking" | "default" | "loanpass-unavailable";
      programLabel?: string;
      thinkingLabel?: string;
      thinkingLabels?: readonly string[];
      ragReply?: boolean;
    }
  | { kind: "user"; id: string; text: string }
  | { kind: "results"; id: string; programs: EligibleProgram[] }
  | { kind: "suggestion"; id: string }
  | { kind: "program-detail"; id: string; program: EligibleProgram }
  | {
      kind: "loanpass-products";
      id: string;
      program: EligibleProgram;
      products: LoanpassDbProduct[];
    }
  | {
      kind: "loanpass-pricing";
      id: string;
      payload: LoanpassPricingPayload;
      fromProductPicker?: boolean;
    }
  | { kind: "exclusions"; id: string };

/** Rebuild the full post-submit chat tail after a tab refresh (skip streaming gate). */
export function buildRestoredResultsTail(programs: EligibleProgram[]): FormChatResultsMessage[] {
  const introId = "restore-headline";
  const resultsId = "restore-results";
  const suggestionId = "restore-suggestion";
  return [
    { kind: "assistant", id: introId, text: eligibilityResultsHeadline(programs.length) },
    { kind: "results", id: resultsId, programs },
    { kind: "suggestion", id: suggestionId },
  ];
}

/** Messages that belong to a results run (cleared when a resubmit replaces them). */
export function isResultsConversationMsg(msg: FormChatResultsMessage): boolean {
  if (
    msg.kind === "results" ||
    msg.kind === "suggestion" ||
    msg.kind === "program-detail" ||
    msg.kind === "loanpass-products" ||
    msg.kind === "loanpass-pricing" ||
    msg.kind === "exclusions"
  ) {
    return true;
  }
  if (
    msg.kind === "assistant" &&
    (msg.variant === "thinking" ||
      (!!msg.text &&
        /^(Found \d|Good News|Hard Luck|Updated results|Running eligibility|Refreshing eligibility|Reloading results|Back to Programs Summary|Getting Program Details|Please Wait|Almost There|Fetching program details|Loading key metrics|Reviewing guideline notes)/.test(
          msg.text,
        )))
  ) {
    return true;
  }
  if (
    msg.kind === "user" &&
    (msg.text.startsWith("Know more:") ||
      msg.text === "Exit" ||
      msg.text === "Understand exclusions")
  ) {
    return true;
  }
  return false;
}

export function lastResultsMessageIndex(messages: FormChatResultsMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === "results") return i;
  }
  return -1;
}

export function isViewingResultsSubPanel(messages: FormChatResultsMessage[]): boolean {
  const lastResultsIdx = lastResultsMessageIndex(messages);
  if (lastResultsIdx < 0) return false;

  for (let i = messages.length - 1; i > lastResultsIdx; i--) {
    const m = messages[i];
    if (m.kind === "results") return false;
    if (m.kind === "assistant" && m.text?.trim() === BACK_TO_RESULTS_LIST_TEXT) return false;
  }

  for (let i = lastResultsIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.kind === "program-detail" || m.kind === "exclusions") return true;
    if (m.kind === "user") {
      const t = m.text.trim().toLowerCase();
      if (t.startsWith("know more:") || t === "understand exclusions") return true;
    }
  }
  return false;
}

export function programDetailAfterResults(
  messages: FormChatResultsMessage[],
): EligibleProgram | null {
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
    const m = messages[i];
    if (m.kind === "program-detail") return m.program;
  }
  return null;
}

export function isResultsNavigationCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (/^exit$/i.test(t)) return true;
  if (t === "back to programs summary" || t === "back to program summary") return true;
  return isScenarioNotesSkipMessage(text);
}

/** From LoanPASS pricing view → product picker (when opened via Check pricing). */
export function isBackToLoanpassProductsCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "back to product" || t === "back to products";
}

export function lastMessageIdOfKind(
  messages: FormChatResultsMessage[],
  kind: FormChatResultsMessage["kind"],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === kind) return messages[i].id;
  }
  return null;
}
