/**
 * In-chat post-submit results UI — program cards, headline banner, action pills.
 * Used by FormChatFlow (shared by /form and /chat after eligibility).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Download,
  HelpCircle,
  Menu,
  RotateCcw,
  Save,
  X,
} from "lucide-react";

import type { EligibleProgram } from "@/components/wizard/loanWizardEligibility";
import { ResultsPagination } from "@/components/wizard/results/ResultsPagination";
import {
  downloadLoanpassPricingCardPdf,
  LoanpassPricingCard,
  loanpassPricingCanDownload,
} from "@/components/wizard/LoanpassPricingCard";
import { Button } from "@/components/ui/button";
import {
  downloadComparisonPdf,
  formatLoanpassRate,
  formatLoanpassRatePoints,
  loanpassSimplifiedCreditDisplay,
  type LoanpassDbProduct,
  type LoanpassPricingPayload,
} from "@/lib/loanpass/pricingTable";
import { resolveLoanpassProductByLabel } from "@/lib/loanpass/programProducts";
import { programDisplayName } from "@/lib/programDisplayHelpers";
import { formatLeveragePercentDisplay } from "@/lib/nqmIntegratedForm";
import { FORM_CHAT_H_PAD, FORM_CHAT_MAX_WIDTH } from "@/lib/formChatLayout";
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

/** Tenure (years) then product kind: Fixed → Fixed IO → ARM → ARM IO. */
function parseProductSortMeta(name: string): {
  tenure: number;
  category: number;
  armInitial: number;
} {
  const lower = name
    .toLowerCase()
    .replace(/interest[- ]only/g, " io ")
    .replace(/\s+/g, " ")
    .trim();
  const parenYears = lower.match(/\((\d+)\s*y\)/);
  const tenureFromParen = parenYears ? Number(parenYears[1]) : null;

  const armMatch = lower.match(/(\d+)\s*\/\s*(\d+)\s*(?:sofr\s*)?arm/);
  if (armMatch) {
    const armInitial = Number(armMatch[1]);
    const isIo = /\bio\b/.test(lower);
    return {
      tenure: tenureFromParen ?? 30,
      category: isIo ? 3 : 2,
      armInitial,
    };
  }

  const fixedMatch = lower.match(/(\d+)[\s-]*year\s+fixed/);
  if (fixedMatch) {
    const isIo = /\bio\b/.test(lower);
    return {
      tenure: Number(fixedMatch[1]),
      category: isIo ? 1 : 0,
      armInitial: 0,
    };
  }

  const anyYear = lower.match(/(\d+)[\s-]*year/);
  if (anyYear) {
    return { tenure: Number(anyYear[1]), category: 0, armInitial: 0 };
  }

  return { tenure: 9999, category: 99, armInitial: 0 };
}

export function compareProductNames(a: string, b: string): number {
  const ka = parseProductSortMeta(a);
  const kb = parseProductSortMeta(b);
  if (ka.tenure !== kb.tenure) return ka.tenure - kb.tenure;
  if (ka.category !== kb.category) return ka.category - kb.category;
  if (ka.armInitial !== kb.armInitial) return ka.armInitial - kb.armInitial;
  return a.localeCompare(b);
}

export function programProductsLabel(p: EligibleProgram): string {
  const list = p.products_matching?.length ? p.products_matching : (p.products ?? []);
  if (list.length) return list.map(abbreviateProduct).join(" · ");
  return abbreviateProduct((p.products_available ?? "").trim());
}

