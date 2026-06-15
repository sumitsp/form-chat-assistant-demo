import { ChevronLeft } from "lucide-react";

import type { LoanpassDbProduct } from "@/lib/loanpass/pricingTable";
import { cn } from "@/lib/utils";

const letter = (i: number) => String.fromCharCode(65 + i);

function ProductOptionCard({
  letter: l,
  label,
  loading,
  onClick,
}: {
  letter: string;
  label: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border border-border bg-card text-left transition-colors md:gap-3",
        "px-3 py-2.5 md:px-3.5 md:py-3",
        "hover:border-[#012a5b]/50 hover:bg-[#012a5b]/[0.06] disabled:cursor-wait disabled:opacity-60",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#012a5b]/10 text-[11px] font-semibold text-[#012a5b] md:h-6 md:w-6 md:text-[12px]">
        {l}
      </span>
      <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground md:text-[14px]">
        {label}
      </span>
    </button>
  );
}

export function LoanpassProductPicker({
  programName,
  products,
  loadingProductId,
  onPick,
  onExit,
}: {
  programName: string;
  products: readonly LoanpassDbProduct[];
  /** When set, the row whose product_type_id matches is in a loading state. */
  loadingProductId?: number | null;
  onPick: (product: LoanpassDbProduct) => void;
  onExit?: () => void;
}) {
  const backButton = onExit ? (
    <button
      type="button"
      onClick={onExit}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-[#012a5b] transition-colors hover:border-[#012a5b]/40 hover:bg-muted/40 dark:text-sky-300"
    >
      <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
      Back to Programs Summary
    </button>
  ) : null;

  if (products.length === 0) {
    return (
      <div className="space-y-2">
        {backButton ? (
          <div className="mb-2 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
            <span className="text-[15px] font-semibold text-foreground">{programName}</span>
            {backButton}
          </div>
        ) : null}
        <p className="text-[13px] text-muted-foreground">
          No product types are listed for {programName}. Adjust product preferences or try another
          program.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {backButton ? (
        <div className="mb-2 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
          <span className="text-[15px] font-semibold text-foreground">{programName}</span>
          {backButton}
        </div>
      ) : null}
      <p className="text-[13px] leading-relaxed text-foreground">
        Choose a product type for <strong>{programName}</strong> to view pricing:
      </p>
      <div className={cn("grid gap-1.5", products.length > 5 ? "sm:grid-cols-2" : "grid-cols-1")}>
        {products.map((product, i) => (
          <ProductOptionCard
            key={product.product_type_id}
            letter={letter(i)}
            label={product.product_name}
            loading={loadingProductId === product.product_type_id}
            onClick={() => onPick(product)}
          />
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Or type the letter (A, B, C…) in the chat box below.
      </p>
    </div>
  );
}
