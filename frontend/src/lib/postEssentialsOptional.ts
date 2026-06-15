/**
 * Optional-detail categories shown after essentials (chat intake).
 */

import {
  LOAN_TERM_SELECT_OPTIONS,
  RATE_TYPE_PREF_OPTIONS,
  YES_NO_OPTIONS,
} from "@/lib/nqmIntegratedForm";

export type EssentialsPickerOption = {
  code: string;
  label: string;
  /** Skip — leaves field unchanged */
  skip?: boolean;
};

export type EssentialsPickerCategory = {
  id: string;
  title: string;
  subtitle?: string;
  kind?: "pills" | "text" | "select" | "loan_term_multi" | "number";
  placeholder?: string;
  options?: EssentialsPickerOption[];
  moreOptions?: EssentialsPickerOption[];
  selectOptions?: readonly string[];
};

/** Property types that show the acreage field (aligned with LoanWizardV2 step 3 optional). */
export const ACREAGE_PROPERTY_TYPES = new Set(["single_family", "pud", "townhouse"]);

export type OptionalPickerFormValues = {
  propertyCondition: string;
  acreage: string;
  loanTerm: string;
  rateTypePref: string;
  interestOnlyPref: string;
  nonOccupantCoBorrower: string;
  powerOfAttorney: string;
  listingSeasoning: string;
  scenarioNotes: string;
};

export const ESSENTIALS_PICKER_INTRO =
  "I've got all the essentials. Submit now, or quickly add any of these optional details first?";
export const ESSENTIALS_PICKER_HINT =
  'Tap a pill to fill instantly — doesn\'t count as a question. "Skip" or just hit Submit.';

const SKIP: EssentialsPickerOption = { code: "_skip", label: "Skip", skip: true };

export const POST_ESSENTIALS_CATEGORIES: EssentialsPickerCategory[] = [
  {
    id: "property_condition",
    title: "PROPERTY CONDITION",
    kind: "pills",
    options: [
      { code: "Good", label: "Good" },
      { code: "Fair", label: "Fair" },
      { code: "C5 (poor)", label: "C5" },
      { code: "C6 (ineligible)", label: "C6" },
      SKIP,
    ],
  },
  {
    id: "acreage",
    title: "ACREAGE",
    subtitle: "Most programs cap at 2–20 acres",
    kind: "number",
    placeholder: "e.g. 1.5",
  },
  {
    id: "loan_term",
    title: "LOAN TERM",
    subtitle: "Select all preferences",
    kind: "loan_term_multi",
  },
  {
    id: "rate_type",
    title: "RATE TYPE",
    kind: "select",
    selectOptions: RATE_TYPE_PREF_OPTIONS,
  },
  {
    id: "interest_only",
    title: "INTEREST-ONLY?",
    kind: "select",
    selectOptions: ["No preference", "Yes", "No"],
  },
  {
    id: "non_occupant_co",
    title: "NON-OCCUPANT CO-BORROWER?",
    kind: "select",
    selectOptions: YES_NO_OPTIONS,
  },
  {
    id: "power_of_attorney",
    title: "POWER OF ATTORNEY?",
    kind: "select",
    selectOptions: YES_NO_OPTIONS,
  },
  {
    id: "listing_seasoning",
    title: "LISTED FOR SALE IN LAST 6 MONTHS?",
    kind: "select",
    selectOptions: YES_NO_OPTIONS,
  },
  {
    id: "scenario_notes",
    title: "ANYTHING ELSE YOU'D LIKE US TO KNOW?",
    kind: "text",
    placeholder: "Additional context — rehab history, departing residence, other notes.",
  },
];

/** @deprecated Use POST_ESSENTIALS_CATEGORIES */
export const PRIMARY_ESSENTIALS_CATEGORIES = POST_ESSENTIALS_CATEGORIES;

/** @deprecated No expanded optional section */
export const EXPANDED_ESSENTIALS_CATEGORIES: EssentialsPickerCategory[] = [];

export type EssentialsFormSlice = {
  occupancy: string;
  propertyType: string;
  investmentIncomePath: string;
  documentationType: string;
};

export function visibleOptionalPickerCategories(
  form: EssentialsFormSlice,
): EssentialsPickerCategory[] {
  const isPrimary = form.occupancy === "Primary Residence";
  return POST_ESSENTIALS_CATEGORIES.filter((cat) => {
    if (cat.id === "non_occupant_co") return isPrimary;
    if (cat.id === "acreage") return ACREAGE_PROPERTY_TYPES.has(form.propertyType);
    return true;
  });
}

/** @deprecated */
export function visiblePrimaryCategories(form: EssentialsFormSlice): EssentialsPickerCategory[] {
  return visibleOptionalPickerCategories(form);
}

/** @deprecated */
export function visibleExpandedCategories(_form: EssentialsFormSlice): EssentialsPickerCategory[] {
  return [];
}

export function applyEssentialsPickerSelection(
  categoryId: string,
  code: string,
  customValue?: string,
): Record<string, string> {
  if (code === "_skip") return {};

  const patch: Record<string, string> = {};

  switch (categoryId) {
    case "property_condition":
      patch.propertyCondition = code;
      break;
    case "non_occupant_co":
      patch.nonOccupantCoBorrower = code;
      break;
    case "scenario_notes":
      if (customValue?.trim()) patch.scenarioNotes = customValue.trim();
      break;
    default:
      break;
  }

  return patch;
}

export function applyOptionalPickerFieldPatch(
  patch: Partial<OptionalPickerFormValues>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (patch.propertyCondition !== undefined) out.propertyCondition = patch.propertyCondition;
  if (patch.acreage !== undefined) out.acreage = patch.acreage;
  if (patch.loanTerm !== undefined) out.loanTerm = patch.loanTerm;
  if (patch.rateTypePref !== undefined) out.rateTypePref = patch.rateTypePref;
  if (patch.interestOnlyPref !== undefined) {
    const io = patch.interestOnlyPref.trim();
    out.interestOnlyPref =
      io === "Yes"
        ? "Yes — IO"
        : io === "No"
          ? "No"
          : io === "No preference"
            ? "No preference"
            : io;
  }
  if (patch.nonOccupantCoBorrower !== undefined)
    out.nonOccupantCoBorrower = patch.nonOccupantCoBorrower;
  if (patch.powerOfAttorney !== undefined) out.powerOfAttorney = patch.powerOfAttorney;
  if (patch.listingSeasoning !== undefined) out.listingSeasoning = patch.listingSeasoning;
  if (patch.scenarioNotes !== undefined) out.scenarioNotes = patch.scenarioNotes;
  return out;
}

/** Read current selection code for highlighting pills */
export function selectionCodeForCategory(
  categoryId: string,
  form: Record<string, unknown>,
): string | null {
  switch (categoryId) {
    case "property_condition":
      return String(form.propertyCondition || "") || null;
    case "acreage":
      return String(form.acreage || "").trim() ? "_filled" : null;
    case "non_occupant_co":
      return String(form.nonOccupantCoBorrower || "") || null;
    case "scenario_notes":
      return String(form.scenarioNotes || "").trim() ? "_filled" : null;
    default:
      return null;
  }
}

export { LOAN_TERM_SELECT_OPTIONS };
