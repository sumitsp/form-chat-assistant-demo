/**
 * Payload builders for eligibility API calls.
 * Quick scan sends only fields the user has actually answered (no synthetic defaults).
 */
import { isDscrPathScenario, mapDocumentationForApi } from "@/lib/nqmIntegratedForm";

export type QuickEligibilityFormSnap = {
  citizenship?: string;
  occupancy?: string;
  loanPurpose?: string;
  isSecondLien?: string;
  ltv?: string;
  cltv?: string;
  loanAmount?: string;
  valueSalesPrice?: string;
  decisionCreditScore?: string;
  state?: string;
  propertyType?: string;
  documentationType?: string;
  investmentIncomePath?: string;
  dscr?: string;
  estimatedDti?: string;
  prepaymentTerms?: string;
  prepayStepdown?: string;
  rentalType?: string;
  firstTimeHomebuyer?: string;
  firstTimeInvestor?: string;
  establishedPrimaryRes?: string;
  paymentHistory?: string;
  existingFirstLien?: string;
  existingSecondLien?: string;
  existingSecondLienBalance?: string;
  creditEventType?: string;
  yearsSinceEvent?: string;
  stateCounty?: string;
  stateCity?: string;
  stateBorough?: string;
  stateZipCode?: string;
  isInBaltimoreCity?: string;
  isInIndianapolis?: string;
  isInPhiladelphia?: string;
  isInMemphis?: string;
  isInLubbock?: string;
  hiLavaZone?: string;
  isRuralProperty?: string;
  acreage?: string;
  loanTerm?: string;
  interestOnlyPref?: string;
  rateTypePref?: string;
  lienPosition?: string;
  firstLienPurpose?: string;
  secondLienProduct?: string;
  helocDrawYears?: string;
  helocInitialDraw?: string;
  cashInHandRequest?: string;
  piggybackPurpose?: string;
  primaryLoanPurpose?: string;
  propertyCount?: string;
  combinedPropertyValue?: string;
  combinedLoanAmount?: string;
  totalGrossRents?: string;
  combinedPitia?: string;
  loanLevelDscr?: string;
  visaCategory?: string;
  visaType?: string;
  visaTypeOther?: string;
  ofacSanctioned?: string;
  hasUsCredit?: string;
  creditEvents?: string[];
  creditEventYears?: Record<string, string>;
  nonOccupantCoBorrower?: string;
  combinedDti?: string;
  listingSeasoning?: string;
  powerOfAttorney?: string;
  nonArmsLength?: string;
};

const trim = (v?: string) => (v ?? "").trim();
const CROSS_COLLATERAL_CODE = "multiple_properties";

function mapPropertyTypeForApi(value: string): string {
  const t = trim(value);
  if (t === CROSS_COLLATERAL_CODE) return "five_to_eight_unit";
  return t;
}

export function formHasQuickScanInput(snap: QuickEligibilityFormSnap): boolean {
  return !!(
    trim(snap.citizenship) ||
    trim(snap.occupancy) ||
    trim(snap.loanPurpose) ||
    trim(snap.isSecondLien) ||
    trim(snap.ltv) ||
    trim(snap.loanAmount) ||
    trim(snap.valueSalesPrice) ||
    trim(snap.decisionCreditScore) ||
    trim(snap.state) ||
    trim(snap.propertyType) ||
    trim(snap.documentationType) ||
    trim(snap.dscr) ||
    trim(snap.estimatedDti)
  );
}

export function getQuickApiValuesFromForm(snap: QuickEligibilityFormSnap) {
  const dscrPath = isDscrPathScenario({
    occupancy: snap.occupancy ?? "",
    propertyType: snap.propertyType ?? "",
    investmentIncomePath: (snap.investmentIncomePath ?? "") as "" | "income" | "dscr",
  });
  const docForApi = dscrPath ? "DSCR" : mapDocumentationForApi(snap.documentationType ?? "");
  const dtiForApi = dscrPath ? trim(snap.estimatedDti) || "" : trim(snap.estimatedDti);
  const rawPrep = snap.prepaymentTerms === "No Penalty" ? "None" : trim(snap.prepaymentTerms);
  const prepForApi = snap.occupancy === "Investment Property" ? rawPrep : rawPrep || "";
  return { docForApi, dtiForApi, prepForApi, dscrPath };
}

