import type { EligibleProgram } from "@/components/ProgramKnowMoreDetail";
import type { WizardForm } from "@/components/LoanWizard";
import type {
  LoanpassDbProduct,
  LoanpassPriceScenarioRow,
  LoanpassPricingGrid,
} from "@/lib/loanpass/pricingTable";
import { programDisplayName } from "@/lib/programDisplayHelpers";

export type LoanpassPriceResult = {
  reply: string;
  program_name: string;
  program_code?: string | null;
  breadcrumbs?: string | null;
  program_id?: number | null;
  program_name_loanpass?: string | null;
  product_type_id?: number | null;
  product_label?: string | null;
  loanpass_product_id?: string | null;
  loanpass_product_name?: string | null;
  loanpass_investor?: string | null;
  status?: string | null;
  effective_date?: string | null;
  info_notes?: string[];
  scenario_count?: number;
  price_scenarios?: LoanpassPriceScenarioRow[];
  pricing_grid?: LoanpassPricingGrid | null;
};

export type LoanpassProgramMeta = {
  program_id: number;
  program_code?: string | null;
  program_name_np?: string | null;
  program_name_loanpass?: string | null;
  pricing_available: boolean;
};

type ProgramRef = Pick<
  EligibleProgram,
  "program_id" | "investor_name" | "investor" | "program_name" | "program_name_np"
>;

function programBody(form: WizardForm, program: ProgramRef) {
  return {
    form,
    program_id: program.program_id ?? null,
    program_name: programDisplayName(program as EligibleProgram),
    investor_name: program.investor_name || program.investor || null,
  };
}

async function parseLoanpassError(res: Response): Promise<never> {
  let data: { detail?: string } = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  throw new Error(
    (data.detail as string) ||
      (res.status === 503
        ? "Pricing is not configured on the server."
        : res.status === 422
          ? "No pricing found for this program. We will notify you once we get it."
          : `Pricing request failed (HTTP ${res.status}).`),
  );
}

export async function fetchLoanpassProgramMeta(
  apiBase: string,
  programId: number,
): Promise<LoanpassProgramMeta> {
  const base = apiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/api/loanpass/program/${programId}`);
  if (!res.ok) await parseLoanpassError(res);
  return (await res.json()) as LoanpassProgramMeta;
}

export async function fetchLoanpassPrice(
  apiBase: string,
  form: WizardForm,
  program: EligibleProgram,
  opts?: {
    productId?: string | null;
    productLabel?: string | null;
    productTypeId?: number | null;
  },
): Promise<LoanpassPriceResult> {
  const base = apiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/api/loanpass/price`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...programBody(form, program),
      product_id: opts?.productId ?? null,
      product_label: opts?.productLabel ?? null,
      product_type_id: opts?.productTypeId ?? null,
    }),
  });
  if (!res.ok) await parseLoanpassError(res);
  return (await res.json()) as LoanpassPriceResult;
}

export async function fetchLoanpassProducts(
  apiBase: string,
  form: WizardForm,
  program: ProgramRef,
): Promise<{
  program_name: string;
  products: LoanpassDbProduct[];
}> {
  const base = apiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/api/loanpass/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(programBody(form, program as EligibleProgram)),
  });
  if (!res.ok) await parseLoanpassError(res);
  const data = (await res.json()) as {
    program_name: string;
    products: Array<{
      product_type_id?: number;
      product_name?: string;
      io_period_years?: number | null;
      amort_period_years?: number | null;
      total_term_years?: number | null;
    }>;
  };
  return {
    program_name: data.program_name,
    products: (data.products ?? [])
      .map((p) => ({
        product_type_id: Number(p.product_type_id),
        product_name: (p.product_name ?? "").trim(),
        io_period_years: p.io_period_years ?? null,
        amort_period_years: p.amort_period_years ?? null,
        total_term_years: p.total_term_years ?? null,
      }))
      .filter((p) => p.product_type_id > 0 && p.product_name),
  };
}
