/**
 * Save / restore wizard form state for form_history_scenario (Save Scenario).
 * Merges eligibility API fields with wizard-only UI state (lien cascade, multi-credit, etc.).
 */
import { type WizardForm } from "@/components/wizard/loanWizardForm";
import {
  CREDIT_EVENT_CATEGORY_OPTIONS,
  LIEN_POSITION_FIRST,
  LIEN_POSITION_PIGGYBACK,
  LIEN_POSITION_SECOND,
  creditEventTypesForCategory,
  docTypeLabelFromCode,
} from "@/lib/nqmIntegratedForm";
import {
  VAULT_SCENARIO_DESCRIPTION_KEY,
  vaultScenarioDescriptionFromFields,
} from "@/lib/scenarioHistoryApi";

export type SavedFormFields = Record<string, unknown>;

/** Bump when persisted wizard-only field set changes. */
export const WIZARD_SAVE_SCHEMA_VERSION = 2;

const YES = new Set(["yes", "y", "true", "1"]);

/** Wizard-only string fields stored alongside eligibility payload. */
const WIZARD_STRING_KEYS = [
  "primaryLoanPurpose",
  "lienPosition",
  "secondLienProduct",
  "piggybackPurpose",
  "firstLienPurpose",
  "loanPurpose",
  "visaCategory",
  "visaType",
  "visaTypeOther",
  "ofacSanctioned",
  "hasUsCredit",
  "creditEventCategory",
  "creditEventDate",
  "creditEventDateUncertain",
  "hasCreditEvent",
  "combinedDti",
  "noCbRelationship",
  "noCbFico",
  "noCbIncome",
  "propertyCount",
  "combinedPropertyValue",
  "combinedLoanAmount",
  "totalGrossRents",
  "combinedPitia",
  "loanLevelDscr",
  "nonArmsLength",
  "departingResidence",
  "departingRent",
  "hiLavaZone",
  "recentlyRehabbed",
  "otherFinancedProperties",
  "reservesAvailable",
  "vacantProperty",
  "selfEmploymentHistory",
  "reservesMonths",
  "householdSize",
  "monthlyResidualIncome",
  "refinancingExistingSecond",
  "existingSecondBalance",
] as const;

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function parseStoredJson<T>(v: unknown): T | undefined {
  if (v == null) return undefined;
  if (typeof v === "object") return v as T;
  const s = String(v).trim();
  if (!s) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

function categoryForEventType(eventType: string): string {
  if (!eventType) return "None";
  for (const cat of CREDIT_EVENT_CATEGORY_OPTIONS) {
    if (cat.value === "None") continue;
    if (creditEventTypesForCategory(cat.value).includes(eventType)) return cat.value;
  }
  return "None";
}

function inferInvestmentIncomePath(fields: SavedFormFields): "" | "income" | "dscr" {
  const explicit = str(fields.investmentIncomePath || fields.qualificationPath);
  if (explicit === "dscr" || explicit === "income") return explicit;

  const docRaw = str(fields.documentationType).toLowerCase();
  if (docRaw === "dscr" || str(fields.dscr)) return "dscr";

  if (str(fields.occupancy) === "Investment Property" && (docRaw || str(fields.estimatedDti))) {
    return "income";
  }
  return "";
}

function mapDocumentationTypeForForm(fields: SavedFormFields, dscrPath: boolean): string {
  if (dscrPath) return "DSCR";
  const docRaw = str(fields.documentationType);
  if (!docRaw) return "";
  if (docRaw.toLowerCase() === "dscr") return "DSCR";
  return docTypeLabelFromCode(docRaw) || docRaw;
}

function mapPrepaymentTermsForForm(raw: unknown): string {
  const prep = str(raw);
  if (!prep || prep === "None") return "No Penalty";
  return prep;
}

/** Infer lien cascade from saved fields (supports pre-v2 saves with only isSecondLien). */
function inferLienCascade(fields: SavedFormFields): {
  primaryLoanPurpose: string;
  lienPosition: string;
  secondLienProduct: string;
  piggybackPurpose: string;
  firstLienPurpose: string;
} {
  const lienPosition = str(fields.lienPosition);
  const primaryLoanPurpose =
    str(fields.primaryLoanPurpose) || str(fields.loanPurpose) || "Purchase";
  const secondLienProduct = str(fields.secondLienProduct).toLowerCase();
  const piggybackPurpose = str(fields.piggybackPurpose);
  const firstLienPurpose = str(fields.firstLienPurpose);

  if (lienPosition) {
    return {
      primaryLoanPurpose,
      lienPosition,
      secondLienProduct,
      piggybackPurpose,
      firstLienPurpose,
    };
  }

  const isSecond = YES.has(str(fields.isSecondLien).toLowerCase());
  if (!isSecond) {
    return {
      primaryLoanPurpose,
      lienPosition: LIEN_POSITION_FIRST,
      secondLienProduct: "",
      piggybackPurpose: "",
      firstLienPurpose: primaryLoanPurpose,
    };
  }

  if (secondLienProduct === "heloc" || secondLienProduct === "heloan") {
    return {
      primaryLoanPurpose,
      lienPosition: LIEN_POSITION_SECOND,
      secondLienProduct,
      piggybackPurpose: "",
      firstLienPurpose: "",
    };
  }

  if (piggybackPurpose) {
    return {
      primaryLoanPurpose: piggybackPurpose || primaryLoanPurpose,
      lienPosition: LIEN_POSITION_PIGGYBACK,
      secondLienProduct: "",
      piggybackPurpose: piggybackPurpose || primaryLoanPurpose,
      firstLienPurpose: "",
    };
  }

  // Legacy second-lien flag without product — treat as standalone closed-end.
  return {
    primaryLoanPurpose,
    lienPosition: LIEN_POSITION_SECOND,
    secondLienProduct: secondLienProduct || "heloan",
    piggybackPurpose: "",
    firstLienPurpose: "",
  };
}

/**
 * Build JSON blob for POST /api/form-history/save.
 * `eligibilityPayload` should come from buildEligibilityPayloadFromForm + extras in LoanWizardV2.
 */
export function buildFormFieldsForHistorySave(
  form: Record<string, unknown>,
  eligibilityPayload: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...eligibilityPayload,
    _wizardSaveVersion: WIZARD_SAVE_SCHEMA_VERSION,
  };

  for (const key of WIZARD_STRING_KEYS) {
    const v = form[key];
    if (v != null && str(v) !== "") out[key] = str(v);
  }

  const creditEvents = form.creditEvents;
  if (Array.isArray(creditEvents) && creditEvents.length > 0) {
    out.creditEvents = creditEvents;
  }

  const creditEventYears = form.creditEventYears;
  if (
    creditEventYears &&
    typeof creditEventYears === "object" &&
    !Array.isArray(creditEventYears)
  ) {
    out.creditEventYears = creditEventYears;
  }

  const creditEventDates = form.creditEventDates;
  if (
    creditEventDates &&
    typeof creditEventDates === "object" &&
    !Array.isArray(creditEventDates)
  ) {
    out.creditEventDates = creditEventDates;
  }

  const vaultDesc = str(form._vaultScenarioDescription);
  if (vaultDesc) out[VAULT_SCENARIO_DESCRIPTION_KEY] = vaultDesc;

  return out;
}