function setIfFilled(payload: Record<string, string>, key: string, value: string) {
  if (value) payload[key] = value;
}

function visaTypeForApi(snap: QuickEligibilityFormSnap): string {
  if (trim(snap.visaCategory) === "Other / Not Listed") return trim(snap.visaTypeOther);
  return trim(snap.visaType);
}

function normalizePrepayStepdown(v?: string): string {
  const t = trim(v);
  if (!t || t === "Not Applicable" || t === "Doesn't Matter") return "";
  return t;
}

/** Qualifying DTI: combined only when NOCB=Yes; otherwise the borrower's own DTI. */
function effectiveDtiForPayload(snap: QuickEligibilityFormSnap): string {
  if (snap.nonOccupantCoBorrower === "Yes" && trim(snap.combinedDti)) {
    return trim(snap.combinedDti);
  }
  return trim(snap.estimatedDti);
}

/** FICO for API — FN without US credit has no score gate. */
function ficoForQuickPayload(snap: QuickEligibilityFormSnap): string {
  if (trim(snap.citizenship) === "Foreign National" && trim(snap.hasUsCredit) === "No") {
    return "";
  }
  return trim(snap.decisionCreditScore);
}

/** Full submit — default 780 only for US Citizen when score omitted. */
function ficoForFullPayload(snap: QuickEligibilityFormSnap): string {
  const score = ficoForQuickPayload(snap);
  if (score) return score;
  if (trim(snap.citizenship) === "US Citizen") return "780";
  return "";
}

/**
 * SQL-only sidebar count — only includes fields the user has actually filled.
 * Unset fields are omitted so the backend treats them as "no constraint yet".
 */
