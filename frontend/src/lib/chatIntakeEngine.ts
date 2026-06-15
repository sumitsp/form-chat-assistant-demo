/**
 * Conversational intake for Chat Mode — question order, parsers, and completion checks.
 * Mirrors LoanWizardV2 form requirements without rendering the wizard UI.
 */

import {
  CITIZENSHIP_OPTIONS,
  CREDIT_EVENT_CATEGORY_OPTIONS,
  creditEventTypesForCategory,
  DOC_TYPES_INTEGRATED,
  EXISTING_SECOND_LIEN_OPTIONS,
  existingSecondLienNeedsSubordination,
  INTEGRATED_PROPERTY_TYPES,
  INVESTMENT_INCOME_TYPE_OPTIONS,
  isDscrPathScenario,
  isFiveEightProperty,
  parseMoneyNum,
  LOAN_PURPOSE_INTEGRATED,
  PAYMENT_HISTORY_OPTIONS,
  SECOND_LIEN_NO_LABEL,
  SECOND_LIEN_YES_LABEL,
  shouldShowEstablishedPrimaryRes,
  shouldShowPaymentHistory,
  shouldShowSecondLienFields,
  shouldAskFirstTimeHomebuyer,
  shouldHardcodeFirstTimeHomebuyerNo,
  shouldAskFirstTimeInvestor,
  shouldHardcodeFirstTimeInvestorNo,
  YES_NO_OPTIONS,
  type InvestmentPath,
} from "@/lib/nqmIntegratedForm";
import { CREDIT_EVENT_YEAR_BUCKETS } from "@/lib/creditEventTiming";
import {
  geoFormFromWizard,
  getGeoFieldsForCounty,
  clearGeoFollowupFieldsPatch,
  inferGeoFollowupsFromCounty,
  isGeoLocationComplete,
} from "@/lib/stateGeoFollowUp";

export type ChatWizardForm = {
  citizenship: string;
  occupancy: string;
  loanPurpose: string;
  propertyType: string;
  valueSalesPrice: string;
  loanAmount: string;
  ltv: string;
  decisionCreditScore: string;
  isSecondLien: string;
  existingFirstLien: string;
  existingSecondLien: string;
  existingSecondLienBalance: string;
  firstTimeHomebuyer: string;
  firstTimeInvestor: string;
  establishedPrimaryRes: string;
  investmentIncomePath: InvestmentPath;
  documentationType: string;
  estimatedDti: string;
  dscr: string;
  rentalType: string;
  prepaymentTerms: string;
  state: string;
  stateCounty: string;
  stateCity: string;
  stateBorough: string;
  stateZipCode: string;
  isInBaltimoreCity: string;
  isInIndianapolis: string;
  isInPhiladelphia: string;
  isInMemphis: string;
  isInLubbock: string;
  creditEventCategory: string;
  creditEventType: string;
  yearsSinceCreditEvent: string;
  paymentHistory: string;
};

export type ChatQuestion = {
  id: string;
  prompt: string;
  hint?: string;
  options?: string[];
};

const PREPAY_OPTIONS = ["5 Year", "4 Year", "3 Year", "2 Year", "1 Year", "No Penalty"] as const;
const RENTAL_TYPES = ["Long-term rental", "Short-term rental"] as const;
const YEARS_SINCE = CREDIT_EVENT_YEAR_BUCKETS;
const OCCUPANCY_OPTIONS = ["Primary Residence", "Second Home", "Investment Property"] as const;

const US_STATES: { code: string; label: string }[] = [
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
];

function filled(v: string | undefined): boolean {
  return (v ?? "").trim().length > 0;
}

function isDscrPath(form: ChatWizardForm): boolean {
  return isDscrPathScenario({
    occupancy: form.occupancy,
    propertyType: form.propertyType,
    investmentIncomePath: form.investmentIncomePath,
  });
}

function creditScoreRequired(form: ChatWizardForm): boolean {
  return form.citizenship === "US Citizen";
}

function parseMoney(raw: string): string {
  const digits = raw.replace(/[^\d.]/g, "");
  if (!digits) return "";
  const n = Math.round(parseFloat(digits));
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n);
}

function parsePercent(raw: string): string {
  const m = raw.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (m) {
    const n = Math.round(parseFloat(m[1]));
    if (n < 1 || n > 100) return "";
    return String(n);
  }
  // Accept bare integer in 1–100 range (e.g. user types "45" for 45%)
  if (/^\s*\d{1,3}\s*$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 100) return String(n);
  }
  return "";
}

