import { postEligibilityFull } from "@/lib/eligibilityApi";
import {
  docTypeLabelFromCode,
  formatMortgageAcronyms,
  formatProductsForScenario,
  LIEN_POSITION_OPTIONS,
  LOAN_PURPOSE_INTEGRATED,
} from "@/lib/nqmIntegratedForm";
import {
  getProgramConsiderationBullets,
  getProgramDocsDisplay,
  limitConsiderationBullets,
  programDisplayName,
} from "@/lib/programDisplayHelpers";
import type { FormHistoryDetail } from "@/lib/scenarioHistoryApi";
import {
  downloadScenarioPdf,
  isMobilePdfEnvironment,
  type ScenarioPdfProfileSection,
} from "@/lib/scenarioPdfExport";
import {
  eligibilityPayloadFromSavedFields,
  wizardFormFromSavedFields,
} from "@/lib/wizardFormFromSavedFields";

type EligibleRow = Record<string, unknown>;

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function buildProfileSectionsFromSavedFields(
  fields: Record<string, unknown>,
): ScenarioPdfProfileSection[] {
  const form = wizardFormFromSavedFields(fields) as Record<string, unknown>;
  const addRow = (rows: Array<{ label: string; value: string }>, label: string, key: string) => {
    const value = str(form[key]);
    if (value) rows.push({ label, value });
  };

  const basics: Array<{ label: string; value: string }> = [];
  addRow(basics, "Citizenship", "citizenship");
  addRow(basics, "Occupancy", "occupancy");
  const loanPurpose = str(form.loanPurpose);
  if (loanPurpose) {
    const lp = LOAN_PURPOSE_INTEGRATED.find((p) => p.value === loanPurpose);
    basics.push({ label: "Loan Purpose", value: lp?.label ?? loanPurpose });
  }
  const lien = str(form.lienPosition);
  if (lien) {
    const lp = LIEN_POSITION_OPTIONS.find((o) => o.value === lien);
    basics.push({ label: "Lien Position", value: lp?.label ?? lien });
  }
  addRow(basics, "Property Type", "propertyType");
  addRow(basics, "Property Value", "valueSalesPrice");
  addRow(basics, "Loan Amount", "loanAmount");
  addRow(basics, "LTV", "ltv");
  addRow(basics, "CLTV", "cltv");
  addRow(basics, "Decision Credit Score", "decisionCreditScore");
  addRow(basics, "State", "state");

  const capacity: Array<{ label: string; value: string }> = [];
  const doc = str(form.documentationType);
  if (doc) capacity.push({ label: "Documentation Type", value: docTypeLabelFromCode(doc) || doc });
  addRow(capacity, "Estimated DTI", "estimatedDti");
  addRow(capacity, "DSCR", "dscr");

  const sections: ScenarioPdfProfileSection[] = [];
  if (basics.length) sections.push({ title: "Basics", rows: basics });
  if (capacity.length) sections.push({ title: "Capacity", rows: capacity });
  return sections;
}

function mapEligibleForPdf(programs: EligibleRow[]) {
  return programs.map((p) => ({
    program_title: programDisplayName(p as Parameters<typeof programDisplayName>[0]),
    investor_name: formatMortgageAcronyms(str(p.investor_name) || str(p.investor) || ""),
    products_display:
      formatProductsForScenario(
        (p.products as string[] | null | undefined) ?? null,
        str(p.products_available) || null,
      ) ||
      str(p.products_available) ||
      "",
    min_fico: (p.min_fico as number | null | undefined) ?? null,
    max_loan: (p.max_loan as number | null | undefined) ?? null,
    max_ltv_purchase: (p.max_ltv_purchase as number | null | undefined) ?? null,
    max_ltv_rate_term: (p.max_ltv_rate_term as number | null | undefined) ?? null,
    max_ltv_cashout: (p.max_ltv_cashout as number | null | undefined) ?? null,
    max_dti: (p.max_dti as number | null | undefined) ?? null,
    min_dscr: (p.min_dscr as number | null | undefined) ?? null,
    doc_type: (p.doc_type as string | null | undefined) ?? null,
    occupancy: (p.occupancy as string | null | undefined) ?? null,
    documentation_type:
      getProgramDocsDisplay(p as Parameters<typeof getProgramDocsDisplay>[0]) || undefined,
    special_overlay: (p.special_overlay as string | null | undefined) ?? null,
    considerations: limitConsiderationBullets(
      getProgramConsiderationBullets(p as Parameters<typeof getProgramConsiderationBullets>[0]),
    ),
  }));
}

/** Download the same scenario PDF shown on the results screen for a saved history record. */
export async function downloadHistoryScenarioPdf(detail: FormHistoryDetail): Promise<boolean> {
  const base = apiBase();
  const payload = eligibilityPayloadFromSavedFields(detail.form_fields);
  const res = await postEligibilityFull(base, payload);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(str(data.detail) || `Could not load programs (HTTP ${res.status})`);
  }

  const eligible = (data.eligible as EligibleRow[] | undefined) ?? [];
  const profileSections = buildProfileSectionsFromSavedFields(detail.form_fields);
  const mobilePdf = isMobilePdfEnvironment();
  const mobilePdfWindow = mobilePdf ? window.open("about:blank", "_blank") : null;

  try {
    const result = await downloadScenarioPdf(
      base,
      {
        profile_sections: profileSections,
        programs: mapEligibleForPdf(eligible),
        form_fields: detail.form_fields,
      },
      { mobilePreviewWindow: mobilePdfWindow },
    );
    if (mobilePdfWindow && !mobilePdfWindow.closed && result !== "opened") {
      mobilePdfWindow.close();
    }
    return result !== false;
  } catch (err) {
    if (mobilePdfWindow && !mobilePdfWindow.closed) mobilePdfWindow.close();
    throw err;
  }
}
