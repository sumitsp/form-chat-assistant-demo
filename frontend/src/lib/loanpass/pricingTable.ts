import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type LoanpassPriceScenarioRow = {
  option: number;
  rate: string | null;
  price: string | null;
  lock_period: string | null;
  lock_days?: number | null;
  adjusted_price?: string | null;
  rate_credit?: string | null;
};

export type LoanpassPricingGridCell = {
  adjusted_price: string | null;
  rate_credit: string | null;
  final_est_payment: string | null;
  final_est_dti: string | null;
  final_est_dscr: string | null;
  available: boolean;
};

export type LoanpassPricingGridRate = {
  rate: string;
  rate_display: string;
  locks: Record<string, LoanpassPricingGridCell>;
};

export type LoanpassPricingGrid = {
  lock_periods: number[];
  rates: LoanpassPricingGridRate[];
};

/** Single lock column returned by the API (matches backend LOANPASS_FOCUS_LOCK_DAYS). */
export function loanpassFocusLockDays(grid: LoanpassPricingGrid | null | undefined): number | null {
  const periods = grid?.lock_periods;
  if (!periods?.length) return null;
  return periods[0];
}

export type LoanpassDbProduct = {
  product_type_id: number;
  product_name: string;
  io_period_years?: number | null;
  amort_period_years?: number | null;
  total_term_years?: number | null;
};

export type LoanpassPricingPayload = {
  program_name: string;
  program_code?: string | null;
  breadcrumbs?: string | null;
  product_type_id?: number | null;
  product_label: string;
  loanpass_product_name?: string | null;
  loanpass_investor?: string | null;
  status?: string | null;
  effective_date?: string | null;
  info_notes?: string[];
  price_scenarios: LoanpassPriceScenarioRow[];
  pricing_grid?: LoanpassPricingGrid | null;
};

