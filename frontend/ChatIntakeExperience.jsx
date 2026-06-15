import React, { useState, useRef, useEffect, useMemo } from "react";

// ════════════════════════════════════════════════════════════════════════════
// ChatIntakeExperience — Claude-style chat flow with numbered cards
// ════════════════════════════════════════════════════════════════════════════
// Replaces the embedded form modal that appears after the user clicks "Start".
// Each question shows as a chat message with numbered cards below it.
// Mortgage Profile sidebar on the left updates as answers come in.
//
// To wire up the real backend, replace `mockNextQuestion()` with a call to
// /api/intake/message and pull `nextQuestion` from the response.
// ════════════════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────────────
// QUESTION DEFINITIONS — replace/extend with your full question set
// ────────────────────────────────────────────────────────────────────────────

// The DTI threshold above which we ask for extra details (NOCB, residual
// income). When the borrower's estimated DTI exceeds this allowed threshold,
// the conditional questions activate. Adjust here to keep the notice text
// and the showIf predicates in sync.
const MAX_ALLOWED_DTI = 43;

const QUESTIONS = [
  // Step 1 — Basics
  {
    id: "citizenship",
    step: 1,
    stepName: "Basics",
    field: "citizenship",
    text: "What's the citizenship status of the primary borrower?",
    type: "multi-choice",
    options: [
      { value: "us_citizen", label: "US Citizen" },
      { value: "permanent_resident", label: "Permanent Resident" },
      { value: "non_permanent_resident", label: "Non-Permanent Resident" },
      { value: "foreign_national", label: "Foreign National" },
      { value: "itin_daca", label: "ITIN / DACA" },
    ],
  },
  {
    id: "ofac",
    step: 1,
    stepName: "Basics",
    field: "ofacSanctioned",
    text: "Is the borrower from an OFAC-sanctioned country?",
    type: "yes-no",
    showIf: (s) => s.citizenship === "foreign_national",
  },
  {
    id: "us_credit",
    step: 1,
    stepName: "Basics",
    field: "hasUsCredit",
    text: "Does the borrower have US credit?",
    type: "yes-no",
    showIf: (s) => s.citizenship === "foreign_national",
  },
  {
    id: "occupancy",
    step: 1,
    stepName: "Basics",
    field: "occupancy",
    text: "What's the occupancy type?",
    type: "multi-choice",
    options: [
      { value: "primary", label: "Primary Residence" },
      { value: "second_home", label: "Second Home" },
      { value: "investment", label: "Investment Property" },
    ],
    filterOptions: (s) =>
      s.citizenship === "foreign_national" ? (o) => o.value !== "primary" : null,
  },
  {
    id: "loan_purpose",
    step: 1,
    stepName: "Basics",
    field: "loanPurpose",
    text: "What's the loan purpose?",
    type: "multi-choice",
    options: [
      { value: "purchase", label: "Purchase", description: "Buying a home" },
      {
        value: "rate_term",
        label: "Rate & Term Refinance",
        description: "Lower rate, same balance",
      },
      { value: "cash_out", label: "Cash-Out Refinance", description: "Pull equity out" },
    ],
  },
  {
    id: "lien_position",
    step: 1,
    stepName: "Basics",
    field: "lienPosition",
    text: "What's the lien position?",
    type: "multi-choice",
    optionsFn: (s) => {
      if (s.loanPurpose === "purchase") {
        return [
          { value: "first", label: "First Lien" },
          { value: "piggyback", label: "Piggyback (new first + new second)" },
        ];
      }
      if (s.loanPurpose === "rate_term") {
        return [
          { value: "first", label: "First Lien" },
          { value: "second", label: "Second Lien — Standalone (HELOC / HELOAN)" },
          { value: "piggyback", label: "Piggyback (new first + new second)" },
        ];
      }
      if (s.loanPurpose === "cash_out") {
        return [
          { value: "first", label: "First Lien" },
          { value: "second", label: "Second Lien (HELOC / HELOAN with cash)" },
        ];
      }
      return [];
    },
  },
  {
    id: "second_lien_type",
    step: 1,
    stepName: "Basics",
    field: "secondLienType",
    text: "What type of second lien?",
    type: "multi-choice",
    options: [
      { value: "heloc", label: "HELOC", description: "Revolving line of credit" },
      { value: "heloan", label: "HELOAN / Closed-End", description: "Fixed lump sum" },
    ],
    showIf: (s) => s.lienPosition === "second",
  },
  {
    id: "property_type",
    step: 1,
    stepName: "Basics",
    field: "propertyType",
    text: "What's the property type?",
    type: "multi-choice",
    options: [
      { value: "single_family", label: "Single Family" },
      { value: "pud", label: "PUD" },
      { value: "townhouse", label: "Townhouse" },
      { value: "condo", label: "Condominium" },
      { value: "two_to_four", label: "2-4 Units" },
    ],
  },
  {
    id: "value_loan_ltv",
    step: 1,
    stepName: "Basics",
    fields: ["propertyValue", "loanAmount", "ltv"],
    text: "What are the property value, loan amount, and LTV? Enter any two — the third auto-fills.",
    type: "triangle",
  },
  {
    id: "credit_score",
    step: 1,
    stepName: "Basics",
    field: "creditScore",
    text: "What's the decision credit score? (Middle of 3 / lower of 2)",
    type: "number",
    placeholder: "e.g., 720",
    showIf: (s) => !(s.citizenship === "foreign_national" && s.hasUsCredit === "no"),
  },

  // Step 2 — Capacity
  {
    id: "doc_type",
    step: 2,
    stepName: "Capacity",
    field: "documentationType",
    text: "What documentation type will the borrower use?",
    type: "multi-choice",
    options: [
      { value: "full_doc", label: "Full Documentation" },
      { value: "bank_stmt_personal", label: "Bank Statements — Personal" },
      { value: "bank_stmt_business", label: "Bank Statements — Business" },
      { value: "pl_only", label: "P&L Only" },
      { value: "asset_util", label: "Asset Utilization" },
    ],
    showIf: (s) => s.occupancy !== "investment" || s.investmentIncomePath === "personal_income",
  },
  {
    id: "dti",
    step: 2,
    stepName: "Capacity",
    field: "estimatedDti",
    text: "What's the estimated DTI (debt-to-income)?",
    type: "number",
    suffix: "%",
    placeholder: "e.g., 42",
    showIf: (s) => s.occupancy !== "investment" || s.investmentIncomePath === "personal_income",
  },

  // High-DTI conditional block: notice + a single compound form bundling
  // the 3 NOCB questions and 2 residual-income questions together.
  {
    id: "high_dti_notice",
    step: 2,
    stepName: "Capacity",
    field: "highDtiAck",
    text: `Since DTI is higher than the allowed threshold (${MAX_ALLOWED_DTI}%), we need a few additional details — about any Non-Occupant Co-Borrower (NOCB) and your residual income — to find programs that fit.`,
    type: "notice",
    showIf: (s) => Number(s.estimatedDti) > MAX_ALLOWED_DTI,
  },
  {
    id: "high_dti_followup",
    step: 2,
    stepName: "Capacity",
    text: "Additional details — NOCB & Residual Income",
    type: "compound-high-dti",
    // Bundles 5 fields; sidebar still surfaces each via the meta entries below.
    fields: ["hasNocb", "nocbRelationship", "combinedDti", "householdSize", "residualIncome"],
    showIf: (s) => Number(s.estimatedDti) > MAX_ALLOWED_DTI,
  },
  // ── Field-only meta entries — never rendered as chat questions (groupedInto
  //    flag tells findNextActiveQuestion to skip them). They exist so the
  //    sidebar can humanize each individual field set by the compound form.
  {
    id: "has_nocb",
    step: 2,
    stepName: "Capacity",
    field: "hasNocb",
    type: "yes-no",
    groupedInto: "high_dti_followup",
  },
  {
    id: "nocb_relationship",
    step: 2,
    stepName: "Capacity",
    field: "nocbRelationship",
    type: "multi-choice",
    options: [
      { value: "spouse", label: "Spouse / Partner" },
      { value: "parent", label: "Parent" },
      { value: "sibling", label: "Sibling" },
      { value: "child", label: "Child" },
      { value: "other_relative", label: "Other Relative" },
      { value: "non_relative", label: "Non-Relative" },
    ],
    groupedInto: "high_dti_followup",
  },
  {
    id: "combined_dti",
    step: 2,
    stepName: "Capacity",
    field: "combinedDti",
    type: "number",
    suffix: "%",
    groupedInto: "high_dti_followup",
  },
  {
    id: "household_size",
    step: 2,
    stepName: "Capacity",
    field: "householdSize",
    type: "number",
    groupedInto: "high_dti_followup",
  },
  {
    id: "residual_income",
    step: 2,
    stepName: "Capacity",
    field: "residualIncome",
    type: "number",
    prefix: "$",
    groupedInto: "high_dti_followup",
  },

  // Step 3 — Credit
  {
    id: "housing_history",
    step: 3,
    stepName: "Credit",
    field: "housingHistory",
    text: "What's the borrower's housing payment history over the last 12 months?",
    type: "multi-choice",
    options: [
      { value: "0x30x12", label: "0×30×12 — No lates" },
      { value: "1x30x12", label: "1×30×12 — One 30-day late" },
      { value: "0x60x12", label: "0×60×12 — No 60-day lates" },
      { value: "1x60x12", label: "1×60×12 — One 60-day late" },
    ],
  },
  {
    id: "has_credit_event",
    step: 3,
    stepName: "Credit",
    field: "hasCreditEvent",
    text: "Are there any prior credit events (bankruptcy, foreclosure, etc.)?",
    type: "yes-no",
  },
  {
    id: "credit_event_types",
    step: 3,
    stepName: "Credit",
    field: "creditEventTypes",
    text: "Which credit events occurred? Select all that apply.",
    type: "multi-select",
    options: [
      { value: "ch7", label: "Bankruptcy — Chapter 7 Discharged" },
      { value: "ch13", label: "Bankruptcy — Chapter 13 Discharged / Filed" },
      { value: "fc", label: "Foreclosure" },
      { value: "ss", label: "Short Sale" },
      { value: "dil", label: "Deed in Lieu" },
      { value: "mod", label: "Loan Modification" },
      { value: "nod", label: "Notice of Default" },
      { value: "mortlate", label: "Mortgage Late (30 / 60 / 90)" },
    ],
    showIf: (s) => s.hasCreditEvent === "yes",
  },
  {
    id: "credit_event_timeline",
    step: 3,
    stepName: "Credit",
    field: "creditEventDates",
    text: "When did each event occur? Pick a time bucket or enter the date.",
    type: "credit-events-timeline",
    showIf: (s) =>
      s.hasCreditEvent === "yes" &&
      Array.isArray(s.creditEventTypes) &&
      s.creditEventTypes.length > 0,
  },

  // Step 4 — Collateral
  {
    id: "state",
    step: 4,
    stepName: "Collateral",
    field: "state",
    text: "What state is the property in?",
    type: "select",
    placeholder: "Select a state…",
    options: [
      { value: "AL", label: "Alabama" },
      { value: "AK", label: "Alaska" },
      { value: "AZ", label: "Arizona" },
      { value: "AR", label: "Arkansas" },
      { value: "CA", label: "California" },
      { value: "CO", label: "Colorado" },
      { value: "CT", label: "Connecticut" },
      { value: "DE", label: "Delaware" },
      { value: "DC", label: "District of Columbia" },
      { value: "FL", label: "Florida" },
      { value: "GA", label: "Georgia" },
      { value: "HI", label: "Hawaii" },
      { value: "ID", label: "Idaho" },
      { value: "IL", label: "Illinois" },
      { value: "IN", label: "Indiana" },
      { value: "IA", label: "Iowa" },
      { value: "KS", label: "Kansas" },
      { value: "KY", label: "Kentucky" },
      { value: "LA", label: "Louisiana" },
      { value: "ME", label: "Maine" },
      { value: "MD", label: "Maryland" },
      { value: "MA", label: "Massachusetts" },
      { value: "MI", label: "Michigan" },
      { value: "MN", label: "Minnesota" },
      { value: "MS", label: "Mississippi" },
      { value: "MO", label: "Missouri" },
      { value: "MT", label: "Montana" },
      { value: "NE", label: "Nebraska" },
      { value: "NV", label: "Nevada" },
      { value: "NH", label: "New Hampshire" },
      { value: "NJ", label: "New Jersey" },
      { value: "NM", label: "New Mexico" },
      { value: "NY", label: "New York" },
      { value: "NC", label: "North Carolina" },
      { value: "ND", label: "North Dakota" },
      { value: "OH", label: "Ohio" },
      { value: "OK", label: "Oklahoma" },
      { value: "OR", label: "Oregon" },
      { value: "PA", label: "Pennsylvania" },
      { value: "RI", label: "Rhode Island" },
      { value: "SC", label: "South Carolina" },
      { value: "SD", label: "South Dakota" },
      { value: "TN", label: "Tennessee" },
      { value: "TX", label: "Texas" },
      { value: "UT", label: "Utah" },
      { value: "VT", label: "Vermont" },
      { value: "VA", label: "Virginia" },
      { value: "WA", label: "Washington" },
      { value: "WV", label: "West Virginia" },
      { value: "WI", label: "Wisconsin" },
      { value: "WY", label: "Wyoming" },
    ],
  },
  {
    id: "rural",
    step: 4,
    stepName: "Collateral",
    field: "isRuralProperty",
    text: "Is the property rural?",
    type: "yes-no",
  },

  // Step 5 — Conditions
  {
    id: "poa",
    step: 5,
    stepName: "Considerations",
    field: "powerOfAttorney",
    text: "Will the loan be signed via Power of Attorney?",
    type: "yes-no",
  },
  {
    id: "non_arm",
    step: 5,
    stepName: "Considerations",
    field: "nonArmsLength",
    text: "Is this a non-arm's length transaction (selling between relatives / partners)?",
    type: "yes-no",
  },

  // Optional product preferences — user can skip with "No Preference"
  {
    id: "rate_type_pref",
    step: 5,
    stepName: "Considerations",
    field: "rateTypePref",
    text: "Rate type preference?",
    optional: true,
    type: "multi-choice",
    options: [
      { value: "no_pref", label: "No Preference" },
      { value: "fixed", label: "Fixed-rate", description: "Same rate for the life of the loan" },
      {
        value: "arm",
        label: "Adjustable-rate (ARM)",
        description: "Rate adjusts after intro period",
      },
    ],
  },
  {
    id: "loan_term_pref",
    step: 5,
    stepName: "Considerations",
    field: "loanTermPref",
    text: "Loan term preference?",
    optional: true,
    type: "multi-choice",
    options: [
      { value: "no_pref", label: "No Preference" },
      { value: "10", label: "10 years" },
      { value: "15", label: "15 years" },
      { value: "20", label: "20 years" },
      { value: "25", label: "25 years" },
      { value: "30", label: "30 years" },
      { value: "40", label: "40 years" },
    ],
  },
  {
    id: "io_pref",
    step: 5,
    stepName: "Considerations",
    field: "ioPref",
    text: "Interest-Only (I/O) preference?",
    optional: true,
    type: "multi-choice",
    options: [
      { value: "no_pref", label: "No Preference" },
      {
        value: "yes_io",
        label: "Yes — I want Interest-Only",
        description: "Lower initial payments",
      },
      { value: "no_io", label: "No — fully amortizing only" },
    ],
  },
];

// ────────────────────────────────────────────────────────────────────────────
// CHAT-MODE EXTRACTION — parses freeform mortgage narratives into scenario
// fields using keyword/regex patterns. Replace with an LLM-backed extractor
// (e.g. POST /api/extract-scenario) when you wire up the backend.
// ────────────────────────────────────────────────────────────────────────────

const US_STATE_NAMES = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

// Parse "600.000", "$600,000", "600k", "1.5M" into a plain numeric string
function parseAmount(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase().replace(/[$\s]/g, "");
  // Drop any leading or trailing separators that snuck in from greedy captures
  s = s.replace(/^[.,]+/, "").replace(/[.,]+$/, "");
  let multiplier = 1;
  if (s.endsWith("k")) {
    multiplier = 1_000;
    s = s.slice(0, -1);
  } else if (s.endsWith("m")) {
    multiplier = 1_000_000;
    s = s.slice(0, -1);
  }
  // Heuristic: if the value matches "NNN.NNN" or "N,NNN" (thousands grouping),
  // strip all separators. Otherwise treat "." as decimal and "," as removable.
  const looksLikeThousandsSep = /^\d{1,3}([.,]\d{3})+$/.test(s);
  if (looksLikeThousandsSep) s = s.replace(/[.,]/g, "");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return String(Math.round(n * multiplier));
}

