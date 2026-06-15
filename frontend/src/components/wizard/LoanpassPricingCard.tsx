import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getAccessRole } from "@/lib/access";
import {
  downloadLoanpassPricingPdf,
  loanpassCellForLock,
  loanpassFocusLockDays,
  loanpassPayloadHasDscr,
  loanpassSimplifiedCreditDisplay,
  loanpassSimplifiedDisplayRows,
  formatLoanpassRate,
  formatLoanpassRatePoints,
  type LoanpassPricingPayload,
} from "@/lib/loanpass/pricingTable";
import { cn } from "@/lib/utils";

function formatPct(value: string | null | undefined): string {
  if (!value || value === "—") return "—";
  const n = Number.parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return value.includes("%") ? value : `${value}%`;
  return `${n.toFixed(1)}%`;
}

const PRICING_ROW_REVEAL_MS = 65;
const PRICING_OUTLINE_BTN = "gap-1.5 text-[13px]";

export function loanpassPricingCanDownload(payload: LoanpassPricingPayload): boolean {
  return (payload.pricing_grid?.rates?.length ?? 0) > 0 || payload.price_scenarios.length > 0;
}

export function downloadLoanpassPricingCardPdf(payload: LoanpassPricingPayload): void {
  const simplified = getAccessRole() !== "admin";
  downloadLoanpassPricingPdf(payload, { simplified });
}

export function loanpassPricingCopyText(payload: LoanpassPricingPayload): string {
  const simplified = getAccessRole() !== "admin";
  const lines = [
    `Indicative Pricing — ${payload.breadcrumbs || payload.program_name} · ${payload.product_label}`,
  ];
  if (payload.loanpass_product_name) {
    lines.push(
      `Matched: ${payload.loanpass_product_name}${payload.loanpass_investor ? ` (${payload.loanpass_investor})` : ""}`,
    );
  }
  const grid = payload.pricing_grid;
  if (!grid || grid.rates.length === 0) {
    if (payload.price_scenarios.length === 0) {
      lines.push("No price scenarios returned.");
    } else {
      lines.push("", "Rate\tPrice\tLock\tRate credit");
      for (const row of payload.price_scenarios) {
        lines.push(
          `${row.rate ?? "—"}\t${row.adjusted_price ?? row.price ?? "—"}\t${row.lock_period ?? "—"}\t${row.rate_credit ?? "—"}`,
        );
      }
    }
  } else {
    const lockDays = loanpassFocusLockDays(grid);
    const lockLabel = lockDays != null ? `${lockDays} days` : "lock";
    const rows =
      simplified && lockDays != null
        ? loanpassSimplifiedDisplayRows(grid.rates, lockDays)
        : grid.rates;
    lines.push("", `Lock: ${lockLabel}`);
    const showDscr = loanpassPayloadHasDscr(payload);
    if (simplified) {
      lines.push(
        "",
        ["Rate", "Price", "Estimated P&I Payment", "DTI", ...(showDscr ? ["DSCR"] : [])].join("\t"),
      );
      for (const row of rows) {
        const cell = lockDays != null ? loanpassCellForLock(row, lockDays) : null;
        lines.push(
          [
            formatLoanpassRate(row.rate_display),
            loanpassSimplifiedCreditDisplay(cell),
            cell?.available ? (cell.final_est_payment ?? "—") : "—",
            cell?.available ? formatPct(cell.final_est_dti) : "—",
            ...(showDscr ? [cell?.available ? formatPct(cell.final_est_dscr) : "—"] : []),
          ].join("\t"),
        );
      }
    } else {
      lines.push(
        "",
        [
          "Rate",
          "Price",
          "Credit",
          "Estimated P&I Payment",
          "DTI",
          ...(showDscr ? ["DSCR"] : []),
        ].join("\t"),
      );
      for (const row of rows) {
        const cell = lockDays != null ? loanpassCellForLock(row, lockDays) : null;
        const price = cell?.available ? formatLoanpassRatePoints(cell.adjusted_price) : "—";
        lines.push(
          [
            formatLoanpassRate(row.rate_display),
            price,
            cell?.available ? formatLoanpassRatePoints(cell.rate_credit) : "—",
            cell?.available ? (cell.final_est_payment ?? "—") : "—",
            cell?.available ? formatPct(cell.final_est_dti) : "—",
            ...(showDscr ? [cell?.available ? formatPct(cell.final_est_dscr) : "—"] : []),
          ].join("\t"),
        );
      }
    }
  }
  lines.push("", "Rates are indicative and subject to lock desk confirmation.");
  return lines.join("\n");
}

