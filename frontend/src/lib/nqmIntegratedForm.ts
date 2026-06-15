/**
 * Helpers and option lists for the integrated NQM intake flow
 * (aligned with nqm_chatbot_integrated_flow.jsx).
 */

export type InvestmentPath = "" | "income" | "dscr";

/** Subset of wizard form state used by visibility / completion helpers */
export type IntegratedFormFields = {
  occupancy: string;
  propertyType: string;
  investmentIncomePath: InvestmentPath;
  citizenship: string;
  loanPurpose: string;
  valueSalesPrice: string;
  loanAmount: string;
  ltv: string;
  decisionCreditScore: string;
  firstTimeHomebuyer: string;
  firstTimeInvestor: string;
  establishedPrimaryRes: string;
  documentationType: string;
  estimatedDti: string;
  prepaymentTerms: string;
  dscr: string;
  rentalType: string;
  state: string;
  creditEventCategory: string;
  creditEventType: string;
  yearsSinceCreditEvent: string;
  existingFirstLien: string;
  cltv: string;
  paymentHistory: string;
  isSecondLien: string;
};

export const INTEGRATED_PROPERTY_TYPES = [
  { value: "single_family", label: "Single Family" },
  { value: "pud", label: "PUD" },
  { value: "townhouse", label: "Townhouse" },
  { value: "condo_warrantable", label: "Condominium (Warrantable)" },
  { value: "condo_non_warrantable", label: "Condominium (Non-Warrantable)" },
  { value: "condotel", label: "Condotel" },
  { value: "two_to_four_family", label: "Two to Four Family" },
  { value: "five_to_eight_unit", label: "Multi-Family (5-8 Unit)" },
  { value: "mixed_use", label: "Mixed-Use" },
  { value: "manufactured_home", label: "Manufactured Home" },
  { value: "cooperative", label: "Cooperative" },
] as const;

/** Canonical property_type codes stored on the form and sent to the eligibility API. */
export const CANONICAL_PROPERTY_TYPE_CODES = INTEGRATED_PROPERTY_TYPES.map((p) => p.value);

export const LOAN_PURPOSE_INTEGRATED = [
  { value: "Purchase", label: "Purchase" },
  { value: "Refinance", label: "Rate & Term Refinance" },
  { value: "Cash-Out Refinance", label: "Cash-Out Refinance" },
] as const;

/** Canonical `ltv_matrix.doc_type` / `programs.doc_types_allowed` values (MySQL ENUM). */
/** Virtual eligibility code: matches matrix/program `bank_stmt_12` or `bank_stmt_24`. */
export const BANK_STMT_COMBINED_CODE = "bank_stmt_12_or_24";
export const BANK_STMT_COMBINED_LABEL = "Bank Statements (12 or 24 Months)";
export const BANK_STMT_BUSINESS_CODE = "bank_stmt_business";
export const BANK_STMT_BUSINESS_LABEL = "Bank Statements (Business)";
export const PL_ONLY_LABEL = "P&L Only";
export const PL_2MO_BS_LABEL = "P&L with 2 month Bank Statement";

export const CANONICAL_DOC_TYPES = [
  "full_doc",
  "bank_stmt_12",
  "bank_stmt_24",
  BANK_STMT_COMBINED_CODE,
  BANK_STMT_BUSINESS_CODE,
  "pl_only",
  "pl_2mo_bs",
  "asset_util",
  "asset_qualifier",
  "1099",
  "wvoe",
  "dscr_rental",
] as const;

export type CanonicalDocType = (typeof CANONICAL_DOC_TYPES)[number];

/** UI label → backend doc_type code (sent as `documentationType` on eligibility API). */
export const DOC_TYPE_OPTIONS = [
  { label: "Full Documentation", code: "full_doc" },
  { label: BANK_STMT_COMBINED_LABEL, code: BANK_STMT_COMBINED_CODE },
  { label: BANK_STMT_BUSINESS_LABEL, code: BANK_STMT_BUSINESS_CODE },
  { label: PL_ONLY_LABEL, code: "pl_only" },
  { label: PL_2MO_BS_LABEL, code: "pl_2mo_bs" },
  { label: "Asset Utilization", code: "asset_util" },
  { label: "Asset Qualifier", code: "asset_qualifier" },
  { label: "1099", code: "1099" },
  { label: "WVOE Only", code: "wvoe" },
] as const;

/** Full doc-type list shown when a program allows all documentation types (`any`). */
export const ALL_DOC_TYPES_DISPLAY_LABELS = [
  "Full Documentation",
  BANK_STMT_COMBINED_LABEL,
  BANK_STMT_BUSINESS_LABEL,
  PL_ONLY_LABEL,
  PL_2MO_BS_LABEL,
  "Asset Utilization",
  "Asset Qualifier",
  "1099",
  "WVOE Only",
  "Rental Income",
  "ITIN",
  "Alternative Documentation",
] as const;

export function allDocTypesDisplayLabel(): string {
  return ALL_DOC_TYPES_DISPLAY_LABELS.join(", ");
}