function extractScenarioFromText(text) {
  const t = " " + text.toLowerCase() + " ";
  const out = {};
  const notes = []; // observations the assistant can mention
  const ambiguous = []; // things that need clarification

  // ── Citizenship
  if (/\bus\s*citizen\b/.test(t)) out.citizenship = "us_citizen";
  else if (/\bpermanent\s*resident\b|\bgreen\s*card\b/.test(t))
    out.citizenship = "permanent_resident";
  else if (/\bnon[-\s]*permanent\b/.test(t)) out.citizenship = "non_permanent_resident";
  else if (/\bforeign\s*national\b/.test(t)) out.citizenship = "foreign_national";
  else if (/\bitin\b|\bdaca\b/.test(t)) out.citizenship = "itin_daca";

  // ── Occupancy
  if (/\bprimary\s*(?:residence|home)?\b|\bowner[-\s]*occupied\b/.test(t))
    out.occupancy = "primary";
  else if (/\bsecond\s*home\b|\bvacation\s*home\b/.test(t)) out.occupancy = "second_home";
  else if (/\binvestment\s*(?:property)?\b|\brental\b|\bdscr\b/.test(t))
    out.occupancy = "investment";

  // ── Lien position
  if (/\bfirst\s*lien\b|\b1st\s*lien\b/.test(t)) out.lienPosition = "first";
  else if (/\bpiggyback\b/.test(t)) out.lienPosition = "piggyback";
  else if (/\bsecond\s*lien\b|\b2nd\s*lien\b|\bstandalone\s*second\b/.test(t))
    out.lienPosition = "second";

  // ── Property type
  if (/\bsingle[\s-]*family\b/.test(t)) out.propertyType = "single_family";
  else if (/\bpud\b/.test(t)) out.propertyType = "pud";
  else if (/\btownhouse\b|\btownhome\b/.test(t)) out.propertyType = "townhouse";
  else if (/\bcondo\b|\bcondominium\b/.test(t)) out.propertyType = "condo";
  else if (
    /\b2[-\s]*4\s*unit|\btwo[\s-]to[\s-]four\b|\bduplex|\btriplex|\bfourplex|\bquadplex\b/.test(t)
  )
    out.propertyType = "two_to_four";

  // ── Documentation
  if (/\bfull\s*doc(?:umentation)?\b/.test(t)) out.documentationType = "full_doc";
  else if (/\bbusiness\s*bank\s*statements?\b/.test(t))
    out.documentationType = "bank_stmt_business";
  else if (/\bpersonal\s*bank\s*statements?\b/.test(t))
    out.documentationType = "bank_stmt_personal";
  else if (/\bbank\s*statements?\b/.test(t)) {
    out.documentationType = "bank_stmt_personal";
    ambiguous.push({ field: "documentationType", reason: "Personal or business bank statements?" });
  } else if (/\bp\s*&\s*l\b|\bp\s*and\s*l\b|\bprofit\s*(?:and|&)\s*loss\b/.test(t))
    out.documentationType = "pl_only";
  else if (/\basset\s*util/.test(t)) out.documentationType = "asset_util";

  // ── FICO / credit score
  const ficoMatch = t.match(/\b(?:fico|credit\s*score|score)\s*(?:is|of|:)?\s*(\d{3})\b/);
  if (ficoMatch) out.creditScore = ficoMatch[1];

  // ── DTI
  const dtiMatch = t.match(/\bdti\s*(?:is|of|:)?\s*(\d{1,2})\s*%?\b/);
  if (dtiMatch) out.estimatedDti = dtiMatch[1];

  // ── State (and county hint goes into a note)
  for (const [name, abbr] of Object.entries(US_STATE_NAMES)) {
    const re = new RegExp("\\b" + name.replace(/ /g, "\\s+") + "\\b");
    if (re.test(t)) {
      out.state = abbr;
      break;
    }
  }
  const countyMatch = text.match(/\b([A-Z][a-z]+)\s+County\b/);
  if (countyMatch) notes.push(`Noted county: ${countyMatch[1]} County (not used by matcher).`);

  // ── Loan amount / Property value / LTV
  // Property value cues: "value", "worth", "appraised", "property is X"
  const valueMatch = text.match(
    /\b(?:value|worth|appraised(?:\s*at)?|property\s*(?:is|worth|value))\s*(?:is|of|:|at)?\s*\$?\s*([\d.,kKmM]+)/i,
  );
  if (valueMatch) {
    const v = parseAmount(valueMatch[1]);
    if (v) out.propertyValue = v;
  }
  // Loan amount cues: "loan amount", "loan is", "borrowing"
  const loanMatch = text.match(
    /\bloan\s*(?:amount|size)?\s*(?:is|of|:|at)?\s*\$?\s*([\d.,kKmM]+)/i,
  );
  if (loanMatch) {
    const v = parseAmount(loanMatch[1]);
    if (v) out.loanAmount = v;
  }
  // Compute LTV if both are present
  if (out.loanAmount && out.propertyValue) {
    const ltv = (Number(out.loanAmount) / Number(out.propertyValue)) * 100;
    if (isFinite(ltv) && ltv > 0) out.ltv = ltv.toFixed(2);
  }

  // ── Loan purpose: cash-out / rate-term / purchase
  if (/\bcash[-\s]*out\b|\bpull(?:ing)?\s*equity\s*out\b/.test(t)) out.loanPurpose = "cash_out";
  else if (/\brate[\s-]*(?:and|&)?[\s-]*term\b|\br&t\b/.test(t)) out.loanPurpose = "rate_term";
  else if (/\bpurchase\b|\bbuying\b|\bbuy\s*a\b/.test(t)) out.loanPurpose = "purchase";
  // Inference: "pay off the first for X out of Y" → cash-out refinance
  else if (/\bpay\s*off\b.*\bout\s*of\b/.test(t)) {
    out.loanPurpose = "cash_out";
    notes.push(
      'Inferred Cash-Out Refinance from "pay off the first … out of …" — confirm if wrong.',
    );
  }

  // ── Housing payment history
  if (/\b0\s*x\s*30\s*x\s*12\b|\bclean\s*(?:payment\s*)?history\b|\bno\s*lates?\b/.test(t))
    out.housingHistory = "0x30x12";
  else if (/\b1\s*x\s*30\s*x\s*12\b|\bone\s*30[-\s]*day\s*late\b/.test(t))
    out.housingHistory = "1x30x12";

  // ── Credit events flag
  if (/\bno\s*credit\s*events?\b|\bno\s*bk\b|\bno\s*foreclosure\b/.test(t))
    out.hasCreditEvent = "no";
  else if (
    /\bbankruptcy\b|\bforeclosure\b|\bshort\s*sale\b|\bdeed[-\s]*in[-\s]*lieu\b|\bcredit\s*event\b/.test(
      t,
    )
  )
    out.hasCreditEvent = "yes";

  // ── Loose mentions worth surfacing to the assistant
  const reservesMatch = t.match(
    /\b(\d+)\s*(?:months?|mos?)\s*(?:of)?\s*(?:liquid\s*)?(?:assets?|reserves?)\b/,
  );
  if (reservesMatch)
    notes.push(
      `Noted reserves: ${reservesMatch[1]} months of liquid assets (not a matcher field — useful for AE).`,
    );
  const prepayMatch = t.match(/\b(\d+)\s*[-\s]*year\s*prepay(?:ment)?\b/);
  if (prepayMatch) notes.push(`Noted prepay: ${prepayMatch[1]}-year prepay (DSCR-style overlay).`);

  return { extracted: out, notes, ambiguous };
}

// Conversational prompts used by Chat Mode — each explains *why* the question
// matters, hints at the possible responses, then asks. Falls back to
// question.text when a field isn't listed here.
const CONVERSATIONAL_PROMPTS = {
  citizenship:
    "Let's start with citizenship/residency. Some programs are available only to U.S. citizens and permanent residents, while others are designed specifically for ITIN borrowers, visa holders, and foreign nationals. What's the borrower's citizenship or residency status?",
  ofacSanctioned:
    "Borrowers from OFAC-sanctioned countries are ineligible for almost every program by federal regulation, so we need to check this up front. Is the borrower from an OFAC-sanctioned country?",
  hasUsCredit:
    "If the borrower has no US credit history we have to route to alternative-tradeline or limited-doc programs. Does the borrower have US credit history?",
  occupancy:
    "Primary residences unlock the best pricing and the widest set of programs. Second homes have stricter LTV caps; investment properties typically need DSCR or qualifying with personal income. Will this be a primary residence, a second home, or an investment property?",
  loanPurpose:
    "Purchases, rate-and-term refinances, and cash-out refinances each follow different LTV caps and seasoning rules. Which one is this — purchase, rate-and-term refi, or cash-out refi?",
  lienPosition:
    "First liens are most common. Piggybacks pair a new first with a new second so we can keep the first below jumbo or PMI thresholds. Standalone seconds (HELOC / HELOAN) sit behind an existing first. Which structure — first lien, piggyback, or second lien?",
  secondLienType:
    "HELOCs are revolving lines of credit with variable rates; HELOANs are closed-end fixed-rate lump sums. For the second lien, is it a HELOC or HELOAN?",
  propertyType:
    "Single family and PUDs are the most program-friendly. Condos need warrantability checks; 2-4 units require unit-mix and rental docs. What kind of property — single family, PUD, townhouse, condo, or 2-4 units?",
  creditScore:
    "FICO drives both eligibility tier and pricing — most programs step at 660 / 680 / 700 / 720 / 740. What's the decision FICO (middle of three, or lower of two scores)?",
  documentationType:
    "Doc type defines how income gets calculated. Full doc uses tax returns and W-2s; bank statements use 12-24 months of deposits; P&L only is profit-and-loss without statements; asset utilization converts liquid assets to qualifying income. Which path will the borrower use?",
  estimatedDti:
    "DTI above 43% triggers a residual income test plus an NOCB option; over 50% raises the residual floor to $3,500. What's the estimated DTI percentage?",
  housingHistory:
    "The borrower's housing payment performance over the last 12 months sets the baseline credit grade. Is it 0×30×12 (clean), 1×30×12 (one 30-day late), 0×60×12 (no 60-day lates), or 1×60×12?",
  hasCreditEvent:
    "Bankruptcy, foreclosure, short sale, deed-in-lieu, modification, or notice of default each trigger their own seasoning rules per program. Any prior credit events?",
  state:
    "State drives geo overlays, prepay restrictions, and disclosure requirements (NY, HI, TX cash-out, etc.). What state is the property in?",
  isRuralProperty:
    "Rural properties usually carry lower max LTV caps and tighter appraisal rules. Is the property in a rural area?",
  powerOfAttorney:
    "POA-signed loans require recordation of the POA and additional documentation. Will this loan be signed via Power of Attorney?",
  nonArmsLength:
    "Non-arm's length transactions (between family or business partners) trigger extra appraisal scrutiny and gift-fund restrictions. Is this a non-arm's length transaction?",
  rateTypePref:
    "Some programs are fixed-rate only; others lean ARM. If you have a preference up front it narrows the list. Any preference — fixed-rate, ARM, or no preference?",
  loanTermPref:
    "Term length impacts both the monthly payment and the rate. Any preference — 10, 15, 20, 25, 30, or 40 years (or no preference)?",
  ioPref:
    "Interest-only lowers the initial payment but raises the qualifying payment, which affects DTI. Any preference on I/O?",
};

// Helper — get the active list of options for a question given current scenario
function getOptions(question, scenario) {
  if (question.optionsFn) return question.optionsFn(scenario);
  if (question.filterOptions) {
    const filter = question.filterOptions(scenario);
    if (filter) return question.options.filter(filter);
  }
  if (question.type === "yes-no") {
    return [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];
  }
  return question.options || [];
}

// ────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ────────────────────────────────────────────────────────────────────────────

// Convert 0-based index to letter (0 → A, 1 → B, ... 25 → Z)
const indexToLetter = (i) => String.fromCharCode(65 + i);

function LetteredCard({ letter, option, onClick }) {
  return (
    <button onClick={onClick} style={styles.numberedCard}>
      <span style={styles.numberCircle}>{letter}</span>
      <div>
        <div style={styles.numberedCardTitle}>{option.label}</div>
        {option.description && <div style={styles.numberedCardDesc}>{option.description}</div>}
      </div>
    </button>
  );
}

// Time buckets used by the credit-events timeline rows
const CREDIT_EVENT_BUCKETS = [
  { value: "lt2", label: "<2 years" },
  { value: "2-3", label: "2-3 years" },
  { value: "3-4", label: "3-4 years" },
  { value: "4-7", label: "4-7 years" },
  { value: "7+", label: "7+ years" },
];

// Multi-select question — user toggles options on/off, then confirms via Continue.
function MultiSelectQuestion({ options, initial, onSubmit }) {
  const [selected, setSelected] = useState(initial || []);
  const toggle = (value) =>
    setSelected((s) => (s.includes(value) ? s.filter((x) => x !== value) : [...s, value]));
  return (
    <div>
      <div style={styles.optionStack}>
        {options.map((opt, idx) => {
          const isSelected = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              style={{
                ...styles.numberedCard,
                borderColor: isSelected ? "#0C447C" : "#E5E7EB",
                background: isSelected ? "#E6F1FB" : "#fff",
              }}
            >
              <span
                style={{
                  ...styles.numberCircle,
                  background: isSelected ? "#0C447C" : "#E6F1FB",
                  color: isSelected ? "#fff" : "#0C447C",
                }}
              >
                {isSelected ? "✓" : indexToLetter(idx)}
              </span>
              <div>
                <div style={styles.numberedCardTitle}>{opt.label}</div>
                {opt.description && <div style={styles.numberedCardDesc}>{opt.description}</div>}
              </div>
            </button>
          );
        })}
        <div style={styles.optionHint}>Pick all that apply, then click Continue.</div>
      </div>
      <button
        onClick={() =>
          onSubmit(
            selected,
            options.filter((o) => selected.includes(o.value)),
          )
        }
        disabled={selected.length === 0}
        style={{
          ...styles.triangleSubmit,
          marginTop: 10,
          opacity: selected.length === 0 ? 0.5 : 1,
          cursor: selected.length === 0 ? "not-allowed" : "pointer",
        }}
      >
        Continue {selected.length > 0 ? `(${selected.length} selected)` : ""}
      </button>
    </div>
  );
}