type LoanpassPricingRowWithCell = {
  row: LoanpassPricingGridRate;
  cell: LoanpassPricingGridCell;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPct(value: string | null | undefined): string {
  if (!value || value === "—") return "—";
  const n = Number.parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return value.includes("%") ? value : `${value}%`;
  return `${n.toFixed(1)}%`;
}

/** Strip formatting and parse the leading numeric value (e.g. "100.000" -> 100). */
export function parseLoanpassPricingNum(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Interest rate for pricing tables — always 3 decimal places + `%`. */
export function formatLoanpassRate(value: string | null | undefined): string {
  if (!value || value === "—") return "—";
  const n = parseLoanpassPricingNum(value);
  if (n == null) {
    const s = String(value).trim();
    return s.includes("%") ? s : `${s}%`;
  }
  return `${n.toFixed(3)}%`;
}

/** Rate points / price / credit columns — always 3 decimal places, no `%`. */
export function formatLoanpassRatePoints(value: string | null | undefined): string {
  if (!value || value === "—") return "—";
  const n = parseLoanpassPricingNum(value);
  if (n == null) return String(value).trim();
  return n.toFixed(3);
}

export function loanpassCellForLock(
  row: LoanpassPricingGridRate | null | undefined,
  lockDays: number,
): LoanpassPricingGridCell | null {
  if (!row) return null;
  return row.locks[String(lockDays)] ?? null;
}

/**
 * LO/UW table rows: the par rate (first to reach price 100) and every BELOW-par
 * rate, ordered par-first then descending (e.g. 6.75 → 6.625 → 6.5 → …). Above-par
 * rows (rate credit / rebate) are dropped. Falls back to all available rows,
 * highest rate first, when no row reaches par.
 */
export function loanpassSimplifiedDisplayRows(
  rows: LoanpassPricingGridRate[],
  lockDays: number | null,
): LoanpassPricingGridRate[] {
  if (lockDays == null) return rows;
  const withCell = rows
    .map((row) => ({ row, cell: loanpassCellForLock(row, lockDays) }))
    .filter((x): x is LoanpassPricingRowWithCell => Boolean(x.cell?.available));
  const parIndex = withCell.findIndex((x) => {
    const price = parseLoanpassPricingNum(x.cell.adjusted_price);
    return price != null && price >= 100 - 1e-6;
  });
  // par and below = ascending rows up to and including par; reverse → par on top.
  const parAndBelow = parIndex === -1 ? withCell : withCell.slice(0, parIndex + 1);
  return parAndBelow
    .slice()
    .reverse()
    .map((x) => x.row);
}

/**
 * LO/UW "Credit" value for a cell = 100 − adjusted_price (buydown points). Par
 * (price 100) → "0"; below-par rows show the positive cost (e.g. 99.772 → "0.228").
 */
export function loanpassSimplifiedCreditDisplay(
  cell: LoanpassPricingGridCell | null | undefined,
): string {
  if (!cell?.available) return "—";
  const price = parseLoanpassPricingNum(cell.adjusted_price);
  if (price == null) return "—";
  const credit = 100 - price;
  return formatLoanpassRatePoints(String(credit));
}

/**
 * Whether this payload is for a DSCR program — true when any available cell has a
 * meaningful (> 0) estimated DSCR. Non-DSCR (income/full-doc) programs return DSCR
 * 0, so the DSCR column is hidden for them. Drives the conditional DSCR column
 * everywhere the pricing table renders (card, copy text, PDF/HTML).
 */
export function loanpassPayloadHasDscr(payload: LoanpassPricingPayload): boolean {
  const grid = payload.pricing_grid;
  if (!grid?.rates?.length) return false;
  for (const row of grid.rates) {
    for (const cell of Object.values(row.locks)) {
      if (!cell?.available) continue;
      const n = parseLoanpassPricingNum(cell.final_est_dscr);
      if (n != null && n > 0) return true;
    }
  }
  return false;
}

export function buildLoanpassPricingPdfHtml(
  payload: LoanpassPricingPayload,
  options: { simplified?: boolean } = {},
): string {
  const date =
    payload.effective_date ||
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const grid = payload.pricing_grid;
  const focusLock = loanpassFocusLockDays(grid);
  const showDscr = loanpassPayloadHasDscr(payload);
  const simplifiedRows =
    options.simplified && grid
      ? loanpassSimplifiedDisplayRows(grid.rates, focusLock)
          .map((row) => {
            const cell = focusLock != null ? loanpassCellForLock(row, focusLock) : null;
            return `
      <tr>
        <td>${escapeHtml(formatLoanpassRate(row.rate_display))}</td>
        <td>${escapeHtml(loanpassSimplifiedCreditDisplay(cell))}</td>
        <td>${escapeHtml(cell?.available ? (cell.final_est_payment ?? "—") : "—")}</td>
        <td>${escapeHtml(cell?.available ? formatPct(cell.final_est_dti) : "—")}</td>${
          showDscr
            ? `\n        <td>${escapeHtml(cell?.available ? formatPct(cell.final_est_dscr) : "—")}</td>`
            : ""
        }
      </tr>`;
          })
          .join("")
      : "";
  const fullRows = payload.price_scenarios
    .map(
      (r) => `
      <tr>
        <td>${r.option}</td>
        <td>${escapeHtml(formatLoanpassRate(r.rate))}</td>
        <td>${escapeHtml(formatLoanpassRatePoints(r.adjusted_price ?? r.price))}</td>
        <td>${escapeHtml(r.lock_period ?? "—")}</td>
        <td>${escapeHtml(formatLoanpassRatePoints(r.rate_credit))}</td>
      </tr>`,
    )
    .join("");
  const tableHead = options.simplified
    ? `<tr><th>Rate</th><th>Price</th><th>Estimated P&amp;I Payment</th><th>DTI</th>${
        showDscr ? "<th>DSCR</th>" : ""
      }</tr>`
    : "<tr><th>#</th><th>Rate</th><th>Price</th><th>Lock</th><th>Rate Credit</th></tr>";
  const tableRows = options.simplified ? simplifiedRows : fullRows;
  const tableColCount = options.simplified ? (showDscr ? 5 : 4) : 5;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Pricing</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #555; font-size: 13px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; }
  th { background: #eff4fb; }
  .note { margin-top: 16px; font-size: 11px; color: #666; }
</style></head><body>
  <h1>Indicative Pricing</h1>
  <p class="sub">${escapeHtml(payload.breadcrumbs || payload.program_name)} · ${escapeHtml(payload.product_label)} · ${date}</p>
  ${payload.loanpass_product_name ? `<p class="sub">Matched product: ${escapeHtml(payload.loanpass_product_name)}${payload.loanpass_investor ? ` (${escapeHtml(payload.loanpass_investor)})` : ""}</p>` : ""}
  <table>
    <thead>${tableHead}</thead>
    <tbody>${tableRows || `<tr><td colspan="${tableColCount}">No scenarios returned.</td></tr>`}</tbody>
  </table>
  <p class="note">Rates are indicative and subject to lock desk confirmation.</p>
</body></html>`;
}

function safePdfFilename(payload: LoanpassPricingPayload): string {
  const base = `Pricing ${payload.program_name || ""} ${payload.product_label || ""}`.trim();
  const cleaned = base.replace(/[^\w\d -]+/g, "").replace(/\s+/g, "_");
  return `${cleaned || "Pricing"}.pdf`;
}

/**
 * Build and immediately download a real PDF (no print preview / new tab) via
 * jsPDF. LO/UW get the trimmed par-first "Rate Cost" table; Admin gets the full
 * scenario table.
 */
export function downloadLoanpassPricingPdf(
  payload: LoanpassPricingPayload,
  options: { simplified?: boolean } = {},
): boolean {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  let cursorY = 48;

  const date =
    payload.effective_date ||
    new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Indicative Pricing", marginX, cursorY);
  cursorY += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(
    `${payload.breadcrumbs || payload.program_name} · ${payload.product_label} · ${date}`,
    marginX,
    cursorY,
  );
  cursorY += 14;
  if (payload.loanpass_product_name) {
    const matched = `Matched product: ${payload.loanpass_product_name}${
      payload.loanpass_investor ? ` (${payload.loanpass_investor})` : ""
    }`;
    doc.text(matched, marginX, cursorY);
    cursorY += 14;
  }
  doc.setTextColor(0);

  const grid = payload.pricing_grid;
  const focusLock = loanpassFocusLockDays(grid);

  const showDscr = loanpassPayloadHasDscr(payload);

  let head: string[][];
  let body: string[][];
  if (options.simplified && grid) {
    head = [["Rate", "Price", "Estimated P&I Payment", "DTI", ...(showDscr ? ["DSCR"] : [])]];
    body = loanpassSimplifiedDisplayRows(grid.rates, focusLock).map((row) => {
      const cell = focusLock != null ? loanpassCellForLock(row, focusLock) : null;
      return [
        formatLoanpassRate(row.rate_display),
        loanpassSimplifiedCreditDisplay(cell),
        cell?.available ? (cell.final_est_payment ?? "—") : "—",
        cell?.available ? formatPct(cell.final_est_dti) : "—",
        ...(showDscr ? [cell?.available ? formatPct(cell.final_est_dscr) : "—"] : []),
      ];
    });
  } else if (grid && grid.rates.length > 0) {
    // Admin: mirror the on-screen grid table (Rate / {lock}d price / Credit / Payment / DTI / DSCR).
    const priceLabel = focusLock != null ? `${focusLock}d` : "Price";
    head = [
      ["Rate", priceLabel, "Credit", "Estimated P&I Payment", "DTI", ...(showDscr ? ["DSCR"] : [])],
    ];
    body = grid.rates.map((row) => {
      const cell = focusLock != null ? loanpassCellForLock(row, focusLock) : null;
      return [
        formatLoanpassRate(row.rate_display),
        formatLoanpassRatePoints(cell?.available ? cell.adjusted_price : null),
        formatLoanpassRatePoints(cell?.available ? cell.rate_credit : null),
        cell?.available ? (cell.final_est_payment ?? "—") : "—",
        cell?.available ? formatPct(cell.final_est_dti) : "—",
        ...(showDscr ? [cell?.available ? formatPct(cell.final_est_dscr) : "—"] : []),
      ];
    });
  } else {
    // Fallback when no grid is present — the legacy price-scenario rows.
    head = [["#", "Rate", "Price", "Lock", "Rate Credit"]];
    body = payload.price_scenarios.map((r) => [
      String(r.option),
      r.rate ? formatLoanpassRate(r.rate) : "—",
      formatLoanpassRatePoints(r.adjusted_price ?? r.price),
      r.lock_period ?? "—",
      formatLoanpassRatePoints(r.rate_credit),
    ]);
  }

  autoTable(doc, {
    head,
    body: body.length > 0 ? body : [["No scenarios returned."]],
    startY: cursorY + 4,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [1, 42, 91], textColor: 255, fontStyle: "bold" },
    // Highlight the par row (first row) in the simplified view with the brand blue tint.
    didParseCell: (data) => {
      if (options.simplified && data.section === "body" && data.row.index === 0) {
        data.cell.styles.fillColor = [222, 230, 241];
        data.cell.styles.textColor = [1, 42, 91];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    "Rates are indicative and subject to lock desk confirmation.",
    marginX,
    (finalY ?? cursorY) + 18,
  );

  doc.save(safePdfFilename(payload));
  return true;
}

/** One row of the Compare-wizard comparison table, ready for the PDF. */
export type ComparisonPdfRow = {
  program: string;
  product: string;
  parRate: string;
  payment: string;
  /** Lowest rate with optional cost, e.g. `6.125% (-3.720)`. */
  minRateCost: string;
  available: boolean;
};

/**
 * Build and immediately download a PDF of the Compare-wizard comparison table
 * (Program · Product · Par Rate · Est. Payment · Min Rate).
 */
export function downloadComparisonPdf(rows: ComparisonPdfRow[]): boolean {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  let cursorY = 48;

  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Program & Product Comparison", marginX, cursorY);
  cursorY += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(date, marginX, cursorY);
  doc.setTextColor(0);

  const head = [["Program", "Product", "Par Rate", "Estimated P&I Payment", "Min Rate"]];
  const body = rows.map((r) =>
    r.available
      ? [r.program, r.product, r.parRate, r.payment, r.minRateCost]
      : [r.program, r.product, "Pricing not available", "", ""],
  );

  autoTable(doc, {
    head,
    body: body.length > 0 ? body : [["No programs selected."]],
    startY: cursorY + 8,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [1, 42, 91], textColor: 255, fontStyle: "bold" },
    didParseCell: (data) => {
      const r = rows[data.row.index];
      if (data.section !== "body" || !r) return;
      // Red "Pricing not available" cell for unavailable rows.
      if (!r.available && data.column.index === 2) {
        data.cell.styles.textColor = [185, 28, 28];
        data.cell.styles.fontStyle = "bold";
      }
      // Red buydown cost in the Min Rate column.
      if (r.available && r.minRateCost.includes("(") && data.column.index === 4) {
        data.cell.styles.textColor = [220, 38, 38];
      }
    },
  });

  doc.save("Program-Comparison.pdf");
  return true;
}