/** Map persisted form_fields back into LoanWizardV2 `emptyForm` shape. */
export function wizardFormFromSavedFields(fields: SavedFormFields): Record<string, unknown> {
  const investmentIncomePath = inferInvestmentIncomePath(fields);
  const dscrPath =
    investmentIncomePath === "dscr" || str(fields.documentationType).toLowerCase() === "dscr";

  const creditEventType = str(fields.creditEventType);
  const creditEvent = str(fields.creditEvent);
  let creditEventCategory = "None";
  if (creditEvent && creditEvent !== "None") {
    creditEventCategory = categoryForEventType(creditEventType);
    if (creditEventCategory === "None") {
      const first = creditEvent.split(/\s+/)[0];
      if (CREDIT_EVENT_CATEGORY_OPTIONS.some((c) => c.value === first)) {
        creditEventCategory = first;
      }
    }
  }

  const lien = inferLienCascade(fields);
  const creditEvents = parseStoredJson<string[]>(fields.creditEvents) ?? [];
  const creditEventYears = parseStoredJson<Record<string, string>>(fields.creditEventYears) ?? {};
  const creditEventDates = parseStoredJson<Record<string, string>>(fields.creditEventDates) ?? {};

  return applyLegacyGeoFieldMigration({
    occupancy: str(fields.occupancy),
    loanPurpose: str(fields.loanPurpose) || lien.primaryLoanPurpose,
    primaryLoanPurpose: lien.primaryLoanPurpose,
    lienPosition: lien.lienPosition,
    secondLienProduct: lien.secondLienProduct,
    piggybackPurpose: lien.piggybackPurpose,
    firstLienPurpose: lien.firstLienPurpose,
    state: str(fields.state),
    valueSalesPrice: str(fields.valueSalesPrice),
    ltv: str(fields.ltv),
    cltv: str(fields.cltv),
    loanAmount: str(fields.loanAmount),
    estimatedDti: str(fields.estimatedDti),
    combinedDti: str(fields.combinedDti),
    documentationType: mapDocumentationTypeForForm(fields, dscrPath),
    prepaymentTerms: mapPrepaymentTermsForForm(fields.prepaymentTerms),
    prepayStepdown: str(fields.prepayStepdown),
    propertyType: str(fields.propertyType),
    citizenship: str(fields.citizenship),
    decisionCreditScore: str(fields.decisionCreditScore),
    firstTimeHomebuyer: str(fields.firstTimeHomebuyer),
    investmentIncomePath,
    rentalType: str(fields.rentalType),
    creditEventCategory,
    creditEventType,
    yearsSinceCreditEvent: str(fields.yearsSinceEvent),
    creditEventDate: str(fields.creditEventDate),
    creditEventDateUncertain: str(fields.creditEventDateUncertain),
    hasCreditEvent: str(fields.hasCreditEvent),
    creditEvents,
    creditEventYears,
    creditEventDates,
    firstTimeInvestor: str(fields.firstTimeInvestor),
    establishedPrimaryRes: str(fields.establishedPrimaryRes),
    paymentHistory: str(fields.paymentHistory) || "0x30",
    isSecondLien: str(fields.isSecondLien) || "no",
    existingFirstLien: str(fields.existingFirstLien),
    dscr: str(fields.dscr),
    visaCategory: str(fields.visaCategory),
    visaType: str(fields.visaType),
    visaTypeOther: str(fields.visaTypeOther),
    ofacSanctioned: str(fields.ofacSanctioned),
    hasUsCredit: str(fields.hasUsCredit),
    existingSecondLien: str(fields.existingSecondLien),
    existingSecondLienBalance: str(fields.existingSecondLienBalance),
    cashInHandRequest: str(fields.cashInHandRequest),
    acreage: str(fields.acreage),
    isRuralProperty: str(fields.isRuralProperty),
    decliningMarket: str(fields.decliningMarket),
    nonOccupantCoBorrower: str(fields.nonOccupantCoBorrower),
    noCbRelationship: str(fields.noCbRelationship),
    noCbFico: str(fields.noCbFico),
    noCbIncome: str(fields.noCbIncome),
    entityVesting: str(fields.entityVesting),
    tradelines: str(fields.tradelines),
    assetsLiquidFunds: str(fields.assetsLiquidFunds),
    giftFundsPercent: str(fields.giftFundsPercent),
    loanTerm: str(fields.loanTerm) || "No preference",
    interestOnlyPref: str(fields.interestOnlyPref) || "No preference",
    powerOfAttorney: str(fields.powerOfAttorney),
    listingSeasoning: str(fields.listingSeasoning),
    scenarioNotes: str(fields.scenarioNotes),
    propertyCondition: str(fields.propertyCondition),
    rateTypePref: str(fields.rateTypePref) || "No Preference",
    stateCounty: str(fields.stateCounty),
    stateCity: str(fields.stateCity),
    stateBorough: str(fields.stateBorough),
    stateZipCode: str(fields.stateZipCode),
    isInBaltimoreCity: str(fields.isInBaltimoreCity),
    isInIndianapolis: str(fields.isInIndianapolis),
    isInPhiladelphia: str(fields.isInPhiladelphia),
    isInMemphis: str(fields.isInMemphis),
    isInLubbock: str(fields.isInLubbock),
    hiLavaZone: str(fields.hiLavaZone),
    recentlyRehabbed: str(fields.recentlyRehabbed),
    otherFinancedProperties: str(fields.otherFinancedProperties),
    reservesAvailable: str(fields.reservesAvailable),
    vacantProperty: str(fields.vacantProperty),
    selfEmploymentHistory: str(fields.selfEmploymentHistory),
    reservesMonths: str(fields.reservesMonths),
    householdSize: str(fields.householdSize),
    monthlyResidualIncome: str(fields.monthlyResidualIncome),
    nonArmsLength: str(fields.nonArmsLength),
    departingResidence: str(fields.departingResidence),
    departingRent: str(fields.departingRent),
    propertyCount: str(fields.propertyCount),
    combinedPropertyValue: str(fields.combinedPropertyValue),
    combinedLoanAmount: str(fields.combinedLoanAmount),
    totalGrossRents: str(fields.totalGrossRents),
    combinedPitia: str(fields.combinedPitia),
    loanLevelDscr: str(fields.loanLevelDscr),
    refinancingExistingSecond: str(fields.refinancingExistingSecond),
    existingSecondBalance: str(fields.existingSecondBalance),
    _vaultScenarioDescription: vaultScenarioDescriptionFromFields(fields),
  });
}

/** Map legacy TX stateCity lubbock/other codes to isInLubbock Yes/No. */
function applyLegacyGeoFieldMigration(form: WizardForm): WizardForm {
  if (form.state === "TX" && !form.isInLubbock.trim() && form.stateCity.trim()) {
    const city = form.stateCity.trim().toLowerCase();
    if (city === "lubbock") return { ...form, isInLubbock: "Yes", stateCity: "" };
    if (city === "other") return { ...form, isInLubbock: "No", stateCity: "" };
  }
  return form;
}

/** Normalize saved JSON for POST /api/eligibility (string values only). */
export function eligibilityPayloadFromSavedFields(fields: SavedFormFields): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith("_")) continue;
    if (value == null) continue;
    if (typeof value === "object") continue;
    const s = String(value).trim();
    if (s) payload[key] = s;
  }
  // Eligibility API expects stringified credit event; arrays are in creditEvent key from save.
  if (!payload.creditEvent && fields.creditEvent != null) {
    payload.creditEvent = String(fields.creditEvent).trim();
  }
  return payload;
}
