/**
 * Map intake portfolio_delta (snake_case slot keys) → wizard form patch.
 * Shared by chat mode sidebar sync and form-mode eligibility payload builders.
 */
import {
  EXISTING_SECOND_LIEN_NONE,
  EXISTING_SECOND_LIEN_PAID_OFF,
  EXISTING_SECOND_LIEN_SUBORDINATION,
  LIEN_POSITION_FIRST,
  LIEN_POSITION_PIGGYBACK,
  LIEN_POSITION_SECOND,
} from "@/lib/nqmIntegratedForm";
import { bkCodeFromFreeText, locationCascadeClearPatch } from "@/lib/formChatFlow";
import { clearGeoFollowupFieldsPatch, inferGeoFollowupsFromCounty } from "@/lib/stateGeoFollowUp";
import { STATES } from "@/lib/wizardFormUi";

// "florida" | "fl" | "FL" → "FL"; unknown input passes through unchanged. The wizard's geo
// gating (sidebar County/City/etc. rows) compares form.state to 2-letter codes, so a chat
// extractor value like "Florida" must be normalized to a code or the sub-geo rows vanish.
const STATE_CODE_BY_KEY = new Map<string, string>();
for (const st of STATES) {
  STATE_CODE_BY_KEY.set(st.code.toLowerCase(), st.code);
  STATE_CODE_BY_KEY.set(st.label.toLowerCase(), st.code);
}
function normalizeStateCode(raw: string): string {
  const trimmed = raw.trim();
  return STATE_CODE_BY_KEY.get(trimmed.toLowerCase()) ?? trimmed;
}

export type WizardFormPatch = Record<
  string,
  string | string[] | Record<string, string> | undefined
>;

/** Portfolio keys mirrored into the wizard form (geo + core location). */
const PORTFOLIO_SNAPSHOT_KEYS = [
  "property_state",
  "state_county",
  "state_city",
  "state_borough",
  "state_zip",
  "is_in_baltimore",
  "is_in_indianapolis",
  "is_in_philadelphia",
  "is_in_memphis",
  "is_in_lubbock",
  "rural_property",
] as const;

export type PortfolioToFormPatchOpts = {
  /**
   * false → pure value mirror: never emit downstream clears (no state→geo wipe,
   * no county→follow-up wipe). Used by the every-turn snapshot sync, which must
   * not revert form values that aren't mirrored in the portfolio.
   */
  cascade?: boolean;
  /**
   * Current form, when available. With it, the state/county cascades fire only on
   * a GENUINE change — a re-emitted unchanged state no longer wipes the county.
   */
  form?: { state?: string; stateCounty?: string };
};

/** Map filled portfolio slots → form patch (keeps chat sidebar geo rows in sync). */
export function portfolioSnapshotToFormPatch(portfolio: Record<string, unknown>): WizardFormPatch {
  const delta: Record<string, unknown> = {};
  for (const key of PORTFOLIO_SNAPSHOT_KEYS) {
    const v = portfolio[key];
    if (v != null && String(v).trim()) delta[key] = v;
  }
  return portfolioToFormPatch(delta, { cascade: false });
}