function parseMoneyToken(raw: string, hasK: boolean): number | null {
  let n = parseFloat(raw.replace(/,/g, ""));
  if (hasK) n *= 1000;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** Drop API/local guesses that mistook FICO, DSCR thresholds, etc. for loan amount or LTV. */
export function sanitizeExtractedFinancials(
  patch: Partial<ChatWizardForm>,
  sourceText: string,
): Partial<ChatWizardForm> {
  const p = { ...patch };
  // Normalize LTV — strip any trailing % so the value is always a plain number string
  if (p.ltv) p.ltv = String(parseInt(String(p.ltv).replace(/%/g, ""), 10) || "").replace("NaN", "");
  if (!p.ltv) delete p.ltv;

  const la = parseInt(p.loanAmount ?? "", 10);
  const vs = parseInt(p.valueSalesPrice ?? "", 10);
  if (Number.isFinite(la) && la > 0 && la < 10_000) delete p.loanAmount;
  if (Number.isFinite(vs) && vs > 0 && vs < 10_000) delete p.valueSalesPrice;

  // Guard against LLM returning loanAmount ≥ valueSalesPrice (100% LTV is almost never valid)
  // This happens when only one dollar amount is in the text and the model copies it to both fields
  if (
    Number.isFinite(la) &&
    la > 0 &&
    Number.isFinite(vs) &&
    vs > 0 &&
    la >= vs * 0.98 &&
    !/\b(?:100|99|98)\s*%?\s*ltv\b|\bloan\s+amount\s*(?:is|of|:)?\s*\$?\s*[\d,]+/i.test(sourceText)
  ) {
    delete p.loanAmount;
  }

  const hasLtvCue = /\bltv\b/i.test(sourceText) || /\b\d{1,3}\s*%\s*ltv\b/i.test(sourceText);
  if (p.ltv && !hasLtvCue) delete p.ltv;
  return p;
}

export function fuzzyMatchOption(input: string, options: readonly string[]): string | null {
  const n = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return null;
  for (const o of options) {
    if (o.toLowerCase() === n) return o;
  }
  const num = parseInt(n, 10);
  if (Number.isFinite(num) && num >= 1 && num <= options.length) {
    return options[num - 1] ?? null;
  }
  for (const o of options) {
    const ol = o.toLowerCase();
    if (n.includes(ol) || ol.includes(n)) return o;
  }
  return null;
}

const CITY_TO_STATE: Record<string, string> = {
  "new york city": "NY",
  nyc: "NY",
  "los angeles": "CA",
  la: "CA",
  "san francisco": "CA",
  sf: "CA",
  chicago: "IL",
  miami: "FL",
  houston: "TX",
  dallas: "TX",
  austin: "TX",
  seattle: "WA",
  denver: "CO",
  atlanta: "GA",
  boston: "MA",
  philadelphia: "PA",
  philly: "PA",
  phoenix: "AZ",
  "las vegas": "NV",
  nashville: "TN",
  charlotte: "NC",
  raleigh: "NC",
  portland: "OR",
  minneapolis: "MN",
  detroit: "MI",
  baltimore: "MD",
  "washington dc": "DC",
  dc: "DC",
  "washington d.c": "DC",
};

function matchState(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  // Extract ST from "City, ST" or "City ST" at end
  const m = t.match(/,?\s*([A-Za-z]{2})\s*$/);
  if (m) {
    const code = m[1].toUpperCase();
    if (US_STATES.some((s) => s.code === code)) return code;
  }
  const lower = t.toLowerCase().replace(/,.*$/, "").trim();
  if (CITY_TO_STATE[lower]) return CITY_TO_STATE[lower];
  const upper = t.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    return US_STATES.some((s) => s.code === upper) ? upper : null;
  }
  for (const s of US_STATES) {
    const sl = s.label.toLowerCase();
    if (sl === lower || sl.startsWith(lower) || lower.includes(sl)) return s.code;
  }
  return null;
}

function matchFollowUpOption(
  input: string,
  options: readonly { value: string; label: string }[],
): string | null {
  const byLabel = fuzzyMatchOption(
    input,
    options.map((o) => o.label),
  );
  if (!byLabel) return null;
  return options.find((o) => o.label === byLabel)?.value ?? null;
}

/** Pull FICO / credit score from free text, e.g. "FICO of 720", "720 FICO", "credit score 680". */
export function parseFicoFromScenario(text: string): string {
  const patterns = [
    /\bfico\s*(?:of|is|at|:)?\s*(\d{3})\b/i,
    /\bcredit\s*score\s*(?:of|is|at|:)?\s*(\d{3})\b/i,
    /\b(\d{3})\s+fico\b/i,
    /\bfico\s*[:-]?\s*(\d{3})\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return String(n);
  }
  return "";
}

/** Rule-based extraction from the initial chat scenario (works without OpenAI). */
export function parseScenarioLocally(text: string): Partial<ChatWizardForm> {
  const patch = sanitizeExtractedFinancials(parseFinancials(text), text);
  const fico = parseFicoFromScenario(text);
  if (fico) patch.decisionCreditScore = fico;

  if (/\b(?:us|u\.s\.)\s*citizen\b/i.test(text)) patch.citizenship = "US Citizen";
  if (
    /\binvest(?:ment)?\s+(?:in\s+)?(?:a\s+)?property\b/i.test(text) ||
    /\binvestment\s+property\b/i.test(text)
  ) {
    patch.occupancy = "Investment Property";
  }
  if (/\bpurchas(?:e|ing|ed)?\b|\bbuying\b|\bto\s+buy\b/i.test(text)) {
    patch.loanPurpose = "Purchase";
  } else if (/\bcash[\s-]out\b/i.test(text)) {
    patch.loanPurpose = "Cash-Out Refinance";
  } else if (/\brate[\s-]and[\s-]term\b|\brefi(?:nance)?\b/i.test(text)) {
    patch.loanPurpose = "Refinance";
  }
  if (/\bdscr\b/i.test(text)) {
    if (patch.occupancy === "Investment Property") patch.investmentIncomePath = "dscr";
  }
  if (/\bsingle[\s-]*family\b/i.test(text)) patch.propertyType = "single_family";
  if (/\bcondo(?:minium)?\b/i.test(text)) patch.propertyType = "condo_warrantable";
  if (/\bpud\b/i.test(text)) patch.propertyType = "pud";
  if (/\btownhouse\b|\btownhome\b/i.test(text)) patch.propertyType = "townhouse";
  if (/\b2[\s-]to[\s-]4\s*(?:unit|family|plex)\b|\b(?:duplex|triplex|quadplex)\b/i.test(text))
    patch.propertyType = "two_to_four_family";

  const state = matchState(text);
  if (state) patch.state = state;

  // Documentation type
  if (!patch.documentationType) {
    if (/\bfull[\s-]doc(?:umentation)?\b/i.test(text))
      patch.documentationType = "Full Documentation";
    else if (/\bbank[\s-]statement(?:s)?\b/i.test(text)) patch.documentationType = "Bank Statement";
    else if (/\bp\s*&\s*l\b|\bprofit\s*(?:and|&)\s*loss\b/i.test(text))
      patch.documentationType = "P&L";
    else if (/\b1099\b/i.test(text)) patch.documentationType = "1099";
    else if (/\basset\s*depletion\b/i.test(text)) patch.documentationType = "Asset Depletion";
    else if (/\bwvoe\b|\bverification\s*of\s*employment\b/i.test(text))
      patch.documentationType = "WVOE";
    else if (/\bno[\s-]doc\b|\bstated\b/i.test(text)) patch.documentationType = "No Doc / Stated";
  }

  // Credit history
  if (!patch.creditEventCategory) {
    if (
      /\bclean\b.*\bcredit\b|\bcredit\b.*\bclean\b|\bno\s+(?:credit\s+)?event|\bclean\s+history\b|\bno\s+derogatories?\b|\bno\s+bk\b|\bno\s+bankruptcy\b|\bno\s+foreclosure\b|\bperson\s+is\s+clean\b/i.test(
        text,
      )
    ) {
      patch.creditEventCategory = "None";
    } else if (/\bbankruptcy\b|\bbk\b|\bchapter\s+(?:7|11|13)\b/i.test(text)) {
      patch.creditEventCategory = "Bankruptcy";
    } else if (/\bforeclosure\b|\bfc\b/i.test(text)) {
      patch.creditEventCategory = "Foreclosure";
    } else if (/\bshort[\s-]sale\b/i.test(text)) {
      patch.creditEventCategory = "Short Sale";
    } else if (/\bmortgage\s+lat(?:e|es)\b|\blate\s+(?:mortgage\s+)?payment\b/i.test(text)) {
      patch.creditEventCategory = "Mortgage Lates";
    } else if (/\bdeed[\s-]in[\s-]lieu\b/i.test(text)) {
      patch.creditEventCategory = "Deed-in-Lieu";
    }
  }

  return patch;
}