export function buildQuickScanPayloadFromForm(
  snap: QuickEligibilityFormSnap,
  creditEvent: string,
): Record<string, string> {
  const payload: Record<string, string> = {};

  setIfFilled(payload, "citizenship", trim(snap.citizenship));
  setIfFilled(payload, "occupancy", trim(snap.occupancy));
  setIfFilled(payload, "loanPurpose", trim(snap.loanPurpose));
  setIfFilled(payload, "state", trim(snap.state));
  setIfFilled(payload, "valueSalesPrice", trim(snap.valueSalesPrice));
  setIfFilled(payload, "loanAmount", trim(snap.loanAmount));
  setIfFilled(payload, "ltv", trim(snap.ltv));
  setIfFilled(payload, "cltv", trim(snap.cltv));
  setIfFilled(payload, "decisionCreditScore", ficoForQuickPayload(snap));
  setIfFilled(payload, "propertyType", mapPropertyTypeForApi(snap.propertyType ?? ""));
  setIfFilled(payload, "visaType", visaTypeForApi(snap));
  setIfFilled(payload, "visaCategory", trim(snap.visaCategory));
  setIfFilled(payload, "ofacSanctioned", trim(snap.ofacSanctioned));
  setIfFilled(payload, "hasUsCredit", trim(snap.hasUsCredit));
  setIfFilled(payload, "establishedPrimaryRes", trim(snap.establishedPrimaryRes));
  setIfFilled(payload, "qualificationPath", trim(snap.investmentIncomePath));
  setIfFilled(payload, "investmentIncomePath", trim(snap.investmentIncomePath));
  setIfFilled(payload, "rentalType", trim(snap.rentalType));
  setIfFilled(payload, "hiLavaZone", trim(snap.hiLavaZone));
  setIfFilled(payload, "isRuralProperty", trim(snap.isRuralProperty));
  setIfFilled(payload, "acreage", trim(snap.acreage));
  setIfFilled(payload, "nonOccupantCoBorrower", trim(snap.nonOccupantCoBorrower));
  setIfFilled(payload, "combinedDti", trim(snap.combinedDti));
  setIfFilled(payload, "listingSeasoning", trim(snap.listingSeasoning));
  setIfFilled(payload, "powerOfAttorney", trim(snap.powerOfAttorney));
  setIfFilled(payload, "nonArmsLength", trim(snap.nonArmsLength));
  setIfFilled(payload, "isSecondLien", trim(snap.isSecondLien));
  setIfFilled(payload, "lienPosition", trim(snap.lienPosition));
  setIfFilled(payload, "secondLienProduct", trim(snap.secondLienProduct));
  setIfFilled(payload, "helocDrawYears", trim(snap.helocDrawYears));
  setIfFilled(payload, "helocInitialDraw", trim(snap.helocInitialDraw));
  setIfFilled(payload, "cashInHandRequest", trim(snap.cashInHandRequest));
  setIfFilled(payload, "primaryLoanPurpose", trim(snap.primaryLoanPurpose));
  setIfFilled(payload, "existingFirstLien", trim(snap.existingFirstLien));
  setIfFilled(payload, "existingSecondLien", trim(snap.existingSecondLien));
  setIfFilled(payload, "existingSecondLienBalance", trim(snap.existingSecondLienBalance));
  setIfFilled(payload, "stateCounty", trim(snap.stateCounty));
  setIfFilled(payload, "stateCity", trim(snap.stateCity));
  setIfFilled(payload, "stateBorough", trim(snap.stateBorough));
  setIfFilled(payload, "stateZipCode", trim(snap.stateZipCode));
  setIfFilled(payload, "isInBaltimoreCity", trim(snap.isInBaltimoreCity));
  setIfFilled(payload, "isInIndianapolis", trim(snap.isInIndianapolis));
  setIfFilled(payload, "isInPhiladelphia", trim(snap.isInPhiladelphia));
  setIfFilled(payload, "isInMemphis", trim(snap.isInMemphis));
  setIfFilled(payload, "isInLubbock", trim(snap.isInLubbock));
  setIfFilled(payload, "loanTerm", trim(snap.loanTerm));
  setIfFilled(payload, "interestOnlyPref", trim(snap.interestOnlyPref));
  setIfFilled(payload, "rateTypePref", trim(snap.rateTypePref));

  const dscrPath = isDscrPathScenario({
    occupancy: snap.occupancy ?? "",
    propertyType: snap.propertyType ?? "",
    investmentIncomePath: (snap.investmentIncomePath ?? "") as "" | "income" | "dscr",
  });

  const docFilled = trim(snap.documentationType);
  if (dscrPath) {
    setIfFilled(payload, "documentationType", "DSCR");
    setIfFilled(payload, "dscr", trim(snap.dscr));
  } else if (docFilled) {
    setIfFilled(payload, "documentationType", mapDocumentationForApi(snap.documentationType ?? ""));
  }

  setIfFilled(payload, "estimatedDti", effectiveDtiForPayload(snap));

  const prep = snap.prepaymentTerms === "No Penalty" ? "None" : trim(snap.prepaymentTerms);
  if (prep && snap.occupancy === "Investment Property") {
    payload.prepaymentTerms = prep;
  }
  const stepdown = normalizePrepayStepdown(snap.prepayStepdown);
  if (stepdown && snap.occupancy === "Investment Property" && prep && prep !== "None") {
    payload.prepayStepdown = stepdown;
  }

  const creditEv = creditEvent.trim();
  if (creditEv && creditEv !== "None") {
    payload.creditEvent = creditEv;
  }
  setIfFilled(payload, "creditEventType", trim(snap.creditEventType));
  setIfFilled(payload, "yearsSinceEvent", trim(snap.yearsSinceEvent));

  setIfFilled(payload, "firstTimeHomebuyer", trim(snap.firstTimeHomebuyer));
  setIfFilled(payload, "firstTimeInvestor", trim(snap.firstTimeInvestor));
  setIfFilled(payload, "paymentHistory", trim(snap.paymentHistory));

  return payload;
}

