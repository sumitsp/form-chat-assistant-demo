import { computeYearsSinceBucket } from "@/lib/creditEventTiming";
import { geoSidebarSlotsForForm } from "@/lib/stateGeoFollowUp";
import {
  creditEventSidebarLabel,
  docTimeframeAsked,
  formatDocumentationTimeframeDisplay,
  loanDetailsFieldSpec,
} from "@/lib/formChatFlow";
import {
  formatMoneyDisplay,
  formatLoanTermDisplay,
  incomeTypeDisplayLabel,
  INTEGRATED_PROPERTY_TYPES,
  isDscrPathScenario as isDscrPathScenarioFields,
  isFiveEightProperty,
  LOAN_PURPOSE_INTEGRATED,
  LIEN_POSITION_FIRST,
  LIEN_POSITION_SECOND,
  LIEN_POSITION_PIGGYBACK,
  loanAmountFieldLabel,
  OWNER_OCCUPIED_INCOME_PATH_LABEL,
  PAYMENT_HISTORY_OPTIONS,
  shouldAskFirstTimeHomebuyer,
  shouldHardcodeFirstTimeHomebuyerNo,
  shouldAskFirstTimeInvestor,
  shouldHardcodeFirstTimeInvestorNo,
  shouldShowOwnerOccupiedIncomePathSidebar,
  effectivePrimaryLoanPurpose,
  shouldShowEstablishedPrimaryRes,
  shouldShowPaymentHistory,
  shouldShowSecondLienFields,
  existingSecondLienNeedsSubordination,
  usesCltvLeverageField,
  parseMoneyNum,
} from "@/lib/nqmIntegratedForm";
import { STATES } from "@/lib/wizardFormUi";
import type { WizardForm } from "@/components/wizard/loanWizardForm";

const LOAN_PURPOSE_OPTIONS = LOAN_PURPOSE_INTEGRATED;
const CORE_PROPERTY_TYPES = INTEGRATED_PROPERTY_TYPES;
const LIEN_POSITION_OPTIONS = [
  { value: LIEN_POSITION_FIRST, label: "First Lien" },
  { value: LIEN_POSITION_SECOND, label: "Second Lien (Standalone)" },
  { value: LIEN_POSITION_PIGGYBACK, label: "Second Lien (Piggyback)" },
] as const;

export type ProfileRow = {
  label: string;
  value: string;
  fieldKey: string;
  missing?: boolean;
  priority?: "essential" | "conditional" | "optional";
};
export type ProfileSection = { step: 1 | 2 | 3 | 4 | 5 | 6; title: string; rows: ProfileRow[] };

export type ChatSlotDef = {
  slotId: string;
  kind: "enum" | "currency" | "number" | "text";
  options?: { code: string; label: string; formValue?: string }[];
};

const PROFILE_SECTION_TITLES: Record<ProfileSection["step"], string> = {
  1: "Basics",
  2: "Capacity",
  3: "Credit",
  4: "Collateral",
  5: "Considerations",
  6: "Extra",
};