function parseFinancials(text: string): Partial<ChatWizardForm> {
  const out: Partial<ChatWizardForm> = {};
  const scrubbed = text
    .replace(/\bfico\s*(?:of|is|at|:)?\s*\d{3}\b/gi, " ")
    .replace(/\b\d{3}\s+fico\b/gi, " ")
    .replace(/\bcredit\s*score\s*(?:of|is|at|:)?\s*\d{3}\b/gi, " ")
    .replace(/\bdscr\s*[><=]+\s*[\d.]+/gi, " ");

  const ltvExplicit =
    text.match(/\bltv\s*(?:of|is|at|:)?\s*(\d{1,3}(?:\.\d+)?)\s*%?/i) ||
    text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s*ltv\b/i);
  if (ltvExplicit) {
    const n = Math.round(parseFloat(ltvExplicit[1]));
    if (n >= 1 && n <= 100) out.ltv = String(n);
  }

  const loanExplicit = text.match(
    /\bloan\s*amount\s*(?:of|is|:)?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k|K|million|mil)?\b/i,
  );
  if (loanExplicit) {
    const unit = loanExplicit[2]?.toLowerCase();
    const n =
      unit === "million" || unit === "mil"
        ? Math.round(parseFloat(loanExplicit[1].replace(/,/g, "")) * 1_000_000)
        : parseMoneyToken(loanExplicit[1], unit === "k");
    if (n && n >= 10_000) out.loanAmount = String(n);
  }

  if (!out.loanAmount) {
    const millionLoan =
      text.match(/\b(?:for\s+)?(?:a\s+)?\$?\s*(\d+(?:\.\d+)?)\s*million\s+loan\b/i) ||
      text.match(/\b\$?\s*(\d+(?:\.\d+)?)million\s+loan\b/i) ||
      text.match(/\bloan\s+(?:of|amount|for)?\s*\$?\s*(\d+(?:\.\d+)?)\s*million\b/i);
    if (millionLoan?.[1]) {
      const n = Math.round(parseFloat(millionLoan[1].replace(/,/g, "")) * 1_000_000);
      if (n >= 10_000) out.loanAmount = String(n);
    }
  }

  const valueExplicit = text.match(
    /\b(?:property\s*value|purchase\s*price|sales\s*price|appraised\s*value)\s*(?:of|is|:)?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k|K)?\b/i,
  );
  if (valueExplicit) {
    const n = parseMoneyToken(valueExplicit[1], !!valueExplicit[2]);
    if (n) out.valueSalesPrice = String(n);
  }

  const amounts: number[] = [];
  for (const m of scrubbed.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(k|K)?/g)) {
    const n = parseMoneyToken(m[1], !!m[2]);
    if (n && n >= 10_000) amounts.push(n);
  }
  for (const m of scrubbed.matchAll(/\b([\d,]+(?:\.\d+)?)\s*(k|K)\b/g)) {
    const n = parseMoneyToken(m[1], true);
    if (n && n >= 10_000) amounts.push(n);
  }

  if (!out.valueSalesPrice && amounts.length >= 1) out.valueSalesPrice = String(amounts[0]);
  if (!out.loanAmount && amounts.length >= 2) out.loanAmount = String(amounts[1]);
  if (!out.ltv && out.valueSalesPrice && out.loanAmount && parseMoneyNum(out.valueSalesPrice) > 0) {
    const computed = Math.round(
      (parseMoneyNum(out.loanAmount) / parseMoneyNum(out.valueSalesPrice)) * 100,
    );
    if (computed >= 1 && computed <= 100) out.ltv = String(computed);
  }

  if (!out.valueSalesPrice && out.loanAmount && out.ltv) {
    const la = parseMoneyNum(out.loanAmount);
    const ltvPct = parseMoneyNum(out.ltv);
    if (la > 0 && ltvPct > 0 && ltvPct <= 100) {
      out.valueSalesPrice = String(Math.round(la / (ltvPct / 100)));
    }
  }

  if (!out.loanAmount && out.valueSalesPrice && out.ltv) {
    const vs = parseMoneyNum(out.valueSalesPrice);
    const ltvPct = parseMoneyNum(out.ltv);
    if (vs > 0 && ltvPct > 0 && ltvPct <= 100) {
      out.loanAmount = String(Math.round(vs * (ltvPct / 100)));
    }
  }

  return out;
}

export function triangulateLoanValues(patch: Partial<ChatWizardForm>): Partial<ChatWizardForm> {
  const out = { ...patch };
  const vs = out.valueSalesPrice ? parseMoneyNum(out.valueSalesPrice) : 0;
  const la = out.loanAmount ? parseMoneyNum(out.loanAmount) : 0;
  const ltvPct = out.ltv ? parseMoneyNum(out.ltv) : 0;
  if (vs > 0 && la > 0 && !ltvPct) {
    const c = Math.round((la / vs) * 100);
    if (c >= 1 && c <= 100) out.ltv = String(c);
  } else if (vs > 0 && ltvPct > 0 && ltvPct <= 100 && !la) {
    out.loanAmount = String(Math.round(vs * (ltvPct / 100)));
  } else if (la > 0 && ltvPct > 0 && ltvPct <= 100 && vs <= 0) {
    // Only infer property value when it is truly missing — not when parse failed on commas.
    out.valueSalesPrice = String(Math.round(la / (ltvPct / 100)));
  }
  return out;
}