// Credit-events timeline — one event per screen, same lettered-card style
// as other questions. User progresses one at a time with Next, until the
// final event's Confirm submits the whole timeline.
function CreditEventsTimeline({ events, initial, onSubmit }) {
  const [data, setData] = useState(initial || {});
  const [idx, setIdx] = useState(0);

  const isMmYyyy = (s) => /^(0[1-9]|1[0-2])\/\d{4}$/.test((s || "").trim());

  if (events.length === 0) return null;
  const currentEvent = events[idx];
  const value = data[currentEvent.value] || {};
  const isLast = idx === events.length - 1;

  const setBucket = (bucket) =>
    setData((d) => ({
      ...d,
      [currentEvent.value]: { ...(d[currentEvent.value] || {}), bucket, date: undefined },
    }));
  const setDate = (date) =>
    setData((d) => ({
      ...d,
      [currentEvent.value]: { ...(d[currentEvent.value] || {}), date, bucket: undefined },
    }));

  const canAdvance = value.bucket || isMmYyyy(value.date);

  const advance = () => {
    if (!canAdvance) return;
    if (isLast) {
      onSubmit(data);
    } else {
      setIdx((i) => i + 1);
    }
  };
  const goBack = () => setIdx((i) => Math.max(0, i - 1));

  return (
    <div>
      <div style={styles.timelineEventHeader}>
        <div style={styles.timelineEventName}>{currentEvent.label}</div>
        <div style={styles.timelineEventSub}>
          Event {idx + 1} of {events.length} — how long ago was this?
        </div>
      </div>

      <div style={styles.optionStack}>
        {CREDIT_EVENT_BUCKETS.map((b, i) => {
          const active = value.bucket === b.value;
          return (
            <button
              key={b.value}
              onClick={() => setBucket(b.value)}
              style={{
                ...styles.numberedCard,
                borderColor: active ? NAVY : "#E5E7EB",
                background: active ? LIGHT_NAVY : "#fff",
              }}
            >
              <span
                style={{
                  ...styles.numberCircle,
                  background: active ? NAVY : LIGHT_NAVY,
                  color: active ? "#fff" : NAVY,
                }}
              >
                {indexToLetter(i)}
              </span>
              <div>
                <div style={styles.numberedCardTitle}>{b.label}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={styles.timelineOrSeparator}>OR</div>

      <div style={styles.timelineDateLabel}>Enter date of event</div>
      <div style={styles.timelineDateRow}>
        <input
          type="text"
          placeholder="MM/YYYY"
          value={value.date || ""}
          onChange={(e) => setDate(e.target.value)}
          style={styles.timelineDateInputFull}
        />
      </div>

      <div style={styles.timelineFooter}>
        {idx > 0 ? (
          <button onClick={goBack} style={styles.secondaryButton}>
            ← Previous
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={advance}
          disabled={!canAdvance}
          style={{
            ...styles.triangleSubmit,
            margin: 0,
            opacity: canAdvance ? 1 : 0.5,
            cursor: canAdvance ? "pointer" : "not-allowed",
          }}
        >
          {isLast ? "Confirm timeline" : "Next →"}
        </button>
      </div>
    </div>
  );
}

// High-DTI compound form — combines NOCB sub-flow + Residual Income into one screen.
const HIGH_DTI_RELATIONSHIPS = [
  { value: "spouse", label: "Spouse / Partner" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "child", label: "Child" },
  { value: "other_relative", label: "Other Relative" },
  { value: "non_relative", label: "Non-Relative" },
];

function HighDtiFollowupForm({ initial, onSubmit }) {
  // Two-step inline flow: 1) NOCB · 2) Residual Income.
  // Submits the full bundle only after the user confirms residual income.
  const [step, setStep] = useState(1);
  const [hasNocb, setHasNocb] = useState(initial.hasNocb || "");
  const [nocbRelationship, setNocbRelationship] = useState(initial.nocbRelationship || "");
  const [combinedDti, setCombinedDti] = useState(initial.combinedDti || "");
  const [householdSize, setHouseholdSize] = useState(initial.householdSize || "");
  const [residualIncome, setResidualIncome] = useState(initial.residualIncome || "");

  const nocbBranchOk =
    hasNocb === "no" || (hasNocb === "yes" && nocbRelationship && String(combinedDti).trim());
  const residualOk = String(householdSize).trim() && String(residualIncome).trim();

  const goNext = () => {
    if (!hasNocb || !nocbBranchOk) return;
    setStep(2);
  };
  const goBack = () => setStep(1);
  const handleConfirm = () => {
    if (!residualOk) return;
    onSubmit({
      hasNocb,
      nocbRelationship: hasNocb === "yes" ? nocbRelationship : "",
      combinedDti: hasNocb === "yes" ? combinedDti : "",
      householdSize,
      residualIncome,
    });
  };

  return (
    <div>
      <div style={styles.compoundStepLabel}>
        Step {step} of 2 — {step === 1 ? "Non-Occupant Co-Borrower" : "Residual Income"}
      </div>

      {step === 1 && (
        <div style={styles.compoundSection}>
          <div style={styles.compoundSectionTitle}>Non-Occupant Co-Borrower (NOCB)</div>

          <div style={styles.compoundFieldLabel}>Do you have a NOCB to help qualify?</div>
          <div style={styles.compoundYesNoRow}>
            <button
              onClick={() => setHasNocb("yes")}
              style={hasNocb === "yes" ? styles.compoundChoiceBtnActive : styles.compoundChoiceBtn}
            >
              Yes
            </button>
            <button
              onClick={() => {
                setHasNocb("no");
                setNocbRelationship("");
                setCombinedDti("");
              }}
              style={hasNocb === "no" ? styles.compoundChoiceBtnActive : styles.compoundChoiceBtn}
            >
              No
            </button>
          </div>

          {hasNocb === "yes" && (
            <div style={styles.compoundTwoCol}>
              <div>
                <div style={styles.compoundFieldLabel}>Relationship to primary borrower</div>
                <select
                  value={nocbRelationship}
                  onChange={(e) => setNocbRelationship(e.target.value)}
                  style={styles.selectInput}
                >
                  <option value="">Select…</option>
                  {HIGH_DTI_RELATIONSHIPS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={styles.compoundFieldLabel}>Combined DTI (with NOCB)</div>
                <div style={styles.compoundNumericRow}>
                  <input
                    type="number"
                    value={combinedDti}
                    onChange={(e) => setCombinedDti(e.target.value)}
                    placeholder="e.g., 38"
                    style={styles.compoundInput}
                  />
                  <span style={styles.compoundSuffix}>%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={styles.compoundSection}>
          <div style={styles.compoundSectionTitle}>Residual Income</div>

          <div style={styles.compoundFieldLabel}>Household size</div>
          <input
            type="number"
            value={householdSize}
            onChange={(e) => setHouseholdSize(e.target.value)}
            placeholder="e.g., 3"
            style={styles.compoundInput}
          />

          <div style={styles.compoundFieldLabel}>
            Monthly residual income (after housing + debts)
          </div>
          <div style={styles.compoundNumericRow}>
            <span style={styles.compoundPrefix}>$</span>
            <input
              type="number"
              value={residualIncome}
              onChange={(e) => setResidualIncome(e.target.value)}
              placeholder="e.g., 2500"
              style={styles.compoundInput}
            />
          </div>
        </div>
      )}

      <div style={styles.compoundFooter}>
        {step === 2 ? (
          <button onClick={goBack} style={styles.secondaryButton}>
            ← Previous
          </button>
        ) : (
          <span />
        )}
        {step === 1 ? (
          <button
            onClick={goNext}
            disabled={!hasNocb || !nocbBranchOk}
            style={{
              ...styles.triangleSubmit,
              margin: 0,
              opacity: !hasNocb || !nocbBranchOk ? 0.5 : 1,
              cursor: !hasNocb || !nocbBranchOk ? "not-allowed" : "pointer",
            }}
          >
            Next →
          </button>
        ) : (
          <button
            onClick={handleConfirm}
            disabled={!residualOk}
            style={{
              ...styles.triangleSubmit,
              margin: 0,
              opacity: !residualOk ? 0.5 : 1,
              cursor: !residualOk ? "not-allowed" : "pointer",
            }}
          >
            Confirm and continue
          </button>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ children }) {
  return (
    <div style={styles.assistantRow}>
      <div style={styles.assistantAvatar}>🤖</div>
      <div style={styles.assistantBubble}>{children}</div>
    </div>
  );
}

function UserMessage({ children, onEdit }) {
  return (
    <div style={styles.userRow}>
      <div style={styles.userBubble}>
        {children}
        {onEdit && (
          <button onClick={onEdit} style={styles.editButton}>
            Change
          </button>
        )}
      </div>
    </div>
  );
}

function TriangleInput({ initial, onSubmit }) {
  const [pv, setPv] = useState(initial.propertyValue || "");
  const [la, setLa] = useState(initial.loanAmount || "");
  const [ltv, setLtv] = useState(initial.ltv || "");

  const onChange = (field, value) => {
    const numPv = parseFloat(field === "pv" ? value : pv) || 0;
    const numLa = parseFloat(field === "la" ? value : la) || 0;
    const numLtv = parseFloat(field === "ltv" ? value : ltv) || 0;

    if (field === "pv") setPv(value);
    if (field === "la") setLa(value);
    if (field === "ltv") setLtv(value);

    if (field === "pv" && numPv > 0) {
      if (numLa > 0) setLtv(((numLa / numPv) * 100).toFixed(2));
      else if (numLtv > 0) setLa((numPv * (numLtv / 100)).toFixed(0));
    } else if (field === "la" && numLa > 0) {
      if (numPv > 0) setLtv(((numLa / numPv) * 100).toFixed(2));
      else if (numLtv > 0) setPv((numLa / (numLtv / 100)).toFixed(0));
    } else if (field === "ltv" && numLtv > 0) {
      if (numPv > 0) setLa((numPv * (numLtv / 100)).toFixed(0));
      else if (numLa > 0) setPv((numLa / (numLtv / 100)).toFixed(0));
    }
  };

  const canSubmit = pv && la && ltv;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={styles.triangleRow}>
        <label style={styles.triangleLabel}>Property Value</label>
        <span style={styles.triangleAffix}>$</span>
        <input
          type="number"
          value={pv}
          onChange={(e) => onChange("pv", e.target.value)}
          placeholder="500000"
          style={styles.triangleInput}
        />
      </div>
      <div style={styles.triangleRow}>
        <label style={styles.triangleLabel}>Loan Amount</label>
        <span style={styles.triangleAffix}>$</span>
        <input
          type="number"
          value={la}
          onChange={(e) => onChange("la", e.target.value)}
          placeholder="400000"
          style={styles.triangleInput}
        />
      </div>
      <div style={styles.triangleRow}>
        <label style={styles.triangleLabel}>LTV</label>
        <input
          type="number"
          step="0.1"
          value={ltv}
          onChange={(e) => onChange("ltv", e.target.value)}
          placeholder="80"
          style={styles.triangleInput}
        />
        <span style={styles.triangleAffix}>%</span>
      </div>
      <button
        onClick={() =>
          onSubmit({
            propertyValue: pv,
            loanAmount: la,
            ltv: ltv,
          })
        }
        disabled={!canSubmit}
        style={{
          ...styles.triangleSubmit,
          opacity: canSubmit ? 1 : 0.5,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        Confirm
      </button>
    </div>
  );
}

function QuestionMessage({
  question,
  options,
  onAnswer,
  onTextSubmit,
  onTriangleSubmit,
  onMultiSelectSubmit,
  onTimelineSubmit,
  onCompoundSubmit,
  scenario,
}) {
  const [textValue, setTextValue] = useState("");

  // For credit-events-timeline, build the event objects from scenario
  const selectedCreditEvents = useMemo(() => {
    if (question.type !== "credit-events-timeline") return [];
    const types = scenario.creditEventTypes || [];
    const typeQuestion = QUESTIONS.find((q) => q.id === "credit_event_types");
    const all = (typeQuestion && typeQuestion.options) || [];
    return types.map((v) => all.find((o) => o.value === v)).filter(Boolean);
  }, [question.type, scenario.creditEventTypes]);

  return (
    <AssistantMessage>
      <div style={styles.questionMeta}>
        <span style={styles.questionChip}>
          {question.stepName} · Question {question.id}
        </span>
        {question.optional && <span style={styles.optionalChip}>Optional</span>}
      </div>
      <div style={styles.questionText}>{question.text}</div>

      {question.type === "triangle" ? (
        <TriangleInput
          initial={{
            propertyValue: scenario?.propertyValue || "",
            loanAmount: scenario?.loanAmount || "",
            ltv: scenario?.ltv || "",
          }}
          onSubmit={onTriangleSubmit}
        />
      ) : question.type === "select" ? (
        <div style={styles.selectRow2}>
          <select
            value={scenario?.[question.field] || ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              const match = options.find((o) => o.value === val);
              if (match) onAnswer(match);
            }}
            style={styles.selectInput}
          >
            <option value="">{question.placeholder || "Select…"}</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ) : question.type === "compound-high-dti" ? (
        <HighDtiFollowupForm initial={scenario} onSubmit={onCompoundSubmit} />
      ) : question.type === "notice" ? (
        <div style={styles.noticeCallout}>
          <button
            onClick={() => onAnswer({ value: "ack", label: "Got it — let's continue" })}
            style={styles.triangleSubmit}
          >
            Got it, let's continue →
          </button>
        </div>
      ) : question.type === "multi-select" ? (
        <MultiSelectQuestion
          options={options}
          initial={scenario?.[question.field] || []}
          onSubmit={onMultiSelectSubmit}
        />
      ) : question.type === "credit-events-timeline" ? (
        <CreditEventsTimeline
          events={selectedCreditEvents}
          initial={scenario?.creditEventDates}
          onSubmit={onTimelineSubmit}
        />
      ) : question.type === "multi-choice" || question.type === "yes-no" ? (
        <div style={styles.optionStack}>
          {options.map((opt, idx) => (
            <LetteredCard
              key={opt.value}
              letter={indexToLetter(idx)}
              option={opt}
              onClick={() => onAnswer(opt)}
            />
          ))}
          <div style={styles.optionHint}>
            Click on the appropriate cards or input the options in the chat.
          </div>
        </div>
      ) : (
        <div style={styles.numericInputRow}>
          {question.prefix && <span style={styles.numericPrefix}>{question.prefix}</span>}
          <input
            type={question.type === "number" ? "number" : "text"}
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder={question.placeholder}
            style={styles.numericInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && textValue.trim()) {
                onTextSubmit(textValue);
                setTextValue("");
              }
            }}
          />
          {question.suffix && <span style={styles.numericPrefix}>{question.suffix}</span>}
          <button
            onClick={() => {
              if (textValue.trim()) {
                onTextSubmit(textValue);
                setTextValue("");
              }
            }}
            style={styles.numericSubmit}
          >
            ↵
          </button>
        </div>
      )}
    </AssistantMessage>
  );
}

// Mock list of programs that get filtered as answers come in.
// In real implementation, derive this from the matching engine response.
const ALL_PROGRAMS = [
  "Denali 2nd Lien",
  "Everest 2nd Lien",
  "Everest 2nd Lien Plus",
  "Prime Ascent",
  "Prime Ascent Plus",
  "Investor DSCR",
  "DSCR Plus",
  "DSCR 5-9 Multi",
  "DSCR 2-8 Mixed Use",
  "Cross-Collateral DSCR",
  "Foreign National DSCR",
  "ITIN",
  "Closed-End Second",
  "HELOC",
  "Equity Advantage",
  "Equity Advantage DSCR",
  "Equity Advantage Elite",
  "Flex Supreme",
  "Flex Select",
  "Super Jumbo",
  "Non-Prime",
  "Expanded Prime",
  "Select ITIN",
  "Investor No Ratio",
  "Foreign National",
  "Bridge",
  "Fix & Flip",
  "RTL Construction",
  "Bank Statement Loan",
  "P&L Loan",
];

function MortgageProfileSidebar({
  scenario,
  eligibleCount,
  totalCount,
  hasStarted,
  onReset,
  isDirty,
  hasSubmittedOnce,
  onResubmit,
}) {
  const [showProgramList, setShowProgramList] = useState(false);
  const visiblePrograms = ALL_PROGRAMS.slice(0, eligibleCount);
  // Group filled fields by step
  const sections = useMemo(() => {
    const grouped = {};
    for (const q of QUESTIONS) {
      const value = scenario[q.field];
      if (value === undefined || value === null || value === "") continue;
      // Empty arrays / objects don't count as filled either
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
        continue;

      const stepLabel = q.stepName;
      if (!grouped[stepLabel]) grouped[stepLabel] = [];

      // Resolve display label for the value
      const opts = getOptions(q, scenario);
      let displayValue;
      if (Array.isArray(value)) {
        const labels = value.map((v) => {
          const o = opts.find((opt) => opt.value === v);
          return o ? o.label.replace(/^Bankruptcy — /, "") : v;
        });
        displayValue = labels.join(", ");
      } else if (typeof value === "object") {
        displayValue = `${Object.keys(value).length} set`;
      } else {
        const opt = opts.find((o) => o.value === value);
        displayValue = opt ? opt.label : value;
      }

      grouped[stepLabel].push({ label: humanizeFieldName(q.field), value: displayValue });
    }
    return grouped;
  }, [scenario]);

  // When showProgramList is true, the entire sidebar is taken over by the
  // preview list — the regular profile content underneath is fully hidden.
  if (showProgramList) {
    return (
      <div style={styles.sidebar}>
        <div style={styles.previewTakeoverHeader}>
          <button
            onClick={() => setShowProgramList(false)}
            style={styles.backIconButton}
            aria-label="Back to profile"
            title="Back to profile"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span style={styles.previewTakeoverTitle}>Eligible Programs</span>
        </div>

        <div style={styles.previewListLabel}>
          {visiblePrograms.length} of {totalCount} currently eligible
        </div>
        <div style={styles.previewList}>
          {visiblePrograms.map((p) => (
            <div key={p} style={styles.previewListItem}>
              <span style={styles.previewDot} />
              {p}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.sidebar}>
      <div style={styles.sidebarHeader}>
        <span style={styles.sidebarTitle}>👤 Mortgage Profile</span>
        <div style={styles.sidebarHeaderActions}>
          {hasSubmittedOnce && isDirty && (
            <button
              onClick={onResubmit}
              style={styles.resubmitButton}
              aria-label="Resubmit with updated answers"
              title="Resubmit with updated answers"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-9-9" />
                <path d="M21 3v6h-6" />
              </svg>
              Resubmit
            </button>
          )}
          {hasStarted && (
            <button
              onClick={onReset}
              style={styles.resetButton}
              aria-label="Reset and start over"
              title="Reset and start over"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 12a9 9 0 1 0 9-9" />
                <path d="M3 4v5h5" />
              </svg>
              Reset
            </button>
          )}
        </div>
      </div>

      <div style={styles.eligibleCard}>
        <div style={styles.eligibleCardHeader}>
          <div style={styles.eligibleLabel}>Eligible Programs</div>
          <button
            onClick={() => setShowProgramList(true)}
            style={styles.eyeButton}
            aria-label="Preview eligible programs"
            title="Preview eligible programs"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>

        <div style={styles.eligibleValue}>
          <span style={styles.eligibleNumber}>{eligibleCount}</span>
          <span style={styles.eligibleTotal}> / {totalCount}</span>
        </div>
        <div style={styles.progressTrack}>
          <div
            style={{
              ...styles.progressFill,
              width: `${(eligibleCount / totalCount) * 100}%`,
            }}
          />
        </div>
        <div style={styles.eligibleHint}>
          Preliminary Estimate · Submit to check for the special overlays.
        </div>
      </div>

      {Object.entries(sections).map(([stepLabel, fields]) => (
        <div key={stepLabel} style={{ marginBottom: 12 }}>
          <div style={styles.sectionTitle}>{stepLabel}</div>
          {fields.map((f) => (
            <div key={f.label} style={styles.sidebarRow}>
              <span style={styles.checkIcon}>✓</span>
              <span style={styles.sidebarLabel}>{f.label}</span>
              <span style={styles.sidebarValue}>{f.value}</span>
            </div>
          ))}
        </div>
      ))}

      <div style={styles.sidebarLegend}>
        <span style={{ color: "#B91C1C" }}>*</span> Mandatory ·{" "}
        <span style={{ color: "#9CA3AF" }}>o</span> Optional
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SCENARIO VAULT — full-screen list of saved scenarios with search, filter,
// and per-row actions. Lives alongside the intake experience and replaces
// the chat view when opened from the avatar menu.
// ────────────────────────────────────────────────────────────────────────────

function formatRelativeTime(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} wk${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} mo${months === 1 ? "" : "s"} ago`;
}

// Format e.g. "2 Jun 2026, 11:50"
function formatScenarioDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = d.getDate();
  const mon = months[d.getMonth()];
  const yr = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${yr}, ${hh}:${mm}`;
}

// Build a compact "PR_1st_Full Doc_FL" shortcode from a scenario.
function scenarioShortcode(sc) {
  const purpose =
    sc.loanPurpose === "purchase"
      ? "PR"
      : sc.loanPurpose === "cash_out"
        ? "CO"
        : sc.loanPurpose === "rate_term"
          ? "RT"
          : "—";
  const lien =
    sc.lienPosition === "first"
      ? "1st"
      : sc.lienPosition === "second"
        ? "2nd"
        : sc.lienPosition === "piggyback"
          ? "PB"
          : "1st";
  const occ = sc.occupancy === "investment" ? "Inv" : sc.occupancy === "second_home" ? "2H" : null;
  const doc =
    sc.documentationType === "full_doc"
      ? "Full Doc"
      : sc.documentationType === "bank_stmt_personal"
        ? "BS-P"
        : sc.documentationType === "bank_stmt_business"
          ? "BS-B"
          : sc.documentationType === "pl_only"
            ? "P&L"
            : sc.documentationType === "asset_util"
              ? "Asset"
              : "Full Doc";
  const state = sc.state || "—";
  // Investment scenarios prefix with "Inv" instead of "PR"/"CO" purpose
  const head = occ === "Inv" ? "Inv" : purpose;
  return `${head}_${lien}_${doc}_${state}`;
}

const VAULT_STATUS_META = {
  draft: { label: "Draft", color: "#6B7280", bg: "#F3F4F6" },
  active: { label: "Active", color: "#0C447C", bg: "#E6F1FB" },
  submitted: { label: "Submitted", color: "#0F6E56", bg: "#D1FAE5" },
  locked: { label: "Locked", color: "#92400E", bg: "#FEF3C7" },
  closed: { label: "Closed", color: "#475569", bg: "#E2E8F0" },
  archived: { label: "Archived", color: "#9CA3AF", bg: "#F3F4F6" },
};

function ScenarioVaultView({
  scenarios,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  sort,
  setSort,
  onClose,
  onLoad,
  onNew,
  onTogglePin,
  onArchive,
  onDelete,
  onClone,
  onDownload,
}) {
  // Apply filters + sort + search
  let visible = scenarios.slice();
  if (statusFilter !== "all") {
    visible = visible.filter((s) =>
      statusFilter === "active-only" ? s.status !== "archived" : s.status === statusFilter,
    );
  } else {
    // Default: hide archived in the "all" view
    visible = visible.filter((s) => s.status !== "archived");
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    visible = visible.filter(
      (s) =>
        (s.borrowerName || "").toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.scenario.state || "").toLowerCase().includes(q) ||
        scenarioShortcode(s.scenario).toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  visible.sort((a, b) => {
    // Pinned always on top
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "updated") return b.updatedAt - a.updatedAt;
    if (sort === "submitted") return (b.lastSubmittedAt || 0) - (a.lastSubmittedAt || 0);
    if (sort === "created") return b.createdAt - a.createdAt;
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "borrower") return (a.borrowerName || "").localeCompare(b.borrowerName || "");
    if (sort === "amount")
      return Number(b.scenario.loanAmount || 0) - Number(a.scenario.loanAmount || 0);
    return 0;
  });

  return (
    <div style={styles.vaultContainer}>
      <div style={styles.vaultPageHeader}>
        <div>
          <h1 style={styles.vaultPageTitle}>Scenario Vault</h1>
          <div style={styles.vaultPageSubtitle}>
            {visible.length} saved {visible.length === 1 ? "scenario" : "scenarios"} — open, search,
            and manage.
          </div>
        </div>
        <div style={styles.vaultHeaderActions}>
          <button onClick={onNew} style={styles.vaultNewBtn}>
            + New Scenario
          </button>
          <button
            onClick={onClose}
            style={styles.vaultCloseBtn}
            aria-label="Close Scenario Vault"
            title="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div style={styles.vaultToolbar}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by borrower, state, tag…"
          style={styles.vaultSearchInput}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={styles.vaultSelect}
        >
          <option value="all">All (except archived)</option>
          <option value="active-only">Active scenarios</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="submitted">Submitted</option>
          <option value="locked">Locked</option>
          <option value="closed">Closed</option>
          <option value="archived">Archived</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={styles.vaultSelect}>
          <option value="updated">Sort: Last modified</option>
          <option value="submitted">Sort: Last submitted</option>
          <option value="created">Sort: Created date</option>
          <option value="name">Sort: Name A–Z</option>
          <option value="amount">Sort: Loan amount</option>
        </select>
      </div>

      <div style={styles.vaultTableCard}>
        {visible.length === 0 ? (
          <div style={styles.vaultEmpty}>
            <div style={styles.vaultEmptyIcon}>📂</div>
            <div style={styles.vaultEmptyTitle}>No scenarios match these filters.</div>
            <div style={styles.vaultEmptyBody}>
              Try clearing the search or status filter, or start a new scenario.
            </div>
            <button onClick={onNew} style={styles.vaultNewBtn}>
              + New Scenario
            </button>
          </div>
        ) : (
          <>
            <div style={{ ...styles.vaultTableRow, ...styles.vaultTableHeadRow }}>
              <div style={styles.vaultColSno}>S.NO</div>
              <div style={styles.vaultColBorrower}>Borrower Name</div>
              <div style={styles.vaultColScenario}>Scenario</div>
              <div style={styles.vaultColDate}>Date</div>
              <div style={styles.vaultColMatches}>Matches</div>
              <div style={styles.vaultColTags}>Tags</div>
              <div style={styles.vaultColActions}>Actions</div>
            </div>
            {visible.map((s, idx) => (
              <div
                key={s.id}
                style={{
                  ...styles.vaultTableRow,
                  ...(idx % 2 === 1 ? styles.vaultTableRowAlt : null),
                }}
                role="button"
                tabIndex={0}
                onClick={() => onLoad(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onLoad(s);
                }}
              >
                <div style={styles.vaultColSno}>
                  <span style={styles.vaultSnoText}>{idx + 1}</span>
                </div>
                <div style={styles.vaultColBorrower}>
                  {s.pinned && <span style={styles.vaultPinStar}>★ </span>}
                  <span style={styles.vaultRowName}>{s.borrowerName || s.name}</span>
                </div>
                <div style={styles.vaultColScenario}>
                  <code style={styles.vaultScenarioCode}>{scenarioShortcode(s.scenario)}</code>
                </div>
                <div style={styles.vaultColDate}>
                  {formatScenarioDate(s.lastSubmittedAt || s.updatedAt || s.createdAt)}
                </div>
                <div style={styles.vaultColMatches}>
                  {s.matchCount != null ? (
                    <span style={styles.vaultMatchedNum}>{s.matchCount}</span>
                  ) : (
                    <span style={styles.vaultMatchedEmpty}>—</span>
                  )}
                </div>
                <div style={styles.vaultColTags}>
                  {s.tags && s.tags.length > 0 ? (
                    <div style={styles.vaultTagWrap}>
                      {s.tags.map((t) => (
                        <span key={t} style={styles.vaultTagChip}>
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={styles.vaultEmptyCell}>—</span>
                  )}
                </div>
                <div style={styles.vaultColActions} onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onLoad(s)}
                    style={styles.vaultIconBtn}
                    title="Edit"
                    aria-label="Edit scenario"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onClone(s.id)}
                    style={styles.vaultIconBtn}
                    title="Clone"
                    aria-label="Clone scenario"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onDownload(s)}
                    style={styles.vaultIconBtn}
                    title="Download PDF"
                    aria-label="Download as PDF"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onDelete(s.id)}
                    style={styles.vaultIconBtnDanger}
                    title="Delete"
                    aria-label="Delete scenario"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function humanizeFieldName(field) {
  if (field === "creditEventTypes") return "Credit Events";
  if (field === "creditEventDates") return "Timeline";
  if (field === "highDtiAck") return "High DTI Notice";
  if (field === "hasNocb") return "NOCB?";
  if (field === "nocbRelationship") return "NOCB Relationship";
  if (field === "combinedDti") return "Combined DTI";
  if (field === "householdSize") return "Household";
  if (field === "residualIncome") return "Residual Income";
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/\bDti\b/, "DTI")
    .replace(/\bOfac\b/, "OFAC")
    .replace(/\bUs\b/, "US");
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────

export default function ChatIntakeExperience() {
  const WELCOME_MESSAGE = [
    "Hi! I'm your mortgage assistant, here to help you find programs that best match your property and financing needs.",
    "I'll guide you through a few quick questions to understand your scenario and help identify suitable options. Whether you're purchasing, refinancing, or exploring eligibility, I'll help narrow down the best-fit programs for you.",
    "Click Start to begin a fresh intake — or upload an existing Form 1003 (PDF) or URLA v3.4 (XML) file to pre-fill answers and pick up from the first missing field.",
  ];

  // Form Mode = guided question-by-question intake. Chat Mode = freeform NL.
  const [mode, setMode] = useState("form");
  const [scenario, setScenario] = useState({});
  const [messages, setMessages] = useState([
    {
      type: "assistant",
      paragraphs: WELCOME_MESSAGE,
    },
  ]);
  const [currentQuestionId, setCurrentQuestionId] = useState(null);
  const [resumePoint, setResumePoint] = useState(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [chatInputValue, setChatInputValue] = useState("");
  const [eligibleCount, setEligibleCount] = useState(30);
  // Chat Mode cadence — count of consecutive conversational asks (no card
  // shown), and the field we last asked about so we can match short replies.
  const [chatConversationalTurns, setChatConversationalTurns] = useState(0);
  const [pendingChatField, setPendingChatField] = useState(null);
  // Profile dropdown menu toggle
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  // Scenario Vault — view toggle + saved scenarios list
  const [view, setView] = useState("intake"); // "intake" | "vault"
  const [vaultSearch, setVaultSearch] = useState("");
  const [vaultStatusFilter, setVaultStatusFilter] = useState("all");
  const [vaultSort, setVaultSort] = useState("updated");
  const [savedScenarios, setSavedScenarios] = useState(() => {
    const now = Date.now();
    const make = (name, p, ago, matchCount, tags = [], status = "active") => ({
      id: "sc_" + name.toLowerCase(),
      name,
      borrowerName: name,
      status,
      tags,
      pinned: false,
      scenario: p,
      matchCount,
      createdAt: now - ago,
      updatedAt: now - ago,
      lastSubmittedAt: matchCount != null ? now - ago : null,
      freshness: "fresh",
      notes: "",
    });
    return [
      make(
        "Ron",
        {
          loanPurpose: "purchase",
          lienPosition: "first",
          documentationType: "full_doc",
          state: "FL",
          occupancy: "primary",
          propertyType: "single_family",
          propertyValue: "500000",
          loanAmount: "400000",
          ltv: "80",
          creditScore: "740",
          estimatedDti: "38",
        },
        1000 * 60 * 60 * 2,
        4,
        ["#priority"],
      ),
      make(
        "Banala",
        {
          loanPurpose: "purchase",
          lienPosition: "first",
          documentationType: "full_doc",
          state: "CA",
          occupancy: "primary",
          propertyType: "condo",
          propertyValue: "950000",
          loanAmount: "760000",
          ltv: "80",
          creditScore: "700",
          estimatedDti: "44",
        },
        1000 * 60 * 60 * 3,
        1,
        ["#refi"],
      ),
      make(
        "Abhinav",
        {
          loanPurpose: "purchase",
          lienPosition: "first",
          documentationType: "full_doc",
          state: "FL",
          occupancy: "primary",
          propertyType: "single_family",
          propertyValue: "600000",
          loanAmount: "480000",
          ltv: "80",
          creditScore: "760",
          estimatedDti: "32",
        },
        1000 * 60 * 60 * 23,
        6,
        ["#pre-approval", "#priority"],
      ),
      make(
        "Devyansh",
        {
          loanPurpose: "purchase",
          lienPosition: "first",
          documentationType: "full_doc",
          state: "CA",
          occupancy: "primary",
          propertyType: "townhouse",
          propertyValue: "780000",
          loanAmount: "624000",
          ltv: "80",
          creditScore: "710",
          estimatedDti: "42",
        },
        1000 * 60 * 60 * 24 * 4,
        1,
        ["#lead"],
      ),
      make(
        "Tarun",
        {
          loanPurpose: "purchase",
          lienPosition: "first",
          documentationType: "full_doc",
          state: "FL",
          occupancy: "investment",
          propertyType: "single_family",
          propertyValue: "550000",
          loanAmount: "412500",
          ltv: "75",
          creditScore: "720",
          estimatedDti: "40",
        },
        1000 * 60 * 60 * 24 * 5,
        1,
        ["#investor", "#dscr"],
      ),
      make(
        "Sumit",
        {
          loanPurpose: "purchase",
          lienPosition: "first",
          documentationType: "full_doc",
          state: "CA",
          occupancy: "primary",
          propertyType: "single_family",
          propertyValue: "1100000",
          loanAmount: "880000",
          ltv: "80",
          creditScore: "780",
          estimatedDti: "30",
        },
        1000 * 60 * 60 * 24 * 6,
        5,
        ["#jumbo"],
      ),
    ];
  });
  // When the extractor inferred a value or hit something ambiguous, queue a
  // reinforcement question that gets asked BEFORE moving on to the next field.
  // Shape: { field, currentValue, prompt, kind: "inferred"|"ambiguous" } | null
  const [pendingReinforcement, setPendingReinforcement] = useState(null);
  // Tracks whether the user already gave us a big brain-dump so the next
  // conversational ask can lead with an encouraging "we're narrowing this down"
  const [chatHadBrainDump, setChatHadBrainDump] = useState(false);
  // Snapshot of the scenario at the moment of the last successful submit.
  // Used to compute dirtiness for the resubmit affordances (chat + sidebar).
  const [lastSubmittedSnapshot, setLastSubmittedSnapshot] = useState(null);
  const hasSubmittedOnce = lastSubmittedSnapshot != null;
  const isDirty = hasSubmittedOnce && lastSubmittedSnapshot !== JSON.stringify(scenario);
  // selectedProgram = currently scoped program for follow-up chat Q&A
  const [selectedProgram, setSelectedProgram] = useState(null);
  const totalCount = 30;
  const chatEndRef = useRef(null);
  // Hidden file input for 1003 / URLA v3.4 ingestion
  const fileInputRef = useRef(null);

  // Sample follow-up questions shown as chips below the program detail card
  const SAMPLE_DETAIL_QUESTIONS = [
    "What are the geo / state restrictions?",
    "What documentation does this program require?",
    "Any overlays I should be aware of?",
  ];

  // Mock follow-up Q&A engine — replace with /api/program/{id}/qa
  const answerProgramQuestion = (program, question) => {
    const q = question.toLowerCase();
    if (q.includes("geo") || q.includes("state") || q.includes("restrict")) {
      return `${program.name} is available in 48 states. Currently restricted in NY and HI. Texas cash-out has a 12-month seasoning overlay.`;
    }
    if (q.includes("doc")) {
      return `Required: ${program.requiredDocs.join(", ")}. Allowed doc types vary by income source — check the program matrix for combinations.`;
    }
    if (q.includes("overlay") || q.includes("caveat")) {
      return `Investor overlays: condo warrantability required; non-warrantable condos add 0.25% to rate. HPML rules apply at high APR spreads.`;
    }
    if (q.includes("rate") || q.includes("price")) {
      return `Indicative pricing for ${program.name} starts at ~7.25% (30Y fixed, 75% CLTV, 740 FICO). Use Check Pricing for a live quote.`;
    }
    return `Here's what I know about "${question}" for ${program.name}: this is a stub answer — wire up /api/program/${encodeURIComponent(program.name)}/qa for live responses.`;
  };

  // Push a follow-up Q&A pair into the chat scroll, scoped to selectedProgram
  const askDetailQuestion = (question) => {
    if (!selectedProgram || !question.trim()) return;
    const q = question.trim();
    const a = answerProgramQuestion(selectedProgram, q);
    setMessages((m) => [
      ...m,
      { type: "user", content: q },
      { type: "program-qa-answer", program: selectedProgram, question: q, answer: a },
    ]);
  };

  // Get the next question that should be asked
  const findNextQuestion = (scenarioSnapshot, lastQuestionId) => {
    const lastIndex = lastQuestionId ? QUESTIONS.findIndex((q) => q.id === lastQuestionId) : -1;
    for (let i = lastIndex + 1; i < QUESTIONS.length; i++) {
      const q = QUESTIONS[i];
      if (q.groupedInto) continue; // skip field-only meta entries
      if (!q.showIf || q.showIf(scenarioSnapshot)) {
        return q;
      }
    }
    return null;
  };

  // Kick off after Start — called by button click OR by typing "start"/"go"
  const handleStart = (typedValue) => {
    if (hasStarted) return;
    // Guard: if called from a button onClick, typedValue will be a
    // SyntheticEvent. Only accept actual strings.
    const userText = typeof typedValue === "string" && typedValue.trim() ? typedValue : "Start";
    setHasStarted(true);
    setMessages((m) => [...m, { type: "user", content: userText }]);
    setMessages((m) => [
      ...m,
      {
        type: "assistant",
        content: "Great — let's begin with Step 1: Basics. About 90 seconds.",
      },
    ]);
    const first = findNextQuestion({}, null);
    if (first) {
      setCurrentQuestionId(first.id);
      setMessages((m) => [...m, { type: "question", question: first }]);
    }
  };

  // Trigger the hidden file input to open the OS file picker
  const triggerFileUpload = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  // Handle Form 1003 (PDF) or URLA v3.4 (XML) ingestion. Real parsing is
  // wired downstream — here we stub the extraction so the UX is intact.
  const handleFileUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // Reset input so re-uploading the same file works next time
    e.target.value = "";

    setHasStarted(true);
    setMessages((m) => [
      ...m,
      { type: "user", content: `Uploaded: ${file.name}` },
      {
        type: "assistant",
        content: `Got it — parsing ${file.name}…`,
      },
    ]);

    // Stub extraction. Replace this block with the real parser response.
    // For PDFs: POST /api/ingest/1003-pdf  | For XML: POST /api/ingest/urla-xml
    const mockExtracted = {
      citizenship: "us_citizen",
      occupancy: "primary",
      loanPurpose: "purchase",
      lienPosition: "first",
      propertyType: "single_family",
      state: "FL",
      propertyValue: "500000",
      loanAmount: "400000",
      ltv: "80",
      creditScore: "740",
      documentationType: "full_doc",
      estimatedDti: "38",
    };

    setTimeout(() => {
      setScenario(mockExtracted);
      const items = Object.keys(mockExtracted).map((f) => ({
        field: f,
        label: friendlyFieldLabel(f),
        value: formatFieldValue(f, mockExtracted[f], mockExtracted),
      }));
      setMessages((m) => [
        ...m,
        {
          type: "assistant",
          content: `Extracted ${items.length} fields from your ${file.name.endsWith(".xml") ? "URLA v3.4 XML" : "Form 1003"}. Picking up from the first missing answer.`,
        },
        { type: "chat-extraction", items, notes: [], ambiguous: [] },
      ]);
      // Advance to the first still-missing question in the form flow
      const next = findNextQuestion(mockExtracted, null);
      if (next) {
        setCurrentQuestionId(next.id);
        setTimeout(() => {
          setMessages((m) => [...m, { type: "question", question: next }]);
        }, 200);
      } else {
        setMessages((m) => [
          ...m.filter((msg) => msg.type !== "final-action"),
          { type: "assistant", content: "Looks complete — ready to find matching programs?" },
          { type: "final-action", isResubmit: false },
        ]);
      }
    }, 600);
  };

  // Handle the chat input bar
  // ────────────────────────────────────────────────────────────
  // Chat Mode — freeform NL → scenario extraction
  // ────────────────────────────────────────────────────────────
  // For chat mode we don't walk the QUESTIONS list; we just track which
  // mandatory fields are still unanswered and ask the user about the
  // most important one each turn.
  const chatModeMissingQuestion = (scenarioSnapshot) => {
    // Walk QUESTIONS in order and return the first one that's still relevant
    // AND unanswered. Skip groupedInto entries and notice/compound housekeeping.
    for (const q of QUESTIONS) {
      if (q.groupedInto) continue;
      if (q.type === "notice") continue;
      if (q.showIf && !q.showIf(scenarioSnapshot)) continue;
      const fields = q.fields || (q.field ? [q.field] : []);
      const filled = fields.every((f) => {
        const v = scenarioSnapshot[f];
        return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
      });
      if (!filled) return q;
    }
    return null;
  };

  const friendlyFieldLabel = (field) => {
    // Compact labels for the "I picked up:" summary
    const map = {
      citizenship: "Citizenship",
      occupancy: "Occupancy",
      loanPurpose: "Loan Purpose",
      lienPosition: "Lien Position",
      propertyType: "Property Type",
      propertyValue: "Property Value",
      loanAmount: "Loan Amount",
      ltv: "LTV",
      creditScore: "FICO",
      documentationType: "Documentation",
      estimatedDti: "DTI",
      state: "State",
      housingHistory: "Housing History",
      hasCreditEvent: "Credit Events",
    };
    return map[field] || humanizeFieldName(field);
  };

  const formatFieldValue = (field, value, scenarioSnapshot) => {
    // Try to resolve via QUESTIONS option labels first
    const q = QUESTIONS.find((qq) => qq.field === field);
    if (q) {
      const opts = getOptions(q, scenarioSnapshot);
      const opt = opts.find((o) => o.value === value);
      if (opt) return opt.label;
    }
    if (field === "propertyValue" || field === "loanAmount") {
      return "$" + Number(value).toLocaleString();
    }
    if (field === "ltv" || field === "estimatedDti") return value + "%";
    return String(value);
  };

  // Context-aware parse: if we just asked conversationally about a specific
  // field and the generic extractor missed it, try to interpret the user's
  // short reply against that field's options / yes-no / number type.
  const contextAwareParse = (text, scenarioSnapshot) => {
    if (!pendingChatField) return {};
    const out = {};
    const q = QUESTIONS.find((qq) => qq.field === pendingChatField);
    if (!q) return {};
    const lc = text.toLowerCase().trim();
    if (q.type === "yes-no") {
      if (/^(?:yes|yeah|yep|sure|ok|y|true|correct|yup)\b/.test(lc)) out[pendingChatField] = "yes";
      else if (/^(?:no|nope|nah|n|false|negative)\b/.test(lc)) out[pendingChatField] = "no";
    } else if (q.type === "number") {
      const nMatch = text.match(/\d+(?:\.\d+)?/);
      if (nMatch) out[pendingChatField] = nMatch[0];
    } else if (q.type === "multi-choice" || q.type === "select") {
      const opts = getOptions(q, scenarioSnapshot);
      // Exact or substring match against value / label
      const hit = opts.find(
        (o) =>
          lc === o.value.toLowerCase() ||
          lc === o.label.toLowerCase() ||
          lc.startsWith(o.label.toLowerCase()) ||
          lc.endsWith(o.label.toLowerCase()) ||
          (lc.length >= 3 && o.label.toLowerCase().startsWith(lc)),
      );
      if (hit) out[pendingChatField] = hit.value;
    }
    return out;
  };

  // Detect reinforcement items (inferences / ambiguous fields) that need
  // confirmation BEFORE moving on to the next missing question.
  const detectReinforcements = (extracted, notes, ambiguous, merged) => {
    const items = [];
    // Inferred loan purpose
    if (extracted.loanPurpose && notes.some((n) => /Inferred Cash-Out/.test(n))) {
      items.push({
        field: "loanPurpose",
        currentValue: extracted.loanPurpose,
        prompt:
          'Quick check first — I picked up that you\'re paying off an existing first plus pulling some equity out, which reads as a cash-out refinance. Want me to lock that in, or is it actually rate-and-term? (Reply "yes" to confirm or tell me the right purpose.)',
        kind: "inferred",
      });
    }
    // Ambiguous documentation (personal vs business bank statements)
    ambiguous.forEach((a) => {
      if (a.field === "documentationType") {
        items.push({
          field: "documentationType",
          currentValue: merged.documentationType,
          prompt:
            "Quick clarification — you mentioned bank statements. Are these personal bank statements or business bank statements? They follow slightly different income-calc rules.",
          kind: "ambiguous",
        });
      }
    });
    return items;
  };

  // Decide how to ask the next question in chat mode — conversational prose
  // for most simple types, a form card for complex types or every 3rd ask.
  const advanceChatModeNext = (scenarioSnapshot, recentlyPickedCount) => {
    const next = chatModeMissingQuestion(scenarioSnapshot);
    if (!next) {
      setCurrentQuestionId(null);
      setPendingChatField(null);
      const isResubmit = lastSubmittedSnapshot != null;
      setMessages((m) => [
        ...m.filter((msg) => msg.type !== "final-action"),
        {
          type: "assistant",
          content: isResubmit
            ? "Got everything. Resubmit to refresh results."
            : "Got everything I need. Ready to find matching programs?",
        },
        { type: "final-action", isResubmit },
      ]);
      return;
    }
    const isComplexType =
      next.type === "triangle" ||
      next.type === "multi-select" ||
      next.type === "credit-events-timeline" ||
      next.type === "compound-high-dti" ||
      next.type === "notice";
    // Force a form card after 3 consecutive conversational asks
    const forceForm = chatConversationalTurns >= 3;
    if (isComplexType || forceForm) {
      setCurrentQuestionId(next.id);
      setPendingChatField(null);
      setChatConversationalTurns(0);
      setTimeout(() => {
        setMessages((m) => [
          ...m,
          {
            type: "assistant",
            content: isComplexType
              ? "Let me ask this one specifically:"
              : "Quick one — pick from these:",
          },
          { type: "question", question: next },
        ]);
      }, 150);
    } else {
      // Conversational ask — pure prose, no card
      setCurrentQuestionId(null);
      setPendingChatField(next.field || null);
      setChatConversationalTurns((c) => c + 1);
      const prompt =
        CONVERSATIONAL_PROMPTS[next.field] ||
        next.text ||
        `Can you tell me about ${friendlyFieldLabel(next.field)}?`;
      // After a big initial brain dump, encourage + frame the next ask
      const useLeadIn = chatHadBrainDump;
      if (useLeadIn) setChatHadBrainDump(false);
      setTimeout(() => {
        if (useLeadIn) {
          setMessages((m) => [
            ...m,
            {
              type: "assistant",
              paragraphs: [
                "Great, we're making progress. Based on what you've shared so far, we've already narrowed down the list of matching programs.",
                "To finalize the shortlist, I need a few more details.",
                prompt,
              ],
            },
          ]);
        } else {
          setMessages((m) => [...m, { type: "assistant", content: prompt }]);
        }
      }, 150);
    }
  };

  const handleChatModeMessage = (text) => {
    // Reinforcement-response branch — if we just asked the user to confirm an
    // inference or resolve an ambiguity, interpret this turn against it.
    if (pendingReinforcement) {
      const lc = text.toLowerCase().trim();
      const isYes =
        /^(?:yes|yeah|yep|sure|ok|correct|right|y|true|confirm|confirmed|lock\s*it\s*in)\b/.test(
          lc,
        );
      const isNo = /^(?:no|nope|nah|wrong|incorrect|not\s*quite|n|false|negative)\b/.test(lc);
      setMessages((m) => [...m, { type: "user", content: text }]);
      if (isYes) {
        setMessages((m) => [...m, { type: "assistant", content: "Locked in. Moving on." }]);
        setPendingReinforcement(null);
        advanceChatModeNext(scenario, 0);
        return;
      }
      if (isNo) {
        // Clear the inferred / ambiguous value and pivot to asking for the
        // correct one via the context-aware flow.
        const cleared = { ...scenario };
        delete cleared[pendingReinforcement.field];
        setScenario(cleared);
        const fld = pendingReinforcement.field;
        setPendingReinforcement(null);
        setPendingChatField(fld);
        setMessages((m) => [
          ...m,
          {
            type: "assistant",
            content: `Got it, clearing that. ${
              CONVERSATIONAL_PROMPTS[fld] || `What's the correct ${friendlyFieldLabel(fld)}?`
            }`,
          },
        ]);
        return;
      }
      // Otherwise the user replied with a value — let normal extraction run and
      // we'll fall through to the standard path below.
    }

    const parsed = extractScenarioFromText(text);
    let extracted = parsed.extracted;
    const { notes, ambiguous } = parsed;
    // If we asked conversationally about a specific field and the generic
    // extractor missed it, salvage the short reply via context-aware parse
    const ctx = contextAwareParse(text, scenario);
    extracted = { ...ctx, ...extracted };

    setMessages((m) => [...m, { type: "user", content: text }]);

    const merged = { ...scenario, ...extracted };
    setScenario(merged);

    const picked = Object.keys(extracted);
    // Initial-style brain dump (4+ fields) gets the structured card so the
    // user can scan and verify. Follow-ups get conversational prose only.
    if (picked.length >= 4) {
      const items = picked.map((f) => ({
        field: f,
        label: friendlyFieldLabel(f),
        value: formatFieldValue(f, extracted[f], merged),
      }));
      setMessages((m) => [...m, { type: "chat-extraction", items, notes, ambiguous }]);
      setChatHadBrainDump(true);
    } else if (picked.length > 0) {
      const summary = picked
        .map((f) => `${friendlyFieldLabel(f)} ${formatFieldValue(f, extracted[f], merged)}`)
        .join(" · ");
      setMessages((m) => [...m, { type: "assistant", content: `Got it — ${summary}.` }]);
    } else {
      // No fields picked up — gentle nudge
      setMessages((m) => [
        ...m,
        {
          type: "assistant",
          content:
            "Hmm, I didn't catch that. Could you rephrase? You can mention things like loan amount, property value, FICO, DTI, occupancy, doc type, etc.",
        },
      ]);
    }

    // BEFORE advancing to the next missing question, ask any reinforcement
    // questions we detected (inferences / ambiguities) so the user can
    // confirm or correct what was picked up.
    const reinforcements = detectReinforcements(extracted, notes, ambiguous, merged);
    if (reinforcements.length > 0) {
      const first = reinforcements[0];
      setPendingReinforcement(first);
      setPendingChatField(null);
      setTimeout(() => {
        setMessages((m) => [...m, { type: "assistant", content: first.prompt }]);
      }, 150);
      return;
    }

    advanceChatModeNext(merged, picked.length);
  };

  const handleChatInputSubmit = () => {
    const val = chatInputValue.trim();
    if (!val) return;

    // Chat Mode: route every input through the NL extraction handler
    if (mode === "chat") {
      // First message in chat mode kicks things off
      if (!hasStarted) setHasStarted(true);
      setChatInputValue("");
      handleChatModeMessage(val);
      return;
    }

    if (!hasStarted) {
      const lower = val.toLowerCase();
      if (lower === "start" || lower === "go" || lower === "begin") {
        setChatInputValue("");
        handleStart(val);
        return;
      }
      // Unrecognized command before start — gentle nudge
      setMessages((m) => [
        ...m,
        { type: "user", content: val },
        {
          type: "assistant",
          content: "Type 'Start' or 'Go' when you're ready to begin.",
        },
      ]);
      setChatInputValue("");
      return;
    }

    // If a program is currently in scope (Know More was clicked), route the
    // typed text into either an "exit" command or a follow-up Q&A.
    if (selectedProgram) {
      const lower = val.toLowerCase();
      if (
        lower === "exit" ||
        lower === "all programs" ||
        lower === "back" ||
        lower === "go to program list"
      ) {
        setChatInputValue("");
        exitProgramContext();
        return;
      }
      askDetailQuestion(val);
      setChatInputValue("");
      return;
    }

    // After started: route to current question handler
    const currentQ = QUESTIONS.find((q) => q.id === currentQuestionId);
    if (currentQ) {
      // Compound / multi-select / timeline don't accept typed answers — guide the user
      if (
        currentQ.type === "multi-select" ||
        currentQ.type === "credit-events-timeline" ||
        currentQ.type === "compound-high-dti"
      ) {
        setMessages((m) => [
          ...m,
          { type: "user", content: val },
          {
            type: "assistant",
            content:
              "Use the buttons above to pick your answer for this step — typed input isn't supported here.",
          },
        ]);
        setChatInputValue("");
        return;
      }
      if (
        currentQ.type === "multi-choice" ||
        currentQ.type === "yes-no" ||
        currentQ.type === "chip-choice"
      ) {
        const opts = getOptions(currentQ, scenario);

        // 1) Try matching a single-letter answer (A, B, C, …)
        if (val.length === 1 && /^[A-Za-z]$/.test(val)) {
          const idx = val.toUpperCase().charCodeAt(0) - 65;
          if (idx >= 0 && idx < opts.length) {
            handleAnswer(opts[idx]);
            setChatInputValue("");
            return;
          }
        }

        // 2) Try matching the typed value against an option label or value
        const match = opts.find(
          (o) =>
            o.label.toLowerCase() === val.toLowerCase() ||
            o.value.toLowerCase() === val.toLowerCase(),
        );
        if (match) {
          handleAnswer(match);
          setChatInputValue("");
          return;
        }
      }
      // Select (dropdown) questions accept typed state code or name
      if (currentQ.type === "select") {
        const opts = getOptions(currentQ, scenario);
        const match = opts.find(
          (o) =>
            o.label.toLowerCase() === val.toLowerCase() ||
            o.value.toLowerCase() === val.toLowerCase(),
        );
        if (match) {
          handleAnswer(match);
          setChatInputValue("");
          return;
        }
      }
      // Otherwise treat as free text/number submit
      handleTextSubmit(val);
      setChatInputValue("");
    }
  };

  // ────────────────────────────────────────────────────────────
  // Voice input (Web Speech API)
  // ────────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);

  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      setChatInputValue(transcript);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  // After answering, sweep through subsequent answered questions and
  // remove any whose showIf no longer holds with the updated scenario.
  const pruneIrrelevant = (newScenario) => {
    setMessages((m) =>
      m.filter((msg) => {
        if (msg.type !== "answered") return true;
        const q = msg.question;
        if (q.showIf && !q.showIf(newScenario)) {
          // Also clear the scenario field for irrelevant answers
          if (q.field) delete newScenario[q.field];
          if (q.fields) q.fields.forEach((f) => delete newScenario[f]);
          return false;
        }
        return true;
      }),
    );
  };

  // Find the question we should jump to AFTER answering one.
  // If we're editing (resumePoint set), jump back there if still valid;
  // otherwise advance to the next unanswered question.
  const findNextActiveQuestion = (newScenario, answeredId) => {
    const answeredIds = new Set();
    // Read current messages to find which IDs are already answered
    for (const msg of messages) {
      if (msg.type === "answered") answeredIds.add(msg.question.id);
    }
    answeredIds.add(answeredId);

    // First, if resumePoint is set and still valid, go there
    if (resumePoint) {
      const rp = QUESTIONS.find((q) => q.id === resumePoint);
      if (rp && (!rp.showIf || rp.showIf(newScenario)) && !answeredIds.has(rp.id)) {
        return rp;
      }
    }

    // Otherwise, find the first question that's not answered AND is relevant
    for (const q of QUESTIONS) {
      if (q.groupedInto) continue; // skip field-only meta entries
      if (answeredIds.has(q.id)) continue;
      if (q.showIf && !q.showIf(newScenario)) continue;
      return q;
    }
    return null;
  };

  // Handle answer to current multi-choice / yes-no question
  const handleAnswer = (option) => {
    const currentQ = QUESTIONS.find((q) => q.id === currentQuestionId);
    if (!currentQ) return;

    const newScenario = { ...scenario, [currentQ.field]: option.value };

    // Convert this question message to answered (preserve all other messages)
    setMessages((m) =>
      m.map((msg) => {
        if (msg.type === "question" && msg.question.id === currentQuestionId) {
          return { type: "answered", question: currentQ, answer: option.label };
        }
        return msg;
      }),
    );

    // Prune subsequent answers that became irrelevant
    pruneIrrelevant(newScenario);
    setScenario(newScenario);

    // Simulate program narrowing
    setEligibleCount((prev) => Math.max(3, prev - Math.floor(Math.random() * 4 + 1)));

    const next = findNextActiveQuestion(newScenario, currentQuestionId);
    setResumePoint(null);
    advanceToQuestion(next, currentQ);
  };

  // Handle multi-select question submit (e.g. credit event types)
  const handleMultiSelectSubmit = (values, selectedOptions) => {
    const currentQ = QUESTIONS.find((q) => q.id === currentQuestionId);
    if (!currentQ) return;
    const newScenario = { ...scenario, [currentQ.field]: values };
    const summary = selectedOptions.map((o) => o.label).join(" · ");

    setMessages((m) =>
      m.map((msg) => {
        if (msg.type === "question" && msg.question.id === currentQuestionId) {
          return { type: "answered", question: currentQ, answer: summary };
        }
        return msg;
      }),
    );

    pruneIrrelevant(newScenario);
    setScenario(newScenario);
    setEligibleCount((prev) => Math.max(3, prev - Math.floor(Math.random() * 4 + 1)));

    const next = findNextActiveQuestion(newScenario, currentQuestionId);
    setResumePoint(null);
    advanceToQuestion(next, currentQ);
  };

  // Handle the compound high-DTI followup form submit. Sets all 5 fields at
  // once and produces a one-line summary for the chat bubble.
  const handleCompoundSubmit = (values) => {
    const currentQ = QUESTIONS.find((q) => q.id === currentQuestionId);
    if (!currentQ) return;
    const newScenario = {
      ...scenario,
      hasNocb: values.hasNocb,
      nocbRelationship: values.nocbRelationship || undefined,
      combinedDti: values.combinedDti || undefined,
      householdSize: values.householdSize,
      residualIncome: values.residualIncome,
    };
    const relLabel = HIGH_DTI_RELATIONSHIPS.find((r) => r.value === values.nocbRelationship)?.label;
    const nocbBit =
      values.hasNocb === "yes"
        ? `NOCB: Yes (${relLabel || "—"}, Combined DTI ${values.combinedDti}%)`
        : "NOCB: No";
    const summary = `${nocbBit} · Household ${values.householdSize} · Residual $${Number(
      values.residualIncome,
    ).toLocaleString()}/mo`;

    setMessages((m) =>
      m.map((msg) => {
        if (msg.type === "question" && msg.question.id === currentQuestionId) {
          return { type: "answered", question: currentQ, answer: summary };
        }
        return msg;
      }),
    );

    pruneIrrelevant(newScenario);
    setScenario(newScenario);
    setEligibleCount((prev) => Math.max(3, prev - Math.floor(Math.random() * 4 + 1)));

    const next = findNextActiveQuestion(newScenario, currentQuestionId);
    setResumePoint(null);
    advanceToQuestion(next, currentQ);
  };

  // Handle credit-events timeline submit (one row per selected event)
  const handleTimelineSubmit = (data) => {
    const currentQ = QUESTIONS.find((q) => q.id === currentQuestionId);
    if (!currentQ) return;
    const newScenario = { ...scenario, [currentQ.field]: data };

    const typeQuestion = QUESTIONS.find((q) => q.id === "credit_event_types");
    const allTypes = (typeQuestion && typeQuestion.options) || [];
    const bucketLabel = (b) => CREDIT_EVENT_BUCKETS.find((x) => x.value === b)?.label || b;
    const summary = Object.entries(data)
      .map(([k, v]) => {
        const opt = allTypes.find((o) => o.value === k);
        const name = opt ? opt.label.replace(/^Bankruptcy — /, "") : k;
        const when = v.bucket ? bucketLabel(v.bucket) : v.date;
        return `${name}: ${when}`;
      })
      .join(" · ");

    setMessages((m) =>
      m.map((msg) => {
        if (msg.type === "question" && msg.question.id === currentQuestionId) {
          return { type: "answered", question: currentQ, answer: summary };
        }
        return msg;
      }),
    );

    pruneIrrelevant(newScenario);
    setScenario(newScenario);
    setEligibleCount((prev) => Math.max(3, prev - Math.floor(Math.random() * 4 + 1)));

    const next = findNextActiveQuestion(newScenario, currentQuestionId);
    setResumePoint(null);
    advanceToQuestion(next, currentQ);
  };

  // Handle triangle (Property Value / Loan Amount / LTV) submit
  const handleTriangleSubmit = (values) => {
    const currentQ = QUESTIONS.find((q) => q.id === currentQuestionId);
    if (!currentQ) return;
    const newScenario = {
      ...scenario,
      propertyValue: values.propertyValue,
      loanAmount: values.loanAmount,
      ltv: values.ltv,
    };
    const summary = `Value $${Number(values.propertyValue).toLocaleString()} · Loan $${Number(values.loanAmount).toLocaleString()} · LTV ${values.ltv}%`;

    setMessages((m) =>
      m.map((msg) => {
        if (msg.type === "question" && msg.question.id === currentQuestionId) {
          return { type: "answered", question: currentQ, answer: summary };
        }
        return msg;
      }),
    );

    pruneIrrelevant(newScenario);
    setScenario(newScenario);
    setEligibleCount((prev) => Math.max(3, prev - Math.floor(Math.random() * 4 + 1)));

    const next = findNextActiveQuestion(newScenario, currentQuestionId);
    setResumePoint(null);
    advanceToQuestion(next, currentQ);
  };

  // Advance UI to the next question (or final action if none)
  const advanceToQuestion = (next, currentQ) => {
    // In Chat Mode, route advancement through the conversational dispatcher
    // so a card answer resumes the prose Q&A instead of stacking more cards.
    if (mode === "chat" && next) {
      advanceChatModeNext(scenario, 0);
      return;
    }
    if (next) {
      if (currentQ && next.step !== currentQ.step) {
        setMessages((m) => [
          ...m,
          {
            type: "assistant",
            content: `${currentQ.stepName} complete. Moving on to Step ${next.step}: ${next.stepName}.`,
          },
        ]);
      }
      setTimeout(() => {
        setCurrentQuestionId(next.id);
        setMessages((m) => [...m, { type: "question", question: next }]);
      }, 200);
    } else {
      const isResubmit = hasSubmittedOnce;
      const nudge = isResubmit
        ? "Some answers changed since your last submission — resubmit to refresh results."
        : "I have everything I need. Want me to find your matching programs?";
      setMessages((m) => [
        // Keep only one final-action active at a time
        ...m.filter((msg) => msg.type !== "final-action"),
        { type: "assistant", content: nudge },
        { type: "final-action", isResubmit },
      ]);
      setCurrentQuestionId(null);
    }
  };

  // Handle text/numeric submit
  const handleTextSubmit = (value) => {
    const currentQ = QUESTIONS.find((q) => q.id === currentQuestionId);
    if (!currentQ) return;
    handleAnswer({ value: value, label: currentQ.prefix ? `${currentQ.prefix}${value}` : value });
  };

  // Allow user to edit a prior answer.
  // Subsequent answers are preserved unless they become irrelevant after the edit.
  const handleEdit = (questionId) => {
    // Remember where we were so we can return after editing
    if (currentQuestionId && currentQuestionId !== questionId) {
      setResumePoint(currentQuestionId);
    }
    // Convert the answered message back into a question message in place
    setMessages((m) =>
      m.map((msg) =>
        msg.type === "answered" && msg.question.id === questionId
          ? { type: "question", question: msg.question }
          : msg,
      ),
    );
    setCurrentQuestionId(questionId);
  };

  // Close profile menu on outside click
  useEffect(() => {
    if (!profileMenuOpen) return;
    const handler = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [profileMenuOpen]);

  // Auto-scroll on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keyboard shortcuts — letter keys (A, B, C, …) select options
  useEffect(() => {
    const handler = (e) => {
      if (document.activeElement.tagName === "INPUT") return;
      if (e.key.length !== 1) return;
      const letter = e.key.toUpperCase();
      const code = letter.charCodeAt(0);
      if (code < 65 || code > 90) return; // not A-Z
      const optionIndex = code - 65;
      const currentQ = QUESTIONS.find((q) => q.id === currentQuestionId);
      if (!currentQ) return;
      // Letter shortcuts only apply to single-select question types
      if (
        currentQ.type !== "multi-choice" &&
        currentQ.type !== "yes-no" &&
        currentQ.type !== "chip-choice"
      )
        return;
      const opts = getOptions(currentQ, scenario);
      if (optionIndex < opts.length) {
        handleAnswer(opts[optionIndex]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentQuestionId, scenario]);

  // Clear all answers and restart the intake from scratch
  const handleClearAndRestart = () => {
    setScenario({});
    setCurrentQuestionId(null);
    setResumePoint(null);
    setHasStarted(false);
    setChatInputValue("");
    setEligibleCount(30);
    setLastSubmittedSnapshot(null);
    setChatConversationalTurns(0);
    setPendingChatField(null);
    setPendingReinforcement(null);
    setChatHadBrainDump(false);
    setMessages([
      {
        type: "assistant",
        paragraphs: WELCOME_MESSAGE,
      },
    ]);
  };

  // ────────────────────────────────────────────────────────────
  // MOCK eligibility API — replace with: POST /api/eligibility/full
  // ────────────────────────────────────────────────────────────
  async function fetchEligibility(scenarioPayload) {
    // In production:
    //   const res = await fetch("/api/eligibility/full", {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json" },
    //     body: JSON.stringify(scenarioPayload),
    //   });
    //   return await res.json();
    //
    // Expected response shape:
    //   {
    //     matched: [{ name, maxLoan, products, maxCLTV, minFICO, maxDTI, whyMatched: [...], requiredDocs: [...] }],
    //     excluded: [{ name, reason }],
    //   }

    await new Promise((r) => setTimeout(r, 600));
    const baseProgram = (overrides) => ({
      // Defaults shared across mock programs
      minFICO: 660,
      bestMatchFICO: 720,
      minLoanAmount: 100000,
      maxLoanAmount: 1500000,
      maxLtvByPurpose: { Purchase: 90, "Rate & Term": 85, "Cash-Out Refinance": 80 },
      bestMatchLtvByPurpose: { Purchase: 90, "Rate & Term": 85, "Cash-Out Refinance": 75 },
      maxDTI: 50,
      bestMatchDTI: 50,
      occupancyTypes: ["Primary Residence", "Second Home", "Investment Property"],
      propertyTypes: [
        "Single Family",
        "PUD",
        "Townhouse",
        "Condo Warrantable",
        "Two To Four Family",
      ],
      loanPurposes: ["Purchase", "Rate & Term", "Cash-Out Refinance"],
      documentationTypes: [
        "Full Documentation",
        "1099",
        "Asset Utilization",
        "Bank Statements (Business)",
        "Rental Income",
        "Alternative Documentation",
        "P&L with 2 month Bank Statement",
        "WVOE Only",
        "Bank Statements (12 or 24 Months)",
      ],
      productsAllowed: ["5/6 SOFR ARM", "15-Year Fixed", "30-Year Fixed", "40-Year Fixed"],
      productsExcluded: [
        "5/6 ARM Interest-Only",
        "30-Year Fixed Interest-Only",
        "40-Year Fixed Interest-Only",
      ],
      additionalConsiderations: [
        {
          label: "2-1 Buydown",
          text: "Only seller or builder-funded buydowns are allowed; lender-paid or third-party buydowns are for correspondent clients only.",
        },
        {
          label: "Acreage",
          text: "Maximum of 20 acres allowed for primary and second homes; investment properties are limited to 5 acres.",
        },
        {
          label: "Appraisals",
          text: "A second appraisal is mandatory for loans exceeding $2,000,000.",
        },
        { label: "Gift Funds", text: "Gift funds cannot be used for reserve requirements." },
        {
          label: "First-Time Homebuyer",
          text: "Eligible for loans up to $1,500,000 across all occupancy types.",
        },
        {
          label: "Declining Markets",
          text: "A 5% reduction in maximum LTV is required for declining markets when LTV exceeds 65%.",
        },
        {
          label: "Non-Occupant Co-Borrower",
          text: "Must be a relative and is only allowed for primary residences.",
        },
        {
          label: "Reserves",
          text: "Cash-out proceeds are permitted to fulfill reserve requirements.",
        },
      ],
      relatedExclusions: [],
      ...overrides,
    });
    return {
      matched: [
        baseProgram({
          name: "Denali Prime",
          maxLoan: 1500000,
          products: "5/6 SOFR ARM · 15Y · 30Y · 40Y Fixed",
          maxCLTV: 90,
          minFICO: 660,
          maxDTI: 50,
          whyMatched: [
            "LTV within band for this scenario",
            "Credit score above 660 threshold",
            "No state overlay applies",
          ],
          requiredDocs: [
            "12-mo bank statements",
            "Proof of housing",
            "Income verification",
            "Asset statements",
          ],
          relatedExclusions: [
            {
              category: "Overlay / Credit Restrictions",
              program: "Denali Prime Plus",
              reason: "First Time Homebuyers are ineligible",
            },
          ],
        }),
        baseProgram({
          name: "Everest 2nd Lien",
          maxLoan: 1000000,
          products: "10Y–30Y Fixed · 20Y/30Y I/O",
          maxCLTV: 85,
          minFICO: 700,
          maxDTI: 50,
          whyMatched: ["All eligibility criteria satisfied", "I/O option available at this LTV"],
          requiredDocs: ["12-mo bank statements", "Asset verification"],
          productsAllowed: [
            "10-Year Fixed",
            "15-Year Fixed",
            "20-Year Fixed",
            "30-Year Fixed",
            "20Y Interest-Only",
            "30Y Interest-Only",
          ],
          productsExcluded: ["40-Year Fixed"],
        }),
        baseProgram({
          name: "Everest 2nd Lien Plus",
          maxLoan: 500000,
          products: "10Y–30Y Fixed",
          maxCLTV: 80,
          minFICO: 720,
          maxDTI: 50,
          whyMatched: ["Higher tier requires 720+ FICO — passes"],
          requiredDocs: ["Tax returns (2 yr)", "Bank statements", "Asset verification"],
          productsAllowed: ["10-Year Fixed", "15-Year Fixed", "20-Year Fixed", "30-Year Fixed"],
          productsExcluded: ["5/6 ARM", "40-Year Fixed", "All Interest-Only variants"],
        }),
      ],
      excluded: [
        {
          name: "DSCR Plus",
          reason: "Investment occupancy required",
          category: "Occupancy Overlay",
          whatToChange: "Switch occupancy to Investment Property",
          impactedFields: ["Occupancy"],
        },
        {
          name: "Foreign National DSCR",
          reason: "US Citizen — Foreign National program N/A",
          category: "Citizenship Overlay",
          whatToChange: "Borrower citizenship would need to be Foreign National",
          impactedFields: ["Citizenship"],
        },
        {
          name: "Cross-Collateral DSCR",
          reason: "Single property — Cross-Collateral requires 2+ properties",
          category: "Collateral Overlay",
          whatToChange: "Add a second property to the collateral pool",
          impactedFields: ["Property count"],
        },
        {
          name: "ITIN",
          reason: "Borrower has SSN",
          category: "ID Type Overlay",
          whatToChange: "ITIN program is for borrowers without SSN",
          impactedFields: ["Citizenship", "Tax ID"],
        },
      ],
    };
  }

  // Final eligibility submission (initial submit AND resubmits go through here)
  const handleFindPrograms = async () => {
    const isResubmit = hasSubmittedOnce;
    const userLabel = isResubmit ? "Resubmit with updated answers" : "Submit and find programs";
    const placeholder = isResubmit ? "Refreshing eligibility…" : "Running eligibility check…";

    setMessages((m) => [
      // Clear any prior final-action so the chat doesn't pile up
      ...m.filter((msg) => msg.type !== "final-action"),
      { type: "user", content: userLabel },
      { type: "assistant", content: placeholder },
    ]);

    const results = await fetchEligibility(scenario);

    // First batch — intro line + results card (program rows animate in)
    setMessages((m) => {
      const filtered = m.filter(
        (msg, idx) =>
          !(msg.type === "assistant" && msg.content === placeholder && idx === m.length - 1),
      );
      return [
        ...filtered,
        {
          type: "assistant",
          content: isResubmit
            ? `Updated results — ${results.matched.length} program${results.matched.length === 1 ? "" : "s"} match your refreshed scenario.`
            : `Found ${results.matched.length} program${results.matched.length === 1 ? "" : "s"} that match your scenario.`,
        },
        {
          type: "results",
          matched: results.matched,
          excluded: results.excluded,
          streamedAt: Date.now(),
        },
      ];
    });
    setEligibleCount(results.matched.length);
    // Snapshot the scenario at submission time so future edits make isDirty true
    setLastSubmittedSnapshot(JSON.stringify(scenario));

    // Second batch — push the suggestion cards once every program row has
    // animated in (staggered delay of ~200ms each + a small buffer).
    const totalAnimMs = results.matched.length * 200 + 500;
    setTimeout(() => {
      setMessages((m) => [...m, { type: "suggestion-cards" }]);
    }, totalAnimMs);
  };

  // Know More — pushes an inline program detail card to the chat scroll
  // and sets the active program context so follow-up chat questions apply.
  // No standalone banners — the detail card carries its own Return action.
  const showProgramDetail = (program) => {
    setSelectedProgram(program);
    setMessages((m) => [
      ...m,
      { type: "user", content: `Know more: ${program.name}` },
      { type: "program-detail-full", program },
    ]);
  };

  // Exit the active program context — return to results list view.
  const exitProgramContext = () => {
    if (!selectedProgram) return;
    const programName = selectedProgram.name;
    setSelectedProgram(null);
    setMessages((m) => [
      ...m,
      { type: "user", content: "Exit" },
      {
        type: "assistant",
        content: `Returned to your results list. Follow-up questions about ${programName} are no longer scoped — click Know More on a program to re-enter that context.`,
      },
    ]);
  };
  const handleCheckPricing = (program) => {
    // TODO: integrate with pricing engine
    setMessages((m) => [
      ...m,
      {
        type: "assistant",
        content: `Pulling indicative pricing for ${program.name}…`,
      },
    ]);
  };
  const showExclusionList = (excluded) => {
    setMessages((m) => [...m, { type: "exclusions", excluded }]);
  };
  const handleSaveScenario = () => {
    // Snapshot the current scenario into the Scenario Vault. Generates a
    // human-readable default name from purpose / state / amount.
    const purposeLabel =
      scenario.loanPurpose === "purchase"
        ? "Purchase"
        : scenario.loanPurpose === "cash_out"
          ? "Cash-Out"
          : scenario.loanPurpose === "rate_term"
            ? "Rate & Term"
            : "Scenario";
    const stateChunk = scenario.state ? ` — ${scenario.state}` : "";
    const amtChunk = scenario.loanAmount ? ` $${Number(scenario.loanAmount).toLocaleString()}` : "";
    const name = `${purposeLabel}${stateChunk}${amtChunk}`.trim() || "New Scenario";
    const now = Date.now();
    const entry = {
      id: "sc_" + now.toString(36),
      name,
      borrowerName: "",
      status: hasSubmittedOnce ? "submitted" : "draft",
      tags: [],
      pinned: false,
      scenario: { ...scenario },
      matchCount: eligibleCount,
      createdAt: now,
      updatedAt: now,
      lastSubmittedAt: hasSubmittedOnce ? now : null,
      freshness: "fresh",
      notes: "",
    };
    setSavedScenarios((s) => [entry, ...s]);
    setMessages((m) => [
      ...m,
      {
        type: "assistant",
        content: `Saved to your Scenario Vault as "${name}". Open the vault from the avatar menu in the top-right.`,
      },
    ]);
  };

  // ────────────────────────────────────────────────────────────
  // Scenario Vault helpers
  // ────────────────────────────────────────────────────────────
  const openVault = () => setView("vault");
  const closeVault = () => setView("intake");

  const loadScenarioFromVault = (entry) => {
    setScenario({ ...entry.scenario });
    setMode("form");
    setHasStarted(true);
    setLastSubmittedSnapshot(entry.lastSubmittedAt ? JSON.stringify(entry.scenario) : null);
    setCurrentQuestionId(null);
    setPendingChatField(null);
    setChatConversationalTurns(0);
    setMessages([
      {
        type: "assistant",
        paragraphs: [
          `Loaded "${entry.name}" from your Scenario Vault.`,
          "Click any answered field on the left to edit, or pick an action below.",
        ],
      },
      { type: "final-action", isResubmit: !!entry.lastSubmittedAt },
    ]);
    setEligibleCount(entry.matchCount != null ? entry.matchCount : 30);
    setView("intake");
  };

  const startNewScenarioFromVault = () => {
    handleClearAndRestart();
    setView("intake");
  };

  const toggleVaultPin = (id) => {
    setSavedScenarios((s) =>
      s.map((entry) => (entry.id === id ? { ...entry, pinned: !entry.pinned } : entry)),
    );
  };

  const archiveVaultEntry = (id) => {
    setSavedScenarios((s) =>
      s.map((entry) => (entry.id === id ? { ...entry, status: "archived" } : entry)),
    );
  };

  const deleteVaultEntry = (id) => {
    if (!window.confirm("Delete this scenario? You can recover it within 30 days from Archived."))
      return;
    setSavedScenarios((s) => s.filter((entry) => entry.id !== id));
  };

  const cloneVaultEntry = (id) => {
    const original = savedScenarios.find((entry) => entry.id === id);
    if (!original) return;
    const now = Date.now();
    const clone = {
      ...original,
      id: "sc_" + now.toString(36),
      name: original.name + " (copy)",
      borrowerName: original.borrowerName + " (copy)",
      scenario: { ...original.scenario },
      tags: [...original.tags],
      status: "draft",
      matchCount: null,
      pinned: false,
      lastSubmittedAt: null,
      createdAt: now,
      updatedAt: now,
      freshness: "fresh",
    };
    setSavedScenarios((s) => [clone, ...s]);
  };

  const downloadVaultEntry = (entry) => {
    // TODO: wire up real PDF export via existing API intake
    alert(`Exporting "${entry.name}" as PDF — coming soon.`);
  };
  const handleEmailAndResubmit = () => {
    // TODO: open email composer + offer to re-run eligibility after edits
    alert("Email & resubmit — would route to AE and offer scenario edits.");
  };
  const handleDownloadPdf = () => {
    // TODO: POST /api/scenario/pdf with scenario; trigger download
    alert(`Would generate PDF with scenario: ${JSON.stringify(scenario, null, 2)}`);
  };

  // Scenario Vault — full-screen takeover when view === "vault"
  if (view === "vault") {
    return (
      <ScenarioVaultView
        scenarios={savedScenarios}
        search={vaultSearch}
        setSearch={setVaultSearch}
        statusFilter={vaultStatusFilter}
        setStatusFilter={setVaultStatusFilter}
        sort={vaultSort}
        setSort={setVaultSort}
        onClose={closeVault}
        onLoad={loadScenarioFromVault}
        onNew={startNewScenarioFromVault}
        onTogglePin={toggleVaultPin}
        onArchive={archiveVaultEntry}
        onDelete={deleteVaultEntry}
        onClone={cloneVaultEntry}
        onDownload={downloadVaultEntry}
      />
    );
  }

  return (
    <div style={styles.container}>
      {/* Global keyframes injected once for results streaming + voice button pulse */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
      <MortgageProfileSidebar
        scenario={scenario}
        eligibleCount={eligibleCount}
        totalCount={totalCount}
        hasStarted={hasStarted}
        onReset={handleClearAndRestart}
        isDirty={isDirty}
        hasSubmittedOnce={hasSubmittedOnce}
        onResubmit={handleFindPrograms}
      />

      <div style={styles.chatPane}>
        <div style={styles.modeTabBar}>
          <div style={styles.modeTabLeft}>
            <button
              onClick={() => {
                if (mode !== "form") {
                  setMode("form");
                  handleClearAndRestart();
                }
              }}
              style={mode === "form" ? styles.modeTabActive : styles.modeTab}
            >
              Form Mode
            </button>
            <button
              onClick={() => {
                if (mode !== "chat") {
                  setMode("chat");
                  handleClearAndRestart();
                  setHasStarted(true);
                  setMessages([
                    {
                      type: "assistant",
                      paragraphs: [
                        "Hi! I'm your mortgage assistant, here to help you find programs that best match your property and financing needs.",
                        "I'll guide you through a few quick questions to understand your scenario and help identify suitable options. Whether you're purchasing, refinancing, or exploring eligibility, I'll help narrow down the best-fit programs for you.",
                        "Type your scenario to get started. With your inputs, your profile and matching scenario will take shape on the left.",
                      ],
                    },
                  ]);
                }
              }}
              style={mode === "chat" ? styles.modeTabActive : styles.modeTab}
            >
              Chat Mode
            </button>
            {mode === "chat" && (
              <span style={styles.uploadHint}>
                Have a 1003 / URLA v3.4?{" "}
                <button
                  onClick={() => {
                    if (mode !== "form") {
                      setMode("form");
                      handleClearAndRestart();
                    }
                  }}
                  style={styles.uploadHintLink}
                >
                  Switch to Form Mode →
                </button>
              </span>
            )}
          </div>
          <div style={styles.modeTabRight}>
            <div style={styles.profileWrap} ref={profileMenuRef}>
              <button
                onClick={() => setProfileMenuOpen((o) => !o)}
                style={styles.profileButton}
                aria-label="Open profile menu"
                aria-expanded={profileMenuOpen}
                title="Profile menu"
              >
                <span style={styles.profileAvatar}>AE</span>
                <span style={styles.profileName}>Alex Evans</span>
                <span style={styles.profileCaret}>▾</span>
              </button>
              {profileMenuOpen && (
                <div style={styles.profileDropdown} role="menu">
                  <div style={styles.profileDropHeader}>
                    <span style={styles.profileDropAvatar}>AE</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={styles.profileDropName}>Alex Evans</div>
                      <div style={styles.profileDropEmail}>alex.evans@acmemortgage.com</div>
                    </div>
                  </div>
                  <div style={styles.profileAccessRow}>
                    <span style={styles.profileAccessLabel}>Access Type</span>
                    <span style={styles.profileAccessValue}>Loan Officer</span>
                  </div>
                  <div style={styles.profileDivider} />
                  <button
                    onClick={() => {
                      setProfileMenuOpen(false);
                      openVault();
                    }}
                    style={styles.profileItem}
                    role="menuitem"
                  >
                    <span style={styles.profileItemIcon}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </span>
                    <span style={styles.profileItemLabel}>Scenario Vault</span>
                    <span style={styles.profileItemBadge}>
                      {savedScenarios.filter((s) => s.status !== "archived").length}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setProfileMenuOpen(false);
                      startNewScenarioFromVault();
                    }}
                    style={styles.profileItem}
                    role="menuitem"
                  >
                    <span style={styles.profileItemIcon}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </span>
                    <span style={styles.profileItemLabel}>New Scenario</span>
                  </button>
                  <button
                    onClick={() => {
                      setProfileMenuOpen(false);
                      alert("View Profile — account info, plan, usage (coming soon).");
                    }}
                    style={styles.profileItem}
                    role="menuitem"
                  >
                    <span style={styles.profileItemIcon}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </span>
                    <span style={styles.profileItemLabel}>View Profile</span>
                  </button>
                  <div style={styles.profileDivider} />
                  <button
                    onClick={() => {
                      setProfileMenuOpen(false);
                      if (window.confirm("Sign out of Acme?")) {
                        alert("Signing out — coming soon.");
                      }
                    }}
                    style={styles.profileItemDanger}
                    role="menuitem"
                  >
                    <span style={styles.profileItemIcon}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                    </span>
                    <span style={styles.profileItemLabel}>Sign out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={styles.chatScroll}>
          {messages.map((msg, idx) => {
            if (msg.type === "assistant") {
              if (msg.paragraphs) {
                return (
                  <AssistantMessage key={idx}>
                    {msg.paragraphs.map((p, i) => (
                      <p
                        key={i}
                        style={{
                          margin: i < msg.paragraphs.length - 1 ? "0 0 12px" : 0,
                          fontSize: 14,
                        }}
                      >
                        {p}
                      </p>
                    ))}
                  </AssistantMessage>
                );
              }
              return (
                <AssistantMessage key={idx}>
                  <div style={{ fontSize: 14 }}>{msg.content}</div>
                </AssistantMessage>
              );
            }
            if (msg.type === "user") {
              return <UserMessage key={idx}>{msg.content}</UserMessage>;
            }
            if (msg.type === "question") {
              return (
                <QuestionMessage
                  key={idx}
                  question={msg.question}
                  options={getOptions(msg.question, scenario)}
                  scenario={scenario}
                  onAnswer={handleAnswer}
                  onTextSubmit={handleTextSubmit}
                  onTriangleSubmit={handleTriangleSubmit}
                  onMultiSelectSubmit={handleMultiSelectSubmit}
                  onTimelineSubmit={handleTimelineSubmit}
                  onCompoundSubmit={handleCompoundSubmit}
                />
              );
            }
            if (msg.type === "answered") {
              return (
                <UserMessage key={idx} onEdit={() => handleEdit(msg.question.id)}>
                  {msg.answer}
                </UserMessage>
              );
            }
            if (msg.type === "chat-extraction") {
              return (
                <AssistantMessage key={idx}>
                  <div style={styles.chatExtractionCard}>
                    <div style={styles.chatExtractionTitle}>
                      I picked these up from what you said
                    </div>
                    <div style={styles.chatExtractionList}>
                      {msg.items.map((it) => (
                        <div key={it.field} style={styles.chatExtractionRow}>
                          <span style={styles.chatExtractionCheck}>✓</span>
                          <span style={styles.chatExtractionLabel}>{it.label}</span>
                          <span style={styles.chatExtractionValue}>{it.value}</span>
                        </div>
                      ))}
                    </div>
                    {msg.notes && msg.notes.length > 0 && (
                      <div style={styles.chatExtractionNotes}>
                        {msg.notes.map((n, i) => (
                          <div key={i} style={styles.chatExtractionNote}>
                            · {n}
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.ambiguous && msg.ambiguous.length > 0 && (
                      <div style={styles.chatExtractionAmbiguous}>
                        Needs a quick clarification:{" "}
                        {msg.ambiguous.map((a) => a.reason).join(" · ")}
                      </div>
                    )}
                  </div>
                </AssistantMessage>
              );
            }
            if (msg.type === "final-action") {
              return (
                <div key={idx} style={styles.finalActions}>
                  <button onClick={handleFindPrograms} style={styles.primaryButton}>
                    {msg.isResubmit ? "Resubmit with updated answers" : "Submit and find programs"}
                  </button>
                  <button onClick={handleClearAndRestart} style={styles.secondaryButton}>
                    Clear and Restart
                  </button>
                </div>
              );
            }
            if (msg.type === "results") {
              return (
                <AssistantMessage key={idx}>
                  <div style={styles.resultsCard}>
                    <div style={styles.resultsCardHeader}>
                      <span style={styles.resultsCardTitle}>Eligible programs</span>
                      <span style={styles.resultsCardChip}>{msg.matched.length} matched</span>
                    </div>
                    {msg.matched.map((p, i) => (
                      <button
                        key={p.name}
                        onClick={() => showProgramDetail(p)}
                        style={{
                          ...styles.programRow,
                          animation: `fadeInUp 380ms ${i * 200}ms both`,
                        }}
                        aria-label={`Know more about ${p.name}`}
                      >
                        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                          <div style={styles.programRowName}>{p.name}</div>
                          <div style={styles.programRowStats}>
                            <span style={styles.programStatPill}>
                              <span style={styles.programStatLabel}>Max Loan</span>
                              <span style={styles.programStatValue}>
                                ${p.maxLoan.toLocaleString()}
                              </span>
                            </span>
                            <span style={styles.programStatPill}>
                              <span style={styles.programStatLabel}>Min FICO</span>
                              <span style={styles.programStatValue}>{p.minFICO}</span>
                            </span>
                            <span style={styles.programStatPill}>
                              <span style={styles.programStatLabel}>Products</span>
                              <span style={styles.programStatValue}>{p.products}</span>
                            </span>
                          </div>
                        </div>
                        <span style={styles.knowMoreBtn}>Know More →</span>
                      </button>
                    ))}
                  </div>
                </AssistantMessage>
              );
            }
            if (msg.type === "suggestion-cards") {
              // Find the most recent results message so we can use its data for exclusions
              const lastResults = [...messages].reverse().find((m) => m.type === "results");
              return (
                <AssistantMessage key={idx}>
                  <div style={styles.suggestionLabel}>
                    Click to Know More about a program or Choose one of the below
                  </div>
                  <div style={styles.suggestionRow}>
                    <button onClick={handleDownloadPdf} style={styles.suggestionPill}>
                      <span style={styles.suggestionPillIcon}>↓</span>
                      <span>Download the Scenario PDF</span>
                    </button>
                    <button onClick={handleSaveScenario} style={styles.suggestionPill}>
                      <span style={styles.suggestionPillIcon}>★</span>
                      <span>Save Scenario</span>
                    </button>
                    <button
                      onClick={() => showExclusionList(lastResults?.excluded || [])}
                      style={styles.suggestionPill}
                    >
                      <span style={styles.suggestionPillIcon}>?</span>
                      <span>Understand Exclusions</span>
                    </button>
                    <button onClick={handleEmailAndResubmit} style={styles.suggestionPill}>
                      <span style={styles.suggestionPillIcon}>✉</span>
                      <span>Email & Resubmit</span>
                    </button>
                    <button onClick={handleClearAndRestart} style={styles.suggestionPillDanger}>
                      <span style={styles.suggestionPillIconDanger}>↺</span>
                      <span>Clear and Restart</span>
                    </button>
                  </div>
                </AssistantMessage>
              );
            }
            if (msg.type === "program-detail-full") {
              const p = msg.program;
              // Compute borrower's value column from scenario when available
              const borrowerFico = scenario.creditScore ? Number(scenario.creditScore) : null;
              const borrowerLoan = scenario.loanAmount ? Number(scenario.loanAmount) : null;
              const borrowerLtv = scenario.ltv ? Number(scenario.ltv) : null;
              const borrowerDti = scenario.estimatedDti ? Number(scenario.estimatedDti) : null;
              const purposeLabel =
                scenario.loanPurpose === "purchase"
                  ? "Purchase"
                  : scenario.loanPurpose === "rate_term"
                    ? "Rate & Term"
                    : scenario.loanPurpose === "cash_out"
                      ? "Cash-Out Refinance"
                      : "Purchase";
              const maxLtvForScenario = p.maxLtvByPurpose[purposeLabel] ?? p.maxCLTV;
              const bestMatchLtv =
                (p.bestMatchLtvByPurpose && p.bestMatchLtvByPurpose[purposeLabel]) ??
                maxLtvForScenario;
              const within = (val, limit, dir = "max") => {
                if (val == null) return false;
                return dir === "max" ? val <= limit : val >= limit;
              };
              // Build the metric rows
              const metricRows = [
                {
                  label: "Min FICO",
                  programLimit: p.minFICO,
                  bestMatch: p.bestMatchFICO ?? p.minFICO,
                  borrower: borrowerFico,
                  formatter: (v) => v,
                  matchOk: within(borrowerFico, p.minFICO, "min"),
                },
                {
                  label: "Min Loan Amount",
                  programLimit: p.minLoanAmount,
                  bestMatch: p.minLoanAmount,
                  borrower: borrowerLoan,
                  formatter: (v) => "$" + Number(v).toLocaleString(),
                  matchOk: within(borrowerLoan, p.minLoanAmount, "min"),
                },
                {
                  label: "Max Loan Amount",
                  programLimit: p.maxLoanAmount ?? p.maxLoan,
                  bestMatch: p.maxLoanAmount ?? p.maxLoan,
                  borrower: borrowerLoan,
                  formatter: (v) => "$" + Number(v).toLocaleString(),
                  matchOk: within(borrowerLoan, p.maxLoanAmount ?? p.maxLoan, "max"),
                },
                {
                  label: `Max LTV — ${purposeLabel}`,
                  programLimit: maxLtvForScenario,
                  bestMatch: bestMatchLtv,
                  borrower: borrowerLtv,
                  formatter: (v) => v + "%",
                  matchOk: within(borrowerLtv, maxLtvForScenario, "max"),
                },
                {
                  label: "Max DTI",
                  programLimit: p.maxDTI,
                  bestMatch: p.bestMatchDTI ?? p.maxDTI,
                  borrower: borrowerDti,
                  formatter: (v) => v + "%",
                  matchOk: within(borrowerDti, p.maxDTI, "max"),
                },
              ];

              // Helper to render highlighted list items
              const borrowerOccupancyLabel =
                scenario.occupancy === "primary"
                  ? "Primary Residence"
                  : scenario.occupancy === "second_home"
                    ? "Second Home"
                    : scenario.occupancy === "investment"
                      ? "Investment Property"
                      : null;
              const propertyTypeLabel =
                scenario.propertyType === "single_family"
                  ? "Single Family"
                  : scenario.propertyType === "pud"
                    ? "PUD"
                    : scenario.propertyType === "townhouse"
                      ? "Townhouse"
                      : scenario.propertyType === "condo"
                        ? "Condo Warrantable"
                        : scenario.propertyType === "two_to_four"
                          ? "Two To Four Family"
                          : null;
              const docTypeLabel =
                scenario.documentationType === "full_doc"
                  ? "Full Documentation"
                  : scenario.documentationType === "bank_stmt_personal"
                    ? "Bank Statements (12 or 24 Months)"
                    : scenario.documentationType === "bank_stmt_business"
                      ? "Bank Statements (Business)"
                      : scenario.documentationType === "pl_only"
                        ? "P&L with 2 month Bank Statement"
                        : scenario.documentationType === "asset_util"
                          ? "Asset Utilization"
                          : null;
              const renderInlineList = (items, matchValue) => (
                <>
                  {items.map((item, i) => (
                    <span key={item}>
                      <span style={item === matchValue ? styles.inlineMatch : undefined}>
                        {item}
                      </span>
                      {i < items.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </>
              );

              return (
                <div key={idx} style={styles.fullDetailCard}>
                  <div style={styles.fullDetailHeaderRow}>
                    <div style={styles.fullDetailName}>{p.name}</div>
                    <button onClick={exitProgramContext} style={styles.returnLinkBtn}>
                      ← Return to results list
                    </button>
                  </div>

                  <div style={styles.fullDetailSection}>KEY METRICS</div>
                  <div style={styles.metricTable}>
                    <div style={styles.metricHeaderRow}>
                      <div style={styles.metricLabelCell}></div>
                      <div style={styles.metricCell}>PROGRAM LIMIT</div>
                      <div style={styles.metricCell}>BEST MATCH</div>
                      <div style={styles.metricCell}>BORROWER'S VALUE</div>
                    </div>
                    {metricRows.map((row) => (
                      <div key={row.label} style={styles.metricRow}>
                        <div style={styles.metricLabelCell}>{row.label}</div>
                        <div style={styles.metricCell}>{row.formatter(row.programLimit)}</div>
                        <div style={{ ...styles.metricCell, color: GREEN }}>
                          {row.formatter(row.bestMatch)}
                        </div>
                        <div
                          style={{
                            ...styles.metricCell,
                            color:
                              row.borrower == null ? "#9CA3AF" : row.matchOk ? GREEN : "#B45309",
                          }}
                        >
                          {row.borrower == null ? "—" : row.formatter(row.borrower)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={styles.fullDetailSection}>OCCUPANCY TYPES</div>
                  <div style={styles.fullDetailBody}>
                    {renderInlineList(p.occupancyTypes, borrowerOccupancyLabel)}
                  </div>

                  <div style={styles.fullDetailSection}>PROPERTY TYPES</div>
                  <div style={styles.fullDetailBody}>
                    {renderInlineList(p.propertyTypes, propertyTypeLabel)}
                  </div>

                  <div style={styles.fullDetailSection}>LOAN PURPOSES</div>
                  <div style={styles.fullDetailBody}>
                    {renderInlineList(p.loanPurposes, purposeLabel)}
                  </div>

                  <div style={styles.fullDetailSection}>DOCUMENTATION</div>
                  <div style={styles.fullDetailBody}>
                    {renderInlineList(p.documentationTypes, docTypeLabel)}
                  </div>

                  <div style={styles.fullDetailSection}>PRODUCTS AVAILABLE FOR YOU</div>
                  <div style={styles.productsList}>
                    {p.productsAllowed.map((prod) => (
                      <div key={prod} style={styles.productAvailable}>
                        · {prod}
                      </div>
                    ))}
                  </div>

                  <div style={styles.fullDetailSection}>ADDITIONAL CONSIDERATIONS</div>
                  <div style={styles.considerationList}>
                    {p.additionalConsiderations.map((c) => (
                      <div key={c.label} style={styles.considerationItem}>
                        · <strong>{c.label}:</strong> {c.text}
                      </div>
                    ))}
                  </div>

                  <div style={styles.fullDetailCtaRow}>
                    <button
                      onClick={() => handleCheckPricing(p)}
                      style={styles.checkPricingPrimary}
                    >
                      Check Pricing
                    </button>
                    <span style={styles.fullDetailQuickAskLabel}>or ask:</span>
                    {SAMPLE_DETAIL_QUESTIONS.slice(0, 2).map((q) => (
                      <button
                        key={q}
                        onClick={() => askDetailQuestion(q)}
                        style={styles.detailChip}
                      >
                        {q}
                      </button>
                    ))}
                  </div>

                  <div style={styles.fullDetailFooter}>
                    Ask Follow-up questions in the chat below or type <strong>"Exit"</strong> to
                    return to your results list.
                  </div>
                </div>
              );
            }
            if (msg.type === "program-qa-answer") {
              return (
                <AssistantMessage key={idx}>
                  <div style={styles.qaAnswerBox}>
                    <div style={styles.qaAnswerEyebrow}>{msg.program.name} · Follow-up</div>
                    <div style={styles.qaAnswerText}>{msg.answer}</div>
                  </div>
                </AssistantMessage>
              );
            }
            if (msg.type === "exclusions") {
              return (
                <div key={idx} style={styles.exclusionsCard}>
                  <div style={styles.exclusionsHeader}>
                    <div>
                      <div style={styles.exclusionsTitle}>Excluded Programs</div>
                      <div style={styles.exclusionsSubtitle}>
                        Programs that didn't match your scenario, with the overlay or rule that
                        triggered the skip.
                      </div>
                    </div>
                    <span style={styles.exclusionsCountChip}>{msg.excluded.length}</span>
                  </div>
                  {msg.excluded.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#374151" }}>
                      None — all programs matched.
                    </div>
                  ) : (
                    msg.excluded.map((e) => (
                      <div key={e.name} style={styles.exclusionDetailRow}>
                        <div style={styles.exclusionRowHead}>
                          <div style={styles.exclusionDetailName}>{e.name}</div>
                          {e.category && (
                            <span style={styles.exclusionCategoryChip}>{e.category}</span>
                          )}
                        </div>
                        <div style={styles.exclusionDetailReason}>{e.reason}</div>
                        {e.whatToChange && (
                          <div style={styles.exclusionWhatToChange}>
                            <span style={styles.exclusionWhatToChangeLabel}>
                              What would unlock this:
                            </span>{" "}
                            {e.whatToChange}
                          </div>
                        )}
                        {e.impactedFields && e.impactedFields.length > 0 && (
                          <div style={styles.exclusionImpactedRow}>
                            <span style={styles.exclusionImpactedLabel}>Impacted fields:</span>{" "}
                            {e.impactedFields.map((f, i) => (
                              <span key={f} style={styles.exclusionImpactedChip}>
                                {f}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              );
            }
            return null;
          })}
          <div ref={chatEndRef} />
        </div>

        {!hasStarted && mode === "form" && (
          <div style={styles.startRow}>
            <button onClick={() => handleStart()} style={styles.primaryButton}>
              Start
            </button>
            <span style={styles.startSeparator}>or</span>
            <button onClick={triggerFileUpload} style={styles.uploadFormBtn}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload 1003 / URLA v3.4
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xml,application/pdf,text/xml,application/xml"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
          </div>
        )}

        <div style={styles.chatInputBar}>
          <input
            type="text"
            value={chatInputValue}
            onChange={(e) => setChatInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleChatInputSubmit();
              }
            }}
            placeholder={
              mode === "chat"
                ? "Message"
                : hasStarted
                  ? "Type your answer, an option letter (A, B, C…), or describe in your own words..."
                  : "Type Start to begin..."
            }
            style={styles.chatInput}
          />
          <button
            onClick={toggleVoice}
            style={{
              ...styles.voiceButton,
              ...(isRecording ? styles.voiceButtonActive : {}),
            }}
            aria-label={isRecording ? "Stop recording" : "Voice input"}
            title={isRecording ? "Stop recording" : "Voice input"}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
              <line x1="8" y1="22" x2="16" y2="22" />
              <line x1="12" y1="18" x2="12" y2="22" />
            </svg>
          </button>
          <button onClick={handleChatInputSubmit} style={styles.sendButton} aria-label="Send">
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// STYLES
// ────────────────────────────────────────────────────────────────────────────

const NAVY = "#0C447C";
const LIGHT_NAVY = "#E6F1FB";
const GREEN = "#0F6E56";

const styles = {
  container: {
    display: "grid",
    gridTemplateColumns: "320px 1fr",
    height: "100vh",
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    background: "#fff",
  },

  // ── Scenario Vault ──────────────────────────────────────────────────────
  vaultContainer: {
    minHeight: "100vh",
    background: "#F9FAFB",
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: "24px 32px 80px",
    overflow: "auto",
  },
  vaultPageHeader: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18,
  },
  vaultPageTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "#0F172A",
    letterSpacing: -0.3,
    margin: 0,
  },
  vaultPageSubtitle: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 4,
  },
  vaultHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  vaultCloseBtn: {
    width: 38,
    height: 38,
    padding: 0,
    background: "#fff",
    color: "#6B7280",
    border: "0.5px solid #E5E7EB",
    borderRadius: 8,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  vaultNewBtn: {
    padding: "10px 18px",
    background: "linear-gradient(135deg, " + NAVY + " 0%, #1E5BA0 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(12, 68, 124, 0.25)",
  },
  vaultToolbar: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 16,
  },
  vaultSearchInput: {
    flex: 1,
    minWidth: 280,
    padding: "10px 14px",
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 13,
    background: "#fff",
  },
  vaultSelect: {
    padding: "10px 12px",
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 12,
    background: "#fff",
    color: "#1F2937",
    cursor: "pointer",
  },
  // Table card
  vaultTableCard: {
    background: "#fff",
    border: "0.5px solid #E5E7EB",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
  },
  vaultTableRow: {
    display: "grid",
    gridTemplateColumns: "56px 1.1fr 1.4fr 1.2fr 100px 1.3fr 140px",
    alignItems: "center",
    gap: 16,
    padding: "14px 24px",
    borderBottom: "0.5px solid #F1F5F9",
    cursor: "pointer",
    transition: "background-color 120ms ease",
    background: "#fff",
  },
  vaultTableRowAlt: {
    background: "#FAFBFC",
  },
  vaultTableHeadRow: {
    background: "#F1F5F9",
    cursor: "default",
    fontSize: 10,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: 700,
    padding: "12px 24px",
    borderBottom: "0.5px solid #E2E8F0",
  },
  vaultColSno: {
    fontSize: 13,
    color: "#94A3B8",
    fontWeight: 500,
    textAlign: "center",
    minWidth: 0,
  },
  vaultSnoText: {
    color: "#94A3B8",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  vaultColBorrower: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  vaultColScenario: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  vaultColTags: {
    minWidth: 0,
  },
  vaultColDate: {
    fontSize: 12,
    color: "#475569",
    minWidth: 0,
    fontVariantNumeric: "tabular-nums",
  },
  vaultColMatches: {
    minWidth: 0,
    textAlign: "center",
  },
  vaultColActions: {
    display: "flex",
    gap: 4,
    justifyContent: "flex-end",
  },
  vaultTagWrap: {
    display: "flex",
    gap: 4,
    flexWrap: "wrap",
  },
  vaultTagChip: {
    padding: "3px 8px",
    background: LIGHT_NAVY,
    color: NAVY,
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 600,
    whiteSpace: "nowrap",
    letterSpacing: 0.2,
  },
  vaultEmptyCell: {
    color: "#CBD5E1",
    fontSize: 13,
  },
  vaultRowName: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0F172A",
  },
  vaultPinStar: {
    color: "#F59E0B",
    fontSize: 13,
    marginRight: 4,
  },
  vaultMatchedNum: {
    fontSize: 14,
    color: GREEN,
    fontWeight: 600,
  },
  vaultMatchedEmpty: {
    fontSize: 13,
    color: "#9CA3AF",
  },
  vaultScenarioCode: {
    fontSize: 12,
    color: "#1F2937",
    fontFamily:
      'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "Roboto Mono", Consolas, monospace',
    background: "transparent",
    padding: 0,
  },
  vaultIconBtn: {
    width: 28,
    height: 28,
    padding: 0,
    background: "transparent",
    color: "#64748B",
    border: "0.5px solid #E2E8F0",
    borderRadius: 6,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 120ms ease, border-color 120ms ease, color 120ms ease",
  },
  vaultIconBtnDanger: {
    width: 28,
    height: 28,
    padding: 0,
    background: "transparent",
    color: "#94A3B8",
    border: "0.5px solid #E2E8F0",
    borderRadius: 6,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 120ms ease, border-color 120ms ease, color 120ms ease",
  },
  vaultEmpty: {
    textAlign: "center",
    padding: "60px 24px",
    background: "#fff",
    border: "0.5px dashed #D1D5DB",
    borderRadius: 12,
  },
  vaultEmptyIcon: {
    fontSize: 32,
    marginBottom: 10,
  },
  vaultEmptyTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#0F172A",
    marginBottom: 4,
  },
  vaultEmptyBody: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 16,
  },

  // Sidebar
  sidebar: {
    background: "#fff",
    borderRight: "0.5px solid #E5E7EB",
    padding: "16px",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
  },
  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sidebarTitle: {
    fontSize: 11,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  resetButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    background: "#FEE2E2",
    color: "#B91C1C",
    border: "1px solid #FCA5A5",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  sidebarHeaderActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  resubmitButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    background: NAVY,
    color: "#fff",
    border: "1px solid " + NAVY,
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    boxShadow: "0 2px 4px rgba(12, 68, 124, 0.18)",
  },
  eligibleCard: {
    marginBottom: 16,
    padding: 12,
    border: "0.5px solid #E5E7EB",
    borderRadius: 10,
    background: "#fff",
    transition: "all 200ms ease",
  },
  eligibleCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  eligibleLabel: {
    fontSize: 10,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  eyeButton: {
    width: 26,
    height: 26,
    padding: 0,
    background: "transparent",
    color: NAVY,
    border: "0.5px solid #D1D5DB",
    borderRadius: 6,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  eligibleValue: { marginBottom: 4 },
  eligibleNumber: { fontSize: 30, fontWeight: 500, color: GREEN },
  eligibleTotal: { fontSize: 13, color: "#6B7280" },
  progressTrack: {
    height: 4,
    background: "#F3F4F6",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: GREEN,
    transition: "width 300ms ease",
  },
  eligibleHint: { fontSize: 10, color: "#9CA3AF", marginTop: 4, lineHeight: 1.4 },
  previewTakeoverHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  previewTakeoverTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: "#1F2937",
  },
  backIconButton: {
    width: 26,
    height: 26,
    padding: 0,
    background: "transparent",
    color: NAVY,
    border: "0.5px solid #D1D5DB",
    borderRadius: 6,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  previewListLabel: {
    fontSize: 11,
    color: "#6B7280",
    marginTop: 0,
    marginBottom: 10,
  },
  previewList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: 1,
    overflowY: "auto",
  },
  previewListItem: {
    fontSize: 12,
    color: "#1F2937",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 0",
  },
  previewDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: GREEN,
    flexShrink: 0,
  },
  sectionTitle: {
    fontSize: 10,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 10,
  },
  sidebarRow: {
    display: "grid",
    gridTemplateColumns: "14px 1fr auto",
    gap: 6,
    padding: "4px 0",
    alignItems: "center",
    fontSize: 11,
  },
  checkIcon: { color: GREEN, fontSize: 12 },
  sidebarLabel: { color: "#6B7280" },
  sidebarValue: { fontWeight: 500, fontSize: 11 },
  sidebarLegend: {
    fontSize: 10,
    color: "#9CA3AF",
    lineHeight: 1.5,
    marginTop: "auto",
    paddingTop: 24,
  },

  // Chat pane
  chatPane: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
  },

  // Form/Chat mode tab strip
  modeTabBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 24px",
    borderBottom: "0.5px solid #E5E7EB",
    background: "#fff",
  },
  modeTabLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  modeTabRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  modeTab: {
    padding: "7px 14px",
    background: "transparent",
    color: "#6B7280",
    border: "0.5px solid transparent",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  modeTabActive: {
    padding: "7px 14px",
    background: NAVY,
    color: "#fff",
    border: "0.5px solid " + NAVY,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  uploadHint: {
    fontSize: 11,
    color: "#6B7280",
    marginLeft: 8,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  uploadHintLink: {
    background: "transparent",
    border: "none",
    color: NAVY,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
  },
  profileButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 12px 5px 5px",
    background: "#fff",
    color: "#1F2937",
    border: "0.5px solid #E5E7EB",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  profileAvatar: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    background: LIGHT_NAVY,
    color: NAVY,
    fontSize: 11,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    letterSpacing: 0.4,
  },
  profileName: {
    fontSize: 12,
    fontWeight: 500,
    color: "#1F2937",
  },
  profileWrap: {
    position: "relative",
    display: "inline-block",
  },
  profileCaret: {
    fontSize: 10,
    color: "#9CA3AF",
    marginLeft: 2,
  },
  profileDropdown: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    width: 280,
    background: "#fff",
    border: "0.5px solid #E5E7EB",
    borderRadius: 12,
    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)",
    padding: 8,
    zIndex: 1000,
  },
  profileDropHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 8px",
  },
  profileDropAvatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: LIGHT_NAVY,
    color: NAVY,
    fontSize: 13,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    letterSpacing: 0.4,
    flexShrink: 0,
  },
  profileDropName: {
    fontSize: 13,
    fontWeight: 600,
    color: "#0F172A",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  profileDropEmail: {
    fontSize: 11,
    color: "#6B7280",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  profileAccessRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    margin: "0 -2px 4px",
    background: LIGHT_NAVY,
    borderRadius: 8,
  },
  profileAccessLabel: {
    fontSize: 10,
    color: NAVY,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  profileAccessValue: {
    fontSize: 11,
    color: NAVY,
    fontWeight: 700,
    padding: "2px 8px",
    background: "#fff",
    borderRadius: 999,
  },
  profileDivider: {
    height: 1,
    background: "#F3F4F6",
    margin: "6px -8px",
  },
  profileItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "9px 10px",
    background: "transparent",
    color: "#1F2937",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "left",
  },
  profileItemDanger: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "9px 10px",
    background: "transparent",
    color: "#B91C1C",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "left",
  },
  profileItemIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    color: "#6B7280",
    flexShrink: 0,
  },
  profileItemLabel: {
    flex: 1,
  },
  profileItemBadge: {
    background: LIGHT_NAVY,
    color: NAVY,
    fontSize: 10,
    fontWeight: 700,
    padding: "1px 7px",
    borderRadius: 999,
  },

  // Chat-mode extraction summary card
  chatExtractionCard: {
    border: "0.5px solid #BFDBFE",
    background: LIGHT_NAVY,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
  },
  chatExtractionTitle: {
    fontSize: 11,
    color: NAVY,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: 600,
    marginBottom: 8,
  },
  chatExtractionList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  chatExtractionRow: {
    display: "grid",
    gridTemplateColumns: "16px 130px 1fr",
    gap: 8,
    alignItems: "center",
    fontSize: 12,
  },
  chatExtractionCheck: {
    color: GREEN,
    fontWeight: 600,
  },
  chatExtractionLabel: {
    color: "#6B7280",
  },
  chatExtractionValue: {
    color: "#1F2937",
    fontWeight: 500,
  },
  chatExtractionNotes: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: "0.5px solid #BFDBFE",
    fontSize: 11,
    color: "#4B5563",
    lineHeight: 1.5,
  },
  chatExtractionNote: {
    fontSize: 11,
    color: "#4B5563",
  },
  chatExtractionAmbiguous: {
    marginTop: 8,
    padding: "6px 8px",
    background: "#FEF3C7",
    border: "0.5px solid #FCD34D",
    borderRadius: 6,
    fontSize: 11,
    color: "#92400E",
  },
  chatScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },

  // Messages
  assistantRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
  },
  assistantAvatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: NAVY,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: 16,
  },
  assistantBubble: {
    flex: 1,
    paddingTop: 6,
    lineHeight: 1.6,
    color: "#1F2937",
  },
  userRow: {
    display: "flex",
    justifyContent: "flex-end",
  },
  userBubble: {
    background: "#F3F4F6",
    padding: "8px 14px",
    borderRadius: 12,
    fontSize: 13,
    maxWidth: "75%",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  editButton: {
    fontSize: 10,
    color: "#6B7280",
    background: "transparent",
    border: "0.5px solid #D1D5DB",
    padding: "2px 8px",
    borderRadius: 6,
    cursor: "pointer",
  },

  // Question rendering
  questionMeta: {
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  questionChip: {
    fontSize: 10,
    color: NAVY,
    background: LIGHT_NAVY,
    padding: "2px 8px",
    borderRadius: 8,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  optionalChip: {
    fontSize: 10,
    color: "#6B7280",
    background: "#F3F4F6",
    border: "0.5px solid #E5E7EB",
    padding: "2px 8px",
    borderRadius: 8,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  questionText: {
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 1.5,
  },
  optionStack: { display: "flex", flexDirection: "column", gap: 6 },
  optionHint: {
    fontSize: 11,
    color: "#9CA3AF",
    marginTop: 4,
    paddingLeft: 4,
  },

  numberedCard: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: 10,
    alignItems: "center",
    padding: "10px 12px",
    border: "0.5px solid #E5E7EB",
    borderRadius: 8,
    background: "#fff",
    textAlign: "left",
    cursor: "pointer",
    transition: "border-color 150ms ease",
  },
  numberCircle: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: LIGHT_NAVY,
    color: NAVY,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 500,
  },
  numberedCardTitle: { fontSize: 13, fontWeight: 500, color: "#1F2937" },
  numberedCardDesc: { fontSize: 11, color: "#6B7280", marginTop: 2 },

  // Triangle (Property Value / Loan Amount / LTV) inputs
  triangleRow: {
    display: "grid",
    gridTemplateColumns: "120px auto 1fr auto",
    gap: 8,
    alignItems: "center",
  },
  triangleLabel: {
    fontSize: 12,
    color: "#374151",
    fontWeight: 500,
  },
  triangleAffix: {
    fontSize: 14,
    color: "#6B7280",
  },
  triangleInput: {
    padding: "8px 10px",
    border: "0.5px solid #D1D5DB",
    borderRadius: 6,
    fontSize: 13,
    width: "100%",
  },
  triangleSubmit: {
    marginTop: 8,
    padding: "8px 16px",
    background: NAVY,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    alignSelf: "flex-start",
  },

  // Compound high-DTI followup form
  compoundStepLabel: {
    fontSize: 11,
    color: NAVY,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontWeight: 600,
    marginBottom: 8,
  },
  compoundFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  compoundSection: {
    border: "0.5px solid #E5E7EB",
    borderRadius: 10,
    padding: 12,
    background: "#fff",
    marginBottom: 10,
  },
  compoundSectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "#0F172A",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  compoundFieldLabel: {
    fontSize: 12,
    color: "#374151",
    fontWeight: 500,
    marginTop: 8,
    marginBottom: 6,
  },
  compoundYesNoRow: {
    display: "flex",
    gap: 8,
  },
  compoundChoiceBtn: {
    flex: 1,
    padding: "8px 14px",
    background: "#fff",
    color: "#1F2937",
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  compoundChoiceBtnActive: {
    flex: 1,
    padding: "8px 14px",
    background: LIGHT_NAVY,
    color: NAVY,
    border: "0.5px solid " + NAVY,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  compoundInput: {
    width: "100%",
    padding: "8px 12px",
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 13,
    boxSizing: "border-box",
  },
  compoundNumericRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  compoundPrefix: {
    fontSize: 14,
    color: "#6B7280",
  },
  compoundSuffix: {
    fontSize: 14,
    color: "#6B7280",
  },

  // Notice callout — used for high-DTI explanation banner
  noticeCallout: {
    padding: 10,
    background: "#FEF3C7",
    border: "0.5px solid #FCD34D",
    borderRadius: 8,
    marginTop: 4,
  },

  // Credit-events timeline — one event per screen with the same card style
  timelineEventHeader: {
    marginBottom: 10,
  },
  timelineEventName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#0F172A",
  },
  timelineEventSub: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 2,
  },
  timelineOrSeparator: {
    textAlign: "center",
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: 600,
    letterSpacing: 1,
    margin: "12px 0",
  },
  timelineDateLabel: {
    fontSize: 12,
    color: "#374151",
    fontWeight: 500,
    marginBottom: 6,
  },
  timelineDateRow: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  timelineDateInputFull: {
    flex: 1,
    padding: "10px 12px",
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 14,
  },
  timelineFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    gap: 8,
  },

  // Dropdown (select) inputs
  selectRow2: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  compoundTwoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginTop: 10,
  },
  selectInput: {
    flex: 1,
    padding: "10px 12px",
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
    color: "#1F2937",
    cursor: "pointer",
    appearance: "auto",
  },

  // Numeric inputs
  numericInputRow: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  numericPrefix: {
    fontSize: 14,
    color: "#6B7280",
  },
  numericInput: {
    flex: 1,
    padding: "8px 12px",
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 14,
  },
  numericSubmit: {
    width: 36,
    height: 36,
    padding: 0,
    background: NAVY,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 16,
  },

  // Final actions
  finalActions: {
    display: "flex",
    gap: 8,
    paddingLeft: 40,
  },
  primaryButton: {
    background: NAVY,
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  secondaryButton: {
    background: "transparent",
    color: "#374151",
    border: "0.5px solid #D1D5DB",
    padding: "10px 20px",
    borderRadius: 8,
    fontSize: 14,
    cursor: "pointer",
  },

  startRow: {
    padding: "0 24px 16px",
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
  },
  startSeparator: {
    fontSize: 12,
    color: "#9CA3AF",
    fontWeight: 500,
  },
  uploadFormBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    background: "#fff",
    color: NAVY,
    border: "0.5px solid #BFDBFE",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
  },

  // Chat input bar
  chatInputBar: {
    padding: "12px 24px",
    borderTop: "0.5px solid #E5E7EB",
    display: "flex",
    gap: 8,
    alignItems: "center",
    background: "#fff",
  },
  chatInput: {
    flex: 1,
    padding: "10px 14px",
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 13,
  },
  sendButton: {
    width: 38,
    height: 38,
    padding: 0,
    background: NAVY,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 16,
  },
  voiceButton: {
    width: 38,
    height: 38,
    padding: 0,
    background: "transparent",
    color: NAVY,
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  voiceButtonActive: {
    background: "#DC2626",
    color: "#fff",
    borderColor: "#DC2626",
    animation: "pulse 1s infinite",
  },

  // Results card
  resultsCard: {
    border: "0.5px solid #E5E7EB",
    borderRadius: 14,
    background: "linear-gradient(180deg, #FAFBFC 0%, #FFFFFF 100%)",
    padding: 18,
    marginTop: 4,
    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
  },
  resultsCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: "0.5px solid #E5E7EB",
  },
  resultsCardTitle: { fontSize: 14, fontWeight: 600, color: "#0F172A" },
  resultsCardChip: {
    fontSize: 11,
    padding: "3px 10px",
    background: "linear-gradient(135deg, #E6F1FB 0%, #DBEAFE 100%)",
    color: NAVY,
    borderRadius: 12,
    fontWeight: 600,
    letterSpacing: 0.2,
  },
  programRow: {
    display: "flex",
    alignItems: "center",
    padding: "14px 14px",
    gap: 12,
    width: "100%",
    background: "#fff",
    border: "0.5px solid #E5E7EB",
    cursor: "pointer",
    transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
    borderRadius: 10,
    textAlign: "left",
    marginBottom: 8,
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
  },
  programRowName: { fontSize: 14, fontWeight: 600, color: "#0F172A" },
  programRowStats: {
    display: "flex",
    gap: 6,
    marginTop: 8,
    flexWrap: "wrap",
  },
  programStatPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 10px",
    background: "#F8FAFC",
    border: "0.5px solid #E5E7EB",
    borderRadius: 999,
    fontSize: 11,
  },
  programStatLabel: { color: "#6B7280", fontWeight: 500 },
  programStatValue: { color: "#0F172A", fontWeight: 600 },
  knowMoreBtn: {
    background: "linear-gradient(135deg, " + NAVY + " 0%, #1E5BA0 100%)",
    color: "#fff",
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    flexShrink: 0,
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    boxShadow: "0 2px 6px rgba(12, 68, 124, 0.25)",
  },

  // Suggestion cards
  suggestionLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#0F172A",
    marginBottom: 10,
    marginTop: 4,
    lineHeight: 1.5,
  },
  suggestionRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "stretch",
    marginTop: 4,
  },
  suggestionPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    background: "linear-gradient(180deg, #FFFFFF 0%, #F9FAFB 100%)",
    color: "#0F172A",
    border: "0.5px solid #E5E7EB",
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textAlign: "left",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
    transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
  },
  suggestionPillDanger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    background: "linear-gradient(180deg, #FEF2F2 0%, #FEE2E2 100%)",
    color: "#B91C1C",
    border: "0.5px solid #FCA5A5",
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textAlign: "left",
    boxShadow: "0 1px 3px rgba(185, 28, 28, 0.08)",
    transition: "transform 150ms ease, box-shadow 150ms ease",
  },
  suggestionPillIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: 6,
    background: LIGHT_NAVY,
    color: NAVY,
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  suggestionPillIconDanger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: 6,
    background: "#FECACA",
    color: "#B91C1C",
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  // Quick-ask chip used inside the full-detail card
  detailChip: {
    padding: "6px 10px",
    background: LIGHT_NAVY,
    color: NAVY,
    border: "0.5px solid #BFDBFE",
    borderRadius: 999,
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left",
  },

  // Inline full program detail card (replaces the modal)
  fullDetailCard: {
    border: "0.5px solid #E5E7EB",
    borderRadius: 12,
    background: "#fff",
    padding: 18,
  },
  fullDetailHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  fullDetailName: {
    fontSize: 15,
    fontWeight: 600,
    color: "#0F172A",
  },
  returnLinkBtn: {
    padding: "7px 12px",
    background: "#fff",
    color: "#1F2937",
    border: "0.5px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  fullDetailSection: {
    fontSize: 10,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: 600,
    marginTop: 14,
    marginBottom: 6,
  },
  fullDetailBody: {
    fontSize: 13,
    color: "#1F2937",
    lineHeight: 1.5,
  },
  inlineMatch: {
    color: GREEN,
    fontWeight: 600,
  },

  // Key metrics table
  metricTable: {
    border: "0.5px solid #E5E7EB",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 4,
  },
  metricHeaderRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 1fr 1fr 1.2fr",
    padding: "10px 12px",
    background: "#F9FAFB",
    fontSize: 10,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontWeight: 500,
    borderBottom: "0.5px solid #E5E7EB",
  },
  metricRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 1fr 1fr 1.2fr",
    padding: "10px 12px",
    fontSize: 12,
    borderBottom: "0.5px solid #F3F4F6",
    alignItems: "center",
  },
  metricLabelCell: {
    color: "#374151",
    fontWeight: 500,
  },
  metricCell: {
    color: "#1F2937",
  },

  // Products list — only the products available to this borrower
  productsList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  productAvailable: {
    fontSize: 13,
    color: "#1F2937",
  },

  // Additional considerations
  considerationList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  considerationItem: {
    fontSize: 12,
    color: "#374151",
    lineHeight: 1.5,
  },

  // Primary CTA row inside the detail card — Check Pricing + quick ask chips
  fullDetailCtaRow: {
    marginTop: 20,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  fullDetailQuickAskLabel: {
    fontSize: 12,
    color: "#6B7280",
    marginLeft: 4,
    marginRight: 2,
  },
  checkPricingPrimary: {
    padding: "10px 18px",
    background: NAVY,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 4px rgba(12, 68, 124, 0.18)",
  },

  // Footer hint in the detail card
  fullDetailFooter: {
    marginTop: 16,
    paddingTop: 12,
    borderTop: "0.5px solid #F3F4F6",
    fontSize: 12,
    color: "#6B7280",
    lineHeight: 1.5,
  },

  // Follow-up Q&A answer bubble
  qaAnswerBox: {
    border: "0.5px solid #E5E7EB",
    borderRadius: 10,
    background: "#F9FAFB",
    padding: 12,
  },
  qaAnswerEyebrow: {
    fontSize: 10,
    color: NAVY,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: 500,
    marginBottom: 4,
  },
  qaAnswerText: {
    fontSize: 13,
    color: "#1F2937",
    lineHeight: 1.5,
  },

  // Excluded Programs richer card
  exclusionsCard: {
    border: "0.5px solid #E5E7EB",
    borderRadius: 12,
    background: "#fff",
    padding: 16,
  },
  exclusionsHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  exclusionsTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#0F172A",
  },
  exclusionsSubtitle: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 2,
    lineHeight: 1.4,
  },
  exclusionsCountChip: {
    padding: "3px 10px",
    background: "#FEE2E2",
    color: "#B91C1C",
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    flexShrink: 0,
  },
  exclusionDetailRow: {
    padding: "12px 0",
    borderTop: "0.5px solid #F3F4F6",
  },
  exclusionRowHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  exclusionDetailName: {
    fontSize: 13,
    fontWeight: 600,
    color: "#1F2937",
  },
  exclusionCategoryChip: {
    fontSize: 10,
    padding: "2px 8px",
    background: "#FEF3C7",
    color: "#92400E",
    borderRadius: 10,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    flexShrink: 0,
  },
  exclusionDetailReason: {
    fontSize: 12,
    color: "#4B5563",
    lineHeight: 1.5,
    marginBottom: 6,
  },
  exclusionWhatToChange: {
    fontSize: 12,
    color: "#1F2937",
    lineHeight: 1.5,
    background: "#F9FAFB",
    border: "0.5px solid #E5E7EB",
    borderRadius: 6,
    padding: "6px 8px",
    marginBottom: 6,
  },
  exclusionWhatToChangeLabel: {
    fontWeight: 600,
    color: "#0F172A",
  },
  exclusionImpactedRow: {
    fontSize: 11,
    color: "#6B7280",
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  exclusionImpactedLabel: {
    color: "#6B7280",
  },
  exclusionImpactedChip: {
    padding: "2px 6px",
    background: "#E5E7EB",
    color: "#374151",
    borderRadius: 8,
    fontSize: 10,
    fontWeight: 500,
  },
};
