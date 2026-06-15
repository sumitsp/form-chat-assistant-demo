export type EligibleProgram = {
  investor: string;
  investor_name: string;
  program_name: string;
  program_name_np?: string | null;
  program_type: string | null;
  is_dscr: boolean;
  is_itin: boolean;
  is_foreign_nat: boolean;
  min_fico: number | null;
  min_loan?: number | null;
  max_loan: number | null;
  max_ltv_purchase: number | null;
  max_ltv_rate_term: number | null;
  max_ltv_cashout: number | null;
  max_dti: number | null;
  min_dscr: number | null;
  doc_type: string | null;
  occupancy: string | null;
  occupancy_types?: string[] | null;
  property_types?: string[] | null;
  loan_purposes_allowed?: string[] | null;
  program_notes?: string | null;
  doc_types_allowed: string | null;
  products_available: string | null;
  products?: string[] | null;
  products_matching?: string[] | null;
  best_match?: {
    min_fico?: number | null;
    min_loan?: number | null;
    max_loan?: number | null;
    max_ltv_purchase?: number | null;
    max_ltv_rate_term?: number | null;
    max_ltv_cashout?: number | null;
    max_dti?: number | null;
    min_dscr?: number | null;
  } | null;
  special_overlay?: string | null;
  rag_notes?: string[] | null;
  summary_notes?: string | null;
  summary_bullets?: string[] | null;
  program_id?: number | null;
};

export type NearMissProgram = EligibleProgram & {
  near_miss_hint: string;
  near_miss_type?: string | null;
  near_miss_suggestion?: string | null;
  suggested_ltv?: number | null;
  suggested_loan?: number | null;
};

/** Name-only quick-scan fallback when `include_programs` rows are absent. */
export function eligibleProgramNameStub(name: string): EligibleProgram {
  return {
    program_name: name,
    investor: "",
    investor_name: "",
    program_type: null,
    is_dscr: false,
    is_itin: false,
    is_foreign_nat: false,
    min_fico: null,
    min_loan: null,
    max_loan: null,
    max_ltv_purchase: null,
    max_ltv_rate_term: null,
    max_ltv_cashout: null,
    max_dti: null,
    min_dscr: null,
    doc_type: null,
    occupancy: null,
    doc_types_allowed: null,
    products_available: null,
  };
}