export function mergeScenarioExtract(
  form: ChatWizardForm,
  extracted: Record<string, string>,
): Partial<ChatWizardForm> {
  const patch: Partial<ChatWizardForm> = {};
  const map: Record<string, keyof ChatWizardForm> = {
    citizenship: "citizenship",
    occupancy: "occupancy",
    loan_purpose: "loanPurpose",
    loanPurpose: "loanPurpose",
    property_type: "propertyType",
    propertyType: "propertyType",
    value_sales_price: "valueSalesPrice",
    valueSalesPrice: "valueSalesPrice",
    loan_amount: "loanAmount",
    loanAmount: "loanAmount",
    ltv: "ltv",
    decision_credit_score: "decisionCreditScore",
    fico: "decisionCreditScore",
    state: "state",
    documentation_type: "documentationType",
    documentationType: "documentationType",
    estimated_dti: "estimatedDti",
    dscr: "dscr",
    prepayment_terms: "prepaymentTerms",
    credit_event_category: "creditEventCategory",
    first_time_homebuyer: "firstTimeHomebuyer",
    is_second_lien: "isSecondLien",
  };
  for (const [k, v] of Object.entries(extracted)) {
    const key = map[k];
    if (key && v?.trim()) (patch as Record<string, string>)[key] = String(v).trim();
  }
  if (extracted.financials) {
    Object.assign(
      patch,
      sanitizeExtractedFinancials(parseFinancials(extracted.financials), extracted.financials),
    );
  }
  const fromText = parseFicoFromScenario(
    extracted.text ?? extracted.scenario ?? extracted.raw ?? "",
  );
  if (fromText && !patch.decisionCreditScore) patch.decisionCreditScore = fromText;
  const scoreRaw = extracted.decisionCreditScore ?? extracted.decision_credit_score ?? "";
  if (scoreRaw) {
    const n = parseInt(String(scoreRaw).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > 0) patch.decisionCreditScore = String(n);
  }
  const scenarioText = extracted.text ?? extracted.scenario ?? extracted.raw ?? "";
  return sanitizeExtractedFinancials(patch, scenarioText);
}

export type ChatSection = 1 | 2 | 3 | 4;

export const CHAT_SECTION_COMPLETION_MSGS: Record<1 | 2 | 3, string> = {
  1: "Section 1 done — borrower and property captured. Moving to docs & financial details...",
  2: "Docs and financial details confirmed. Now let's get the property location.",
  3: "Location confirmed. A few more details and we can run eligibility.",
};

export function getChatSection(form: ChatWizardForm): ChatSection {
  const s1 =
    filled(form.citizenship) &&
    filled(form.occupancy) &&
    filled(form.loanPurpose) &&
    filled(form.propertyType) &&
    filled(form.valueSalesPrice) &&
    filled(form.loanAmount) &&
    filled(form.ltv) &&
    (!creditScoreRequired(form) || filled(form.decisionCreditScore)) &&
    filled(form.isSecondLien) &&
    (!shouldShowSecondLienFields(form.isSecondLien) || filled(form.existingFirstLien)) &&
    (form.isSecondLien !== "no" || filled(form.existingSecondLien)) &&
    ((form.occupancy !== "Primary Residence" && form.occupancy !== "Second Home") ||
      shouldHardcodeFirstTimeHomebuyerNo(form) ||
      filled(form.firstTimeHomebuyer)) &&
    (form.occupancy !== "Investment Property" ||
      ((shouldHardcodeFirstTimeInvestorNo(form) || filled(form.firstTimeInvestor)) &&
        (!shouldShowEstablishedPrimaryRes(
          form.occupancy,
          form.firstTimeHomebuyer,
          form.firstTimeInvestor,
        ) ||
          filled(form.establishedPrimaryRes)) &&
        (isFiveEightProperty(form.propertyType) || !!form.investmentIncomePath)));
  if (!s1) return 1;

  const s2 = isDscrPath(form)
    ? filled(form.dscr) && filled(form.rentalType) && filled(form.prepaymentTerms)
    : filled(form.documentationType) &&
      filled(form.estimatedDti) &&
      (form.occupancy !== "Investment Property" || filled(form.prepaymentTerms));
  if (!s2) return 2;

  const s3 = filled(form.state) && isGeoLocationComplete(geoFormFromWizard(form));
  if (!s3) return 3;

  return 4;
}

export function isChatIntakeComplete(form: ChatWizardForm): boolean {
  if (!filled(form.citizenship) || !filled(form.occupancy) || !filled(form.loanPurpose))
    return false;
  if (!filled(form.propertyType) || !filled(form.valueSalesPrice) || !filled(form.loanAmount))
    return false;
  if (!filled(form.ltv)) return false;
  const ltvN = parseInt(form.ltv, 10);
  if (ltvN < 1 || ltvN > 100) return false;
  if (creditScoreRequired(form) && !filled(form.decisionCreditScore)) return false;
  if (!filled(form.isSecondLien)) return false;
  if (shouldShowSecondLienFields(form.isSecondLien) && !filled(form.existingFirstLien))
    return false;
  if (form.isSecondLien === "no") {
    if (!filled(form.existingSecondLien)) return false;
    if (
      existingSecondLienNeedsSubordination(form.existingSecondLien) &&
      !filled(form.existingSecondLienBalance)
    )
      return false;
  }
  if (form.occupancy === "Primary Residence" || form.occupancy === "Second Home") {
    if (shouldAskFirstTimeHomebuyer(form) && !filled(form.firstTimeHomebuyer)) return false;
  }
  if (form.occupancy === "Investment Property") {
    if (shouldAskFirstTimeInvestor(form) && !filled(form.firstTimeInvestor)) return false;
    if (
      shouldShowEstablishedPrimaryRes(
        form.occupancy,
        form.firstTimeHomebuyer,
        form.firstTimeInvestor,
      ) &&
      !filled(form.establishedPrimaryRes)
    )
      return false;
    if (!isFiveEightProperty(form.propertyType) && !form.investmentIncomePath) return false;
  }
  if (isDscrPath(form)) {
    if (!filled(form.dscr) || !filled(form.rentalType) || !filled(form.prepaymentTerms))
      return false;
  } else {
    if (!filled(form.documentationType) || !filled(form.estimatedDti)) return false;
    if (form.occupancy === "Investment Property" && !filled(form.prepaymentTerms)) return false;
  }
  if (!filled(form.state)) return false;
  const geo = geoFormFromWizard(form);
  if (!isGeoLocationComplete(geo)) return false;
  if (!filled(form.creditEventCategory)) return false;
  if (form.creditEventCategory !== "None") {
    if (!filled(form.creditEventType) || !filled(form.yearsSinceCreditEvent)) return false;
  }
  if (shouldShowPaymentHistory(form.estimatedDti, form.documentationType, form.occupancy)) {
    if (!filled(form.paymentHistory)) return false;
  }
  return true;
}