export function collectMissingRequiredProfileRows(
  form: WizardForm,
  ctx: { creditScoreOk: boolean; creditScoreRequired: boolean },
): (ProfileRow & { step: ProfileSection["step"] })[] {
  const empty = (v: string) => !v.trim();
  const rows: (ProfileRow & { step: ProfileSection["step"] })[] = [];
  const add = (
    step: ProfileSection["step"],
    label: string,
    fieldKey: string,
    isMissing: boolean,
  ) => {
    if (isMissing) rows.push({ label, value: "", fieldKey, missing: true, step });
  };

  const isDscr = isDscrPathScenarioFields({
    occupancy: form.occupancy,
    propertyType: form.propertyType,
    investmentIncomePath: form.investmentIncomePath,
  });

  const triGaps = loanDetailsFieldSpec(form);
  add(1, "Citizenship", "citizenship", empty(form.citizenship));
  add(1, "Occupancy", "occupancy", empty(form.occupancy));
  add(1, "Loan Purpose", "primaryLoanPurpose", empty(form.primaryLoanPurpose));
  add(1, "Lien Position", "lienPosition", empty(form.lienPosition));
  if (triGaps.showExistingFirstLien && triGaps.existingFirstLienRequired) {
    add(1, triGaps.existingFirstLien, "existingFirstLien", empty(form.existingFirstLien));
  }
  const _isFirstLienRefi =
    form.lienPosition === LIEN_POSITION_FIRST &&
    (form.primaryLoanPurpose === "Refinance" || form.primaryLoanPurpose === "Cash-Out Refinance");
  if (form.isSecondLien === "no" && _isFirstLienRefi) {
    add(1, "Existing 2nd Lien", "existingSecondLien", empty(form.existingSecondLien));
    if (
      existingSecondLienNeedsSubordination(form.existingSecondLien) &&
      empty(form.existingSecondLienBalance)
    ) {
      add(1, "2nd Lien Balance", "existingSecondLienBalance", true);
    }
  }
  add(1, "Property Type", "propertyType", empty(form.propertyType));
  add(1, triGaps.propertyValue, "valueSalesPrice", empty(form.valueSalesPrice));
  add(1, triGaps.loanAmount, "loanAmount", empty(form.loanAmount));
  add(1, triGaps.ltv, "ltv", empty(form.ltv));
  if (triGaps.showHelocDraw) {
    add(1, "Draw Period", "helocDrawYears", empty(form.helocDrawYears));
    add(1, "Initial Draw", "helocInitialDraw", empty(form.helocInitialDraw));
  }
  if (usesCltvLeverageField(form.isSecondLien, form.existingSecondLien)) {
    add(1, "CLTV", "cltv", empty(form.cltv));
  }
  if (ctx.creditScoreRequired || form.decisionCreditScore.trim()) {
    add(1, "Decision Credit Score", "decisionCreditScore", !ctx.creditScoreOk);
  }
  if (form.occupancy === "Primary Residence" || form.occupancy === "Second Home") {
    if (shouldAskFirstTimeHomebuyer(form)) {
      add(1, "First-Time Buyer", "firstTimeHomebuyer", empty(form.firstTimeHomebuyer));
    }
  }
  if (form.occupancy === "Investment Property") {
    if (shouldAskFirstTimeInvestor(form)) {
      add(1, "First-Time Investor", "firstTimeInvestor", empty(form.firstTimeInvestor));
    }
    if (
      shouldShowEstablishedPrimaryRes(
        form.occupancy,
        form.firstTimeHomebuyer,
        form.firstTimeInvestor,
      )
    ) {
      add(
        1,
        "Established Primary Res.",
        "establishedPrimaryRes",
        empty(form.establishedPrimaryRes),
      );
    }
    if (!isFiveEightProperty(form.propertyType)) {
      add(1, "Investment Income Path", "investmentIncomePath", empty(form.investmentIncomePath));
    }
  }

  if (!isDscr) {
    add(2, "Doc Type", "documentationType", empty(form.documentationType));
    if (docTimeframeAsked(form)) {
      add(2, "Doc Timeframe", "documentationTimeframe", empty(form.documentationTimeframe));
    }
    add(2, "DTI", "estimatedDti", empty(form.estimatedDti));
  } else {
    add(2, "DSCR", "dscr", empty(form.dscr));
    add(2, "Rental Type", "rentalType", empty(form.rentalType));
  }
  if (isDscr || form.occupancy === "Investment Property") {
    add(2, "Prepayment", "prepaymentTerms", empty(form.prepaymentTerms));
  }

  // Step 3: Credit
  add(3, "Credit Events", "hasCreditEvent", empty(form.hasCreditEvent));
  if (form.hasCreditEvent === "Yes") {
    for (const evCode of [...new Set(form.creditEvents)]) {
      const hasDate = !!form.creditEventDates?.[evCode]?.trim();
      const hasYears = !!form.creditEventYears?.[evCode]?.trim();
      if (!hasDate && !hasYears) {
        add(3, "Event Date / Years Since", "creditEventDates", true);
        break;
      }
    }
  }
  if (
    shouldShowPaymentHistory(form.estimatedDti, form.documentationType, form.occupancy) &&
    empty(form.paymentHistory)
  ) {
    add(3, "Housing History", "paymentHistory", true);
  }

  // Step 4: Collateral
  add(4, "State", "state", empty(form.state));
  if (form.state.trim()) {
    add(4, "County", "stateCounty", empty(form.stateCounty));
  }
  for (const slot of geoSidebarSlotsForForm(form)) {
    add(4, slot.label, slot.fieldKey, empty(slot.value));
  }
  if (form.state === "HI") add(4, "HI Lava Zone", "hiLavaZone", empty(form.hiLavaZone));
  add(4, "Rural Property", "isRuralProperty", empty(form.isRuralProperty));

  // Step 5: Considerations
  add(5, "Power of Attorney", "powerOfAttorney", empty(form.powerOfAttorney));
  add(5, "Non-Arm's Length", "nonArmsLength", empty(form.nonArmsLength));

  return rows;
}

export function enrichProfileSectionsForEdit(
  sections: ProfileSection[],
  missing: (ProfileRow & { step: ProfileSection["step"] })[],
): ProfileSection[] {
  const map = new Map<number, ProfileSection>();
  for (const s of sections) map.set(s.step, { ...s, rows: [...s.rows] });
  for (const row of missing) {
    const step = row.step;
    const sec = map.get(step) ?? { step, title: PROFILE_SECTION_TITLES[step], rows: [] };
    if (!sec.rows.some((r) => r.fieldKey === row.fieldKey)) {
      sec.rows.push({ label: row.label, value: "", fieldKey: row.fieldKey, missing: true });
    }
    map.set(step, sec);
  }
  return Array.from(map.values()).sort((a, b) => a.step - b.step);
}