export function portfolioToFormPatch(
  delta: Record<string, unknown>,
  opts: PortfolioToFormPatchOpts = {},
): WizardFormPatch {
  const cascade = opts.cascade !== false;
  const patch: WizardFormPatch = {};
  const s = (k: string): string => String(delta[k] ?? "");

  if (delta.citizenship) {
    const m: Record<string, string> = {
      us_citizen: "US Citizen",
      perm_resident: "Permanent Resident Alien",
      non_perm_resident: "Non-Permanent Resident Alien",
      foreign_national: "Foreign National",
      itin: "ITIN",
      daca: "DACA",
    };
    patch.citizenship = m[s("citizenship")] ?? s("citizenship");
  }
  if (delta.occupancy) {
    const m: Record<string, string> = {
      primary_residence: "Primary Residence",
      second_home: "Second Home",
      investment_property: "Investment Property",
    };
    patch.occupancy = m[s("occupancy")] ?? s("occupancy");
  }
  if (delta.loan_purpose) {
    const m: Record<string, string> = {
      purchase: "Purchase",
      rate_term: "Refinance",
      cash_out: "Cash-Out Refinance",
    };
    const canonical = m[s("loan_purpose")] ?? s("loan_purpose");
    patch.loanPurpose = canonical;
    patch.primaryLoanPurpose = canonical;
  }
  if (delta.property_type) patch.propertyType = s("property_type");
  if (delta.property_value) patch.valueSalesPrice = s("property_value");
  if (delta.loan_amount) patch.loanAmount = s("loan_amount");
  if (delta.ltv) patch.ltv = s("ltv");
  if (delta.cltv) patch.cltv = s("cltv");
  if (delta.fico) patch.decisionCreditScore = s("fico");
  if (delta.estimated_dti) patch.estimatedDti = s("estimated_dti");
  if (delta.dscr) patch.dscr = s("dscr");
  if (delta.property_state) {
    const nextState = normalizeStateCode(s("property_state"));
    patch.state = nextState;
    const prevState = String(opts.form?.state ?? "").trim();
    if (cascade && (!opts.form || nextState !== prevState)) {
      Object.assign(patch, locationCascadeClearPatch(nextState));
    }
  }
  if (delta.doc_type) {
    const m: Record<string, string> = {
      full_doc: "Full Documentation",
      bank_stmt_12_or_24: "Bank Statements (12 or 24 Months)",
      bank_stmt_business: "Bank Statement Business",
      pl_only: "P&L Only",
      pl_2mo_bs: "P&L with 2 Month Bank Statement",
      asset_util: "Asset Utilization",
      asset_qualifier: "Asset Qualifier",
      "1099": "1099",
      wvoe: "WVOE",
    };
    patch.documentationType = m[s("doc_type")] ?? s("doc_type");
  }
  if (delta.doc_timeframe) {
    const v = s("doc_timeframe").trim();
    patch.documentationTimeframe =
      v === "12" || v.startsWith("12") ? "12" : v === "24" || v.startsWith("24") ? "24" : v;
  }
  if (delta.lien_position) {
    const lienCodeMap: Record<string, string> = {
      first_lien_only: LIEN_POSITION_FIRST,
      second_lien: LIEN_POSITION_SECOND,
      second_lien_piggyback: LIEN_POSITION_PIGGYBACK,
    };
    patch.lienPosition = lienCodeMap[s("lien_position")] ?? s("lien_position");
    patch.isSecondLien =
      s("lien_position") === "second_lien" || s("lien_position") === "second_lien_piggyback"
        ? "yes"
        : "no";
  }
  if (delta.existing_first_lien) patch.existingFirstLien = s("existing_first_lien");
  // existing_mortgage_upb (first-lien refi payoff) is the same number as
  // existingFirstLien — bridge it so an extraction under either slot id lands.
  if (delta.existing_mortgage_upb && !delta.existing_first_lien)
    patch.existingFirstLien = s("existing_mortgage_upb");
  if (delta.existing_second_lien) {
    const rawSecond = s("existing_second_lien").toLowerCase();
    if (rawSecond.includes("subordinat")) {
      patch.existingSecondLien = EXISTING_SECOND_LIEN_SUBORDINATION;
    } else if (rawSecond.includes("paid off") || rawSecond.includes("being paid")) {
      patch.existingSecondLien = EXISTING_SECOND_LIEN_PAID_OFF;
    } else if (rawSecond === "none" || rawSecond === "") {
      patch.existingSecondLien = EXISTING_SECOND_LIEN_NONE;
    } else {
      patch.existingSecondLien = s("existing_second_lien");
    }
  }
  if (delta.existing_second_lien_balance)
    patch.existingSecondLienBalance = s("existing_second_lien_balance");
  if (delta.investment_income_path) {
    patch.investmentIncomePath = s("investment_income_path") as "" | "income" | "dscr";
  } else if (
    delta.doc_type &&
    s("doc_type") !== "dscr" &&
    delta.occupancy &&
    s("occupancy") === "investment_property"
  ) {
    patch.investmentIncomePath = "income";
  }
  if (delta.rental_type) patch.rentalType = s("rental_type");
  if (delta.prepayment_terms) patch.prepaymentTerms = s("prepayment_terms");
  if (delta.credit_event_category) {
    const cat = s("credit_event_category");
    patch.creditEventCategory = cat;
    const isNone = cat === "None" || cat === "";
    patch.hasCreditEvent = isNone ? "No" : "Yes";
    if (!isNone) {
      const creditType = delta.credit_event_type ? s("credit_event_type") : "";
      const BK_TYPE_MAP: Record<string, string> = {
        "Ch. 7 discharged": "BK-Ch7-Discharged",
        "Ch. 7 dismissed": "BK-Ch7-Dismissed",
        "Ch. 13 discharged": "BK-Ch13-Discharged",
        "Ch. 13 dismissed": "BK-Ch13-Dismissed",
      };
      const CAT_TO_EV_CODE: Record<string, string> = {
        // Chapter/status unknown → generic "BK"; the chat asks the chapter next
        // instead of silently assuming Ch. 7 Discharged.
        BK: "BK",
        FC: "FC",
        SS: "SS",
        DIL: "DIL",
        "Pre-FC": "Pre-FC",
        "Charge-Off": "Charge-Off",
        NOD: "NOD",
        Mod: "Mod",
        Forbearance: "Forbearance",
        Deferral: "Deferral",
      };
      const evCode =
        cat === "BK"
          ? (BK_TYPE_MAP[creditType] ?? bkCodeFromFreeText(creditType) ?? "BK")
          : (CAT_TO_EV_CODE[cat] ?? cat);
      patch.creditEvents = [evCode];
      patch.creditEventType = creditType || evCode;
    } else {
      patch.creditEvents = [];
    }
  }
  if (delta.credit_event_type && !delta.credit_event_category) {
    patch.creditEventType = s("credit_event_type");
  }
  if (delta.years_since_event) {
    patch.yearsSinceCreditEvent = s("years_since_event");
    if (Array.isArray(patch.creditEvents) && patch.creditEvents.length) {
      patch.creditEventYears = { [patch.creditEvents[0]]: s("years_since_event") };
    }
  }
  if (delta.payment_history) patch.paymentHistory = s("payment_history");
  if (delta.first_time_homebuyer) patch.firstTimeHomebuyer = s("first_time_homebuyer");
  if (delta.first_time_investor) patch.firstTimeInvestor = s("first_time_investor");
  if (delta.state_county) {
    const county = s("state_county");
    patch.stateCounty = county;
    const prevCounty = String(opts.form?.stateCounty ?? "").trim();
    if (cascade && (!opts.form || county.trim() !== prevCounty)) {
      Object.assign(patch, clearGeoFollowupFieldsPatch());
      const st = delta.property_state
        ? normalizeStateCode(s("property_state"))
        : String(opts.form?.state ?? "").trim() || undefined;
      if (st) Object.assign(patch, inferGeoFollowupsFromCounty(st, county));
    }
  }
  if (delta.state_city) {
    const city = s("state_city");
    if (city === "lubbock") {
      patch.isInLubbock = "Yes";
    } else {
      patch.stateCity = city;
    }
  }
  if (delta.state_borough) patch.stateBorough = s("state_borough");
  if (delta.state_zip) patch.stateZipCode = s("state_zip");
  if (delta.is_in_baltimore) patch.isInBaltimoreCity = s("is_in_baltimore");
  if (delta.is_in_indianapolis) patch.isInIndianapolis = s("is_in_indianapolis");
  if (delta.is_in_philadelphia) patch.isInPhiladelphia = s("is_in_philadelphia");
  if (delta.is_in_memphis) patch.isInMemphis = s("is_in_memphis");
  if (delta.is_in_lubbock) patch.isInLubbock = s("is_in_lubbock");
  if (delta.gift_funds_pct) patch.giftFundsPercent = s("gift_funds_pct");
  if (delta.reserves_months) patch.reservesAvailable = s("reserves_months");
  if (delta.assets) patch.assetsLiquidFunds = s("assets");
  if (delta.interest_only) {
    const io = s("interest_only");
    patch.interestOnlyPref = io === "yes" ? "Yes — IO" : io === "no" ? "No" : io;
  }
  if (delta.rural_property) {
    const m: Record<string, string> = { yes: "Yes", no: "No", unsure: "Not sure" };
    patch.isRuralProperty = m[s("rural_property")] ?? s("rural_property");
  }
  if (delta.declining_market) {
    patch.decliningMarket =
      s("declining_market") === "yes"
        ? "Yes"
        : s("declining_market") === "no_unknown"
          ? "No"
          : s("declining_market");
  }
  if (delta.property_condition) patch.propertyCondition = s("property_condition");
  if (delta.acreage) patch.acreage = s("acreage");
  if (delta.tradelines) {
    const m: Record<string, string> = {
      three_twelve: "3+ active, 12+ mo",
      two_twentyfour: "2+ active, 24+ mo",
      mortgage: "Mortgage 36+ mo",
      unsure: "Unsure",
      none: "None — non-traditional",
    };
    patch.tradelines = m[s("tradelines")] ?? s("tradelines");
  }
  if (delta.cash_in_hand) patch.cashInHandRequest = s("cash_in_hand");
  if (delta.power_of_attorney) {
    patch.powerOfAttorney = s("power_of_attorney") === "yes" ? "Yes" : "No";
  }
  if (delta.non_arms_length) {
    patch.nonArmsLength = s("non_arms_length") === "yes" ? "Yes" : "No";
  }

  // ── v6 slots — codes already match the wizard option values (passthrough) ──
  if (delta.visa_category) patch.visaCategory = s("visa_category");
  if (delta.visa_type) patch.visaType = s("visa_type");
  if (delta.second_lien_product) patch.secondLienProduct = s("second_lien_product");
  if (delta.heloc_draw_years) patch.helocDrawYears = s("heloc_draw_years");
  if (delta.heloc_initial_draw) patch.helocInitialDraw = s("heloc_initial_draw");
  if (delta.hi_lava_zone) {
    // Slot code "Zone 3-9" → wizard option "Zone 3-9 (lower risk)"; others passthrough.
    const z = s("hi_lava_zone");
    patch.hiLavaZone = z === "Zone 3-9" ? "Zone 3-9 (lower risk)" : z;
  }
  if (delta.vacant_property) patch.vacantProperty = s("vacant_property");
  if (delta.recently_rehabbed) patch.recentlyRehabbed = s("recently_rehabbed");
  if (delta.prepay_stepdown) patch.prepayStepdown = s("prepay_stepdown");
  if (delta.established_primary_res) patch.establishedPrimaryRes = s("established_primary_res");

  return patch;
}
