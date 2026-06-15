/**
 * Form-mode Mortgage Profile rows — driven by FORM_CHAT_QUESTIONS + answeredQIds.
 */
import type { WizardForm } from "@/components/wizard/loanWizardForm";
import {
  FORM_CHAT_QUESTIONS,
  creditEventSidebarLabel,
  firstTimeHomebuyerSidebarValue,
  firstTimeInvestorSidebarValue,
  formatDocumentationTimeframeDisplay,
  includeFormChatQuestionInFlow,
  isFormChatProductPrefQuestion,
  isFormChatQuestionAnswered,
  isNoProductPreference,
  loanDetailsFieldSpec,
  nocbVisible,
  optionsFor,
  type FormChatQuestion,
} from "@/lib/formChatFlow";
import {
  OWNER_OCCUPIED_INCOME_PATH_LABEL,
  LIEN_POSITION_FIRST,
  LIEN_POSITION_PIGGYBACK,
  LIEN_POSITION_SECOND,
  effectivePrimaryLoanPurpose,
  formatLoanTermDisplay,
  shouldHardcodeFirstTimeHomebuyerNo,
  shouldHardcodeFirstTimeInvestorNo,
  shouldShowOwnerOccupiedIncomePathSidebar,
} from "@/lib/nqmIntegratedForm";
import { creditEventBucketForForm } from "@/lib/creditEventTiming";
import { geoSidebarSlotsForForm } from "@/lib/stateGeoFollowUp";
import { STATES } from "@/lib/wizardFormUi";

const money = (v: string | number) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : String(v);
};

/** Same explicit labels the chat sidebar + capture pills use. */
const LIEN_POSITION_SIDEBAR_OPTIONS = [
  { value: LIEN_POSITION_FIRST, label: "First Lien" },
  { value: LIEN_POSITION_SECOND, label: "Second Lien (Standalone)" },
  { value: LIEN_POSITION_PIGGYBACK, label: "Second Lien (Piggyback)" },
] as const;

export type FormProfileRow = {
  id: string;
  editId: string;
  label: string;
  value: string;
  mandatory: boolean;
  missing?: boolean;
  fromImport?: boolean;
  editable?: boolean;
};
export type FormProfileSection = { name: string; rows: FormProfileRow[] };