export function LoanpassPricingCard({
  payload,
  fromProductPicker = false,
  onBackToProducts,
  onBackToProgramSummary,
  /** @deprecated Use `onBackToProducts` / `onBackToProgramSummary`. */
  onBack,
  /** @deprecated Use `onBackToProgramSummary`. */
  onContinue,
  /** When false, nav lives in a parent footer (e.g. Compare modal). */
  showFooterNav = true,
  /** When false, hide the in-card download button (parent footer owns download). */
  showDownloadButton = true,
  /** When false, hide product title + effective date (parent shows context in footer). */
  showProductHeader = true,
  /** @deprecated Use `onBackToProducts`. */
  onBackToResults,
  className,
}: {
  payload: LoanpassPricingPayload;
  fromProductPicker?: boolean;
  onBackToProducts?: () => void;
  onBackToProgramSummary?: () => void;
  onBack?: () => void;
  onContinue?: () => void;
  showFooterNav?: boolean;
  showDownloadButton?: boolean;
  showProductHeader?: boolean;
  onBackToResults?: () => void;
  className?: string;
}) {
  const backToProducts = onBackToProducts ?? (fromProductPicker && onBack ? onBack : undefined);
  const backToProgramSummary =
    onBackToProgramSummary ??
    onContinue ??
    onBackToResults ??
    (!fromProductPicker ? onBack : undefined);
  const grid = payload.pricing_grid;
  const focusLock = loanpassFocusLockDays(grid);
  const rateRows = grid?.rates ?? [];

  // Non-DSCR (income / full-doc) programs return DSCR 0 — hide the DSCR column.
  const showDscr = loanpassPayloadHasDscr(payload);

  // Loan Officer + Underwriter get a trimmed table (no price/snapshot, par-first
  // rows only). Admin keeps the full view. Role lives in sessionStorage; both
  // /form and /chat are client-only so reading it during render is safe.
  const simplified = useMemo(() => getAccessRole() !== "admin", []);

  // Rows to render. Admin → all matrix rows in the original order. LO/UW → only
  // the par-or-better rows (price ≥ 100), with the par rate (first row to reach
  // 100) pinned on top and the remaining rows sorted by greatest credit first.
  const displayRows = useMemo(() => {
    if (!simplified || focusLock == null) return rateRows;
    return loanpassSimplifiedDisplayRows(rateRows, focusLock);
  }, [simplified, focusLock, rateRows]);

  const initialRate =
    (focusLock != null
      ? rateRows.find((r) => r.locks[String(focusLock)]?.available)?.rate
      : null) ??
    rateRows[0]?.rate ??
    null;

  const [selectedRate, setSelectedRate] = useState<string | null>(initialRate);
  const [visibleRowCount, setVisibleRowCount] = useState(0);

  useEffect(() => {
    setVisibleRowCount(0);
    if (displayRows.length === 0) return;
    let shown = 0;
    const timer = window.setInterval(() => {
      shown += 1;
      setVisibleRowCount(shown);
      if (shown >= displayRows.length) window.clearInterval(timer);
    }, PRICING_ROW_REVEAL_MS);
    return () => window.clearInterval(timer);
  }, [displayRows]);

  const visibleRows = displayRows.slice(0, visibleRowCount);

  const selectedRow = useMemo(
    () => rateRows.find((r) => r.rate === selectedRate) ?? rateRows[0] ?? null,
    [rateRows, selectedRate],
  );

  const selectedCell = useMemo(() => {
    if (!selectedRow || focusLock == null) return null;
    return loanpassCellForLock(selectedRow, focusLock);
  }, [selectedRow, focusLock]);

  const snapshot = selectedCell?.available ? selectedCell : null;
  const snapshotLock = focusLock;

  const handleDownload = () => {
    downloadLoanpassPricingCardPdf(payload);
  };

  const canDownload = loanpassPricingCanDownload(payload);
  const downloadLabel = "Download Pricing";

  const backNavButtons =
    showFooterNav && (backToProducts || backToProgramSummary) ? (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {backToProducts ? (
          <Button
            type="button"
            variant="outline"
            onClick={backToProducts}
            className={PRICING_OUTLINE_BTN}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back to Products
          </Button>
        ) : null}
        {backToProgramSummary ? (
          <Button
            type="button"
            variant="outline"
            onClick={backToProgramSummary}
            className={PRICING_OUTLINE_BTN}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back to Program Summary
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <div className={cn("space-y-4", className)}>
      {showProductHeader ? (
        <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2.5">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-snug text-foreground">
              {payload.product_label}
            </p>
            {payload.effective_date ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Effective {payload.effective_date}
              </p>
            ) : null}
          </div>
          {backNavButtons}
        </div>
      ) : backNavButtons ? (
        <div className="flex justify-end border-b border-border/60 pb-2.5">{backNavButtons}</div>
      ) : null}

      {!simplified ? (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <p className="text-[11px] text-muted-foreground">
            Selected rate snapshot — click any row below to update
          </p>

          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "INVESTOR", value: payload.loanpass_investor || "—" },
              {
                label: "ADJUSTED PRICE",
                value: formatLoanpassRatePoints(snapshot?.adjusted_price),
              },
              {
                label: "FINAL INTEREST RATE",
                value: formatLoanpassRate(selectedRow?.rate_display ?? selectedRow?.rate),
              },
              {
                label: "LOCK PERIOD",
                value: snapshotLock ? `${snapshotLock} Days` : "—",
              },
              { label: "RATE CREDIT", value: formatLoanpassRatePoints(snapshot?.rate_credit) },
              { label: "FINAL EST PAYMENT", value: snapshot?.final_est_payment ?? "—" },
              { label: "FINAL EST DTI", value: formatPct(snapshot?.final_est_dti) },
              { label: "DSCR", value: formatPct(snapshot?.final_est_dscr) },
            ].map((item) => (
              <div key={item.label} className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-0.5 truncate text-[12px] font-semibold text-foreground">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {displayRows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No price scenarios were returned for this product with your current scenario.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full table-fixed text-left text-[11px] leading-tight">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="w-[14%] px-2 py-1.5 font-semibold text-foreground">Rate</th>
                {!simplified && focusLock != null ? (
                  <th className="w-[12%] px-2 py-1.5 font-semibold text-[#012a5b] dark:text-sky-300">
                    {focusLock}d
                  </th>
                ) : null}
                <th className="w-[12%] px-2 py-1.5 font-semibold text-foreground">
                  {simplified ? "Price" : "Credit"}
                </th>
                <th className="w-[22%] px-2 py-1.5 font-semibold text-foreground">
                  Estimated P&amp;I Payment
                </th>
                <th className="w-[14%] px-2 py-1.5 font-semibold text-foreground">DTI</th>
                {showDscr ? (
                  <th className="w-[12%] px-2 py-1.5 font-semibold text-foreground">DSCR</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, rowIndex) => {
                const focusCell = focusLock != null ? loanpassCellForLock(row, focusLock) : null;
                const isSelected = selectedRate === row.rate;
                const showPrice = focusCell?.available && focusCell.adjusted_price;
                // Simplified view: the first row is the par rate — highlight it in brand blue.
                const isPar = simplified && rowIndex === 0;
                const rateCost = simplified ? loanpassSimplifiedCreditDisplay(focusCell) : null;
                const rateCostNum =
                  rateCost != null && rateCost !== "—" ? Number.parseFloat(rateCost) : null;
                const rateCostIsZero =
                  rateCostNum != null && Number.isFinite(rateCostNum) && rateCostNum === 0;
                const rateCostIsNonZero =
                  rateCostNum != null && Number.isFinite(rateCostNum) && rateCostNum !== 0;
                const parRowCell = isPar ? "py-2 font-semibold" : "font-medium";
                return (
                  <tr
                    key={row.rate}
                    onClick={simplified ? undefined : () => setSelectedRate(row.rate)}
                    className={cn(
                      "border-b border-border/60 transition-colors last:border-0",
                      "animate-in fade-in duration-200",
                      isPar && "text-[12px]",
                      simplified
                        ? isPar
                          ? "relative bg-[#012a5b]/[0.12] shadow-[inset_3px_0_0_#012a5b]"
                          : ""
                        : cn(
                            "cursor-pointer",
                            isSelected ? "bg-[#012a5b]/[0.08]" : "hover:bg-muted/30",
                          ),
                    )}
                  >
                    <td className={cn("px-2 py-1.5", parRowCell)}>
                      <span
                        className={cn(
                          isPar
                            ? "font-bold tabular-nums text-[#012a5b] dark:text-sky-200"
                            : "text-foreground",
                        )}
                      >
                        {formatLoanpassRate(row.rate_display)}
                      </span>
                    </td>
                    {!simplified && focusLock != null ? (
                      <td className="px-2 py-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                        {showPrice ? (
                          formatLoanpassRatePoints(focusCell.adjusted_price)
                        ) : (
                          <span className="inline-flex h-5 w-6 items-center justify-center rounded border border-border/70 bg-muted/30 text-muted-foreground">
                            <X className="h-3 w-3" aria-hidden="true" />
                          </span>
                        )}
                      </td>
                    ) : null}
                    {simplified ? (
                      <td
                        className={cn(
                          "px-2 py-1.5 tabular-nums",
                          parRowCell,
                          rateCostIsZero
                            ? "text-emerald-600 dark:text-emerald-400"
                            : rateCostIsNonZero
                              ? "text-red-600 dark:text-red-400"
                              : "text-foreground",
                        )}
                      >
                        {rateCost}
                      </td>
                    ) : (
                      <td className="px-2 py-1.5 text-emerald-700 dark:text-emerald-300">
                        {focusCell?.available
                          ? formatLoanpassRatePoints(focusCell.rate_credit)
                          : "—"}
                      </td>
                    )}
                    <td
                      className={cn("truncate px-2 py-1.5", parRowCell, isPar && "text-foreground")}
                    >
                      {focusCell?.available ? (focusCell.final_est_payment ?? "—") : "—"}
                    </td>
                    <td className={cn("px-2 py-1.5", parRowCell, isPar && "text-foreground")}>
                      {focusCell?.available ? formatPct(focusCell.final_est_dti) : "—"}
                    </td>
                    {showDscr ? (
                      <td className={cn("px-2 py-1.5", parRowCell, isPar && "text-foreground")}>
                        {focusCell?.available ? formatPct(focusCell.final_est_dscr) : "—"}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showFooterNav && showDownloadButton ? (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="outline"
            disabled={!canDownload}
            onClick={handleDownload}
            className={PRICING_OUTLINE_BTN}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {downloadLabel}
          </Button>
        </div>
      ) : showDownloadButton ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="outline"
            disabled={!canDownload}
            onClick={handleDownload}
            className={PRICING_OUTLINE_BTN}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {downloadLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
