import { useMemo } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildPreferredProductSet,
  formatMortgageAcronyms,
  parseProductsList,
  shouldStyleProductMismatch,
  type ProductDisplayPrefs,
} from "@/lib/nqmIntegratedForm";

export type ProgramNotesSource = {
  special_overlay?: string | null;
  rag_notes?: string[] | null;
  summary_notes?: string | null;
  summary_bullets?: string[] | null;
};

export const MAX_ADDITIONAL_CONSIDERATIONS_DISPLAY = 8;
export const MIN_ADDITIONAL_CONSIDERATIONS_TARGET = 5;

/** Body copy: PROGRAM_DETAIL card + program-scoped chat (13.5px on md+ matches chat bubble). */
export const PROGRAM_CHAT_BODY_CLASS =
  "text-[12.5px] leading-snug md:text-[13.5px] md:leading-relaxed";

export const PROGRAM_CHAT_SECTION_LABEL_CLASS =
  "mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:mb-2 md:text-[11px]";

export const PROGRAM_CHAT_TITLE_CLASS = "text-[13.5px] font-semibold text-foreground";

/** Guideline categories already on the program card / scenario — omit from summarize. */
const SUMMARIZE_EXCLUDED_NOTE_CATEGORIES = new Set([
  "credit score",
  "product type",
  "documentation",
  "doc type",
  "max dti",
  "loan amounts",
  "loan purpose",
  "occupancy",
  "property type",
  "tradelines",
]);

function noteCategoryPrefix(note: string): string {
  const i = note.indexOf(":");
  return i >= 0 ? note.slice(0, i).trim().toLowerCase() : "";
}

/** Drop table-duplicative guideline rows before POST /api/summarize-notes. */
export function filterNotesForSummarize(notes: string[]): string[] {
  return notes
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && !SUMMARIZE_EXCLUDED_NOTE_CATEGORIES.has(noteCategoryPrefix(n)));
}

export const KNOW_MORE_FOLLOWUP_TEXT =
  'Ask follow-up questions in the chat below or type "Exit" or "Back to Programs Summary" to return to the program summary.';

/** Shown after the user clicks Check pricing on a program Know More card (or types a pricing question in chat). */
export const PRICING_COMING_SOON_TEXT =
  "Live program pricing isn't available in the assistant yet—we're building that next. " +
  "For now, use the suggested questions or type your own to explore documentation, " +
  "geo restrictions, and credit-event guidelines for this program.";

/** Plain-text copy for clipboard / message actions. */
export function loanpassPricingUnavailableCopyText(programLabel: string): string {
  const label = programLabel.trim() || "this program";
  return (
    `Live pricing isn't available for ${label} yet. ` +
    "Try one of the suggested questions below, or type your own about documentation, " +
    "geo restrictions, or credit guidelines for this program."
  );
}

/** dim_programs.program_name_loanpass is null — LoanPASS mapping not configured. */
export function LoanpassPricingUnavailableNotice({
  programLabel,
  onBackToProgramSummary,
  className,
  ...rest
}: {
  programLabel: string;
  onBackToProgramSummary?: () => void;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const label = programLabel.trim() || "this program";
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200/90 bg-slate-50 px-3 py-2.5 dark:border-slate-700/60 dark:bg-slate-900/40",
        className,
      )}
      {...rest}
    >
      <p className="text-[13px] leading-relaxed text-foreground">
        Live pricing isn&apos;t available for{" "}
        <strong className="font-semibold text-[#012a5b] dark:text-sky-300">{label}</strong> yet.
      </p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
        Try one of the suggested questions below, or type your own about documentation, geo
        restrictions, or credit guidelines for this program.
      </p>
      {onBackToProgramSummary ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={onBackToProgramSummary}
            className="gap-1.5 text-[13px]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back to Program Summary
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PricingComingSoonNotice({
  className,
  ...rest
}: { className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-amber-200/90 bg-amber-50 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30",
        className,
      )}
      {...rest}
    >
      <p className="text-[13px] leading-relaxed text-amber-950 dark:text-amber-100">
        {PRICING_COMING_SOON_TEXT}
      </p>
    </div>
  );
}

