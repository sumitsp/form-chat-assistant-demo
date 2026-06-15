/** Shared eligibility API paths — used by form mode and chat mode. */

export const ELIGIBILITY_FULL_PATH = "/api/eligibility/full";
export const ELIGIBILITY_QUICK_PATH = "/api/eligibility/quick";

export type QuickEligibilityApiOptions = {
  includePrograms?: boolean;
  signal?: AbortSignal;
};

function apiUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`;
}

export function postEligibilityFull(
  base: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(apiUrl(base, ELIGIBILITY_FULL_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

export function postEligibilityQuick(
  base: string,
  payload: Record<string, unknown>,
  opts?: QuickEligibilityApiOptions,
): Promise<Response> {
  return fetch(apiUrl(base, ELIGIBILITY_QUICK_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      ...(opts?.includePrograms ? { include_programs: true } : {}),
    }),
    signal: opts?.signal,
  });
}

export type QuickEligibilityApiResponse = {
  count: number;
  program_names: string[];
  available?: boolean;
  eligible?: Record<string, unknown>[];
  total_screened?: number;
  geo_blocked_count?: number;
  overlay_blocked_count?: number;
};

/** Map `/api/eligibility/quick` eligible rows (include_programs) to UI program objects. */
export function eligibleProgramsFromQuickApi(rows: Record<string, unknown>[] | undefined): Array<{
  investor: string;
  investor_name: string;
  program_name: string;
  program_name_np?: string | null;
  program_type: string | null;
  is_dscr: boolean;
  is_itin: boolean;
  is_foreign_nat: boolean;
  min_fico: number | null;
  max_loan: number | null;
  best_match?: {
    min_fico?: number | null;
    max_loan?: number | null;
  } | null;
}> {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const bm = r.best_match as Record<string, unknown> | null | undefined;
    const intOrNull = (v: unknown) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      investor: String(r.investor ?? r.lender ?? ""),
      investor_name: String(r.investor_name ?? r.lender_name ?? ""),
      program_name: String(r.program_name ?? ""),
      program_name_np: (r.program_name_np as string | null) ?? null,
      program_type: (r.program_type as string | null) ?? null,
      is_dscr: Boolean(r.is_dscr),
      is_itin: Boolean(r.is_itin),
      is_foreign_nat: Boolean(r.is_foreign_nat),
      min_fico: intOrNull(r.min_fico),
      max_loan: intOrNull(r.max_loan),
      best_match: bm
        ? {
            min_fico: intOrNull(bm.min_fico),
            max_loan: intOrNull(bm.max_loan),
          }
        : null,
    };
  });
}