export function buildProfileSections(form: WizardForm, maxReachedStep = 1): ProfileSection[] {
  const f = (v: string) => v.trim().length > 0;
  const sections: ProfileSection[] = [];
  const isDscr = isDscrPathScenarioFields({
    occupancy: form.occupancy,
    propertyType: form.propertyType,
    investmentIncomePath: form.investmentIncomePath,
  });

  const s1: ProfileRow[] = [];
  if (f(form.citizenship))
    s1.push({
      label: "Citizenship",
      value: form.citizenship,
      fieldKey: "citizenship",
      priority: "essential",
    });
  if (f(form.occupancy))
    s1.push({
      label: "Occupancy",
      value: form.occupancy,
      fieldKey: "occupancy",
      priority: "essential",
    });
  if (f(form.loanPurpose)) {
    const lp = LOAN_PURPOSE_OPTIONS.find((p) => p.value === form.loanPurpose);
    s1.push({
      label: "Loan Purpose",
      value: lp?.label ?? form.loanPurpose,
      fieldKey: "loanPurpose",
      priority: "essential",
    });
  }
  if (f(form.lienPosition))
    s1.push({
      label: "Lien Position",
      value:
        LIEN_POSITION_OPTIONS.find((o) => o.value === form.lienPosition)?.label ??
        form.lienPosition,
      fieldKey: "lienPosition",
      priority: "essential",
    });
  if (f(form.secondLienProduct))
    s1.push({
      label: "Second Lien Product",
      value: form.secondLienProduct === "heloc" ? "HELOC" : "HELOAN",
      fieldKey: "secondLienProduct",
      priority: "conditional",
    });
  if (f(form.propertyType)) {
    const pt = CORE_PROPERTY_TYPES.find((p) => p.value === form.propertyType);
    s1.push({
      label: "Property Type",
      value: pt?.label ?? form.propertyType,
      fieldKey: "propertyType",
      priority: "essential",
    });
  }
  // Contextual triangle labels — single source shared with the Loan Details card.
  const tri = loanDetailsFieldSpec(form);
  if (f(form.valueSalesPrice))
    s1.push({
      label: tri.propertyValue,
      value: formatMoneyDisplay(form.valueSalesPrice),
      fieldKey: "valueSalesPrice",
      priority: "essential",
    });
  if (f(form.loanAmount))
    s1.push({
      label: tri.loanAmount,
      value: formatMoneyDisplay(form.loanAmount),
      fieldKey: "loanAmount",
      priority: "essential",
    });
  if (f(form.ltv))
    s1.push({ label: tri.ltv, value: `${form.ltv}%`, fieldKey: "ltv", priority: "essential" });
  // CLTV — second liens + refis only (labels spec); falls back to LTV when no 2nd subordinates
  if (f(form.ltv) && tri.showCltv) {
    const cltvVal = f(form.cltv) ? form.cltv : form.ltv;
    s1.push({ label: "CLTV", value: `${cltvVal}%`, fieldKey: "cltv", priority: "essential" });
  }
  // Down Payment — Purchase scenarios only
  if (form.primaryLoanPurpose === "Purchase" || form.loanPurpose === "Purchase") {
    const pv = parseMoneyNum(form.valueSalesPrice);
    if (pv > 0) {
      let dp = 0;
      if (form.lienPosition === LIEN_POSITION_PIGGYBACK) {
        const first = parseMoneyNum(form.existingFirstLien);
        const second = parseMoneyNum(form.loanAmount);
        if (first > 0 && second > 0) dp = pv - first - second;
      } else {
        const loan = parseMoneyNum(form.loanAmount);
        if (loan > 0) dp = pv - loan;
      }
      if (dp > 0) {
        const dpPct = ((dp / pv) * 100).toFixed(1);
        s1.push({
          label: "Down Payment",
          value: `${formatMoneyDisplay(String(dp))} (${dpPct}%)`,
          fieldKey: "_downPayment",
          priority: "essential",
        });
      }
    }
  }
  // Cash-out amount (hidden on standalone HELOC — Initial Draw replaces it)
  if (
    (form.primaryLoanPurpose === "Cash-Out Refinance" ||
      form.loanPurpose === "Cash-Out Refinance") &&
    tri.showCash &&
    f(form.cashInHandRequest)
  ) {
    s1.push({
      label: "Cash-Out Request",
      value: formatMoneyDisplay(form.cashInHandRequest),
      fieldKey: "cashInHandRequest",
      priority: "essential",
    });
  }
  // Standalone HELOC: draw period + day-one draw
  if (tri.showHelocDraw) {
    if (f(form.helocDrawYears))
      s1.push({
        label: "Draw Period",
        value: `${form.helocDrawYears} years`,
        fieldKey: "helocDrawYears",
        priority: "conditional",
      });
    if (f(form.helocInitialDraw))
      s1.push({
        label: "Initial Draw",
        value: formatMoneyDisplay(form.helocInitialDraw),
        fieldKey: "helocInitialDraw",
        priority: "conditional",
      });
  }
  if (f(form.decisionCreditScore))
    s1.push({
      label: "Decision Credit Score",
      value: form.decisionCreditScore,
      fieldKey: "decisionCreditScore",
      priority: "essential",
    });
  if (form.occupancy === "Primary Residence" || form.occupancy === "Second Home") {
    if (shouldHardcodeFirstTimeHomebuyerNo(form) && effectivePrimaryLoanPurpose(form)) {
      s1.push({
        label: "First-Time Buyer",
        value: "No",
        fieldKey: "firstTimeHomebuyer",
        priority: "conditional",
      });
    } else if (f(form.firstTimeHomebuyer))
      s1.push({
        label: "First-Time Buyer",
        value: form.firstTimeHomebuyer,
        fieldKey: "firstTimeHomebuyer",
        priority: "conditional",
      });
  }
  if (shouldShowOwnerOccupiedIncomePathSidebar(form)) {
    s1.push({
      label: "Investment Income Path",
      value: OWNER_OCCUPIED_INCOME_PATH_LABEL,
      fieldKey: "investmentIncomePath",
      priority: "essential",
    });
  }
  if (form.occupancy === "Investment Property") {
    if (shouldHardcodeFirstTimeInvestorNo(form) && effectivePrimaryLoanPurpose(form)) {
      s1.push({
        label: "First-Time Investor",
        value: "No",
        fieldKey: "firstTimeInvestor",
        priority: "conditional",
      });
    } else if (f(form.firstTimeInvestor)) {
      s1.push({
        label: "First-Time Investor",
        value: form.firstTimeInvestor,
        fieldKey: "firstTimeInvestor",
        priority: "conditional",
      });
    }
    if (f(form.investmentIncomePath))
      s1.push({
        label: "Investment Income Path",
        value: incomeTypeDisplayLabel(form.investmentIncomePath),
        fieldKey: "investmentIncomePath",
        priority: "conditional",
      });
  }
  if (f(form.visaType) || f(form.visaTypeOther)) {
    const visaLabel =
      form.visaCategory === "other"
        ? form.visaTypeOther?.trim() || "Other / Not listed"
        : form.visaType || form.visaTypeOther || "";
    if (visaLabel)
      s1.push({
        label: "Visa Type",
        value: visaLabel,
        fieldKey: "visaType",
        priority: "conditional",
      });
  }
  if (f(form.existingFirstLien))
    s1.push({
      label: tri.existingFirstLien,
      value: formatMoneyDisplay(form.existingFirstLien),
      fieldKey: "existingFirstLien",
      priority: "conditional",
    });
  if (f(form.existingSecondLien) && form.existingSecondLien !== "None") {
    s1.push({
      label: "Existing 2nd Lien",
      value: form.existingSecondLien,
      fieldKey: "existingSecondLien",
      priority: "conditional",
    });
    if (f(form.existingSecondLienBalance))
      s1.push({
        label: "2nd Lien Balance",
        value: formatMoneyDisplay(form.existingSecondLienBalance),
        fieldKey: "existingSecondLienBalance",
        priority: "conditional",
      });
  }
  if (s1.length > 0) sections.push({ step: 1, title: "Basics", rows: s1 });

  const s2: ProfileRow[] = [];
  if (f(form.documentationType))
    s2.push({
      label: "Doc Type",
      value: form.documentationType,
      fieldKey: "documentationType",
      priority: "essential",
    });
  if (!isDscr && f(form.documentationTimeframe))
    s2.push({
      label: "Doc Timeframe",
      value: formatDocumentationTimeframeDisplay(form.documentationTimeframe),
      fieldKey: "documentationTimeframe",
      priority: "essential",
    });
  if (!isDscr && f(form.estimatedDti))
    s2.push({
      label: "DTI",
      value: `${form.estimatedDti}%`,
      fieldKey: "estimatedDti",
      priority: "essential",
    });
  const nocbVisible =
    !isDscr &&
    form.occupancy === "Primary Residence" &&
    form.primaryLoanPurpose !== "Cash-Out Refinance" &&
    (parseFloat(form.estimatedDti) || 0) > 43 &&
    form.citizenship !== "Foreign National";
  if (nocbVisible && f(form.nonOccupantCoBorrower))
    s2.push({
      label: "NOCB",
      value: form.nonOccupantCoBorrower,
      fieldKey: "nonOccupantCoBorrower",
      priority: "conditional",
    });
  if (nocbVisible && form.nonOccupantCoBorrower === "Yes" && f(form.noCbRelationship))
    s2.push({
      label: "NOCB Relationship",
      value: form.noCbRelationship,
      fieldKey: "noCbRelationship",
      priority: "conditional",
    });
  if (nocbVisible && form.nonOccupantCoBorrower === "Yes" && f(form.combinedDti))
    s2.push({
      label: "Combined DTI",
      value: `${form.combinedDti}%`,
      fieldKey: "combinedDti",
      priority: "conditional",
    });
  if (!isDscr && f(form.householdSize))
    s2.push({
      label: "Household Size",
      value: form.householdSize,
      fieldKey: "householdSize",
      priority: "conditional",
    });
  if (!isDscr && f(form.monthlyResidualIncome))
    s2.push({
      label: "Residual Income",
      value: `${formatMoneyDisplay(form.monthlyResidualIncome)}/mo`,
      fieldKey: "monthlyResidualIncome",
      priority: "conditional",
    });
  if (isDscr && f(form.dscr))
    s2.push({ label: "DSCR", value: form.dscr, fieldKey: "dscr", priority: "essential" });
  if (isDscr && f(form.rentalType))
    s2.push({
      label: "Rental Type",
      value: form.rentalType,
      fieldKey: "rentalType",
      priority: "essential",
    });
  // Prepayment — investment only (non-investment is locked to N/A and the /form
  // sidebar hides it; chat must match exactly).
  if (maxReachedStep >= 2 && form.occupancy === "Investment Property") {
    const isInvestment = true;
    s2.push({
      label: "Prepayment Terms",
      value: form.prepaymentTerms || "No Penalty",
      fieldKey: "prepaymentTerms",
      priority: "conditional",
    });
    if (isInvestment && f(form.prepayStepdown) && form.prepayStepdown !== "No Preference")
      s2.push({
        label: "Prefer Step-down",
        value: form.prepayStepdown,
        fieldKey: "prepayStepdown",
        priority: "conditional",
      });
  }
  if (f(form.reservesAvailable))
    s2.push({
      label: "Months of Reserves",
      value: `${form.reservesAvailable} months`,
      fieldKey: "reservesAvailable",
      priority: "essential",
    });
  if (f(form.assetsLiquidFunds))
    s2.push({
      label: "Liquid Assets",
      value: formatMoneyDisplay(form.assetsLiquidFunds),
      fieldKey: "assetsLiquidFunds",
      priority: "optional",
    });
  if (f(form.giftFundsPercent))
    s2.push({
      label: "Gift Funds",
      value: `${form.giftFundsPercent}%`,
      fieldKey: "giftFundsPercent",
      priority: "optional",
    });
  if (s2.length > 0) sections.push({ step: 2, title: "Capacity", rows: s2 });

  const sLoc: ProfileRow[] = [];
  if (f(form.state)) {
    const st = STATES.find((s) => s.code === form.state);
    sLoc.push({
      label: "State",
      value: st ? `${st.label} (${form.state})` : form.state,
      fieldKey: "state",
      priority: "essential",
    });
    // County is collected by the universal county question, NOT the per-state geo
    // config — without this row a filled county never rendered for states with no
    // geo follow-ups (e.g. FL), while an empty one still showed as a red gap.
    if (f(form.stateCounty))
      sLoc.push({
        label: "County",
        value: form.stateCounty,
        fieldKey: "stateCounty",
        priority: "essential",
      });
    for (const geoSlot of geoSidebarSlotsForForm(form)) {
      if (!f(geoSlot.value)) continue;
      if (geoSlot.fieldKey === "stateCounty") continue; // added above
      sLoc.push({
        label: geoSlot.label,
        value: geoSlot.displayValue || geoSlot.value,
        fieldKey: geoSlot.fieldKey,
        priority: geoSlot.priority,
      });
    }
    if (form.state === "HI" && f(form.hiLavaZone))
      sLoc.push({
        label: "HI Lava Zone",
        value: form.hiLavaZone,
        fieldKey: "hiLavaZone",
        priority: "conditional",
      });
    if (f(form.isRuralProperty))
      sLoc.push({
        label: "Rural Property",
        value: form.isRuralProperty,
        fieldKey: "isRuralProperty",
        priority: "essential",
      });
    if (f(form.vacantProperty))
      sLoc.push({
        label: "Vacant Property",
        value: form.vacantProperty,
        fieldKey: "vacantProperty",
        priority: "conditional",
      });
    if (f(form.recentlyRehabbed))
      sLoc.push({
        label: "Recently Rehabbed",
        value: form.recentlyRehabbed,
        fieldKey: "recentlyRehabbed",
        priority: "conditional",
      });
    if (f(form.decliningMarket))
      sLoc.push({
        label: "Declining Market",
        value: form.decliningMarket,
        fieldKey: "decliningMarket",
        priority: "conditional",
      });
  }
  if (f(form.acreage))
    sLoc.push({
      label: "Acreage",
      value: `${form.acreage} ac`,
      fieldKey: "acreage",
      priority: "conditional",
    });
  if (f(form.propertyCondition))
    sLoc.push({
      label: "Property Condition",
      value: form.propertyCondition,
      fieldKey: "propertyCondition",
      priority: "optional",
    });
  const sCred: ProfileRow[] = [];
  // Housing / Payment History — show the short code (e.g. "1×120×12") not the raw value
  if (f(form.paymentHistory)) {
    const phOption = PAYMENT_HISTORY_OPTIONS.find((o) => o.value === form.paymentHistory);
    const phDisplay = phOption ? phOption.label.split(" — ")[0] : form.paymentHistory;
    sCred.push({
      label: "Housing History",
      value: phDisplay,
      fieldKey: "paymentHistory",
      priority: "essential",
    });
  }
  // Credit events — multi-event system
  if (f(form.hasCreditEvent))
    sCred.push({
      label: "Credit Events",
      value:
        form.hasCreditEvent === "Yes"
          ? `${form.creditEvents.length} event${form.creditEvents.length !== 1 ? "s" : ""}`
          : "None",
      fieldKey: "hasCreditEvent",
      priority: "essential",
    });
  if (form.hasCreditEvent === "Yes" && form.creditEvents.length > 0) {
    for (const evCode of [...new Set(form.creditEvents)]) {
      const dateVal = form.creditEventDates?.[evCode]?.trim();
      const yearsVal = form.creditEventYears?.[evCode]?.trim();
      const dateSince = dateVal ? computeYearsSinceBucket(dateVal) || dateVal : yearsVal || "";
      sCred.push({
        label: creditEventSidebarLabel(evCode),
        value: dateSince || "—",
        fieldKey: "creditEvents",
        priority: "conditional",
      });
    }
  }
  if (f(form.tradelines))
    sCred.push({
      label: "Tradelines",
      value: form.tradelines,
      fieldKey: "tradelines",
      priority: "optional",
    });
  if (sCred.length > 0) sections.push({ step: 3, title: "Credit", rows: sCred });
  if (sLoc.length > 0) sections.push({ step: 4, title: "Collateral", rows: sLoc });

  const s5: ProfileRow[] = [];
  if (f(form.listingSeasoning))
    s5.push({
      label: "Listed Recently",
      value: form.listingSeasoning,
      fieldKey: "listingSeasoning",
      priority: "conditional",
    });
  if (f(form.powerOfAttorney))
    s5.push({
      label: "Power of Attorney",
      value: form.powerOfAttorney,
      fieldKey: "powerOfAttorney",
      priority: "essential",
    });
  if (f(form.nonArmsLength))
    s5.push({
      label: "Non-Arm's Length",
      value: form.nonArmsLength,
      fieldKey: "nonArmsLength",
      priority: "essential",
    });
  if (f(form.departingResidence))
    s5.push({
      label: "Departing Residence",
      value: form.departingResidence,
      fieldKey: "departingResidence",
      priority: "conditional",
    });
  if (f(form.departingRent))
    s5.push({
      label: "Departing Rent",
      value: `${formatMoneyDisplay(form.departingRent)}/mo`,
      fieldKey: "departingRent",
      priority: "conditional",
    });
  if (f(form.loanTerm) && form.loanTerm !== "No preference")
    s5.push({
      label: "Loan Term Preference",
      value: formatLoanTermDisplay(form.loanTerm),
      fieldKey: "loanTerm",
      priority: "optional",
    });
  if (f(form.rateTypePref) && form.rateTypePref.trim().toLowerCase() !== "no preference")
    s5.push({
      label: "Rate Type",
      value: form.rateTypePref,
      fieldKey: "rateTypePref",
      priority: "optional",
    });
  if (f(form.interestOnlyPref) && form.interestOnlyPref !== "No preference")
    s5.push({
      label: "Interest-Only",
      value: form.interestOnlyPref,
      fieldKey: "interestOnlyPref",
      priority: "optional",
    });
  if (f(form.scenarioNotes))
    s5.push({
      label: "Scenario Notes",
      value: form.scenarioNotes,
      fieldKey: "scenarioNotes",
      priority: "optional",
    });
  if (s5.length > 0) sections.push({ step: 5, title: "Considerations", rows: s5 });

  return sections;
}