/** Know More card footer — action chips sit above this line. */
export function KnowMoreFollowupHint({ className }: { className?: string }) {
  return (
    <p className={cn("text-[12.5px] leading-snug text-muted-foreground", className)}>
      Ask follow-up questions in the chat below, or type{" "}
      <strong className="text-foreground">Exit</strong> or{" "}
      <strong className="text-foreground">Back to Programs Summary</strong> to return to the program
      summary.
    </p>
  );
}

/** Know More / program-scoped results chat composer placeholder. */
export function knowMoreComposerPlaceholder(programTitle?: string): string {
  const name = programTitle?.trim();
  // No program in focus → general results placeholder (the "this program" / Skip-or-Exit
  // framing only makes sense once a specific program is selected).
  if (!name) return "Ask anything about these results…";
  return `Ask about ${name}, or type Exit or Back to Programs Summary to return to the program summary…`;
}

/** Render `• Topic: detail` with bullet + bold topic label (Know More + program chat). */
export function ConsiderationBulletLine({ line }: { line: string }) {
  const text = line.replace(/^[-•*]\s*/, "").trim();
  const colon = text.indexOf(":");
  if (colon <= 0) {
    return (
      <span className="block">
        <span className="text-foreground/55">• </span>
        {text}
      </span>
    );
  }
  const topic = text.slice(0, colon).trim();
  const body = text.slice(colon + 1).trim();
  return (
    <span className="block">
      <span className="text-foreground/55">• </span>
      <span className="font-semibold text-foreground">{topic}:</span>
      {body ? ` ${body}` : null}
    </span>
  );
}

type ChatAnswerChunk = { type: "para" | "bullets"; lines: string[] };

function parseChatAnswerChunks(text: string): ChatAnswerChunk[] {
  const chunks: ChatAnswerChunk[] = [];
  let current: ChatAnswerChunk | null = null;

  for (const line of text.split("\n")) {
    const ln = line.trim();
    if (!ln) {
      if (current?.lines.length) {
        chunks.push(current);
        current = null;
      }
      continue;
    }
    const isBullet = /^[-•*]\s+/.test(ln);
    const nextType = isBullet ? "bullets" : "para";
    if (current?.type !== nextType) {
      if (current?.lines.length) chunks.push(current);
      current = { type: nextType, lines: [] };
    }
    current!.lines.push(ln);
  }
  if (current?.lines.length) chunks.push(current);
  return chunks;
}

