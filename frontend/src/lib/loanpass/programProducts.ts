import type { EligibleProgram } from "@/components/ProgramKnowMoreDetail";
import {
  buildPreferredProductSet,
  formatMortgageAcronyms,
  parseProductsList,
  shouldStyleProductMismatch,
  type ProductDisplayPrefs,
} from "@/lib/nqmIntegratedForm";
import type { LoanpassDbProduct } from "@/lib/loanpass/pricingTable";

/** Match an eligibility product label to a LoanPASS DB product row. */
export function resolveLoanpassProductByLabel(
  products: LoanpassDbProduct[],
  label: string,
): LoanpassDbProduct | undefined {
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(label);
  const exact = products.find((p) => norm(p.product_name) === target);
  if (exact) return exact;
  const abbr = (s: string) =>
    s
      .replace(/Interest[- ]Only/gi, "IO")
      .trim()
      .toLowerCase();
  const abTarget = abbr(label);
  return products.find((p) => abbr(p.product_name) === abTarget);
}

/** Product names shown in Know More — same filter as ProgramKnowMoreDetail. */
export function getVisibleProgramProducts(
  prog: EligibleProgram,
  productPrefs?: ProductDisplayPrefs,
): string[] {
  const matching = (prog.products_matching ?? [])
    .map((s) => formatMortgageAcronyms(s.trim()))
    .filter(Boolean);
  const allProductItems =
    matching.length > 0
      ? matching
      : parseProductsList(prog.products, prog.products_available).map(formatMortgageAcronyms);

  const highlightMismatch = shouldStyleProductMismatch(prog.products_matching, productPrefs);
  if (!highlightMismatch) return allProductItems;

  const preferred = buildPreferredProductSet(
    prog.products,
    prog.products_available,
    prog.products_matching,
    productPrefs,
  );
  return allProductItems.filter((name) => preferred.has(name));
}