/** Raw product names (un-abbreviated) for per-product hover pricing. */
export function programProductList(p: EligibleProgram): string[] {
  const list = p.products_matching?.length ? p.products_matching : (p.products ?? []);
  if (list.length) return list.map((s) => s.trim()).filter(Boolean);
  return (p.products_available ?? "")
    .split(/[·,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Compare table — lowest rate with optional buydown cost badge. */
function parseMinRateCost(cost: string | undefined): number | null {
  if (!cost || cost === "—") return null;
  const n = Number.parseFloat(cost);
  return Number.isFinite(n) ? n : null;
}

function parseCompareRateNum(rate: string | undefined): number | null {
  if (!rate) return null;
  const n = Number.parseFloat(String(rate).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function minRateEqualsPar(row: ProductParPrice): boolean {
  const parNum = parseCompareRateNum(row.rate);
  const minNum = parseCompareRateNum(row.minRate ?? row.rate);
  return parNum != null && minNum != null && Math.abs(parNum - minNum) < 0.0001;
}

function formatCompareMinRateCost(row: ProductParPrice): string {
  const rate = formatLoanpassRate(row.minRate ?? row.rate);
  const costNum = parseMinRateCost(row.minRateCost);
  if (minRateEqualsPar(row) || costNum === 0) return `${rate} (0.000)`;
  if (costNum == null) return rate;
  return `${rate} (${formatLoanpassRatePoints(String(-costNum))})`;
}

function CompareMinRateCell({
  row,
  compact,
  centered,
}: {
  row: ProductParPrice;
  compact?: boolean;
  /** Center stack for mobile comparison cards. */
  centered?: boolean;
}) {
  const rate = formatLoanpassRate(row.minRate ?? row.rate);
  const costNum = parseMinRateCost(row.minRateCost);
  const showZeroBadge = minRateEqualsPar(row) || costNum === 0;
  const showBuydownBadge = !showZeroBadge && costNum != null && costNum !== 0;
  const badgeClass = compact
    ? "inline-flex shrink-0 rounded-full px-1 py-px text-[8px] font-semibold tabular-nums leading-none"
    : "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums";

  const badge = showZeroBadge ? (
    <span
      className={cn(
        badgeClass,
        "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
      )}
    >
      0.000
    </span>
  ) : showBuydownBadge ? (
    <span className={cn(badgeClass, "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300")}>
      {formatLoanpassRatePoints(String(-costNum))}
    </span>
  ) : null;

  return (
    <span
      className={cn(
        compact
          ? cn(
              "inline-flex min-w-0 max-w-full items-center gap-0.5 whitespace-nowrap",
              centered ? "justify-center" : "justify-start",
            )
          : "inline-flex items-center gap-2.5 whitespace-nowrap",
      )}
    >
      <span
        className={cn(
          "shrink-0 font-semibold tabular-nums text-foreground",
          compact && "text-[10px] leading-none",
        )}
      >
        {rate}
      </span>
      {badge}
    </span>
  );
}

const COMPARE_MOBILE_METRICS_GRID =
  "grid grid-cols-3 grid-rows-[auto_auto] gap-x-1.5 gap-y-1 border-t border-border/50 pt-2.5";
const COMPARE_MOBILE_METRIC_LABEL =
  "flex min-h-7 items-end justify-center px-0.5 text-center text-[9px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground";
const COMPARE_MOBILE_METRIC_VALUE =
  "flex h-5 w-full items-center justify-center overflow-hidden text-center text-[10px] font-semibold tabular-nums leading-none text-foreground";

export type ProductParPrice = {
  /** Par row (price 100): rate, cost (0), payment. */
  rate: string;
  rateCost: string;
  payment: string;
  /** Lowest available rate (most below-par) + its buydown cost (positive). */
  minRate?: string;
  minRateCost?: string;
};

export type ProductPriceFetcher = (
  program: EligibleProgram,
  productLabel: string,
  opts?: { force?: boolean },
) => Promise<ProductParPrice | null>;

/** Stable cache key for a program/product pair (shared by prefetch + hover lookup). */
export function productPriceKey(program: EligibleProgram, label: string): string {
  const pid = program.program_id ?? program.program_name ?? "";
  return `${pid}::${label}`;
}

/** Stable identity for a program row (selection across pages). */
function programRowKey(program: EligibleProgram): string {
  return `${program.program_id ?? ""}::${programDisplayName(program)}`;
}

type ProgramComparePricingState = "loading" | "available" | "unavailable";

/** DB catalog only — is this product mapped in map_program_products? */
export function isProductDbPriced(
  catalog: LoanpassDbProduct[] | undefined,
  productLabel: string,
): boolean {
  if (!catalog?.length) return false;
  return Boolean(resolveLoanpassProductByLabel(catalog, productLabel));
}

/** Instant availability from LoanPASS product catalog (MySQL). */
export function programDbPricingState(
  program: EligibleProgram,
  selectedProducts: Set<string>,
  catalog: LoanpassDbProduct[] | undefined,
): ProgramComparePricingState {
  if (program.program_id == null) return "unavailable";
  const relevant = programProductList(program).filter((label) => selectedProducts.has(label));
  if (relevant.length === 0) return "unavailable";
  if (catalog === undefined) return "loading";
  if (relevant.some((label) => isProductDbPriced(catalog, label))) return "available";
  return "unavailable";
}

/** Program-level badge: all products unmapped in DB (null = catalog still loading). */
export function programHasNoDbPricing(
  program: EligibleProgram,
  catalog: LoanpassDbProduct[] | undefined,
): boolean | null {
  const labels = programProductList(program);
  if (labels.length === 0) return false;
  if (catalog === undefined) return null;
  return labels.every((label) => !isProductDbPriced(catalog, label));
}

/** Whether a program has live pricing for at least one selected product (compare step). */
export function programComparePricingState(
  program: EligibleProgram,
  selectedProducts: Set<string>,
  catalog: LoanpassDbProduct[] | undefined,
): ProgramComparePricingState {
  return programDbPricingState(program, selectedProducts, catalog);
}

/** Compare table row: DB unmapped → unavailable immediately; else wait on par-price API. */
export function compareRowParPrice(
  program: EligibleProgram,
  product: string,
  catalog: LoanpassDbProduct[] | undefined,
  productPrices?: Record<string, ProductParPrice | null>,
): ProductParPrice | null | undefined {
  const key = productPriceKey(program, product);
  if (catalog !== undefined && !isProductDbPriced(catalog, product)) return null;
  if (!productPrices || !(key in productPrices)) return undefined;
  return productPrices[key] ?? null;
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

/**
 * Product chip with a hover popover showing par rate + est. payment (dark navy card).
 * Pricing is fetched lazily on first hover when not prefetched.
 */
export function ProductPriceChip({
  program,
  label,
  prices,
  onProductPrice,
  pricingUnavailable = false,
}: {
  program: EligibleProgram;
  label: string;
  /** Prefetched par-price cache: key present (even if null) means resolved. */
  prices?: Record<string, ProductParPrice | null>;
  onProductPrice?: ProductPriceFetcher;
  /** Program has no pricing — render an inert chip: no hover popover, no focus. */
  pricingUnavailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [row, setRow] = useState<ProductParPrice | null>(null);
  const fetchedRef = useRef(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  // Viewport coords for the popover — position:fixed escapes the chat column's
  // overflow clipping (overflow-x-hidden ancestors also clip vertically).
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const key = productPriceKey(program, label);
  const hasPrefetch = prices != null && key in prices;
  const canHover = !pricingUnavailable && (Boolean(onProductPrice) || hasPrefetch);

  const effectiveRow = hasPrefetch ? (prices?.[key] ?? null) : row;
  const effectiveStatus: "idle" | "loading" | "done" | "error" = hasPrefetch
    ? prices?.[key]
      ? "done"
      : "error"
    : status;

  const handleEnter = (e: React.MouseEvent | React.FocusEvent) => {
    e.stopPropagation();
    if (!canHover) return;
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
    if (hasPrefetch || !onProductPrice || fetchedRef.current) return;
    fetchedRef.current = true;
    setStatus("loading");
    onProductPrice(program, label)
      .then((r) => {
        setRow(r);
        setStatus(r ? "done" : "error");
      })
      .catch(() => setStatus("error"));
  };

  const handleLeave = (e: React.MouseEvent | React.FocusEvent) => {
    e.stopPropagation();
    setOpen(false);
  };

  const showUnavailable =
    effectiveStatus === "error" ||
    (!effectiveRow && effectiveStatus !== "loading" && effectiveStatus !== "idle");

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex max-w-full"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      <span
        tabIndex={canHover ? 0 : -1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-w-full rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground dark:bg-muted/30",
          canHover && "cursor-default hover:border-[#012a5b]/40 hover:bg-muted",
        )}
      >
        <span className="block truncate">{abbreviateProduct(label)}</span>
      </span>
      {open && canHover && pos ? (
        <span
          role="tooltip"
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-[120] w-max min-w-[11rem] rounded-lg bg-[#012a5b] px-3 py-2.5 text-left text-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-2 text-[12px] font-semibold leading-snug">{abbreviateProduct(label)}</p>
          {effectiveStatus === "loading" ? (
            <p className="text-[11px] text-white/70">Loading…</p>
          ) : showUnavailable ? (
            <p className="text-[11px] leading-snug text-white/85">Pricing not available</p>
          ) : (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-4 text-[11px]">
                <span className="text-white/65">Par rate</span>
                <span className="font-semibold tabular-nums">
                  {formatLoanpassRate(effectiveRow?.rate)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 text-[11px]">
                <span className="text-white/65">Estimated P&amp;I Payment</span>
                <span className="font-semibold tabular-nums">{effectiveRow?.payment ?? "—"}</span>
              </div>
            </div>
          )}
        </span>
      ) : null}
    </span>
  );
}

const COMPARE_DIALOG_SHELL =
  "fixed inset-0 z-[100] flex items-end justify-center overflow-hidden bg-black/50 backdrop-blur-sm sm:items-center sm:p-4";
const COMPARE_PANEL = cn(
  "flex max-h-[min(92dvh,100%)] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[85vh] sm:rounded-2xl",
  FORM_CHAT_MAX_WIDTH,
);
const COMPARE_KICKER =
  "text-[11px] font-semibold uppercase tracking-wide text-[#012a5b] dark:text-sky-300";
/** Shared horizontal padding + scroll body for every compare step. */
const COMPARE_MODAL_PAD = "px-4 sm:px-5";
const COMPARE_BODY = `min-w-0 flex-1 overflow-auto overscroll-contain ${COMPARE_MODAL_PAD} py-4`;
const COMPARE_FOOTER = `shrink-0 border-t border-border ${COMPARE_MODAL_PAD} py-3`;
const COMPARE_BTN_H = "h-11";
const COMPARE_BTN_TEXT = "text-[13px] font-medium";
const COMPARE_CLOSE_BTN =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

function CompareCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close comparison"
      className={COMPARE_CLOSE_BTN}
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function CompareModalHeader({
  title,
  hideKicker,
  onClose,
}: {
  title: string;
  hideKicker?: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-start justify-between gap-3 border-b border-border py-3",
        COMPARE_MODAL_PAD,
      )}
    >
      <div className="min-w-0 flex-1">
        {hideKicker ? null : <p className={COMPARE_KICKER}>Pricing Comparison</p>}
        <h2 className="text-[15px] font-semibold leading-snug text-foreground sm:text-[16px]">
          {title}
        </h2>
      </div>
      <CompareCloseButton onClick={onClose} />
    </div>
  );
}

/** Back / primary action row for the Compare wizard. */
function CompareNavFooter({
  onBack,
  onContinue,
  continueDisabled,
  continueLabel = "Continue",
  showContinueArrow = true,
  trailing,
}: {
  onBack?: () => void;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLabel?: string;
  showContinueArrow?: boolean;
  trailing?: React.ReactNode;
}) {
  // Mobile: trailing action stacks above a full-width Back/Continue grid.
  // Desktop (sm+): the original layout — Back auto-width left; trailing + Continue right.
  return (
    <div className={COMPARE_FOOTER}>
      <div
        className={cn(
          "grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3",
          onBack ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {onBack ? (
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className={cn(
              COMPARE_BTN_H,
              "w-full gap-1.5 sm:h-9 sm:w-auto sm:shrink-0",
              COMPARE_BTN_TEXT,
            )}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            Back
          </Button>
        ) : null}
        {trailing ? (
          <div className="-order-1 col-span-full sm:order-none sm:col-auto sm:ml-auto sm:flex sm:items-center sm:gap-2">
            {trailing}
          </div>
        ) : null}
        <Button
          type="button"
          disabled={continueDisabled}
          onClick={onContinue}
          className={cn(
            COMPARE_BTN_H,
            "w-full gap-1.5 bg-[#012a5b] hover:bg-[#01234d] sm:h-9 sm:w-auto sm:shrink-0",
            !trailing && "sm:ml-auto",
            COMPARE_BTN_TEXT,
          )}
        >
          {continueLabel}
          {showContinueArrow ? (
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : null}
        </Button>
      </div>
    </div>
  );
}

/** Multi-select grid — same lettered card pattern as Credit Event pickers in form chat. */
function CompareMultiSelectPanel({
  options,
  selected,
  onToggle,
}: {
  options: Array<{ key: string; label: string; disabled?: boolean; disabledReason?: string }>;
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (options.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No options available.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {options.map((opt, i) => {
        const active = selected.has(opt.key);
        const disabled = Boolean(opt.disabled);
        return (
          <button
            key={opt.key}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!disabled) onToggle(opt.key);
            }}
            aria-pressed={active}
            aria-disabled={disabled}
            className={cn(
              "flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-3 py-3 text-left transition-colors md:gap-3",
              disabled
                ? "cursor-not-allowed border-border/60 bg-muted/35 opacity-60 hover:border-border/60 hover:bg-muted/35"
                : active
                  ? "border-[#012a5b] bg-[#012a5b]/5"
                  : "border-border bg-card hover:border-[#012a5b]/50 hover:bg-[#012a5b]/[0.06]",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold md:h-6 md:w-6 md:text-[12px]",
                disabled ? "bg-muted text-muted-foreground" : "bg-[#012a5b]/10 text-[#012a5b]",
              )}
            >
              {String.fromCharCode(65 + i)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
              <span
                className={cn(
                  "min-w-0 text-[13px] font-medium",
                  disabled ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {opt.label}
              </span>
              {disabled && opt.disabledReason ? (
                <span className="shrink-0 text-[11px] text-muted-foreground sm:ml-auto">
                  {opt.disabledReason}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                disabled
                  ? "border-border/50 bg-muted/50"
                  : active
                    ? "border-[#012a5b] bg-[#012a5b] text-white"
                    : "border-border bg-card",
              )}
              aria-hidden="true"
            >
              {active && !disabled ? <Check className="h-3.5 w-3.5 stroke-[2.5]" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Mobile comparison row — 3-column metric grid (no horizontal table scroll). */
function CompareResultMobileCard({
  program,
  product,
  row,
  onOpenPricing,
}: {
  program: EligibleProgram;
  product: string;
  row: ProductParPrice | null | undefined;
  onOpenPricing?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2.5 min-w-0">
        <p className="text-[13px] font-semibold leading-snug text-foreground">
          {programDisplayName(program)}
        </p>
        <span className="mt-1.5 inline-block max-w-full rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground dark:bg-muted/30">
          {abbreviateProduct(product)}
        </span>
      </div>
      {row === undefined ? (
        <p className="text-[12px] text-muted-foreground">Loading…</p>
      ) : row === null ? (
        <span className="inline-flex rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          Pricing not available
        </span>
      ) : (
        <div className={COMPARE_MOBILE_METRICS_GRID}>
          <p className={COMPARE_MOBILE_METRIC_LABEL}>Par Rate</p>
          <p className={COMPARE_MOBILE_METRIC_LABEL}>Estimated P&amp;I Payment</p>
          <p className={COMPARE_MOBILE_METRIC_LABEL}>Min Rate</p>
          <div className={COMPARE_MOBILE_METRIC_VALUE}>
            <span className="truncate">{formatLoanpassRate(row.rate)}</span>
          </div>
          <div className={COMPARE_MOBILE_METRIC_VALUE}>
            <span className="truncate">{row.payment}</span>
          </div>
          <div className={COMPARE_MOBILE_METRIC_VALUE}>
            <CompareMinRateCell row={row} compact centered />
          </div>
        </div>
      )}
      {onOpenPricing && row ? (
        <button
          type="button"
          onClick={onOpenPricing}
          className={cn(
            "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-white",
            COMPARE_BTN_H,
            COMPARE_BTN_TEXT,
            "text-foreground transition-colors hover:bg-muted dark:bg-card",
          )}
        >
          Detailed Pricing
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Three-step Compare wizard:
 *  1. pick the programs to compare (those with live pricing),
 *  2. pick one or more product types offered across the selected programs,
 *  3. comparison table (Program · Product · Par Rate · Est. Payment · Min Rate).
 * Background is blurred/dimmed.
 */
function CompareWizard({
  programs,
  loanpassCatalogs,
  productPrices,
  onProductPrice,
  onLoadPricingPayload,
  onClose,
}: {
  programs: EligibleProgram[];
  /** Per-program LoanPASS DB product rows (`/api/loanpass/products`). */
  loanpassCatalogs?: Record<number, LoanpassDbProduct[] | undefined>;
  productPrices?: Record<string, ProductParPrice | null>;
  onProductPrice?: ProductPriceFetcher;
  /** Fetch the full pricing payload for a program+product (shown inline). */
  onLoadPricingPayload?: (
    program: EligibleProgram,
    productLabel: string,
  ) => Promise<LoanpassPricingPayload | null>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"programs" | "products" | "result">("programs");
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [selectedPrograms, setSelectedPrograms] = useState<Set<string>>(new Set());
  const [comparePage, setComparePage] = useState(0);
  // Inline pricing detail (shown over the comparison without leaving the modal).
  const [pricingView, setPricingView] = useState<{
    program: EligibleProgram;
    product: string;
  } | null>(null);
  const [pricingPayload, setPricingPayload] = useState<LoanpassPricingPayload | null>(null);
  const [pricingStatus, setPricingStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openPricing = (program: EligibleProgram, product: string) => {
    if (!onLoadPricingPayload) return;
    setPricingView({ program, product });
    setPricingPayload(null);
    setPricingStatus("loading");
    onLoadPricingPayload(program, product)
      .then((payload) => {
        setPricingPayload(payload);
        setPricingStatus(payload ? "done" : "error");
      })
      .catch(() => setPricingStatus("error"));
  };

  const closePricing = () => {
    setPricingView(null);
    setPricingPayload(null);
  };

  // Programs the user picked in step 1 (preserving the results order).
  const selectedProgramsList = useMemo(
    () => programs.filter((p) => selectedPrograms.has(programRowKey(p))),
    [programs, selectedPrograms],
  );

  // Step 2 options — product types offered across the selected programs.
  const availableProducts = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of selectedProgramsList) {
      for (const label of programProductList(p)) {
        if (!seen.has(label)) {
          seen.add(label);
          out.push(label);
        }
      }
    }
    return out.sort(compareProductNames);
  }, [selectedProgramsList]);

  const toggleProduct = (label: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const toggleProgram = (p: EligibleProgram) => {
    const catalog = p.program_id != null ? loanpassCatalogs?.[p.program_id] : undefined;
    // Step 1 has no selected products yet — availability is program-level (any
    // product DB-priced). null (loading) / true (none) → not selectable.
    if (programHasNoDbPricing(p, catalog) !== false) return;
    const k = programRowKey(p);
    setSelectedPrograms((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const goToProducts = () => {
    setSelectedProducts(new Set());
    setStep("products");
  };

  // Step 1 — every matched program, with program-level pricing availability.
  const programSelectOptions = useMemo(() => {
    const options = programs.map((p) => {
      const catalog = p.program_id != null ? loanpassCatalogs?.[p.program_id] : undefined;
      const noPricing = programHasNoDbPricing(p, catalog); // null=loading, true=none, false=ok
      return {
        key: programRowKey(p),
        label: programDisplayName(p),
        disabled: noPricing !== false,
        disabledReason:
          noPricing === true
            ? "Pricing Not Available"
            : noPricing === null
              ? "Checking pricing…"
              : undefined,
      };
    });
    const sortRank = (o: (typeof options)[number]) => {
      if (!o.disabled) return 0;
      if (o.disabledReason === "Checking pricing…") return 1;
      if (o.disabledReason === "Pricing Not Available") return 2;
      return 2;
    };
    return [...options].sort((a, b) => sortRank(a) - sortRank(b));
  }, [programs, loanpassCatalogs]);

  const selectableProgramKeys = useMemo(
    () => programSelectOptions.filter((o) => !o.disabled).map((o) => o.key),
    [programSelectOptions],
  );

  // Drop programs from selection once pricing resolves to unavailable.
  useEffect(() => {
    if (step !== "programs") return;
    setSelectedPrograms((prev) => {
      const next = new Set([...prev].filter((k) => selectableProgramKeys.includes(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [step, selectableProgramKeys]);

  // Drop selected products that the (possibly changed) program set no longer offers.
  useEffect(() => {
    setSelectedProducts((prev) => {
      const next = new Set([...prev].filter((label) => availableProducts.includes(label)));
      return next.size === prev.size ? prev : next;
    });
  }, [availableProducts]);

  // Prefetch par pricing once products are chosen (step 2) or on the table (step 3).
  useEffect(() => {
    if ((step !== "products" && step !== "result") || !onProductPrice) return;
    for (const program of selectedProgramsList) {
      const catalog =
        program.program_id != null ? loanpassCatalogs?.[program.program_id] : undefined;
      for (const product of programProductList(program)) {
        if (!selectedProducts.has(product)) continue;
        if (catalog !== undefined && !isProductDbPriced(catalog, product)) continue;
        const key = productPriceKey(program, product);
        if (!productPrices || !(key in productPrices)) void onProductPrice(program, product);
      }
    }
  }, [
    step,
    selectedProgramsList,
    selectedProducts,
    loanpassCatalogs,
    productPrices,
    onProductPrice,
  ]);

  // Comparison rows: one per (selected program × selected product it offers).
  // Priced rows first, loading next, "Pricing not available" last.
  const comparisonRows = useMemo(() => {
    const chosenPrograms = selectedProgramsList;
    const rows: Array<{ program: EligibleProgram; product: string }> = [];
    for (const program of chosenPrograms) {
      const list = programProductList(program);
      for (const product of list) {
        if (selectedProducts.has(product)) rows.push({ program, product });
      }
    }
    const pricingRank = (row: (typeof rows)[number]) => {
      const catalog =
        row.program.program_id != null ? loanpassCatalogs?.[row.program.program_id] : undefined;
      if (catalog !== undefined && !isProductDbPriced(catalog, row.product)) return 2;
      const key = productPriceKey(row.program, row.product);
      if (!productPrices || !(key in productPrices)) return 1;
      if (productPrices[key] === null) return 2;
      return 0;
    };
    return [...rows].sort((a, b) => pricingRank(a) - pricingRank(b));
  }, [selectedProgramsList, selectedProducts, loanpassCatalogs, productPrices]);

  const COMPARE_PAGE_SIZE = 10;
  const comparePageCount = Math.max(1, Math.ceil(comparisonRows.length / COMPARE_PAGE_SIZE));
  const pagedComparisonRows = comparisonRows.slice(
    comparePage * COMPARE_PAGE_SIZE,
    (comparePage + 1) * COMPARE_PAGE_SIZE,
  );

  // Reset to the first page whenever the comparison set changes or we (re)enter
  // the result step.
  useEffect(() => {
    setComparePage(0);
  }, [comparisonRows, step]);

  const selectedSelectablePrograms = useMemo(
    () => [...selectedPrograms].filter((k) => selectableProgramKeys.includes(k)),
    [selectedPrograms, selectableProgramKeys],
  );

  return (
    <div
      className={COMPARE_DIALOG_SHELL}
      role="dialog"
      aria-modal="true"
      aria-label="Results: Comparison Summary"
      onClick={onClose}
    >
      <div className={COMPARE_PANEL} onClick={(e) => e.stopPropagation()}>
        {pricingView ? (
          <>
            <CompareModalHeader title="Results: Pricing Scenarios" hideKicker onClose={onClose} />
            {pricingStatus === "done" && pricingPayload ? (
              <div className={cn("border-b border-border py-2.5", COMPARE_MODAL_PAD)}>
                <p className="text-[13px] font-semibold text-foreground">
                  {pricingPayload.loanpass_product_name || pricingPayload.product_label}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {programDisplayName(pricingView.program)}
                </p>
                {pricingPayload.effective_date ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Effective {pricingPayload.effective_date}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className={COMPARE_BODY}>
              {pricingStatus === "loading" ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  Loading pricing…
                </p>
              ) : pricingStatus === "error" || !pricingPayload ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  Pricing not available for this program.
                </p>
              ) : (
                <LoanpassPricingCard
                  payload={pricingPayload}
                  showFooterNav={false}
                  showDownloadButton={false}
                  showProductHeader={false}
                />
              )}
            </div>
            <CompareNavFooter
              onBack={closePricing}
              onContinue={onClose}
              continueLabel="Done"
              showContinueArrow={false}
              trailing={
                pricingPayload && pricingStatus === "done" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!loanpassPricingCanDownload(pricingPayload)}
                    onClick={() => downloadLoanpassPricingCardPdf(pricingPayload)}
                    className={cn(
                      COMPARE_BTN_H,
                      "w-full gap-1.5 sm:h-9 sm:w-auto sm:shrink-0",
                      COMPARE_BTN_TEXT,
                    )}
                  >
                    <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Download Pricing
                  </Button>
                ) : null
              }
            />
          </>
        ) : step === "programs" ? (
          <>
            <CompareModalHeader
              title="Step 1 — Pick the programs to compare"
              hideKicker
              onClose={onClose}
            />
            <div className={COMPARE_BODY}>
              <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
                Select the programs you want to compare. We&apos;ll then ask which products to
                compare across them. Programs without live pricing are greyed out.
              </p>
              <CompareMultiSelectPanel
                options={programSelectOptions}
                selected={selectedPrograms}
                onToggle={(k) => {
                  const prog = programs.find((p) => programRowKey(p) === k);
                  if (prog) toggleProgram(prog);
                }}
              />
              <p className="mt-4 text-[12px] text-muted-foreground">
                {selectedSelectablePrograms.length} program
                {selectedSelectablePrograms.length === 1 ? "" : "s"} selected
                {selectableProgramKeys.length < programSelectOptions.length
                  ? ` · ${programSelectOptions.length - selectableProgramKeys.length} Pricing Not Available`
                  : ""}
              </p>
            </div>
            <CompareNavFooter
              onContinue={goToProducts}
              continueDisabled={selectedSelectablePrograms.length === 0}
            />
          </>
        ) : step === "products" ? (
          <>
            <CompareModalHeader
              title="Step 2 — Pick the products to compare"
              hideKicker
              onClose={onClose}
            />
            <div className={COMPARE_BODY}>
              <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
                Product types offered across your selected program
                {selectedSelectablePrograms.length === 1 ? "" : "s"} — e.g. 30-Year Fixed, 5/6 ARM.
                Select one or more to compare.
              </p>
              <CompareMultiSelectPanel
                options={availableProducts.map((label) => ({
                  key: label,
                  label: abbreviateProduct(label),
                }))}
                selected={selectedProducts}
                onToggle={toggleProduct}
              />
              <p className="mt-4 text-[12px] text-muted-foreground">
                {selectedProducts.size} product{selectedProducts.size === 1 ? "" : "s"} selected
              </p>
            </div>
            <CompareNavFooter
              onBack={() => setStep("programs")}
              onContinue={() => setStep("result")}
              continueDisabled={selectedProducts.size === 0}
            />
          </>
        ) : (
          <>
            <CompareModalHeader title="Results: Comparison Summary" hideKicker onClose={onClose} />
            <div className={COMPARE_BODY}>
              <div className="flex flex-col gap-2.5 pb-1 sm:hidden">
                {pagedComparisonRows.map(({ program, product }, idx) => {
                  const i = comparePage * COMPARE_PAGE_SIZE + idx;
                  const catalog =
                    program.program_id != null ? loanpassCatalogs?.[program.program_id] : undefined;
                  const row = compareRowParPrice(program, product, catalog, productPrices);
                  return (
                    <CompareResultMobileCard
                      key={`${productPriceKey(program, product)}-${i}-mobile`}
                      program={program}
                      product={product}
                      row={row}
                      onOpenPricing={
                        onLoadPricingPayload && row
                          ? () => openPricing(program, product)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
              <div className="hidden min-w-0 sm:block">
                <table
                  className={cn(
                    "w-full min-w-[36rem] table-fixed border-collapse text-[12px]",
                    onLoadPricingPayload ? "min-w-[42rem]" : "",
                  )}
                >
                  <colgroup>
                    {onLoadPricingPayload ? (
                      <>
                        <col className="w-[20%]" />
                        <col className="w-[17%]" />
                        <col className="w-[11%]" />
                        <col className="w-[14%]" />
                        <col className="w-[16%]" />
                        <col className="w-[22%]" />
                      </>
                    ) : (
                      <>
                        <col className="w-[24%]" />
                        <col className="w-[18%]" />
                        <col className="w-[12%]" />
                        <col className="w-[22%]" />
                        <col className="w-[24%]" />
                      </>
                    )}
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2 py-2 font-semibold sm:px-4 sm:py-2.5">Program</th>
                      <th className="px-2 py-2 font-semibold sm:px-4 sm:py-2.5">Product</th>
                      <th className="px-2 py-2 font-semibold sm:px-4 sm:py-2.5">Par Rate</th>
                      <th className="px-2 py-2 font-semibold sm:px-4 sm:py-2.5">
                        Estimated P&amp;I Payment
                      </th>
                      <th className="px-2 py-2 font-semibold sm:px-4 sm:py-2.5">Min Rate</th>
                      {onLoadPricingPayload ? (
                        <th className="px-2 py-2 font-semibold sm:px-4 sm:py-2.5">Actions</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedComparisonRows.map(({ program, product }, idx) => {
                      const i = comparePage * COMPARE_PAGE_SIZE + idx;
                      const catalog =
                        program.program_id != null
                          ? loanpassCatalogs?.[program.program_id]
                          : undefined;
                      const row = compareRowParPrice(program, product, catalog, productPrices);
                      const valueColspan = onLoadPricingPayload ? 4 : 3;
                      const rowKey = productPriceKey(program, product);
                      return (
                        <tr
                          key={`${rowKey}-${i}`}
                          className={cn(
                            "border-b border-border",
                            i % 2 === 0 ? "bg-card" : "bg-muted/30",
                          )}
                        >
                          <td className="px-2 py-2 align-middle font-semibold text-foreground sm:px-4 sm:py-2.5">
                            <span className="line-clamp-2 leading-snug">
                              {programDisplayName(program)}
                            </span>
                          </td>
                          <td className="px-2 py-2 align-middle sm:px-4 sm:py-2.5">
                            <span className="inline-block max-w-full rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium break-words text-foreground dark:bg-muted/30">
                              {abbreviateProduct(product)}
                            </span>
                          </td>
                          {row === undefined ? (
                            <td
                              className="px-2 py-2 align-middle text-muted-foreground sm:px-4 sm:py-2.5"
                              colSpan={valueColspan}
                            >
                              Loading…
                            </td>
                          ) : row === null ? (
                            <td
                              className="px-2 py-2 align-middle sm:px-4 sm:py-2.5"
                              colSpan={valueColspan}
                            >
                              <span className="inline-flex flex-wrap items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                                Pricing not available
                              </span>
                            </td>
                          ) : (
                            <>
                              <td className="px-2 py-2 align-middle font-semibold tabular-nums text-foreground sm:px-4 sm:py-2.5">
                                {formatLoanpassRate(row.rate)}
                              </td>
                              <td className="px-2 py-2 align-middle font-semibold tabular-nums text-foreground sm:px-4 sm:py-2.5">
                                {row.payment}
                              </td>
                              <td className="px-2 py-2 align-middle sm:px-4 sm:py-2.5">
                                <CompareMinRateCell row={row} />
                              </td>
                              {onLoadPricingPayload ? (
                                <td className="px-2 py-2 align-middle text-right sm:px-4 sm:py-2.5">
                                  <button
                                    type="button"
                                    onClick={() => openPricing(program, product)}
                                    className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-muted sm:px-2.5 sm:text-[11px] dark:bg-card"
                                  >
                                    <span className="truncate">Detailed Pricing</span>
                                    <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                                  </button>
                                </td>
                              ) : null}
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {comparePageCount > 1 ? (
              <div
                className={cn(
                  "flex shrink-0 items-center justify-center gap-2",
                  COMPARE_MODAL_PAD,
                  "border-t border-border py-3",
                )}
              >
                <button
                  type="button"
                  onClick={() => setComparePage((p) => Math.max(0, p - 1))}
                  disabled={comparePage === 0}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3",
                    COMPARE_BTN_H,
                    COMPARE_BTN_TEXT,
                    "text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                >
                  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Prev
                </button>
                <span className={cn(COMPARE_BTN_TEXT, "text-muted-foreground")}>
                  Page {comparePage + 1} of {comparePageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setComparePage((p) => Math.min(comparePageCount - 1, p + 1))}
                  disabled={comparePage >= comparePageCount - 1}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3",
                    COMPARE_BTN_H,
                    COMPARE_BTN_TEXT,
                    "text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                >
                  Next <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            <CompareNavFooter
              onBack={() => setStep("products")}
              onContinue={onClose}
              continueLabel="Done"
              showContinueArrow={false}
              trailing={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const rows = comparisonRows.map(({ program, product }) => {
                      const catalog =
                        program.program_id != null
                          ? loanpassCatalogs?.[program.program_id]
                          : undefined;
                      const r = compareRowParPrice(program, product, catalog, productPrices);
                      const priced = r != null && typeof r === "object";
                      return {
                        program: programDisplayName(program),
                        product: abbreviateProduct(product),
                        parRate: priced ? formatLoanpassRate(r.rate) : "—",
                        payment: priced ? r.payment : "—",
                        minRateCost: priced ? formatCompareMinRateCost(r) : "—",
                        available: priced,
                      };
                    });
                    downloadComparisonPdf(rows);
                  }}
                  className={cn(
                    COMPARE_BTN_H,
                    "w-full gap-1.5 sm:h-9 sm:w-auto sm:shrink-0",
                    COMPARE_BTN_TEXT,
                  )}
                >
                  <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Download Comparison
                </Button>
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

export function ResultsCard({
  programs,
  onKnowMore,
  knowMoreDisabled = false,
  onProductPrice,
  onLoadPricingPayload,
  loanpassCatalogs,
  productPrices,
}: {
  programs: EligibleProgram[];
  onKnowMore?: (program: EligibleProgram) => void;
  /** Lock row actions while program detail / exclusions is open. */
  knowMoreDisabled?: boolean;
  /** Lazy hover fetch fallback for product chips not yet prefetched. */
  onProductPrice?: ProductPriceFetcher;
  /** "View pricing" in the compare table → load the full pricing payload (shown inline). */
  onLoadPricingPayload?: (
    program: EligibleProgram,
    productLabel: string,
  ) => Promise<LoanpassPricingPayload | null>;
  /** Per-program LoanPASS DB catalog — instant pricing available / not available. */
  loanpassCatalogs?: Record<number, LoanpassDbProduct[] | undefined>;
  /** Prefetched par-price cache (key → value) for hover popovers and compare table rates. */
  productPrices?: Record<string, ProductParPrice | null>;
}) {
  const [page, setPage] = useState(0);
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    setPage(0);
    setCompareOpen(false);
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
          {programs.length > 0 && onProductPrice ? (
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              disabled={knowMoreDisabled}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-[13px] dark:bg-card"
            >
              <Menu className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" /> Compare
            </button>
          ) : null}
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
              const catalog = p.program_id != null ? loanpassCatalogs?.[p.program_id] : undefined;
              const noPricingDb = programHasNoDbPricing(p, catalog);
              const noPricingAvailable = noPricingDb === true;
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
                        {noPricingAvailable ? (
                          <span
                            onClick={(e) => e.stopPropagation()}
                            className="pointer-events-none inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                          >
                            Pricing not available
                          </span>
                        ) : null}
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
                            <ProductPriceChip
                              key={label}
                              program={p}
                              label={label}
                              prices={productPrices}
                              onProductPrice={onProductPrice}
                              pricingUnavailable={noPricingAvailable}
                            />
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
      {compareOpen ? (
        <CompareWizard
          programs={programs}
          loanpassCatalogs={loanpassCatalogs}
          productPrices={productPrices}
          onProductPrice={onProductPrice}
          onLoadPricingPayload={onLoadPricingPayload}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}
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
