import type { WizardForm } from "@/components/LoanWizard";
import type { LoanpassCreditField } from "@/lib/loanpass/types";

function parseMoney(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const n = Number(String(raw).replace(/[,$\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

const OCCUPANCY_VARIANT: Record<string, string> = {
  "Primary Residence": "primary-residence",
  "Second Home": "second-home",
  "Investment Property": "investment-property",
};

const LOAN_PURPOSE_VARIANT: Record<string, string> = {
  Purchase: "purchase",
  Refinance: "refinance",
  "Cash-Out Refinance": "cash-out",
};

const PROPERTY_TYPE_VARIANT: Record<string, string> = {
  single_family: "single-family",
  pud: "pud",
  townhouse: "townhouse",
  condo_warrantable: "condo-warrantable",
  condo_non_warrantable: "condo-non-warrantable",
  condotel: "condotel",
  two_to_four_family: "two-to-four-family",
  five_to_eight_unit: "multi-family",
  mixed_use: "mixed-use",
  manufactured_home: "manufactured-home",
  cooperative: "cooperative",
};

function loanTermMonths(loanTerm: string | undefined): string | null {
  const t = (loanTerm ?? "").trim();
  if (!t || /no preference/i.test(t)) return null;
  const m = t.match(/(\d+)/);
  if (!m) return null;
  const years = Number(m[1]);
  if (!Number.isFinite(years) || years <= 0) return null;
  return String(years * 12);
}

function unitCount(propertyType: string): string {
  if (propertyType === "two_to_four_family") return "3";
  if (propertyType === "five_to_eight_unit") return "6";
  return "1";
}

/**
 * Best-effort map from wizard scenario → LoanPASS ``set-fields`` payload.
 * Field IDs follow LoanPASS public/iframe examples (docs.loanpass.io/iframe-api/messages).
 */
export function mapWizardFormToLoanpassFields(form: WizardForm): LoanpassCreditField[] {
  const fields: LoanpassCreditField[] = [];

  const push = (fieldId: string, value: LoanpassCreditField["value"]) => {
    if (value != null) fields.push({ fieldId, value });
  };

  const occVariant = OCCUPANCY_VARIANT[form.occupancy?.trim() ?? ""];
  if (occVariant) {
    push("field@occupancy-type", {
      type: "enum",
      enumTypeId: "occupancy-type",
      variantId: occVariant,
    });
  }

  const purposeVariant = LOAN_PURPOSE_VARIANT[form.loanPurpose?.trim() ?? ""];
  if (purposeVariant) {
    push("field@loan-purpose", {
      type: "enum",
      enumTypeId: "loan-purpose",
      variantId: purposeVariant,
    });
  }

  const propVariant = PROPERTY_TYPE_VARIANT[form.propertyType?.trim() ?? ""];
  if (propVariant) {
    push("field@property-type", {
      type: "enum",
      enumTypeId: "property-type",
      variantId: propVariant,
    });
  }

  push("field@number-of-units", { type: "number", value: unitCount(form.propertyType ?? "") });

  const state = (form.state ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(state)) {
    push("field@state", { type: "string", format: "us-state-code", value: state });
  }

  const fico = (form.decisionCreditScore ?? "").replace(/\D/g, "");
  if (fico) {
    push("field@decision-credit-score", { type: "number", value: fico });
  }

  const loanAmt = parseMoney(form.loanAmount);
  if (loanAmt) {
    push("field@base-loan-amount", { type: "number", value: loanAmt });
  }

  const propertyValue = parseMoney(form.valueSalesPrice);
  if (propertyValue) {
    push("field@purchase-price", { type: "number", value: propertyValue });
  }

  const months = loanTermMonths(form.loanTerm);
  if (months) {
    push("field@desired-loan-term", { type: "duration", unit: "months", count: months });
  }

  const dtiRaw = (form.estimatedDti ?? "").replace(/%/g, "").trim();
  const dti = dtiRaw ? Number(dtiRaw.replace(/[^\d.]/g, "")) : NaN;
  if (Number.isFinite(dti) && dti > 0) {
    push("field@estimated-dti", { type: "number", value: String(dti) });
  }

  const dscrRaw = (form.dscr ?? form.loanLevelDscr ?? "").replace(/%/g, "").trim();
  const dscr = dscrRaw ? Number(dscrRaw.replace(/[^\d.]/g, "")) : NaN;
  if (Number.isFinite(dscr) && dscr > 0) {
    push("field@estimated-dscr", { type: "number", value: String(dscr) });
  }

  const docLabel = (form.documentationType ?? "").trim();
  const docVariants: Record<string, string> = {
    "Full Documentation": "full-documentation",
    "1099": "1099",
    "Asset Utilization": "asset-utilization",
    "Asset Qualifier": "asset-utilization",
    "Profit and Loss": "profit-and-loss",
    "WVOE Only": "wvoe",
    "Rental Income": "dscr-rental",
  };
  const docVariant = docVariants[docLabel];
  if (docVariant) {
    push("field@documentation-type", {
      type: "enum",
      enumTypeId: "documentation-type",
      variantId: docVariant,
    });
  }

  // Timeframe (income path only): Full Doc, bank statements, P&L, and 1099 send the
  // borrower's 12-/24-month selection (stored as "12" | "24"); others default to 24 month.
  const low = docLabel.toLowerCase();
  const isDscrDoc = docVariant === "dscr-rental";
  if (docLabel && !isDscrDoc) {
    const usesSelected =
      low.includes("full documentation") ||
      low.includes("bank statement") ||
      low.includes("p&l") ||
      low.startsWith("pl_") ||
      low === "1099";
    const sel = (form.documentationTimeframe ?? "").trim();
    const selectedVariant =
      sel === "12" || sel.startsWith("12")
        ? "12-month"
        : sel === "24" || sel.startsWith("24")
          ? "24-month"
          : null;
    const timeframe = usesSelected ? (selectedVariant ?? "24-month") : "24-month";
    push("field@documentation-type-timeframe", {
      type: "enum",
      enumTypeId: "documentation-type-timeframe",
      variantId: timeframe,
    });
  }

  const fthb = (form.firstTimeHomebuyer ?? "").trim().toLowerCase();
  const fthbVariant =
    fthb === "yes" || fthb === "y" ? "yes" : fthb === "no" || fthb === "n" ? "no" : null;
  if (fthbVariant) {
    push("field@first-time-homebuyer", {
      type: "enum",
      enumTypeId: "first-time-homebuyer",
      variantId: fthbVariant,
    });
  }

  return fields;
}
