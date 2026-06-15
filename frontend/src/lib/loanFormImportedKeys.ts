import type { WizardForm } from "@/components/LoanWizard";

/** Map API field keys from loan-file import to sidebar row ids for highlight styling. */

export function importedKeysFromExtract(
  raw: Record<string, string>,

  patch?: Partial<WizardForm>,
): Set<string> {
  const keys = new Set<string>();

  for (const [k, v] of Object.entries(raw)) {
    if (!String(v ?? "").trim()) continue;

    if (k === "primaryLoanPurpose" || k === "isSecondLien") continue;

    keys.add(k);
  }

  // Derived on import (LTV/CLTV) — highlight even when not a separate raw key.

  if (patch?.ltv && (raw.loanAmount || raw.valueSalesPrice)) keys.add("ltv");

  if (patch?.cltv) keys.add("cltv");

  return keys;
}

/** Remove sidebar highlight when the user edits a field (unchanged re-confirm keeps highlight). */

export function stripImportedKeys(
  prev: Set<string>,

  patch: Record<string, unknown>,

  formBefore?: Record<string, unknown>,
): Set<string> {
  const next = new Set(prev);

  for (const [k, v] of Object.entries(patch)) {
    if (formBefore) {
      const old = String(formBefore[k] ?? "").trim();

      const neu = String(v ?? "").trim();

      if (old === neu) continue;
    }

    next.delete(k);

    if (k === "loanPurpose") next.delete("primaryLoanPurpose");

    if (k === "lienPosition") next.delete("isSecondLien");
  }

  return next;
}