/** Full eligibility run (submit) — fills best-case defaults for any still-empty fields. */
export function buildEligibilityPayloadFromForm(
  snap: QuickEligibilityFormSnap,
  creditEvent: string,
): Record<string, string> {
  const { docForApi, dtiForApi, prepForApi, dscrPath } = getQuickApiValuesFromForm(snap);
  return {
    occupancy: trim(snap.occupancy),
    loanPurpose: trim(snap.loanPurpose),
    state: trim(snap.state),
    valueSalesPrice: trim(snap.valueSalesPrice),
    loanAmount: trim(snap.loanAmount),
    ltv: trim(snap.ltv),
    estimatedDti: effectiveDtiForPayload(snap) || dtiForApi || "43",
    documentationType: docForApi || "Full Doc",
    prepaymentTerms: prepForApi || "No Penalty",
    propertyType: mapPropertyTypeForApi(snap.propertyType ?? ""),
    citizenship: trim(snap.citizenship),
    decisionCreditScore: ficoForFullPayload(snap),
    cltv: trim(snap.cltv) || trim(snap.ltv),
    dscr: dscrPath ? trim(snap.dscr) || "1.25" : "",
    creditEvent: creditEvent.trim() || "None",
    isSecondLien: trim(snap.isSecondLien) || "no",
    lienPosition: trim(snap.lienPosition),
    secondLienProduct: trim(snap.secondLienProduct),
    helocDrawYears: trim(snap.helocDrawYears),
    helocInitialDraw: trim(snap.helocInitialDraw),
    cashInHandRequest: trim(snap.cashInHandRequest),
    primaryLoanPurpose: trim(snap.primaryLoanPurpose),
    firstTimeHomebuyer: trim(snap.firstTimeHomebuyer) || "no",
    firstTimeInvestor: trim(snap.firstTimeInvestor) || "no",
    paymentHistory: trim(snap.paymentHistory) || "0x30",
    existingFirstLien: trim(snap.existingFirstLien),
    existingSecondLien: trim(snap.existingSecondLien),
    existingSecondLienBalance: trim(snap.existingSecondLienBalance),
    stateCounty: trim(snap.stateCounty),
    stateCity: trim(snap.stateCity),
    stateBorough: trim(snap.stateBorough),
    stateZipCode: trim(snap.stateZipCode),
    isInBaltimoreCity: trim(snap.isInBaltimoreCity),
    isInIndianapolis: trim(snap.isInIndianapolis),
    isInPhiladelphia: trim(snap.isInPhiladelphia),
    isInMemphis: trim(snap.isInMemphis),
    isInLubbock: trim(snap.isInLubbock),
    visaType: visaTypeForApi(snap),
    visaCategory: trim(snap.visaCategory),
    ofacSanctioned: trim(snap.ofacSanctioned),
    hasUsCredit: trim(snap.hasUsCredit),
    establishedPrimaryRes: trim(snap.establishedPrimaryRes),
    qualificationPath: trim(snap.investmentIncomePath),
    investmentIncomePath: trim(snap.investmentIncomePath),
    rentalType: trim(snap.rentalType),
    hiLavaZone: trim(snap.hiLavaZone),
    isRuralProperty: trim(snap.isRuralProperty),
    acreage: trim(snap.acreage),
    nonOccupantCoBorrower: trim(snap.nonOccupantCoBorrower),
    combinedDti: trim(snap.combinedDti),
    listingSeasoning: trim(snap.listingSeasoning),
    powerOfAttorney: trim(snap.powerOfAttorney),
    nonArmsLength: trim(snap.nonArmsLength),
    prepayStepdown: normalizePrepayStepdown(snap.prepayStepdown),
    loanTerm: trim(snap.loanTerm),
    interestOnlyPref: trim(snap.interestOnlyPref),
    rateTypePref: trim(snap.rateTypePref),
  };
}

/** @deprecated Use buildQuickScanPayloadFromForm or buildEligibilityPayloadFromForm */
export const buildQuickEligibilityPayload = buildQuickScanPayloadFromForm;