export function buildFormProfileSections(
  form: WizardForm,
  answeredQIds: Set<string>,
  submitted: boolean,
  includeOptional: boolean,
  importedFieldKeys: Set<string>,
  highlightGaps = false,
): FormProfileSection[] {
  const order: string[] = [];
  const map = new Map<string, FormProfileSection>();
  const add = (sectionName: string, row: Omit<FormProfileRow, "fromImport">) => {
    if (!map.has(sectionName)) {
      map.set(sectionName, { name: sectionName, rows: [] });
      order.push(sectionName);
    }
    map.get(sectionName)!.rows.push({
      ...row,
      fromImport: importedFieldKeys.has(row.id),
    });
  };

  const hasFormProfileRow = (rowId: string) =>
    order.some((n) => map.get(n)?.rows.some((r) => r.id === rowId));

  const maybeAddOwnerOccupiedIncomePath = (sectionName: string) => {
    if (
      !shouldShowOwnerOccupiedIncomePathSidebar(form) ||
      hasFormProfileRow("ownerOccupiedIncomePath")
    ) {
      return;
    }
    add(sectionName, {
      id: "ownerOccupiedIncomePath",
      editId: "",
      label: humanizeField("investmentIncomePath"),
      value: OWNER_OCCUPIED_INCOME_PATH_LABEL,
      mandatory: true,
      editable: false,
    });
  };

  for (const q of FORM_CHAT_QUESTIONS) {
    if (q.showIf && !q.showIf(form)) continue;
    if (!includeFormChatQuestionInFlow(q, includeOptional)) continue;

    // Geo sub-fields (county / city / zip) — show in the profile as soon as they're filled,
    // State-specific geo extras (county is its own question) — show filled rows
    // even while the shared geo_followup question is still in progress.
    if (q.special === "geo_followup") {
      if (!form.state.trim()) continue;
      for (const slot of geoSidebarSlotsForForm(form)) {
        if (!slot.value.trim()) continue;
        add(q.sectionName, {
          id: slot.fieldKey,
          editId: "stateGeoFollowup",
          label: slot.label,
          value: slot.displayValue || slot.value,
          mandatory: true,
        });
      }
      continue;
    }

    if (q.special === "county_search") {
      if (!form.state.trim()) continue;
      const countyVal = form.stateCounty.trim();
      add(q.sectionName, {
        id: q.id,
        editId: q.id,
        label: humanizeField("stateCounty"),
        value: countyVal,
        mandatory: true,
        missing: !countyVal,
      });
      continue;
    }

    if (!submitted && !isFormChatQuestionAnswered(form, q, answeredQIds)) continue;
    // Product preferences always have a valid default ("No preference") — not mandatory.
    const mandatory = q.priority === "mandatory" && !isFormChatProductPrefQuestion(q);

    if (q.special === "triangle") {
      // Contextual labels — single source shared with the Loan Details card and chat.
      const tri = loanDetailsFieldSpec(form);
      if (form.valueSalesPrice)
        add(q.sectionName, {
          id: "valueSalesPrice",
          editId: "valueLoanLtv",
          label: tri.propertyValue,
          value: money(form.valueSalesPrice),
          mandatory,
        });
      if (form.loanAmount)
        add(q.sectionName, {
          id: "loanAmount",
          editId: "valueLoanLtv",
          label: tri.loanAmount,
          value: money(form.loanAmount),
          mandatory,
        });
      if (form.ltv)
        add(q.sectionName, {
          id: "ltv",
          editId: "valueLoanLtv",
          label: tri.ltv,
          value: `${form.ltv}%`,
          mandatory,
        });
      if (form.existingFirstLien)
        add(q.sectionName, {
          id: "existingFirstLien",
          editId: "valueLoanLtv",
          label: tri.existingFirstLien,
          value: money(form.existingFirstLien),
          mandatory,
        });
      if (tri.showCltv && (form.cltv || form.ltv))
        add(q.sectionName, {
          id: "cltv",
          editId: "valueLoanLtv",
          label: "CLTV",
          // Falls back to LTV when no 2nd subordinates — matches the chat sidebar.
          value: `${form.cltv || form.ltv}%`,
          mandatory,
        });
      if (form.existingSecondLien && form.existingSecondLien !== "None")
        add(q.sectionName, {
          id: "existingSecondLien",
          editId: "valueLoanLtv",
          label: "Existing 2nd Lien",
          value: form.existingSecondLien,
          mandatory,
        });
      if (form.cashInHandRequest)
        add(q.sectionName, {
          id: "cashInHandRequest",
          editId: "valueLoanLtv",
          label: "Cash-Out Request",
          value: money(form.cashInHandRequest),
          mandatory,
        });
      if (form.helocInitialDraw)
        add(q.sectionName, {
          id: "helocInitialDraw",
          editId: "valueLoanLtv",
          label: "Initial Draw",
          value: money(form.helocInitialDraw),
          mandatory,
        });
      continue;
    }

    if (q.special === "capacity_dti_bundle") {
      if (nocbVisible(form) && form.nonOccupantCoBorrower) {
        add(q.sectionName, {
          id: "nonOccupantCoBorrower",
          editId: "dtiCapacityExtras",
          label: "NOCB?",
          value: form.nonOccupantCoBorrower,
          mandatory,
        });
      }
      if (form.nonOccupantCoBorrower === "Yes" && form.noCbRelationship) {
        add(q.sectionName, {
          id: "noCbRelationship",
          editId: "dtiCapacityExtras",
          label: "NOCB Relationship",
          value: form.noCbRelationship,
          mandatory,
        });
      }
      if (form.nonOccupantCoBorrower === "Yes" && form.combinedDti) {
        add(q.sectionName, {
          id: "combinedDti",
          editId: "dtiCapacityExtras",
          label: "Combined DTI",
          value: `${form.combinedDti}%`,
          mandatory,
        });
      }
      if (form.householdSize) {
        add(q.sectionName, {
          id: "householdSize",
          editId: "dtiCapacityExtras",
          label: "Household Size",
          value: String(form.householdSize),
          mandatory,
        });
      }
      if (form.monthlyResidualIncome) {
        add(q.sectionName, {
          id: "monthlyResidualIncome",
          editId: "dtiCapacityExtras",
          label: "Residual Income",
          value: `${money(form.monthlyResidualIncome)}/mo`,
          mandatory,
        });
      }
      continue;
    }

    if (
      q.special === "credit_events" &&
      form.hasCreditEvent === "Yes" &&
      form.creditEvents.length > 0
    ) {
      // Show every selected event (each editable) — not only the ones with a
      // bucket, so multiple events are all visible and clickable in the sidebar.
      for (const evCode of [...new Set(form.creditEvents)]) {
        const bucket = creditEventBucketForForm(
          form.creditEventDates,
          form.creditEventYears,
          evCode,
        );
        add(q.sectionName, {
          id: `creditEvent-${evCode}`,
          editId: "creditEvents",
          label: creditEventSidebarLabel(evCode),
          value: bucket || "Set timing",
          mandatory,
        });
      }
      continue;
    }

    const value =
      q.id === "firstTimeHomebuyer"
        ? firstTimeHomebuyerSidebarValue(form)
        : q.id === "firstTimeInvestor"
          ? firstTimeInvestorSidebarValue(form)
          : displayValue(form, q);
    if (!value) continue;
    const hardcoded =
      (q.id === "firstTimeHomebuyer" && shouldHardcodeFirstTimeHomebuyerNo(form)) ||
      (q.id === "firstTimeInvestor" && shouldHardcodeFirstTimeInvestorNo(form));
    add(q.sectionName, {
      id: q.id,
      editId: hardcoded ? "" : q.id,
      label: humanizeField(q.id),
      value,
      mandatory,
      editable: hardcoded ? false : undefined,
    });

    if (q.id === "decisionCreditScore") {
      // Refi / cash-out: read-only No at credit score, then income path below it.
      if (effectivePrimaryLoanPurpose(form)) {
        if (shouldHardcodeFirstTimeHomebuyerNo(form) && !hasFormProfileRow("firstTimeHomebuyer")) {
          add(q.sectionName, {
            id: "firstTimeHomebuyer",
            editId: "",
            label: humanizeField("firstTimeHomebuyer"),
            value: "No",
            mandatory: true,
            editable: false,
          });
          maybeAddOwnerOccupiedIncomePath(q.sectionName);
        }
        if (shouldHardcodeFirstTimeInvestorNo(form) && !hasFormProfileRow("firstTimeInvestor")) {
          add(q.sectionName, {
            id: "firstTimeInvestor",
            editId: "",
            label: humanizeField("firstTimeInvestor"),
            value: "No",
            mandatory: true,
            editable: false,
          });
        }
      }
    }

    if (q.id === "firstTimeHomebuyer") {
      maybeAddOwnerOccupiedIncomePath(q.sectionName);
    }
  }

  if (highlightGaps) {
    for (const q of FORM_CHAT_QUESTIONS) {
      if (q.showIf && !q.showIf(form)) continue;
      if (!includeFormChatQuestionInFlow(q, includeOptional)) continue;
      if (q.priority !== "mandatory" || isFormChatProductPrefQuestion(q)) continue;
      if (q.special === "capacity_dti_notice") continue;
      if (isFormChatQuestionAnswered(form, q, answeredQIds)) continue;
      const rowId =
        q.special === "triangle"
          ? "valueLoanLtv"
          : q.special === "geo_followup"
            ? "stateGeoFollowup"
            : q.special === "county_search"
              ? "stateCounty"
              : q.special === "capacity_dti_bundle"
                ? "dtiCapacityExtras"
                : q.id;
      if (hasFormProfileRow(rowId)) continue;
      add(q.sectionName, {
        id: rowId,
        editId: q.id,
        label: humanizeField(q.id),
        value: "",
        mandatory: true,
        missing: true,
      });
    }
  }

  return order.map((n) => map.get(n)!);
}
function displayValue(form: WizardForm, q: FormChatQuestion): string {
  if (q.id === "creditEvents") {
    return "";
  }
  if (q.id === "hasCreditEvent" && form.hasCreditEvent === "Yes") {
    // Same value the chat sidebar shows ("1 event", "2 events") instead of "Yes".
    const n = (form.creditEvents ?? []).length;
    return n > 0 ? `${n} event${n !== 1 ? "s" : ""}` : "Yes";
  }
  if (q.id === "hasCreditEvent" && form.hasCreditEvent === "No") {
    return "None"; // chat sidebar says "None" — keep both identical
  }
  if (q.id === "lienPosition") {
    // Chat sidebar / capture pills use the explicit labels ("Second Lien (Standalone)" /
    // "Second Lien (Piggyback)") — match them instead of the in-flow option label.
    const raw = String(form.lienPosition ?? "").trim();
    const lien = LIEN_POSITION_SIDEBAR_OPTIONS.find((o) => o.value === raw);
    if (lien) return lien.label;
  }
  if (q.id === "documentationTimeframe") {
    return formatDocumentationTimeframeDisplay(
      String((form as Record<string, unknown>).documentationTimeframe ?? ""),
    );
  }
  if (q.id === "loanTerm") {
    const raw = String((form as Record<string, unknown>).loanTerm ?? "").trim();
    if (!raw) return "";
    return isNoProductPreference(raw) ? "No preference" : formatLoanTermDisplay(raw);
  }
  if (q.id === "rateTypePref" || q.id === "interestOnlyPref") {
    // Stored values are already the canonical short display ("Fixed-rate",
    // "Yes — IO") — matches the chat sidebar; option labels are longer.
    const raw = String((form as Record<string, unknown>)[q.id] ?? "").trim();
    if (!raw) return "";
    return isNoProductPreference(raw) ? "No preference" : raw;
  }
  const raw = (form as Record<string, unknown>)[q.id];
  if (raw == null || raw === "") return "";
  if (q.kind === "currency") return money(String(raw));
  if (q.kind === "number") {
    // "%" hugs the number ("42%"), matching the chat sidebar exactly.
    return q.suffix === "%" ? `${raw}%` : `${raw}${q.suffix ? ` ${q.suffix}` : ""}`;
  }
  if (q.kind === "state") {
    const st = STATES.find((s) => s.code === String(raw));
    return st ? `${st.label} (${st.code})` : String(raw);
  }
  const opt = optionsFor(form, q).find((o) => o.value === raw);
  const label = opt ? opt.label : String(raw);
  // Payment history: show just the short code (e.g. "0×30×12"), not the full description.
  if (q.id === "paymentHistory") return label.split("—")[0].trim();
  return label;
}