function geoFieldBySlot(state: string, county: string, slotId: string) {
  return getGeoFieldsForCounty(state, county).find((f) => f.slot_id === slotId);
}

function matchGeoOption(
  answer: string,
  state: string,
  county: string,
  slotId: string,
): string | null {
  const field = geoFieldBySlot(state, county, slotId);
  if (!field) return null;
  const opts = field.options.map((o) => ({ value: o.code, label: o.label }));
  return matchFollowUpOption(answer, opts);
}

function nextGeoQuestion(form: ChatWizardForm): ChatQuestion | null {
  if (filled(form.state) && !filled(form.stateCounty)) {
    return {
      id: "state_county",
      prompt: "Which county is the property in?",
      hint: "Search or type the county name",
    };
  }
  for (const field of getGeoFieldsForCounty(form.state, form.stateCounty)) {
    const fk = field.form_key as keyof ChatWizardForm;
    const val = String(form[fk] ?? "");
    if (field.widget === "zip") {
      if (val.replace(/\D/g, "").length !== 5) {
        return {
          id: field.slot_id,
          prompt: field.prompt ?? field.label,
          hint: field.hint,
        };
      }
      continue;
    }
    if (!filled(val)) {
      return {
        id: field.slot_id,
        prompt: field.prompt ?? field.label,
        options:
          field.widget === "yes_no" ? [...YES_NO_OPTIONS] : field.options.map((o) => o.label),
      };
    }
  }
  return null;
}

