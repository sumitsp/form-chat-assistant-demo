/**
 * In-chat post-submit results UI — program cards, headline banner, action pills.
 * Used by FormChatFlow (shared by /form and /chat after eligibility).
 */
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Download, HelpCircle, RotateCcw, Save } from "lucide-react";

import type { EligibleProgram } from "@/components/wizard/loanWizardEligibility";
import { ResultsPagination } from "@/components/wizard/results/ResultsPagination";
import { programDisplayName } from "@/lib/programDisplayHelpers";
import { formatLeveragePercentDisplay } from "@/lib/nqmIntegratedForm";
import { cn } from "@/lib/utils";

const RESET_PILL_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-[13px] font-medium text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 dark:bg-card dark:hover:bg-red-950/30";

const STREAM_CHARS_PER_TICK = 2;
const STREAM_TICK_MS = 12;
export const FORM_CHAT_RESULTS_PAGE_SIZE = 5;

const money = (v: string | number) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : String(v);
};

function useStreamedLength(text: string, onDone?: () => void) {
  const [shown, setShown] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!text.length) {
      doneRef.current?.();
      return;
    }
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

function StreamingHeadlineText({
  text,
  onStreamDone,
}: {
  text: string;
  onStreamDone?: () => void;
}) {
  const shown = useStreamedLength(text, onStreamDone);
  return <>{text.slice(0, shown)}</>;
}