/** Product names for eligibility table (prefers API `products` array). */
export function parseProductsList(
  products?: string[] | null,
  productsAvailable?: string | null,
): string[] {
  if (products?.length) {
    return products.map((p) => p.trim()).filter(Boolean);
  }
  const raw = (productsAvailable || "").trim();
  if (!raw || raw === "—") return [];
  return raw
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Comma-separated product labels for the eligibility table. */
export function formatProductsCommaSeparated(
  products?: string[] | null,
  productsAvailable?: string | null,
  formatName: (name: string) => string = formatMortgageAcronyms,
): string {
  const items = parseProductsList(products, productsAvailable);
  if (items.length === 0) return "";
  return items.map((name) => formatName(name)).join(", ");
}

export const LOAN_TERM_SELECT_OPTIONS = [
  { value: "10", label: "10 years" },
  { value: "15", label: "15 years" },
  { value: "20", label: "20 years" },
  { value: "25", label: "25 years" },
  { value: "30", label: "30 years" },
  { value: "40", label: "40 years" },
] as const;

/** Parse stored loan term (single or comma-separated multi-select). */
export function parseLoanTermSelection(value: string): number[] {
  const raw = (value || "").trim();
  if (!raw || raw.toLowerCase() === "no preference") return [];
  const terms: number[] = [];
  for (const part of raw.split(/[,|]/)) {
    const n = parseInt(part.trim(), 10);
    if (!Number.isNaN(n)) terms.push(n);
  }
  return [...new Set(terms)].sort((a, b) => a - b);
}

export function formatLoanTermStorage(terms: number[]): string {
  if (terms.length === 0) return "No preference";
  return terms.join(",");
}

export function formatLoanTermDisplay(value: string): string {
  const terms = parseLoanTermSelection(value);
  if (terms.length === 0) return "No preference";
  return terms.map((t) => `${t} yr`).join(", ");
}

export type ProductDisplayPrefs = {
  loanTerms?: number[];
  isFthb?: boolean;
  interestOnly?: boolean | null;
  rateType?: "fixed" | "arm" | null;
};

function productMatchesTerm(name: string, term: number): boolean {
  const n = name.toLowerCase();
  const re = new RegExp(`\\b${term}\\b`);
  if (re.test(n) && (/year|yr|fixed|arm|sofr|term/i.test(n) || /\d+\s*\/\s*\d+/.test(n))) {
    return true;
  }
  // Hybrid SOFR ARMs (e.g. 5/6, 7/6) are 30-year amortization but omit "30" in the label.
  if (term === 30 && /\d+\s*\/\s*\d+/.test(n) && /arm|sofr/i.test(n)) {
    return true;
  }
  return false;
}

/** Client-side filter when API rows still list all products (e.g. cached session). */
export function productPrefsAreActive(prefs?: ProductDisplayPrefs): boolean {
  return (
    (prefs?.loanTerms?.length ?? 0) > 0 ||
    prefs?.interestOnly != null ||
    prefs?.rateType != null ||
    prefs?.isFthb === true
  );
}

/** Names that match scenario prefs (API `products_matching` when present). */
export function buildPreferredProductSet(
  products?: string[] | null,
  productsAvailable?: string | null,
  productsMatching?: string[] | null,
  prefs?: ProductDisplayPrefs,
): Set<string> {
  const fromApi = (productsMatching ?? [])
    .map((n) => formatMortgageAcronyms(n.trim()))
    .filter(Boolean);
  if (fromApi.length > 0) {
    return new Set(fromApi);
  }
  const all = parseProductsList(products, productsAvailable).map((n) => formatMortgageAcronyms(n));
  if (!productPrefsAreActive(prefs)) {
    return new Set(all);
  }
  return new Set(
    filterProductsByPrefs(products, productsAvailable, prefs).map((n) => formatMortgageAcronyms(n)),
  );
}

export function shouldStyleProductMismatch(
  productsMatching?: string[] | null,
  prefs?: ProductDisplayPrefs,
): boolean {
  if ((productsMatching ?? []).length > 0) return true;
  return productPrefsAreActive(prefs);
}

export function filterProductsByPrefs(
  products?: string[] | null,
  productsAvailable?: string | null,
  prefs?: ProductDisplayPrefs,
): string[] {
  let items = parseProductsList(products, productsAvailable);
  if (!prefs || items.length === 0) return items;

  if (prefs.loanTerms?.length) {
    items = items.filter((name) => prefs.loanTerms!.some((term) => productMatchesTerm(name, term)));
  }
  if (prefs.interestOnly === true) {
    items = items.filter((name) => /interest[- ]?only/i.test(name));
  } else if (prefs.interestOnly === false) {
    items = items.filter((name) => !/interest[- ]?only/i.test(name));
  }
  if (prefs.rateType === "fixed") {
    items = items.filter((name) => /fixed/i.test(name) && !/arm|sofr/i.test(name));
  } else if (prefs.rateType === "arm") {
    items = items.filter((name) => /arm|sofr|\d+\s*\/\s*\d+/i.test(name));
  }
  return items;
}

export function formatProductsForScenario(
  products?: string[] | null,
  productsAvailable?: string | null,
  prefs?: ProductDisplayPrefs,
  formatName: (name: string) => string = formatMortgageAcronyms,
): string {
  const items = filterProductsByPrefs(products, productsAvailable, prefs);
  if (items.length === 0) return "";
  return items.map((name) => formatName(name)).join(" · ");
}

export const RATE_TYPE_PREF_OPTIONS = ["No Preference", "Fixed", "Adjustable-Rate"] as const;

/** Map UI rate-type preference to product filter (fixed / ARM). */
export function rateTypePrefToFilter(rateTypePref?: string): "fixed" | "arm" | null {
  const rate = (rateTypePref ?? "").trim().toLowerCase();
  if (!rate || rate === "no preference") return null;
  if (rate.includes("adjustable") || rate.includes("arm")) return "arm";
  if (rate.includes("flat") || rate.includes("fixed")) return "fixed";
  return null;
}

export function productDisplayPrefsFromForm(form: {
  loanTerm?: string;
  firstTimeHomebuyer?: string;
  interestOnlyPref?: string;
  rateTypePref?: string;
}): ProductDisplayPrefs {
  const loanTerms = parseLoanTermSelection(form.loanTerm ?? "");
  const io = (form.interestOnlyPref ?? "").trim().toLowerCase();
  return {
    loanTerms: loanTerms.length ? loanTerms : undefined,
    isFthb: (form.firstTimeHomebuyer ?? "").trim().toLowerCase() === "yes",
    interestOnly: io === "yes" ? true : io === "no" ? false : null,
    rateType: rateTypePrefToFilter(form.rateTypePref),
  };
}

/** Dropdown labels (form state uses label; API uses `mapDocumentationForApi`). */
export const DOC_TYPES_INTEGRATED = DOC_TYPE_OPTIONS.map((o) => o.label);

export const PAYMENT_HISTORY_OPTIONS = [
  { value: "0x30", label: "0×30×12 — No lates in 12 months" },
  { value: "1x30", label: "1×30×12 — One 30-day late" },
  { value: "0x60", label: "0×60×12 — One 30-day late but no 60s" },
  { value: "1x60", label: "1×60×12 — One 60-day late" },
  { value: "1x120", label: "1×120×12 — Recent major late" },
] as const;

export const YES_NO_OPTIONS = ["Yes", "No"] as const;

export const ENTITY_VESTING_OPTIONS = ["Individual", "LLC / Entity"] as const;

export const SECOND_LIEN_NO_LABEL = "No - First Lien Only";
export const SECOND_LIEN_YES_LABEL = "Yes - Second Lien/Piggyback";
export const LIEN_POSITION_FIRST = "first_lien";
export const LIEN_POSITION_SECOND = "second_lien";
export const LIEN_POSITION_PIGGYBACK = "second_lien_piggyback";
export const LIEN_POSITION_OPTIONS = [
  { value: LIEN_POSITION_FIRST, label: "First Lien" },
  { value: LIEN_POSITION_SECOND, label: "Second Lien (Standalone)" },
  { value: LIEN_POSITION_PIGGYBACK, label: "Second Lien (Piggyback)" },
] as const;

/** Rate & term or cash-out refi (chat stores `Refinance`; legacy saves may use the long label). */
export function isRefiOrCashOutLoanPurpose(loanPurpose: string): boolean {
  const lp = loanPurpose.trim();
  return lp === "Refinance" || lp === "Rate & Term Refinance" || lp === "Cash-Out Refinance";
}

/** Step 5 / conditions gate — listing seasoning must be collected. */
export function listingSeasoningRequired(form: {
  loanPurpose?: string;
  primaryLoanPurpose?: string;
  lienPosition?: string;
}): boolean {
  const purpose = (form.loanPurpose ?? form.primaryLoanPurpose ?? "").trim();
  if (!purpose) return false;
  return purpose !== "Purchase";
}

/** LO guided-chat: default UW-only Step 5 fields before submit / completion gates. */
export function formChatConditionsDefaults(form: {
  powerOfAttorney?: string;
  nonArmsLength?: string;
}): { powerOfAttorney?: string; nonArmsLength?: string } {
  const patch: { powerOfAttorney?: string; nonArmsLength?: string } = {};
  if (!String(form.powerOfAttorney ?? "").trim()) patch.powerOfAttorney = "No";
  if (!String(form.nonArmsLength ?? "").trim()) patch.nonArmsLength = "No";
  return patch;
}

/** Guided /form chat — listing seasoning + departing rent only (POA / non-arm's are UW-only). */
export function isFormChatConditionsComplete(form: {
  listingSeasoning?: string;
  departingResidence?: string;
  departingRent?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
  lienPosition?: string;
}): boolean {
  return (
    (!listingSeasoningRequired(form) || !!String(form.listingSeasoning ?? "").trim()) &&
    !(form.departingResidence === "Yes" && !String(form.departingRent ?? "").trim())
  );
}

/** Conditions (Step 5) completion — POA, non-arm's-length, listing seasoning, departing rent. */
export function isConditionsStepComplete(form: {
  powerOfAttorney?: string;
  nonArmsLength?: string;
  listingSeasoning?: string;
  departingResidence?: string;
  departingRent?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
  lienPosition?: string;
}): boolean {
  return (
    !!String(form.powerOfAttorney ?? "").trim() &&
    !!String(form.nonArmsLength ?? "").trim() &&
    (!listingSeasoningRequired(form) || !!String(form.listingSeasoning ?? "").trim()) &&
    !(
      form.departingResidence === "Keeping & renting it out" &&
      !String(form.departingRent ?? "").trim()
    )
  );
}

/** Credit event category options with display labels. */
export const CREDIT_EVENT_CATEGORY_OPTIONS = [
  { value: "None", label: "None" },
  { value: "BK", label: "Bankruptcy (Ch 7 / 11 / 13)" },
  { value: "FC", label: "Foreclosure" },
  { value: "SS", label: "Short Sale" },
  { value: "DIL", label: "Deed-in-Lieu" },
  { value: "Pre-FC", label: "Pre-Foreclosure" },
  { value: "Charge-Off", label: "Mortgage Charge-Off" },
  { value: "NOD", label: "Notice of Default" },
  { value: "Mod", label: "Loan Modification" },
  { value: "Forbearance", label: "Forbearance" },
  { value: "Deferral", label: "Deferral" },
] as const;

export const CITIZENSHIP_OPTIONS = [
  "US Citizen",
  "Foreign National",
  "Permanent Resident Alien",
  "Non-Permanent Resident Alien",
  "ITIN",
  "DACA",
] as const;

export const INVESTMENT_INCOME_TYPE_OPTIONS = [
  { value: "income", label: "Personal income (documentation)" },
  { value: "dscr", label: "DSCR / rental income" },
] as const;

/** Primary / Second Home always qualify on personal income — shown in sidebar, not asked in chat. */
export const OWNER_OCCUPIED_INCOME_PATH_LABEL = "Personal income (documentation)";

export function isOwnerOccupiedOccupancy(occupancy: string | undefined): boolean {
  return occupancy === "Primary Residence" || occupancy === "Second Home";
}

/** Canonical loan purpose (primaryLoanPurpose wins when both are set). */
export function effectivePrimaryLoanPurpose(form: {
  loanPurpose?: string;
  primaryLoanPurpose?: string;
}): string {
  return (form.primaryLoanPurpose || form.loanPurpose || "").trim();
}

export function isPurchaseLoanPurpose(form: {
  loanPurpose?: string;
  primaryLoanPurpose?: string;
}): boolean {
  return effectivePrimaryLoanPurpose(form) === "Purchase";
}

/** Primary / Second Home + Purchase — ask FTHB in LO and UW. */
export function shouldAskFirstTimeHomebuyer(form: {
  occupancy?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
}): boolean {
  return isOwnerOccupiedOccupancy(form.occupancy) && isPurchaseLoanPurpose(form);
}

/** Primary / Second Home + R&T or Cash-Out — auto No, do not ask. */
export function shouldHardcodeFirstTimeHomebuyerNo(form: {
  occupancy?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
}): boolean {
  return (
    isOwnerOccupiedOccupancy(form.occupancy) &&
    isRefiOrCashOutLoanPurpose(effectivePrimaryLoanPurpose(form))
  );
}

export function isInvestmentOccupancy(occupancy?: string): boolean {
  return occupancy === "Investment Property";
}

/** Investment + Purchase — ask first-time investor in LO and UW. */
export function shouldAskFirstTimeInvestor(form: {
  occupancy?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
}): boolean {
  return isInvestmentOccupancy(form.occupancy) && isPurchaseLoanPurpose(form);
}

/** Investment + R&T or Cash-Out — auto No, do not ask. */
export function shouldHardcodeFirstTimeInvestorNo(form: {
  occupancy?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
}): boolean {
  return (
    isInvestmentOccupancy(form.occupancy) &&
    isRefiOrCashOutLoanPurpose(effectivePrimaryLoanPurpose(form))
  );
}

/** Owner-occupied income path — after credit score + FTHB resolved (answered or refi No). */
export function shouldShowOwnerOccupiedIncomePathSidebar(form: {
  occupancy?: string;
  decisionCreditScore?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
  firstTimeHomebuyer?: string;
}): boolean {
  if (!isOwnerOccupiedOccupancy(form.occupancy)) return false;
  if (!String(form.decisionCreditScore ?? "").trim()) return false;
  if (shouldHardcodeFirstTimeHomebuyerNo(form)) {
    return !!effectivePrimaryLoanPurpose(form);
  }
  if (shouldAskFirstTimeHomebuyer(form)) {
    return !!String(form.firstTimeHomebuyer ?? "").trim();
  }
  return false;
}

/** Form fields whose edits can apply or remove FTHB / FTI hardcoding. */
export const SCENARIO_FIRST_TIME_TRIGGER_FIELDS = new Set([
  "occupancy",
  "loanPurpose",
  "primaryLoanPurpose",
  "lienPosition",
]);

/** @deprecated use SCENARIO_FIRST_TIME_TRIGGER_FIELDS */
export const SCENARIO_FTHB_TRIGGER_FIELDS = SCENARIO_FIRST_TIME_TRIGGER_FIELDS;

/**
 * After occupancy or loan purpose changes, clear stale FTHB when refi/cash-out or
 * leaving owner-occupied purchase. Refi does not store a value — eligibility defaults to no.
 */
export function patchFirstTimeHomebuyerForScenario(form: {
  occupancy?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
  firstTimeHomebuyer?: string;
}): { firstTimeHomebuyer: string } | null {
  const cur = String(form.firstTimeHomebuyer ?? "").trim();
  if (shouldHardcodeFirstTimeHomebuyerNo(form)) {
    return cur ? { firstTimeHomebuyer: "" } : null;
  }
  if (shouldAskFirstTimeHomebuyer(form)) {
    return null;
  }
  if (cur) return { firstTimeHomebuyer: "" };
  return null;
}

/**
 * Same as FTHB — investment refi/cash-out is N/A; clear stale FTI, do not store No.
 */
export function patchFirstTimeInvestorForScenario(form: {
  occupancy?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
  firstTimeInvestor?: string;
}): { firstTimeInvestor: string } | null {
  const cur = String(form.firstTimeInvestor ?? "").trim();
  if (shouldHardcodeFirstTimeInvestorNo(form)) {
    return cur ? { firstTimeInvestor: "" } : null;
  }
  if (shouldAskFirstTimeInvestor(form)) {
    return null;
  }
  if (cur) return { firstTimeInvestor: "" };
  return null;
}

/** Apply or remove FTHB + FTI hardcoding after occupancy / purpose change. */
export function patchScenarioFirstTimeFields(form: {
  occupancy?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
  firstTimeHomebuyer?: string;
  firstTimeInvestor?: string;
}): Partial<{ firstTimeHomebuyer: string; firstTimeInvestor: string }> | null {
  const out: Partial<{ firstTimeHomebuyer: string; firstTimeInvestor: string }> = {};
  const fthb = patchFirstTimeHomebuyerForScenario(form);
  const fti = patchFirstTimeInvestorForScenario(form);
  if (fthb) Object.assign(out, fthb);
  if (fti) Object.assign(out, fti);
  return Object.keys(out).length ? out : null;
}

export const CROSS_COLLATERAL_PROPERTY_CODE = "multiple_properties";

/**
 * v3 compatibility layer:
 * converts legacy/demo values into the canonical values used by the wizard + API payload.
 */
export function mapV3OccupancyToCanonical(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return "";
  if (v === "primary") return "Primary Residence";
  if (v === "second_home") return "Second Home";
  if (v === "investment") return "Investment Property";
  return value;
}

export function mapV3LoanPurposeToCanonical(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return "";
  if (v === "purchase") return "Purchase";
  if (v === "rate_term" || v === "rate_and_term") return "Refinance";
  if (v === "cash_out") return "Cash-Out Refinance";
  return value;
}

export function mapV3CitizenshipToCanonical(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return "";
  if (v === "us_citizen") return "US Citizen";
  if (v === "foreign_national") return "Foreign National";
  if (v === "non_permanent_resident") return "Non-Permanent Resident Alien";
  if (v === "permanent_resident") return "Permanent Resident Alien";
  if (v === "itin") return "ITIN";
  if (v === "daca") return "DACA";
  return value;
}

export function mapV3PropertyTypeToCanonical(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return "";
  if (v === "five_to_nine_unit") return "five_to_eight_unit";
  if (v === "co_op") return "cooperative";
  return value;
}

export function mapV3LienPositionToIsSecondLien(value: string): "" | "yes" | "no" {
  const v = value.trim().toLowerCase();
  if (!v) return "";
  if (v === "first" || v === LIEN_POSITION_FIRST) return "no";
  if (
    v === "second" ||
    v === "piggyback" ||
    v === LIEN_POSITION_SECOND ||
    v === LIEN_POSITION_PIGGYBACK
  ) {
    return "yes";
  }
  return "";
}

/** Mortgage / entity abbreviations shown in ALL CAPS (word-boundary match). */
const ABBREV_UPPER_WORDS = new Set([
  "us",
  "daca",
  "itin",
  "llc",
  "llp",
  "lp",
  "inc",
  "corp",
  "ltd",
  "dscr",
  "dti",
  "ltv",
  "cltv",
  "fico",
  "pitia",
  "atr",
  "nqm",
  "npr",
  "fthb",
  "pud",
  "wvoe",
  "woe",
  "hoa",
  "heloc",
  "arm",
  "io",
  "bk",
  "fc",
  "ss",
  "dil",
  "va",
  "fha",
  "usda",
  "fnma",
  "fhlmc",
  "gnma",
  "cb",
]);

const PL_TOKEN = "\uE000PL\uE001";

function preservePL(text: string): string {
  return text.replace(/\bP&L\b/gi, PL_TOKEN);
}

function restorePL(text: string): string {
  return text.replaceAll(PL_TOKEN, "P&L");
}

/** Known abbreviation casing (Mod is title-case for credit-event label). */
function formatAbbrevWord(low: string): string | null {
  if (low === "mod") return "Mod";
  if (!ABBREV_UPPER_WORDS.has(low)) return null;
  if (low === "us") return "US";
  return low.toUpperCase();
}

/** Uppercase known abbreviations only; leaves other words unchanged (program names, chat). */
export function formatMortgageAcronyms(text: string): string {
  if (!text?.trim()) return text;
  let out = preservePL(text);
  out = out.replace(/\b([a-zA-Z][a-zA-Z0-9']*)\b/g, (word) => {
    const ab = formatAbbrevWord(word.toLowerCase());
    return ab ?? word;
  });
  return restorePL(out);
}

const VERBATIM_DISPLAY_LABELS = new Set<string>([
  ...DOC_TYPE_OPTIONS.map((o) => o.label),
  ...INTEGRATED_PROPERTY_TYPES.map((p) => p.label),
  ...LOAN_PURPOSE_INTEGRATED.map((p) => p.label),
  ...INVESTMENT_INCOME_TYPE_OPTIONS.map((o) => o.label),
  ...CREDIT_EVENT_CATEGORY_OPTIONS.map((o) => o.label),
  ...PAYMENT_HISTORY_OPTIONS.map((o) => o.label),
  ...CITIZENSHIP_OPTIONS,
  ...ENTITY_VESTING_OPTIONS,
  SECOND_LIEN_NO_LABEL,
  SECOND_LIEN_YES_LABEL,
  ...YES_NO_OPTIONS,
]);

/** Title-case dropdown / field labels; preserves US, LLC, DSCR, P&L, BK/FC/SS/DIL/Mod, state codes. */
export function formatSelectDisplayLabel(text: string): string {
  if (!text?.trim()) return text;
  const trimmed = text.trim();
  if (VERBATIM_DISPLAY_LABELS.has(trimmed)) return trimmed;

  const stateLine = trimmed.match(/^([A-Za-z]{2})\s*-\s*(.+)$/);
  if (stateLine) {
    const code = stateLine[1].toUpperCase();
    const name = titleCaseWords(stateLine[2]);
    return `${code} - ${name}`;
  }

  let out = preservePL(trimmed);
  out = out.replace(/\b([a-zA-Z][a-zA-Z0-9']*)\b/g, (word) => {
    const ab = formatAbbrevWord(word.toLowerCase());
    if (ab) return ab;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
  return restorePL(out);
}

function titleCaseWords(text: string): string {
  return restorePL(
    preservePL(text).replace(/\b([a-zA-Z][a-zA-Z0-9']*)\b/g, (word) => {
      const ab = formatAbbrevWord(word.toLowerCase());
      if (ab) return ab;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }),
  );
}

export function incomeTypeDisplayLabel(path: InvestmentPath | string): string {
  const row = INVESTMENT_INCOME_TYPE_OPTIONS.find((o) => o.value === path);
  return row ? formatSelectDisplayLabel(row.label) : "";
}

export function isFiveEightProperty(pt: string): boolean {
  const x = pt.trim().toLowerCase();
  return x === "five_to_eight_unit" || x.includes("5-9") || x.includes("5-8");
}

export function isDscrPathScenario(
  f: Pick<IntegratedFormFields, "occupancy" | "propertyType" | "investmentIncomePath">,
): boolean {
  if (f.occupancy !== "Investment Property") return false;
  return isFiveEightProperty(f.propertyType) || f.investmentIncomePath === "dscr";
}

/** Housing history is collected for every scenario (all occupancies and property types). */
export function shouldShowPaymentHistory(
  _estimatedDti?: string,
  _documentationType?: string,
  _occupancy?: string,
): boolean {
  return true;
}

export function shouldShowEstablishedPrimaryRes(
  occupancy: string,
  firstTimeHomebuyer: string,
  firstTimeInvestor: string,
): boolean {
  if (occupancy !== "Investment Property") return false;
  return firstTimeHomebuyer === "Yes" || firstTimeInvestor === "Yes";
}

export function shouldShowSecondLienFields(isSecondLien: string): boolean {
  return isSecondLien === "yes";
}

/** Form/sidebar label for `loanAmount` (piggyback stores the new lien amount in this field). */
export function loanAmountFieldLabel(_isSecondLien?: string): string {
  return "Loan Amount";
}

export const EXISTING_SECOND_LIEN_NONE = "None";
export const EXISTING_SECOND_LIEN_SUBORDINATION = "Yes — needs subordination";
export const EXISTING_SECOND_LIEN_PAID_OFF = "Yes — being paid off in this transaction";

export const EXISTING_SECOND_LIEN_OPTIONS = [
  EXISTING_SECOND_LIEN_NONE,
  EXISTING_SECOND_LIEN_SUBORDINATION,
  EXISTING_SECOND_LIEN_PAID_OFF,
] as const;

/** Retained 2nd lien that stays on title and must subordinate to the new 1st. */
export function existingSecondLienNeedsSubordination(existingSecondLien: string): boolean {
  return existingSecondLien === EXISTING_SECOND_LIEN_SUBORDINATION;
}

/** Piggyback or subordinating 2nd — show separate LTV (new lien) and CLTV (combined). */
export function usesCltvLeverageField(isSecondLien: string, existingSecondLien: string): boolean {
  return (
    shouldShowSecondLienFields(isSecondLien) ||
    existingSecondLienNeedsSubordination(existingSecondLien)
  );
}

/** Value / loan / leverage row appears after lien follow-ups are satisfied. */
export function valueLoanGridReady(
  isSecondLien: string,
  existingSecondLien: string,
  filled: {
    existingFirstLien: boolean;
    existingSecondLien: boolean;
    existingSecondLienBalance: boolean;
  },
): boolean {
  if (shouldShowSecondLienFields(isSecondLien)) {
    return filled.existingFirstLien;
  }
  if (!filled.existingSecondLien) return false;
  if (!existingSecondLien || existingSecondLien === EXISTING_SECOND_LIEN_NONE) return true;
  if (existingSecondLienNeedsSubordination(existingSecondLien)) {
    return filled.existingSecondLienBalance;
  }
  return true;
}

export function shouldShowCltv(f: IntegratedFormFields): boolean {
  const efl = parseFloat(String(f.existingFirstLien).replace(/[^0-9.]/g, "")) || 0;
  const hasFirstLien = efl > 0;
  const isNotDscr = !isDscrPathScenario(f);
  const isOwnerOccupied = f.occupancy === "Primary Residence" || f.occupancy === "Second Home";
  return hasFirstLien && isOwnerOccupied && isNotDscr;
}

/** Map documentation UI label (or code) → eligibility `documentationType` / matrix doc_type. */
export function mapDocumentationForApi(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return t;
  const norm = t.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
  if (norm === "any") return "";
  const legacyLabels: Record<string, string> = {
    "Bank Statements (12 or 24)": BANK_STMT_COMBINED_CODE,
    "Profit and Loss": "pl_only",
    "P&L with 2-Month Bank Statements": "pl_2mo_bs",
    "P&L with 2 month Bank Statement": "pl_2mo_bs",
  };
  if (legacyLabels[t]) return legacyLabels[t];
  const byLabel = DOC_TYPE_OPTIONS.find((o) => o.label === t);
  if (byLabel) return byLabel.code;
  const byCode = DOC_TYPE_OPTIONS.find((o) => o.code === t);
  if (byCode) return byCode.code;
  if ((CANONICAL_DOC_TYPES as readonly string[]).includes(norm)) return norm;
  return t;
}

/** Display labels for matrix / program codes not in the intake dropdown. */
const DOC_TYPE_DISPLAY_OVERRIDES: Record<string, string> = {
  bank_stmt_12_or_24: BANK_STMT_COMBINED_LABEL,
  bank_stmt_12: BANK_STMT_COMBINED_LABEL,
  bank_stmt_24: BANK_STMT_COMBINED_LABEL,
  bank_stmt_business: BANK_STMT_BUSINESS_LABEL,
  dscr_rental: "Rental Income",
  dscr: "Rental Income",
  itin: "ITIN",
  non_traditional: "Alternative Documentation",
  any: "Any",
};

const BANK_STMT_MATRIX_CODES = new Set(["bank_stmt_12", "bank_stmt_24", BANK_STMT_COMBINED_CODE]);

function collapseBankStatementParts(parts: string[]): string[] {
  const norms = parts.map((p) => normalizeDocTypeCode(p));
  const hasBank = norms.some((n) => BANK_STMT_MATRIX_CODES.has(n));
  if (!hasBank) return parts;
  const rest = parts.filter((p) => !BANK_STMT_MATRIX_CODES.has(normalizeDocTypeCode(p)));
  return [...rest, BANK_STMT_COMBINED_CODE];
}

function normalizeDocTypeCode(raw: string): string {
  return raw.trim().toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
}

/** One backend doc_type code → UI label for tables. */
export function docTypeLabelFromCode(code: string): string {
  const t = (code || "").trim();
  if (!t) return "";
  const exactLabel = DOC_TYPE_OPTIONS.find((o) => o.label === t);
  if (exactLabel) return exactLabel.label;
  const norm = normalizeDocTypeCode(t);
  if (DOC_TYPE_DISPLAY_OVERRIDES[norm]) return DOC_TYPE_DISPLAY_OVERRIDES[norm];
  const opt = DOC_TYPE_OPTIONS.find((o) => o.code === norm);
  if (opt) return opt.label;
  if (norm.includes("_")) return formatSelectDisplayLabel(t.replace(/_/g, " "));
  return t;
}

/**
 * Format programs.doc_types_allowed for the eligibility table:
 * accepts JSON array, comma-separated codes, or pre-formatted text.
 */
export function formatDocTypesAllowedForDisplay(raw: string | null | undefined): string {
  if (!raw?.trim()) return "—";
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "any") return allDocTypesDisplayLabel();

  let parts: string[] = [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      parts = parsed.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {
    parts = trimmed
      .split(/\s*,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (parts.length === 0) return trimmed;

  const collapsed = collapseBankStatementParts(parts);
  const norms = collapsed.map((p) => normalizeDocTypeCode(p));
  if (norms.includes("any")) return allDocTypesDisplayLabel();

  const labels = [...new Set(collapsed.map((p) => docTypeLabelFromCode(p)).filter(Boolean))];
  return labels.length > 0 ? labels.join(", ") : trimmed;
}

export function creditEventTypesForCategory(category: string): string[] {
  switch (category) {
    case "BK":
      return ["Ch. 7 discharged", "Ch. 13 discharged", "Ch. 13 dismissed"];
    case "FC":
      return ["Foreclosure"];
    case "SS":
      return ["Short sale"];
    case "DIL":
      return ["Deed-in-lieu"];
    case "Mod":
      return ["Loan modification"];
    case "Pre-FC":
      return ["Pre-foreclosure"];
    case "Charge-Off":
      return ["Mortgage charge-off"];
    case "NOD":
      return ["Notice of default"];
    case "Forbearance":
      return ["Forbearance"];
    case "Deferral":
      return ["Deferral"];
    default:
      return [];
  }
}

export function parseMoneyNum(v: string): number {
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function formatMoneyInt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return Math.round(n).toLocaleString("en-US");
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n * 100) / 100);
}

/** LTV shown in the integrated wizard: whole percent, 1–100 inclusive. */
export function formatLtvInt1To100(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const i = Math.min(100, Math.max(1, Math.round(n)));
  return String(i);
}

/** LTV/CLTV caps and borrower leverage — whole % for display and gates (e.g. 89.99 → 90). */
export function roundLeveragePercent(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n));
}

export function formatLeveragePercentDisplay(n: number | null | undefined): string | undefined {
  const r = roundLeveragePercent(n);
  return r != null ? `${r}%` : undefined;
}

export type ValueTriSource = "valueSalesPrice" | "loanAmount" | "ltv";

/**
 * Integrated-flow triangulation: property value is user-controlled only.
 * Changing value → updates LTV from loan/value, or loan from value×LTV if loan is empty.
 * Changing loan → updates LTV from loan/value (never property value).
 * Changing LTV → updates loan from value×LTV (never property value).
 */
export function triangulateLoanFields(
  prev: Pick<IntegratedFormFields, "valueSalesPrice" | "loanAmount" | "ltv">,
  source: ValueTriSource,
  rawValue: string,
): { valueSalesPrice: string; loanAmount: string; ltv: string } {
  const next = { ...prev, [source]: rawValue } as {
    valueSalesPrice: string;
    loanAmount: string;
    ltv: string;
  };
  const pv = parseMoneyNum(next.valueSalesPrice);
  const la = parseMoneyNum(next.loanAmount);
  const ltv = parseMoneyNum(next.ltv);

  if (source === "valueSalesPrice") {
    if (pv > 0 && la > 0) {
      next.ltv = formatLtvInt1To100((la / pv) * 100);
    } else if (pv > 0 && ltv > 0 && !(la > 0)) {
      const ltvUse = Math.min(100, Math.max(1, Math.round(ltv)));
      next.loanAmount = formatMoneyInt(pv * (ltvUse / 100));
      next.ltv = String(ltvUse);
    }
  } else if (source === "loanAmount") {
    if (la > 0 && pv > 0) {
      next.ltv = formatLtvInt1To100((la / pv) * 100);
    }
  } else if (source === "ltv") {
    if (ltv > 0 && pv > 0) {
      const ltvUse = Math.min(100, Math.max(1, Math.round(ltv)));
      next.loanAmount = formatMoneyInt(pv * (ltvUse / 100));
      next.ltv = String(ltvUse);
    } else if (ltv > 0) {
      next.ltv = formatLtvInt1To100(ltv);
    }
  }

  // Only reformat fields that were updated — never touch property value when editing LTV/loan.
  if (source === "valueSalesPrice") {
    next.valueSalesPrice = formatMoneyInt(parseMoneyNum(next.valueSalesPrice));
    next.loanAmount = formatMoneyInt(parseMoneyNum(next.loanAmount));
  } else if (source === "loanAmount") {
    next.loanAmount = formatMoneyInt(parseMoneyNum(next.loanAmount));
    if (parseMoneyNum(next.ltv) > 0) {
      next.ltv = formatLtvInt1To100(parseMoneyNum(next.ltv));
    }
  } else if (source === "ltv") {
    if (parseMoneyNum(next.loanAmount) > 0) {
      next.loanAmount = formatMoneyInt(parseMoneyNum(next.loanAmount));
    }
    if (parseMoneyNum(next.ltv) > 0) {
      next.ltv = formatLtvInt1To100(parseMoneyNum(next.ltv));
    }
  }

  return next;
}

export function formatMoneyForInput(raw: string): string {
  return formatMoneyInt(parseMoneyNum(raw));
}

/** Profile sidebar / summary: leading $ plus comma-separated whole dollars. */
export function formatMoneyDisplay(raw: string): string {
  const formatted = formatMoneyForInput(raw);
  return formatted ? `$${formatted}` : "";
}

/** LTV on the new lien only (loan ÷ value). */
export function computeLtvPercent(loanAmount: string, valueSalesPrice: string): string {
  const la = parseMoneyNum(loanAmount);
  const pv = parseMoneyNum(valueSalesPrice);
  if (la > 0 && pv > 0) return formatLtvInt1To100((la / pv) * 100);
  return "";
}

/** Combined CLTV when another lien balance stays on title. */
export function computeCltvPercent(
  otherLienBalance: string,
  loanAmount: string,
  valueSalesPrice: string,
): string {
  const other = parseMoneyNum(otherLienBalance);
  const la = parseMoneyNum(loanAmount);
  const pv = parseMoneyNum(valueSalesPrice);
  if (la > 0 && pv > 0) {
    return formatLtvInt1To100(((other + la) / pv) * 100);
  }
  return "";
}

/** @deprecated Use computeCltvPercent */
export function recomputeCltvFromBalances(
  existingFirstLien: string,
  loanAmount: string,
  valueSalesPrice: string,
): string {
  return computeCltvPercent(existingFirstLien, loanAmount, valueSalesPrice);
}

export type LoanTriSource = "valueSalesPrice" | "loanAmount" | "ltv" | "cltv";