/** Program-scoped Know More chat: intro paragraph(s) + bullet list. */
export function renderChatAnswer(text: string): ReactNode {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const chunks = parseChatAnswerChunks(trimmed);
  if (chunks.length === 0) {
    return <p className="leading-snug text-foreground">{trimmed}</p>;
  }

  return (
    <div className="space-y-2.5 leading-snug text-foreground">
      {chunks.map((chunk, ci) =>
        chunk.type === "bullets" ? (
          <ul key={ci} className="list-none space-y-1.5 pl-0">
            {chunk.lines.map((line, li) => (
              <li key={li}>
                <ConsiderationBulletLine line={line} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={ci}>{chunk.lines.join(" ")}</p>
        ),
      )}
    </div>
  );
}

export const GOOD_NEWS_RESULTS_MSG =
  "Good news — we found programs that match the initial criteria for your profile!\n\nDownload your results or use the options above the table to view program details and ask questions.";

export const RESULTS_GENERAL_CHAT_HINT =
  "Explore general eligibility, loan structure, and financing options below — or ask us anything else about your scenario.";

export function limitConsiderationBullets(
  bullets: string[],
  max = MAX_ADDITIONAL_CONSIDERATIONS_DISPLAY,
): string[] {
  return bullets.slice(0, max);
}

export type ProgramDocsSource = {
  doc_types_allowed?: string | null;
  doc_type?: string | null;
};

/** Split prose into display bullets (sentences or markdown list lines). */
export function splitTextToBullets(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;
  const sentences = trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  return sentences.length > 1 ? sentences : [trimmed];
}

/** True while summarize-notes is in flight (avoid flashing raw overlay/RAG bullets). */
export function programConsiderationsPending(prog: ProgramNotesSource): boolean {
  const hasSource =
    !!(prog.special_overlay || "").trim() || !!(prog.rag_notes || []).some((n) => (n || "").trim());
  return hasSource && !(prog.summary_bullets || []).length && !(prog.summary_notes || "").trim();
}

/** Bullet list for Additional Considerations (summary bullets preferred). */
export function getProgramConsiderationBullets(prog: ProgramNotesSource): string[] {
  if (prog.summary_bullets?.length) {
    return prog.summary_bullets.map((b) => b.trim()).filter(Boolean);
  }
  if (prog.summary_notes?.trim()) {
    return splitTextToBullets(prog.summary_notes);
  }
  return [
    ...(prog.special_overlay ? [prog.special_overlay.trim()] : []),
    ...(prog.rag_notes ?? []).map((n) => n.trim()).filter(Boolean),
  ];
}

/** Strip "Lender — Program" when the lender name is duplicated in the program title. */
function stripDuplicatedLenderPrefix(name: string, investor?: string): string {
  const parts = name.split(/\s*[—–-]\s*/);
  if (parts.length < 2) return name;
  const first = parts[0].trim().toLowerCase();
  const rest = parts.slice(1).join(" - ").trim();
  if (!rest) return name;
  if (investor) {
    const inv = investor.toLowerCase();
    if (first === inv || inv.startsWith(first) || first.startsWith(inv)) return rest;
  }
  if (rest.toLowerCase().startsWith(first)) return rest;
  if (rest.split(/\s+/)[0]?.toLowerCase() === first) return rest;
  return name;
}

/** Program name only — strips a leading investor/lender prefix when duplicated in `program_name`. */
export function programTitleOnly(prog: {
  program_name?: string | null;
  investor?: string | null;
  investor_name?: string | null;
}): string {
  let name = formatMortgageAcronyms(prog.program_name || "").trim();
  const investor = formatMortgageAcronyms(prog.investor_name || prog.investor || "").trim();
  if (!name) return investor || "Program";
  name = stripDuplicatedLenderPrefix(name, investor || undefined);
  if (!investor) return name;
  const parts = name.split(/\s*[—–-]\s*/);
  if (parts.length >= 2 && parts[0].trim().toLowerCase() === investor.toLowerCase()) {
    return parts.slice(1).join(" - ").trim();
  }
  const lower = name.toLowerCase();
  const invLower = investor.toLowerCase();
  if (lower.startsWith(invLower)) {
    const rest = name
      .slice(investor.length)
      .replace(/^\s*[—–-]\s*/, "")
      .trim();
    if (rest) return rest;
  }
  return stripDuplicatedLenderPrefix(name, investor);
}

/** Table/API label: program_name_np as stored (no lender-prefix stripping). */
export function programDisplayName(prog: {
  program_name_np?: string | null;
  program_name?: string | null;
}): string {
  const raw = (prog.program_name_np || prog.program_name || "").trim();
  return raw ? formatMortgageAcronyms(raw) : "Program";
}

type ProgramGateMetrics = {
  min_fico?: number | null;
  max_loan?: number | null;
  best_match?: { min_fico?: number | null; max_loan?: number | null } | null;
};

/** Effective min FICO for list cards (tier row when present). */
export function programGateMinFico(prog: ProgramGateMetrics): number | null {
  const v = prog.min_fico ?? prog.best_match?.min_fico;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

/** Effective max loan for list cards (tier row when present). */
export function programGateMaxLoan(prog: ProgramGateMetrics): number | null {
  const v = prog.max_loan ?? prog.best_match?.max_loan;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

function formatGateMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/** Second-line copy for eligible-program list rows: Min FICO · Max Loan. */
export function programGateMetricsLine(prog: ProgramGateMetrics): string {
  const parts: string[] = [];
  const fico = programGateMinFico(prog);
  const loan = programGateMaxLoan(prog);
  if (fico != null) parts.push(`Min FICO ${fico}`);
  if (loan != null) parts.push(`Max Loan ${formatGateMoney(loan)}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Stable row/selection id (program_id when present; else composite). */
export function programSelectKey(prog: {
  program_id?: number | null;
  investor?: string | null;
  investor_name?: string | null;
  program_name?: string | null;
  program_name_np?: string | null;
  max_loan?: number | null;
  min_fico?: number | null;
  doc_type?: string | null;
}): string {
  const pid = prog.program_id;
  if (pid != null && Number.isFinite(Number(pid))) {
    return `pid:${pid}`;
  }
  const investor = (prog.investor_name || prog.investor || "").trim();
  const name = (prog.program_name_np || prog.program_name || "").trim();
  const loan = prog.max_loan != null ? String(prog.max_loan) : "";
  const fico = prog.min_fico != null ? String(prog.min_fico) : "";
  const doc = (prog.doc_type || "").trim();
  return [investor, name, loan, fico, doc].filter(Boolean).join("|") || name || "program";
}

export function findProgramBySelectKey<T extends Parameters<typeof programSelectKey>[0]>(
  programs: T[],
  key: string,
): T | undefined {
  if (!key.trim()) return undefined;
  const byKey = programs.find((p) => programSelectKey(p) === key);
  if (byKey) return byKey;
  return programs.find((p) => programDisplayName(p) === key || programTitleOnly(p) === key);
}

/** Resolve a program row from eligibility results (handles stale keys / missing program_id). */
export function findFreshEligibleProgram<
  T extends Parameters<typeof programSelectKey>[0] & { program_id?: number | null },
>(embedded: T, programs: T[]): T | undefined {
  if (!programs.length) return undefined;

  const bySelectKey = findProgramBySelectKey(programs, programSelectKey(embedded));
  if (bySelectKey) return bySelectKey;

  const pid = embedded.program_id;
  if (pid != null && Number.isFinite(Number(pid))) {
    const byPid = programs.find((p) => p.program_id === pid);
    if (byPid) return byPid;
  }

  const displayName = programDisplayName(embedded);
  if (displayName) {
    const byName = programs.filter((p) => programDisplayName(p) === displayName);
    if (byName.length === 1) return byName[0];
  }

  const title = programTitleOnly(embedded);
  if (title) {
    const byTitle = programs.filter((p) => programTitleOnly(p) === title);
    if (byTitle.length === 1) return byTitle[0];
  }

  return undefined;
}

/** Old snapshots duplicated matrix tier values into program-limit fields. */
export function programMetricsLookStale(prog: {
  min_fico?: number | null;
  max_loan?: number | null;
  best_match?: {
    min_fico?: number | null;
    max_loan?: number | null;
    max_dti?: number | null;
  } | null;
}): boolean {
  const bm = prog.best_match;
  if (!bm) return false;
  const sameFico = prog.min_fico != null && bm.min_fico != null && prog.min_fico === bm.min_fico;
  const sameLoan = prog.max_loan != null && bm.max_loan != null && prog.max_loan === bm.max_loan;
  return sameFico && sameLoan;
}

/** Merge live eligibility row over stale PROGRAM_DETAIL snapshot (keep LLM summary fields). */
export function mergeFreshProgramDetail<
  T extends Parameters<typeof findFreshEligibleProgram>[0] & {
    summary_notes?: string | null;
    summary_bullets?: string[] | null;
  },
>(embedded: T, programs: T[]): T {
  const fresh = findFreshEligibleProgram(embedded, programs);
  if (!fresh) return embedded;
  return {
    ...fresh,
    summary_notes: embedded.summary_notes ?? fresh.summary_notes,
    summary_bullets: embedded.summary_bullets ?? fresh.summary_bullets,
  };
}

/** Know More card: never trust embedded metrics — always resolve from eligibility pool. */
export function resolveKnowMoreProgram<T extends Parameters<typeof mergeFreshProgramDetail>[0]>(
  embedded: T,
  programs: T[],
): T {
  return mergeFreshProgramDetail(embedded, programs);
}

/** Human-readable supported documentation (never "Same as program"). */
export function getProgramDocsDisplay(prog: ProgramDocsSource): string {
  const allowed = (prog.doc_types_allowed || "").trim();
  if (allowed && allowed !== "—") return allowed;
  const dt = (prog.doc_type || "").trim();
  if (dt && !/^same\s+as\s+program$/i.test(dt)) {
    return dt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return allowed || "Contact your representative for documentation options.";
}

export function AdditionalConsiderationsBullets({
  bullets,
  className = "text-[12.5px] leading-snug text-muted-foreground",
  maxItems = MAX_ADDITIONAL_CONSIDERATIONS_DISPLAY,
}: {
  bullets: string[];
  className?: string;
  maxItems?: number;
}) {
  const display = limitConsiderationBullets(bullets, maxItems);
  if (display.length === 0) return null;
  return (
    <ul className={`list-none space-y-1.5 pl-0 ${className}`}>
      {display.map((note, ni) => (
        <li key={ni} className="flex gap-1.5">
          <span className="mt-0.5 shrink-0 text-foreground/55">•</span>
          <span>{note}</span>
        </li>
      ))}
    </ul>
  );
}

export function formatDocChatIntro(
  program: {
    program_name?: string | null;
    investor?: string | null;
    investor_name?: string | null;
  },
  docs: string,
): ReactNode {
  const title = programDisplayName(program);
  return (
    <>
      <p className="font-medium text-foreground">Supported documentation for {title}</p>
      <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">{docs}</p>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        Ask any follow-up about these documentation types. Type{" "}
        <strong className="text-foreground">Exit</strong> or{" "}
        <strong className="text-foreground">Back to Programs Summary</strong> to return to the
        program summary.
      </p>
    </>
  );
}

export const PRODUCT_INVALID_CLASS = "text-red-400/70 line-through decoration-red-400/50";
export const PRODUCT_VALID_CLASS = "font-medium text-emerald-600";

/** Inline list separator (property types, products, docs, etc.). */
export const UI_LIST_SEPARATOR = " · ";

export function joinUiList(items: string[]): string {
  return items
    .map((s) => s.trim())
    .filter(Boolean)
    .join(UI_LIST_SEPARATOR);
}

/** Inline comma-separated product list for eligibility UI. */
export function ProductsAvailableInline({
  products,
  productsAvailable,
  productsMatching,
  prefs,
  className,
  /** Results table: matching products only, plain foreground text. */
  eligibleOnly = false,
  emptyLabel,
}: {
  products?: string[] | null;
  productsAvailable?: string | null;
  productsMatching?: string[] | null;
  prefs?: ProductDisplayPrefs;
  className?: string;
  eligibleOnly?: boolean;
  emptyLabel?: string;
}) {
  const allItems = useMemo(
    () => parseProductsList(products, productsAvailable).map((n) => formatMortgageAcronyms(n)),
    [products, productsAvailable],
  );
  const preferredSet = useMemo(
    () => buildPreferredProductSet(products, productsAvailable, productsMatching, prefs),
    [products, productsAvailable, productsMatching, prefs],
  );
  const highlightMismatch = useMemo(
    () => shouldStyleProductMismatch(productsMatching, prefs),
    [productsMatching, prefs],
  );

  const displayItems = useMemo(() => {
    if (highlightMismatch || eligibleOnly) {
      return allItems.filter((name) => preferredSet.has(name));
    }
    return allItems;
  }, [eligibleOnly, allItems, highlightMismatch, preferredSet]);

  if (displayItems.length === 0) {
    return emptyLabel ? <span className={className}>{emptyLabel}</span> : null;
  }

  return (
    <span className={className}>
      {displayItems.map((name, i) => {
        const isPreferred = preferredSet.has(name);
        return (
          <span key={`${name}-${i}`}>
            {i > 0 ? <span className="text-muted-foreground">{UI_LIST_SEPARATOR}</span> : null}
            <span
              className={cn(
                highlightMismatch && isPreferred ? PRODUCT_VALID_CLASS : "text-foreground",
              )}
            >
              {name}
            </span>
          </span>
        );
      })}
    </span>
  );
}