export function abbreviateProduct(name: string): string {
  return name
    .replace(/Interest[- ]Only/gi, "IO")
    .replace(/\s*SOFR\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function programProductsLabel(p: EligibleProgram): string {
  const list = p.products_matching?.length ? p.products_matching : (p.products ?? []);
  if (list.length) return list.map(abbreviateProduct).join(" · ");
  return abbreviateProduct((p.products_available ?? "").trim());
}

/** Raw product names (un-abbreviated) for the results product chips. */
export function programProductList(p: EligibleProgram): string[] {
  const list = p.products_matching?.length ? p.products_matching : (p.products ?? []);
  if (list.length) return list.map((s) => s.trim()).filter(Boolean);
  return (p.products_available ?? "")
    .split(/[·,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Plain-text summary of a program detail, for the Copy button. */
export function programDetailText(p: EligibleProgram): string {
  const lines: string[] = [programDisplayName(p)];
  const add = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label}: ${value}`);
  };
  if (p.min_fico != null) add("Min FICO", String(p.min_fico));
  if (p.min_loan != null) add("Min Loan", money(p.min_loan));
  if (p.max_loan != null) add("Max Loan", money(p.max_loan));
  if (p.max_ltv_purchase != null)
    add("Max LTV (Purchase)", formatLeveragePercentDisplay(p.max_ltv_purchase) ?? "");
  if (p.max_dti != null) add("Max DTI", `${p.max_dti}%`);
  if (p.min_dscr != null) add("Min DSCR", String(p.min_dscr));
  const products = programProductsLabel(p);
  if (products) add("Products", products);
  if (p.summary_bullets?.length) {
    lines.push("Considerations:");
    for (const b of p.summary_bullets) lines.push(`• ${b}`);
  }
  return lines.join("\n");
}

function StatPill({
  label,
  value,
  tone = "grey",
  wide = false,
}: {
  label: string;
  value: string;
  /** "blue" highlights key gates (Max Loan, FICO, Products). */
  tone?: "grey" | "blue";
  /** Full-width block — wraps long values (e.g. product list). */
  wide?: boolean;
}) {
  if (tone === "blue") {
    const shell = "rounded-md bg-[#012a5b]/10 text-[11px] dark:bg-sky-500/15";
    const labelCls = "text-[#012a5b]/70 dark:text-sky-300/80";
    const valueCls = "font-semibold text-[#012a5b] dark:text-sky-200";
    if (wide) {
      return (
        <div
          className={cn(
            "flex w-full min-w-0 flex-col gap-0.5 px-2.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-2",
            shell,
          )}
          title={value}
        >
          <span className={cn("shrink-0", labelCls)}>{label}</span>
          <span className={cn("min-w-0 break-words sm:flex-1", valueCls)}>{value}</span>
        </div>
      );
    }
    return (
      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5", shell)}>
        <span className={labelCls}>{label}</span>
        <span className={valueCls}>{value}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] dark:bg-muted/30">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

/** Plain product chip (display only). */
function ProductChip({ label }: { label: string }) {
  return (
    <span className="max-w-full rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground dark:bg-muted/30">
      <span className="block truncate">{abbreviateProduct(label)}</span>
    </span>
  );
}

export function resultsHeadlineVariant(text: string | undefined): "good" | "bad" | null {
  const t = (text ?? "").trim();
  if (t.startsWith("Good News")) return "good";
  if (t.startsWith("Hard Luck")) return "bad";
  return null;
}

export function ResultsHeadlineBanner({
  variant,
  text,
  onStreamDone,
}: {
  variant: "good" | "bad";
  text: string;
  onStreamDone?: () => void;
}) {
  const isGood = variant === "good";
  return (
    <div
      className={cn(
        "min-w-0 w-full rounded-2xl border px-3 py-3 shadow-md sm:px-4 sm:py-3.5",
        isGood
          ? "border-emerald-300/90 bg-gradient-to-br from-emerald-50 via-white to-teal-50 ring-1 ring-emerald-200/70 dark:border-emerald-800/60 dark:from-emerald-950/50 dark:via-card dark:to-teal-950/40 dark:ring-emerald-900/50"
          : "border-amber-300/90 bg-gradient-to-br from-amber-50 via-white to-orange-50/90 ring-1 ring-amber-200/70 dark:border-amber-800/60 dark:from-amber-950/45 dark:via-card dark:to-orange-950/35",
      )}
    >
      <p
        className={cn(
          "text-[14px] font-semibold leading-snug break-words sm:text-[15px]",
          isGood ? "text-emerald-900 dark:text-emerald-50" : "text-amber-950 dark:text-amber-50",
        )}
      >
        <StreamingHeadlineText text={text} onStreamDone={onStreamDone} />
      </p>
    </div>
  );
}

export function ResultsCard({
  programs,
  onKnowMore,
  knowMoreDisabled = false,
}: {
  programs: EligibleProgram[];
  onKnowMore?: (program: EligibleProgram) => void;
  /** Lock row actions while program detail / exclusions is open. */
  knowMoreDisabled?: boolean;
}) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [programs]);

  const pagePrograms = programs.slice(
    page * FORM_CHAT_RESULTS_PAGE_SIZE,
    (page + 1) * FORM_CHAT_RESULTS_PAGE_SIZE,
  );

  return (
    <div className="mt-3 min-w-0 w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <span className="shrink-0 text-[14px] font-semibold text-foreground sm:text-[15px]">
          Program Summary
        </span>
        <div className="flex min-w-0 shrink items-center justify-end gap-1.5 sm:gap-2">
          <span className="shrink-0 rounded-full bg-[#012a5b]/10 px-2 py-0.5 text-[11px] font-medium text-[#012a5b] dark:bg-sky-500/15 dark:text-sky-200 sm:px-2.5 sm:py-1 sm:text-[12px]">
            {programs.length} matched
          </span>
        </div>
      </div>
      {programs.length === 0 ? (
        <p className="py-2 text-[13px] text-muted-foreground">
          No programs matched this scenario — adjust an input and resubmit, or review the exclusions
          below.
        </p>
      ) : (
        <>
          <div className="space-y-3" data-results-programs="true">
            {pagePrograms.map((p, i) => {
              const productList = programProductList(p);
              const name = programDisplayName(p);
              const openKnowMore = () => {
                if (!knowMoreDisabled) onKnowMore?.(p);
              };
              const rowInteractive = !knowMoreDisabled;
              return (
                <div
                  key={`${name}-${page}-${i}`}
                  data-results-program-row
                  role="button"
                  tabIndex={rowInteractive ? 0 : -1}
                  aria-disabled={!rowInteractive}
                  aria-label={`Know more about ${name}`}
                  title={
                    knowMoreDisabled
                      ? 'Exit program details (type "Exit" or Back to Programs Summary) first.'
                      : undefined
                  }
                  onClick={openKnowMore}
                  onKeyDown={(e) => {
                    if (!rowInteractive) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      openKnowMore();
                    }
                  }}
                  className={cn(
                    "min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm transition-[border-color,box-shadow,background-color] sm:p-4",
                    rowInteractive
                      ? "cursor-pointer hover:border-[#012a5b]/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#012a5b]/40"
                      : "cursor-default opacity-90",
                  )}
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 text-[15px] font-semibold leading-snug break-words text-foreground">
                          {name}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.max_loan != null && (
                          <StatPill label="Max Loan" value={money(p.max_loan)} />
                        )}
                        {p.min_fico != null && (
                          <StatPill label="Min FICO" value={String(p.min_fico)} />
                        )}
                      </div>
                      {productList.length > 0 ? (
                        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Products
                          </span>
                          {productList.map((label) => (
                            <ProductChip key={label} label={label} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "inline-flex w-full shrink-0 items-center justify-center gap-1 rounded-lg bg-[#012a5b] px-4 py-2 text-[13px] font-medium text-white sm:w-auto",
                        knowMoreDisabled && "opacity-50",
                      )}
                      aria-hidden="true"
                    >
                      Know More <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3">
            <ResultsPagination
              totalCount={programs.length}
              currentPage={page}
              onPageChange={setPage}
              pageSize={FORM_CHAT_RESULTS_PAGE_SIZE}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function SuggestionPills({
  onDownloadPdf,
  onSaveScenario,
  saveLabel = "Save Scenario",
  canSaveToVault = true,
  onShowExclusions,
  onBackToVault,
  onClearRestart,
  disabled = false,
  stale = false,
}: {
  onDownloadPdf?: () => void;
  onSaveScenario?: () => void;
  saveLabel?: string;
  canSaveToVault?: boolean;
  onShowExclusions?: () => void;
  onBackToVault?: () => void;
  onClearRestart?: () => void;
  /** True while program detail / exclusions is open — exit first. */
  disabled?: boolean;
  /** Earlier results row — not clickable after returning to the latest list. */
  stale?: boolean;
}) {
  const pillClass =
    "flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-center text-[13px] text-foreground transition-colors hover:border-[#012a5b]/40 hover:bg-muted/40 sm:w-auto sm:flex-1 sm:whitespace-nowrap";
  const disabledClass = "cursor-not-allowed opacity-50 hover:border-border hover:bg-card";
  const lockHint = stale
    ? "These options were for a previous results view — use the set below your latest results."
    : 'Exit program details (type "Exit" or Back to Programs Summary) to use these options.';
  const saveDisabled = disabled || !canSaveToVault;
  return (
    <div className="mt-2 min-w-0 w-full max-w-full overflow-hidden">
      <p className="mb-2 break-words text-[13px] text-muted-foreground">
        Click "Know More" to view program details and available terms, choose one of the options
        below or type something of your own.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {onDownloadPdf && (
          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={disabled}
            title={disabled ? lockHint : undefined}
            className={cn(pillClass, disabled && disabledClass)}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download the Scenario PDF
          </button>
        )}
        {onSaveScenario && (
          <button
            type="button"
            onClick={onSaveScenario}
            disabled={saveDisabled}
            title={
              disabled
                ? lockHint
                : canSaveToVault
                  ? "Store this scenario in your vault"
                  : "Edit your scenario to store again"
            }
            className={cn(pillClass, saveDisabled && disabledClass)}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {saveLabel}
          </button>
        )}
        {onShowExclusions && (
          <button
            type="button"
            onClick={onShowExclusions}
            disabled={disabled}
            title={disabled ? lockHint : undefined}
            className={cn(pillClass, disabled && disabledClass)}
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
            Understand Exclusions
          </button>
        )}
        {onBackToVault ? (
          <button
            type="button"
            onClick={onBackToVault}
            disabled={disabled}
            title={disabled ? lockHint : "Return to Scenario Vault"}
            className={cn(pillClass, disabled && disabledClass)}
          >
            <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            Back to Scenario Vault
          </button>
        ) : onClearRestart ? (
          <button
            type="button"
            onClick={onClearRestart}
            disabled={disabled}
            title={disabled ? lockHint : undefined}
            className={cn(RESET_PILL_BTN, "flex-1 rounded-lg", disabled && disabledClass)}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}