export function humanizeField(id: string): string {
  if (id === "decisionCreditScore") return "Decision Credit Score";
  if (id === "stateCounty") return "County";
  // Match the chat sidebar / capture pills exactly (form and chat must read the same).
  if (id === "paymentHistory") return "Housing History";
  if (id === "hasCreditEvent") return "Credit Events";
  if (id === "documentationTimeframe") return "Doc Timeframe";
  if (id === "existingFirstLien") return "First Lien Balance";
  if (id === "existingSecondLien") return "Existing 2nd Lien";
  if (id === "cashInHandRequest") return "Cash-Out Request";
  if (id === "helocDrawYears") return "Draw Period";
  if (id === "helocInitialDraw") return "Initial Draw";
  if (id === "firstTimeHomebuyer") return "First-Time Buyer";
  if (id === "firstTimeInvestor") return "First-Time Investor";
  if (id === "documentationType") return "Doc Type";
  if (id === "estimatedDti") return "DTI";
  if (id === "assetsLiquidFunds") return "Liquid Assets";
  if (id === "giftFundsPercent") return "Gift Funds";
  if (id === "isRuralProperty") return "Rural Property";
  if (id === "listingSeasoning") return "Listed Recently";
  if (id === "rateTypePref") return "Rate Type";
  if (id === "interestOnlyPref") return "Interest-Only";
  if (id === "stateGeoFollowup") return "Location follow-up";
  if (id === "stateBorough") return "Borough";
  if (id === "loanTerm") return "Loan Term Preference";
  if (id === "reservesAvailable") return "Months of Reserves";
  if (id === "investmentIncomePath") return "Investment Income Path";
  if (id === "nonArmsLength") return "Non-Arm's Length"; // match the chat sidebar exactly
  if (id === "powerOfAttorney") return "Power of Attorney"; // startCase would say "Of"
  return id
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/\bDti\b/g, "DTI")
    .replace(/\bDscr\b/g, "DSCR")
    .replace(/\bLtv\b/g, "LTV")
    .replace(/\bCltv\b/g, "CLTV")
    .replace(/\bOfac\b/g, "OFAC")
    .replace(/\bUs\b/g, "US")
    .replace(/value Loan LTV/i, "Value · Loan · LTV")
    .trim();
}
