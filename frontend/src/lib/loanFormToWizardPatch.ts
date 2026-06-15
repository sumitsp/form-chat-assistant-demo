import type { WizardForm } from "@/components/LoanWizard";
import {
  LIEN_POSITION_FIRST,
  LIEN_POSITION_PIGGYBACK,
  LIEN_POSITION_SECOND,
  computeLtvPercent,
} from "@/lib/nqmIntegratedForm";

const STRING_KEYS: (keyof WizardForm)[] = [
  "citizenship",
  "occupancy",
  "loanPurpose",
  "primaryLoanPurpose",
  "lienPosition",
  "isSecondLien",
  "propertyType",
  "valueSalesPrice",
  "loanAmount",
  "ltv",
  "cltv",
  "existingFirstLien",
  "existingSecondLien",
  "existingSecondLienBalance",
  "cashInHandRequest",
  "decisionCreditScore",
  "estimatedDti",
  "documentationType",
  "firstTimeHomebuyer",
  "state",
  "stateCounty",
  "stateZipCode",
  "paymentHistory",
  "prepaymentTerms",
  "investmentIncomePath",
  "rentalType",
  "dscr",
  "firstTimeInvestor",
];

/** Merge API-extracted loan-file fields into the wizard form shape. */
export function loanFormExtractToWizardPatch(raw: Record<string, string>): Partial<WizardForm> {
  const patch: Partial<WizardForm> = {};

  for (const key of STRING_KEYS) {
    const v = raw[key]?.trim();
    if (v) (patch as Record<string, string>)[key] = v;
  }

  if (patch.loanPurpose && !patch.primaryLoanPurpose) {
    patch.primaryLoanPurpose = patch.loanPurpose;
  }

  if (patch.lienPosition && !patch.isSecondLien) {
    patch.isSecondLien = patch.lienPosition === LIEN_POSITION_FIRST ? "no" : "yes";
  }
  if (!patch.lienPosition && patch.isSecondLien) {
    patch.lienPosition =
      patch.isSecondLien === "yes"
        ? patch.loanPurpose === "Purchase"
          ? LIEN_POSITION_PIGGYBACK
          : LIEN_POSITION_SECOND
        : LIEN_POSITION_FIRST;
  }

  if (patch.valueSalesPrice && patch.loanAmount && !patch.ltv) {
    patch.ltv = computeLtvPercent(patch.loanAmount, patch.valueSalesPrice);
  }

  return patch;
}