/** Next unanswered field for conversational intake (after optional scenario extract). */
export function getNextChatQuestion(
  form: ChatWizardForm,
  opts?: { skipExpressOffer?: boolean },
): ChatQuestion | null {
  if (!filled(form.citizenship)) {
    return {
      id: "citizenship",
      prompt: "First, what's the borrower's citizenship status?",
      options: [...CITIZENSHIP_OPTIONS],
    };
  }
  if (!filled(form.occupancy)) {
    return {
      id: "occupancy",
      prompt: "And the intended occupancy?",
      options: [...OCCUPANCY_OPTIONS],
    };
  }
  if (!filled(form.loanPurpose)) {
    return {
      id: "loan_purpose",
      prompt: "What's the loan purpose?",
      options: LOAN_PURPOSE_INTEGRATED.map((p) => p.label),
    };
  }
  if (!filled(form.propertyType)) {
    return {
      id: "property_type",
      prompt: "What type of property is it?",
      options: INTEGRATED_PROPERTY_TYPES.map((p) => p.label),
    };
  }
  if (!filled(form.valueSalesPrice) || !filled(form.loanAmount) || !filled(form.ltv)) {
    if (filled(form.valueSalesPrice) && !filled(form.loanAmount)) {
      const val = parseInt(form.valueSalesPrice, 10);
      if (val >= 50_000 && val <= 10_000_000) {
        const ltvOptions = [60, 65, 70, 75, 80].map((ltv) => {
          const amt = Math.round((val * ltv) / 100 / 5000) * 5000;
          const formatted =
            amt >= 1_000_000
              ? `$${(amt / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
              : `$${Math.round(amt / 1000)}K`;
          return `${formatted} (${ltv}% LTV)`;
        });
        return {
          id: "financials",
          prompt: "What loan amount are you targeting?",
          hint: `Property value: $${val.toLocaleString("en-US")} · pick by LTV or type a dollar amount`,
          options: ltvOptions,
        };
      }
    }
    return {
      id: "financials",
      prompt:
        "What are the numbers — property value and loan amount? Share any two and we'll calculate the third.",
      hint: "e.g. $850k value, $600k loan",
    };
  }
  if (creditScoreRequired(form) && !filled(form.decisionCreditScore)) {
    return {
      id: "credit_score",
      prompt: "What's the borrower's FICO score?",
      hint: "e.g. 720",
    };
  }
  if (!filled(form.isSecondLien)) {
    return {
      id: "lien_position",
      prompt: "Is this a standalone first lien, or part of a piggyback / second lien structure?",
      options: [SECOND_LIEN_NO_LABEL, SECOND_LIEN_YES_LABEL],
    };
  }
  if (shouldShowSecondLienFields(form.isSecondLien) && !filled(form.existingFirstLien)) {
    return {
      id: "existing_first_lien",
      prompt: "What's the balance on the existing first lien?",
      hint: "Dollar amount, e.g. 450000",
    };
  }
  if (form.isSecondLien === "no" && !filled(form.existingSecondLien)) {
    return {
      id: "existing_second_lien",
      prompt: "Is there already a second lien on this property that needs to be dealt with?",
      options: [...EXISTING_SECOND_LIEN_OPTIONS],
    };
  }
  if (
    form.isSecondLien === "no" &&
    existingSecondLienNeedsSubordination(form.existingSecondLien) &&
    !filled(form.existingSecondLienBalance)
  ) {
    return {
      id: "existing_second_lien_balance",
      prompt: "What's the current balance on that second lien?",
      hint: "Dollar amount",
    };
  }
  if (form.occupancy === "Primary Residence" || form.occupancy === "Second Home") {
    if (shouldAskFirstTimeHomebuyer(form) && !filled(form.firstTimeHomebuyer)) {
      return {
        id: "first_time_homebuyer",
        prompt: "Is the borrower a first-time homebuyer?",
        options: [...YES_NO_OPTIONS],
      };
    }
  }
  if (form.occupancy === "Investment Property") {
    if (shouldAskFirstTimeInvestor(form) && !filled(form.firstTimeInvestor)) {
      return {
        id: "first_time_investor",
        prompt: "Is this their first investment property?",
        options: [...YES_NO_OPTIONS],
      };
    }
    if (
      shouldShowEstablishedPrimaryRes(
        form.occupancy,
        form.firstTimeHomebuyer,
        form.firstTimeInvestor,
      ) &&
      !filled(form.establishedPrimaryRes)
    ) {
      return {
        id: "established_primary_res",
        prompt: "Does the borrower have an established primary residence of their own?",
        options: [...YES_NO_OPTIONS],
      };
    }
    if (!isFiveEightProperty(form.propertyType) && !form.investmentIncomePath) {
      return {
        id: "investment_income_path",
        prompt:
          "How will the investment property be qualified — on personal income, or DSCR / rental cash flow?",
        options: INVESTMENT_INCOME_TYPE_OPTIONS.map((o) => o.label),
      };
    }
  }
  if (isDscrPath(form)) {
    if (!filled(form.dscr)) {
      return {
        id: "dscr",
        prompt: "What's the DSCR — that's gross rent divided by PITIA?",
        hint: "e.g. 1.15",
      };
    }
    if (!filled(form.rentalType)) {
      return {
        id: "rental_type",
        prompt: "Is the rental income long-term or short-term?",
        options: [...RENTAL_TYPES],
      };
    }
    if (!filled(form.prepaymentTerms)) {
      return {
        id: "prepayment_terms",
        prompt: "Any maximum prepayment penalty term to stay within?",
        options: [...PREPAY_OPTIONS],
      };
    }
  } else {
    if (!filled(form.documentationType)) {
      return {
        id: "documentation_type",
        prompt: "How will income be documented?",
        options: [...DOC_TYPES_INTEGRATED],
      };
    }
    if (!filled(form.estimatedDti)) {
      return {
        id: "estimated_dti",
        prompt: "Roughly what's the estimated DTI?",
        hint: "Just the percentage, e.g. 43",
      };
    }
    if (form.occupancy === "Investment Property" && !filled(form.prepaymentTerms)) {
      return {
        id: "prepayment_terms",
        prompt: "Any maximum prepayment penalty term to stay within?",
        options: [...PREPAY_OPTIONS],
      };
    }
  }
  if (!filled(form.state)) {
    return {
      id: "state",
      prompt:
        "Where is the property located? State is enough to start — feel free to add a county or zip code too if you have it.",
      hint: "e.g. FL, Texas, or 'Miami-Dade'",
    };
  }
  const geoQ = nextGeoQuestion(form);
  if (geoQ) return geoQ;

  if (!filled(form.creditEventCategory)) {
    return {
      id: "credit_event_category",
      prompt:
        "Any significant credit events in the borrower's history — bankruptcy, foreclosure, short sale, mortgage lates? Or is the credit history clean?",
      options: CREDIT_EVENT_CATEGORY_OPTIONS.map((o) => o.label),
    };
  }
  if (form.creditEventCategory !== "None") {
    if (!filled(form.creditEventType)) {
      const types = creditEventTypesForCategory(form.creditEventCategory);
      return {
        id: "credit_event_type",
        prompt: `Got it — what specific type of ${form.creditEventCategory.toLowerCase()}?`,
        options: types.length ? types : undefined,
      };
    }
    if (!filled(form.yearsSinceCreditEvent)) {
      return {
        id: "years_since_credit_event",
        prompt: "And roughly how long ago was that?",
        options: [...YEARS_SINCE],
      };
    }
  }
  if (shouldShowPaymentHistory(form.estimatedDti, form.documentationType, form.occupancy)) {
    if (!filled(form.paymentHistory)) {
      return {
        id: "payment_history",
        prompt: "How has the housing payment history looked over the past 12 months?",
        options: PAYMENT_HISTORY_OPTIONS.map((o) => o.label),
      };
    }
  }
  return null;
}

export function applyChatAnswer(
  form: ChatWizardForm,
  questionId: string,
  rawAnswer: string,
): { patch: Partial<ChatWizardForm>; error?: string } {
  const answer = rawAnswer.trim();
  if (!answer) return { patch: {}, error: "Please enter a response." };

  switch (questionId) {
    case "citizenship": {
      const v = fuzzyMatchOption(answer, CITIZENSHIP_OPTIONS);
      return v ? { patch: { citizenship: v } } : { patch: {}, error: "Pick a citizenship option." };
    }
    case "occupancy": {
      const v = fuzzyMatchOption(answer, OCCUPANCY_OPTIONS);
      return v
        ? { patch: { occupancy: v } }
        : { patch: {}, error: "Pick Primary, Second Home, or Investment." };
    }
    case "loan_purpose": {
      const label = fuzzyMatchOption(
        answer,
        LOAN_PURPOSE_INTEGRATED.map((p) => p.label),
      );
      const opt = LOAN_PURPOSE_INTEGRATED.find((p) => p.label === label);
      return opt
        ? { patch: { loanPurpose: opt.value } }
        : { patch: {}, error: "Pick a loan purpose." };
    }
    case "property_type": {
      const label = fuzzyMatchOption(
        answer,
        INTEGRATED_PROPERTY_TYPES.map((p) => p.label),
      );
      const opt = INTEGRATED_PROPERTY_TYPES.find((p) => p.label === label);
      return opt
        ? { patch: { propertyType: opt.value } }
        : { patch: {}, error: "Pick a property type." };
    }
    case "financials": {
      const patch = parseFinancials(answer);
      const hasTwo =
        [patch.valueSalesPrice, patch.loanAmount, patch.ltv].filter(Boolean).length >= 2;
      if (!hasTwo)
        return {
          patch: {},
          error:
            'I didn\'t catch the numbers — please share at least two of: property value, loan amount, or LTV. E.g. "$850k value, 75% LTV"',
        };
      return { patch: triangulateLoanValues(patch) };
    }
    case "credit_score": {
      const n = parseInt(answer.replace(/\D/g, ""), 10);
      if (!Number.isFinite(n) || n <= 0)
        return { patch: {}, error: "Please enter a credit score number." };
      return { patch: { decisionCreditScore: String(n) } };
    }
    case "lien_position": {
      const v = fuzzyMatchOption(answer, [SECOND_LIEN_NO_LABEL, SECOND_LIEN_YES_LABEL]);
      if (!v) return { patch: {}, error: "Say first lien only or second lien / piggyback." };
      return {
        patch: {
          isSecondLien: v === SECOND_LIEN_YES_LABEL ? "yes" : "no",
        },
      };
    }
    case "existing_first_lien": {
      const v = parseMoney(answer);
      return v
        ? { patch: { existingFirstLien: v } }
        : { patch: {}, error: "Enter a dollar amount." };
    }
    case "existing_second_lien": {
      const v = fuzzyMatchOption(answer, EXISTING_SECOND_LIEN_OPTIONS);
      return v ? { patch: { existingSecondLien: v } } : { patch: {}, error: "Pick an option." };
    }
    case "existing_second_lien_balance": {
      const v = parseMoney(answer);
      return v
        ? { patch: { existingSecondLienBalance: v } }
        : { patch: {}, error: "Enter a dollar amount." };
    }
    case "first_time_homebuyer":
    case "first_time_investor":
    case "established_primary_res": {
      const v = fuzzyMatchOption(answer, YES_NO_OPTIONS);
      if (!v) return { patch: {}, error: "Please answer Yes or No." };
      const keyMap: Record<string, keyof ChatWizardForm> = {
        first_time_homebuyer: "firstTimeHomebuyer",
        first_time_investor: "firstTimeInvestor",
        established_primary_res: "establishedPrimaryRes",
      };
      return { patch: { [keyMap[questionId]]: v } as Partial<ChatWizardForm> };
    }
    case "is_in_indianapolis":
    case "is_in_baltimore":
    case "is_in_philadelphia":
    case "is_in_memphis":
    case "is_in_lubbock": {
      const v = matchGeoOption(answer, form.state, form.stateCounty, questionId);
      if (!v) return { patch: {}, error: "Pick a listed option." };
      const keyMap: Record<string, keyof ChatWizardForm> = {
        is_in_indianapolis: "isInIndianapolis",
        is_in_baltimore: "isInBaltimoreCity",
        is_in_philadelphia: "isInPhiladelphia",
        is_in_memphis: "isInMemphis",
        is_in_lubbock: "isInLubbock",
      };
      return { patch: { [keyMap[questionId]]: v } as Partial<ChatWizardForm> };
    }
    case "investment_income_path": {
      const label = fuzzyMatchOption(
        answer,
        INVESTMENT_INCOME_TYPE_OPTIONS.map((o) => o.label),
      );
      const opt = INVESTMENT_INCOME_TYPE_OPTIONS.find((o) => o.label === label);
      return opt
        ? { patch: { investmentIncomePath: opt.value } }
        : { patch: {}, error: "Pick personal income or DSCR / rental income." };
    }
    case "documentation_type": {
      const v = fuzzyMatchOption(answer, DOC_TYPES_INTEGRATED);
      return v
        ? { patch: { documentationType: v } }
        : { patch: {}, error: "Pick a documentation type." };
    }
    case "estimated_dti": {
      const v = parsePercent(answer);
      return v
        ? { patch: { estimatedDti: v } }
        : { patch: {}, error: "Enter DTI as a percent, e.g. 43." };
    }
    case "dscr": {
      const n = parseFloat(answer.replace(/[^\d.]/g, ""));
      if (!Number.isFinite(n) || n <= 0)
        return { patch: {}, error: "Enter a valid DSCR, e.g. 1.1." };
      return { patch: { dscr: String(n) } };
    }
    case "rental_type": {
      const v = fuzzyMatchOption(answer, RENTAL_TYPES);
      return v
        ? { patch: { rentalType: v } }
        : { patch: {}, error: "Long-term or short-term rental." };
    }
    case "prepayment_terms": {
      const v = fuzzyMatchOption(answer, PREPAY_OPTIONS);
      return v
        ? { patch: { prepaymentTerms: v } }
        : { patch: {}, error: "Pick a prepayment term." };
    }
    case "state": {
      const code = matchState(answer);
      return code ? { patch: { state: code } } : { patch: {}, error: "Enter a valid U.S. state." };
    }
    case "state_county": {
      const name = answer.trim();
      if (!name) return { patch: {}, error: "Enter a county name." };
      return {
        patch: {
          stateCounty: name,
          ...clearGeoFollowupFieldsPatch(),
          ...inferGeoFollowupsFromCounty(form.state, name),
        },
      };
    }
    case "state_city":
    case "state_borough": {
      const v = matchGeoOption(answer, form.state, form.stateCounty, questionId);
      const field = geoFieldBySlot(form.state, form.stateCounty, questionId);
      if (!field) return { patch: {}, error: "Invalid location option." };
      return v
        ? { patch: { [field.form_key]: v } as Partial<ChatWizardForm> }
        : { patch: {}, error: "Pick a listed option." };
    }
    case "state_zip": {
      const zip = answer.replace(/\D/g, "").slice(0, 5);
      if (zip.length !== 5) return { patch: {}, error: "Enter a 5-digit ZIP." };
      return { patch: { stateZipCode: zip } };
    }
    case "credit_event_category": {
      const v = matchFollowUpOption(answer, CREDIT_EVENT_CATEGORY_OPTIONS);
      return v
        ? {
            patch: {
              creditEventCategory: v,
              ...(v === "None" ? { creditEventType: "", yearsSinceCreditEvent: "" } : {}),
            },
          }
        : { patch: {}, error: "Pick a credit event category or None." };
    }
    case "credit_event_type": {
      const types = creditEventTypesForCategory(form.creditEventCategory);
      const v = fuzzyMatchOption(answer, types);
      return v ? { patch: { creditEventType: v } } : { patch: {}, error: "Pick an event type." };
    }
    case "years_since_credit_event": {
      const v = fuzzyMatchOption(answer, YEARS_SINCE);
      return v
        ? { patch: { yearsSinceCreditEvent: v } }
        : { patch: {}, error: "Pick a time range." };
    }
    case "payment_history": {
      const v = matchFollowUpOption(answer, PAYMENT_HISTORY_OPTIONS);
      return v
        ? { patch: { paymentHistory: v } }
        : { patch: {}, error: "Pick a payment history option." };
    }
    case "express_path_offer":
      return { patch: {} };
    default:
      return { patch: {} };
  }
}

export const CHAT_PROFILE_UPDATED_MSG =
  "Got it — I've pulled what I can from your scenario. Just a few quick follow-up questions to fill in the gaps.";

export const CHAT_ANSWER_HINT = "You can type the number or just say it in your own words.";

export function formatQuestionMessage(q: ChatQuestion): string {
  const text = q.prompt.trim();
  const opts = q.options;

  if (!opts?.length) {
    return q.hint ? `${text}\n\n_${q.hint}_` : text;
  }

  if (opts.length === 2) {
    // Binary — inline
    return `${text} (${opts[0]} / ${opts[1]})`;
  }

  if (opts.length <= 4) {
    // Short list — compact, one per line
    return `${text}\n\n${opts.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
  }

  // Long list
  return `${text}\n\n${opts.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
}

/** Builds a chat message string for a question.
 *  For questions with 3+ options, returns a QUESTION_WITH_OPTIONS: prefix
 *  so the UI can render clickable chips instead of a numbered list. */
export function buildQuestionMsg(q: ChatQuestion): string {
  const text = q.prompt.trim();
  const opts = q.options;

  if (!opts?.length) {
    return q.hint ? `${text}\n\n_${q.hint}_` : text;
  }

  if (opts.length === 2) {
    return `QUESTION_WITH_OPTIONS:${JSON.stringify({ prompt: text, hint: q.hint, options: opts })}`;
  }

  return `QUESTION_WITH_OPTIONS:${JSON.stringify({ prompt: text, hint: q.hint, options: opts })}`;
}

export function chatFormFromWizard(form: Record<string, unknown>): ChatWizardForm {
  return {
    citizenship: String(form.citizenship ?? ""),
    occupancy: String(form.occupancy ?? ""),
    loanPurpose: String(form.loanPurpose ?? ""),
    propertyType: String(form.propertyType ?? ""),
    valueSalesPrice: String(form.valueSalesPrice ?? ""),
    loanAmount: String(form.loanAmount ?? ""),
    ltv: String(form.ltv ?? ""),
    decisionCreditScore: String(form.decisionCreditScore ?? ""),
    isSecondLien: String(form.isSecondLien ?? ""),
    existingFirstLien: String(form.existingFirstLien ?? ""),
    existingSecondLien: String(form.existingSecondLien ?? ""),
    existingSecondLienBalance: String(form.existingSecondLienBalance ?? ""),
    firstTimeHomebuyer: String(form.firstTimeHomebuyer ?? ""),
    firstTimeInvestor: String(form.firstTimeInvestor ?? ""),
    establishedPrimaryRes: String(form.establishedPrimaryRes ?? ""),
    investmentIncomePath: (form.investmentIncomePath as InvestmentPath) || "",
    documentationType: String(form.documentationType ?? ""),
    estimatedDti: String(form.estimatedDti ?? ""),
    dscr: String(form.dscr ?? ""),
    rentalType: String(form.rentalType ?? ""),
    prepaymentTerms: String(form.prepaymentTerms ?? ""),
    state: String(form.state ?? ""),
    stateCounty: String(form.stateCounty ?? ""),
    stateCity: String(form.stateCity ?? ""),
    stateBorough: String(form.stateBorough ?? ""),
    stateZipCode: String(form.stateZipCode ?? ""),
    isInBaltimoreCity: String(form.isInBaltimoreCity ?? ""),
    isInIndianapolis: String(form.isInIndianapolis ?? ""),
    isInPhiladelphia: String(form.isInPhiladelphia ?? ""),
    isInMemphis: String(form.isInMemphis ?? ""),
    isInLubbock: String(form.isInLubbock ?? ""),
    creditEventCategory: String(form.creditEventCategory ?? ""),
    creditEventType: String(form.creditEventType ?? ""),
    yearsSinceCreditEvent: String(form.yearsSinceCreditEvent ?? ""),
    paymentHistory: String(form.paymentHistory ?? ""),
  };
}

/** Returns a natural-language follow-up question covering up to 3 priority missing areas.
 *  Returns empty string when nothing material is missing. */
export function buildFreeTextFollowup(form: ChatWizardForm): string {
  const missing: string[] = [];
  // Financials come first — loan amount and value are the most critical missing pieces
  if (!filled(form.valueSalesPrice) || !filled(form.loanAmount))
    missing.push("the property value and loan amount (e.g. $850k value, $650k loan)");
  if (!filled(form.state)) missing.push("where the property is located (state or city)");
  if (!filled(form.loanPurpose))
    missing.push("the loan purpose — purchase, refinance, or cash-out");
  if (creditScoreRequired(form) && !filled(form.decisionCreditScore))
    missing.push("the borrower's credit score");
  if (!isDscrPath(form) && !filled(form.documentationType))
    missing.push("documentation type — full doc, bank statement, P&L, etc.");
  if (isDscrPath(form) && !filled(form.dscr)) missing.push("the DSCR ratio (e.g. 1.20)");
  if (!isDscrPath(form) && filled(form.documentationType) && !filled(form.estimatedDti))
    missing.push("the estimated DTI");
  if (!filled(form.creditEventCategory))
    missing.push("any credit events (bankruptcy, foreclosure, lates) or confirm clean history");

  const areas = missing.slice(0, 3);
  if (areas.length === 0) return "";
  if (areas.length === 1) return `One more thing — could you share ${areas[0]}?`;
  const bullets = areas.map((a) => `• ${a}`).join("\n");
  return `To sharpen the results, a few more details:\n\n${bullets}\n\nFeel free to answer in your own words.`;
}