// ── Chat-mode sidebar edit map ─────────────────────────────────────────────────
// Maps each sidebar fieldKey → { slotId (backend), kind, options? }
// options.code is the value sent to /api/intake/edit_slot (and stored in the portfolio).
// For fields where portfolioToFormPatch stores the slot code directly in form.*, the
// code == the form value. For fields with a canonical mapping (citizenship, occupancy,
// etc.) the options include the mapped form display label for highlighting the selection.

type _ChatSlotOpt = {
  code: string;
  label: string;
  formValue?: string;
};
type _ChatSlotDef = {
  slotId: string;
  kind: "enum" | "currency" | "number" | "text";
  options?: _ChatSlotOpt[];
  /** Computed from other fields (e.g. LTV/CLTV from value/loan) — render read-only, no edit. */
  derived?: boolean;
};

export const CHAT_SLOT_FIELD_MAP: Record<string, _ChatSlotDef> = {
  citizenship: {
    slotId: "citizenship",
    kind: "enum",
    options: [
      { code: "us_citizen", label: "US Citizen", formValue: "US Citizen" },
      { code: "perm_resident", label: "Permanent Resident", formValue: "Permanent Resident Alien" },
      {
        code: "non_perm_resident",
        label: "Non-Perm Resident",
        formValue: "Non-Permanent Resident Alien",
      },
      { code: "foreign_national", label: "Foreign National", formValue: "Foreign National" },
      { code: "itin", label: "ITIN", formValue: "ITIN" },
      { code: "daca", label: "DACA", formValue: "DACA" },
    ],
  },
  occupancy: {
    slotId: "occupancy",
    kind: "enum",
    options: [
      { code: "primary_residence", label: "Primary", formValue: "Primary Residence" },
      { code: "second_home", label: "Second Home", formValue: "Second Home" },
      { code: "investment_property", label: "Investment", formValue: "Investment Property" },
    ],
  },
  loanPurpose: {
    slotId: "loan_purpose",
    kind: "enum",
    options: [
      { code: "purchase", label: "Purchase", formValue: "Purchase" },
      { code: "rate_term", label: "Refinance", formValue: "Refinance" },
      { code: "cash_out", label: "Cash-Out Refi", formValue: "Cash-Out Refinance" },
    ],
  },
  propertyType: {
    slotId: "property_type",
    kind: "enum",
    options: [
      { code: "single_family", label: "Single Family" },
      { code: "pud", label: "PUD" },
      { code: "townhouse", label: "Townhouse" },
      { code: "condo_warrantable", label: "Condo (Warrantable)" },
      { code: "condo_non_warrantable", label: "Condo (Non-Warrantable)" },
      { code: "condotel", label: "Condotel" },
      { code: "two_to_four_family", label: "2-4 Unit" },
      { code: "five_to_eight_unit", label: "5-8 Unit" },
      { code: "mixed_use", label: "Mixed-Use" },
      { code: "manufactured_home", label: "Manufactured Home" },
    ],
  },
  valueSalesPrice: { slotId: "property_value", kind: "currency" },
  loanAmount: { slotId: "loan_amount", kind: "currency" },
  // LTV / CLTV are editable; the value/loan/LTV triangle cascade recomputes the loan amount
  // (and vice-versa), so the figures stay consistent.
  ltv: { slotId: "ltv", kind: "number" },
  cltv: { slotId: "cltv", kind: "number" },
  cashInHandRequest: { slotId: "cash_in_hand", kind: "currency" },
  decisionCreditScore: { slotId: "fico", kind: "number" },
  documentationType: {
    slotId: "doc_type",
    kind: "enum",
    options: [
      { code: "full_doc", label: "Full Doc", formValue: "Full Documentation" },
      {
        code: "bank_stmt_12_or_24",
        label: "Bank Stmts 12/24 Mo",
        formValue: "Bank Statements (12 or 24 Months)",
      },
      {
        code: "bank_stmt_business",
        label: "Bank Stmts (Biz)",
        formValue: "Bank Statement Business",
      },
      { code: "pl_only", label: "P&L Only", formValue: "P&L Only" },
      { code: "pl_2mo_bs", label: "P&L + 2 Mo BS", formValue: "P&L with 2 Month Bank Statement" },
      { code: "asset_util", label: "Asset Utilization", formValue: "Asset Utilization" },
      { code: "asset_qualifier", label: "Asset Qualifier", formValue: "Asset Qualifier" },
      { code: "1099", label: "1099", formValue: "1099" },
      { code: "wvoe", label: "WVOE Only", formValue: "WVOE" },
    ],
  },
  estimatedDti: { slotId: "estimated_dti", kind: "number" },
  dscr: { slotId: "dscr", kind: "number" },
  rentalType: {
    slotId: "rental_type",
    kind: "enum",
    options: [
      { code: "long_term", label: "Long-Term" },
      { code: "short_term", label: "Short-Term (STR)" },
    ],
  },
  prepaymentTerms: {
    slotId: "prepayment_terms",
    kind: "enum",
    options: [
      { code: "No Penalty", label: "No Penalty" },
      { code: "1 Year", label: "1 Year" },
      { code: "2 Year", label: "2 Year" },
      { code: "3 Year", label: "3 Year" },
      { code: "4 Year", label: "4 Year" },
      { code: "5 Year", label: "5 Year" },
    ],
  },
  investmentIncomePath: {
    slotId: "investment_income_path",
    kind: "enum",
    options: [
      { code: "income", label: "Personal Income" },
      { code: "dscr", label: "DSCR / Rental" },
    ],
  },
  state: { slotId: "property_state", kind: "text" },
  stateCounty: { slotId: "state_county", kind: "text" },
  stateCity: { slotId: "state_city", kind: "text" },
  stateBorough: { slotId: "state_borough", kind: "text" },
  stateZipCode: { slotId: "state_zip", kind: "text" },
  isInBaltimoreCity: {
    slotId: "is_in_baltimore",
    kind: "enum",
    options: [
      { code: "Yes", label: "Yes", formValue: "Yes" },
      { code: "No", label: "No", formValue: "No" },
    ],
  },
  isInIndianapolis: {
    slotId: "is_in_indianapolis",
    kind: "enum",
    options: [
      { code: "Yes", label: "Yes", formValue: "Yes" },
      { code: "No", label: "No", formValue: "No" },
    ],
  },
  isInPhiladelphia: {
    slotId: "is_in_philadelphia",
    kind: "enum",
    options: [
      { code: "Yes", label: "Yes", formValue: "Yes" },
      { code: "No", label: "No", formValue: "No" },
    ],
  },
  isInMemphis: {
    slotId: "is_in_memphis",
    kind: "enum",
    options: [
      { code: "Yes", label: "Yes", formValue: "Yes" },
      { code: "No", label: "No", formValue: "No" },
    ],
  },
  isInLubbock: {
    slotId: "is_in_lubbock",
    kind: "enum",
    options: [
      { code: "Yes", label: "Yes", formValue: "Yes" },
      { code: "No", label: "No", formValue: "No" },
    ],
  },
  creditEventCategory: {
    slotId: "credit_event_category",
    kind: "enum",
    options: [
      { code: "None", label: "None" },
      { code: "BK", label: "Bankruptcy" },
      { code: "FC", label: "Foreclosure" },
      { code: "SS", label: "Short Sale" },
      { code: "DIL", label: "Deed-in-Lieu" },
      { code: "Pre-FC", label: "Pre-Foreclosure" },
      { code: "Charge-Off", label: "Charge-Off" },
      { code: "NOD", label: "NOD" },
      { code: "Mod", label: "Loan Mod" },
      { code: "Forbearance", label: "Forbearance" },
    ],
  },
  paymentHistory: {
    slotId: "payment_history",
    kind: "enum",
    options: [
      { code: "0x30", label: "0×30×12" },
      { code: "1x30", label: "1×30×12" },
      { code: "1x60", label: "1×60×12" },
      { code: "1x120", label: "1×120×12" },
    ],
  },
  firstTimeHomebuyer: {
    slotId: "first_time_homebuyer",
    kind: "enum",
    options: [
      { code: "yes", label: "Yes" },
      { code: "no", label: "No" },
    ],
  },
  firstTimeInvestor: {
    slotId: "first_time_investor",
    kind: "enum",
    options: [
      { code: "yes", label: "Yes" },
      { code: "no", label: "No" },
    ],
  },
  existingFirstLien: { slotId: "existing_first_lien", kind: "currency" },
  helocInitialDraw: { slotId: "heloc_initial_draw", kind: "currency" },
  helocDrawYears: {
    slotId: "heloc_draw_years",
    kind: "enum",
    options: [
      { code: "2", label: "2 years" },
      { code: "3", label: "3 years" },
      { code: "5", label: "5 years" },
    ],
  },
  existingSecondLien: {
    slotId: "existing_second_lien",
    kind: "enum",
    options: [
      { code: "None", label: "None" },
      { code: "Yes — needs subordination", label: "Yes — Needs Sub." },
      { code: "Yes — being paid off in this transaction", label: "Yes — Paid Off" },
    ],
  },
  existingSecondLienBalance: { slotId: "existing_second_lien_balance", kind: "currency" },
  isRuralProperty: {
    slotId: "rural_property",
    kind: "enum",
    options: [
      { code: "yes", label: "Yes", formValue: "Yes" },
      { code: "no", label: "No", formValue: "No" },
      { code: "unsure", label: "Not sure", formValue: "Not sure" },
    ],
  },
  listingSeasoning: {
    slotId: "listing_seasoning",
    kind: "enum",
    options: [
      { code: "yes", label: "Yes", formValue: "Yes" },
      { code: "no", label: "No", formValue: "No" },
    ],
  },
  powerOfAttorney: {
    slotId: "power_of_attorney",
    kind: "enum",
    options: [
      { code: "yes", label: "Yes", formValue: "Yes" },
      { code: "no", label: "No", formValue: "No" },
    ],
  },
  nonArmsLength: {
    slotId: "non_arms_length",
    kind: "enum",
    options: [
      { code: "yes", label: "Yes — related party", formValue: "Yes" },
      { code: "no", label: "No", formValue: "No" },
    ],
  },
  documentationTimeframe: {
    slotId: "doc_timeframe",
    kind: "enum",
    options: [
      { code: "12", label: "12-month", formValue: "12" },
      { code: "24", label: "24-month", formValue: "24" },
    ],
  },
  primaryLoanPurpose: {
    slotId: "loan_purpose",
    kind: "enum",
    options: [
      { code: "purchase", label: "Purchase", formValue: "Purchase" },
      { code: "rate_term", label: "Refinance", formValue: "Refinance" },
      { code: "cash_out", label: "Cash-Out Refinance", formValue: "Cash-Out Refinance" },
    ],
  },
  lienPosition: {
    slotId: "lien_position",
    kind: "enum",
    options: [
      { code: "first_lien_only", label: "First Lien Only" },
      { code: "second_lien", label: "Second Lien (standalone)" },
      { code: "second_lien_piggyback", label: "Second Lien — Piggyback" },
    ],
  },
  secondLienProduct: {
    slotId: "second_lien_product",
    kind: "enum",
    options: [
      { code: "heloc", label: "HELOC" },
      { code: "heloan", label: "HELOAN (closed-end)" },
    ],
  },
  prepayStepdown: {
    slotId: "prepay_stepdown",
    kind: "enum",
    options: [
      { code: "Yes", label: "Yes", formValue: "Yes" },
      { code: "No", label: "No", formValue: "No" },
    ],
  },
  reservesAvailable: { slotId: "reserves_months", kind: "number" },
  assetsLiquidFunds: { slotId: "assets", kind: "currency" },
  giftFundsPercent: { slotId: "gift_funds_pct", kind: "number" },
  visaType: { slotId: "visa_type", kind: "text" },
  hiLavaZone: {
    slotId: "hi_lava_zone",
    kind: "enum",
    options: [
      { code: "Zone 1-2", label: "Zone 1-2" },
      { code: "Zone 3-9", label: "Zone 3-9 (lower risk)", formValue: "Zone 3-9 (lower risk)" },
    ],
  },
  vacantProperty: {
    slotId: "vacant_property",
    kind: "enum",
    options: [
      { code: "Yes", label: "Yes", formValue: "Yes" },
      { code: "No", label: "No", formValue: "No" },
    ],
  },
  recentlyRehabbed: {
    slotId: "recently_rehabbed",
    kind: "enum",
    options: [
      { code: "Yes", label: "Yes", formValue: "Yes" },
      { code: "No", label: "No", formValue: "No" },
    ],
  },
  decliningMarket: {
    slotId: "declining_market",
    kind: "enum",
    options: [
      { code: "yes", label: "Yes", formValue: "Yes" },
      { code: "no_unknown", label: "No / Unknown", formValue: "No" },
    ],
  },
  propertyCondition: { slotId: "property_condition", kind: "text" },
  acreage: { slotId: "acreage", kind: "number" },
  tradelines: {
    slotId: "tradelines",
    kind: "enum",
    options: [
      { code: "three_twelve", label: "3+ active, 12+ mo", formValue: "3+ active, 12+ mo" },
      { code: "two_twentyfour", label: "2+ active, 24+ mo", formValue: "2+ active, 24+ mo" },
      { code: "mortgage", label: "Mortgage 36+ mo", formValue: "Mortgage 36+ mo" },
      { code: "unsure", label: "Unsure", formValue: "Unsure" },
      { code: "none", label: "None — non-traditional", formValue: "None — non-traditional" },
    ],
  },
};
