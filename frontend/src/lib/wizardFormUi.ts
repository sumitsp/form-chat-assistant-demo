/**
 * Shared wizard-form styling constants + the US state list.
 *
 * Extracted from LoanWizard.tsx (Phase 0 of the frontend split) so the split-out
 * field components and the wizard itself share one source. Pure data/strings — no React.
 */

/** Wizard form fields — slightly smaller on phones */
export const WIZARD_FORM_LABEL =
  "text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs";
export const WIZARD_FORM_SECTION_TITLE =
  "mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs";
export const WIZARD_FORM_SECTION_DESC = "mb-3 text-[13px] font-medium text-foreground sm:text-sm";
export const WIZARD_FORM_SELECT =
  "flex h-8 w-full items-center justify-between rounded-md border border-input px-2.5 py-1.5 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:px-3 sm:py-2 sm:text-[13.5px]";
export const WIZARD_FORM_INPUT = "h-8 text-sm sm:h-9";
export const WIZARD_FORM_BTN = "h-9 min-w-0 flex-1 text-xs sm:h-10 sm:flex-none sm:text-sm";
export const WIZARD_FORM_CHIP =
  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors sm:px-3 sm:py-1.5 sm:text-[12px]";
/** Helper copy under selects — blurs with .ff when another dropdown is open */
export const WIZARD_FIELD_HINT = "ff-hint mt-1.5 text-[11px] leading-snug text-muted-foreground/70";
export const WIZARD_FF_GROUP = "ff-group";

export const STATES = [
  { code: "AL", label: "Alabama" },
  { code: "AK", label: "Alaska" },
  { code: "AZ", label: "Arizona" },
  { code: "AR", label: "Arkansas" },
  { code: "CA", label: "California" },
  { code: "CO", label: "Colorado" },
  { code: "CT", label: "Connecticut" },
  { code: "DE", label: "Delaware" },
  { code: "FL", label: "Florida" },
  { code: "GA", label: "Georgia" },
  { code: "HI", label: "Hawaii" },
  { code: "ID", label: "Idaho" },
  { code: "IL", label: "Illinois" },
  { code: "IN", label: "Indiana" },
  { code: "IA", label: "Iowa" },
  { code: "KS", label: "Kansas" },
  { code: "KY", label: "Kentucky" },
  { code: "LA", label: "Louisiana" },
  { code: "ME", label: "Maine" },
  { code: "MD", label: "Maryland" },
  { code: "MA", label: "Massachusetts" },
  { code: "MI", label: "Michigan" },
  { code: "MN", label: "Minnesota" },
  { code: "MS", label: "Mississippi" },
  { code: "MO", label: "Missouri" },
  { code: "MT", label: "Montana" },
  { code: "NE", label: "Nebraska" },
  { code: "NV", label: "Nevada" },
  { code: "NH", label: "New Hampshire" },
  { code: "NJ", label: "New Jersey" },
  { code: "NM", label: "New Mexico" },
  { code: "NY", label: "New York" },
  { code: "NC", label: "North Carolina" },
  { code: "ND", label: "North Dakota" },
  { code: "OH", label: "Ohio" },
  { code: "OK", label: "Oklahoma" },
  { code: "OR", label: "Oregon" },
  { code: "PA", label: "Pennsylvania" },
  { code: "RI", label: "Rhode Island" },
  { code: "SC", label: "South Carolina" },
  { code: "SD", label: "South Dakota" },
  { code: "TN", label: "Tennessee" },
  { code: "TX", label: "Texas" },
  { code: "UT", label: "Utah" },
  { code: "VT", label: "Vermont" },
  { code: "VA", label: "Virginia" },
  { code: "WA", label: "Washington" },
  { code: "WV", label: "West Virginia" },
  { code: "WI", label: "Wisconsin" },
  { code: "WY", label: "Wyoming" },
] as const;
