/**
 * Paginated eligible-program cards (the table core) — extracted from LoanWizard.tsx
 * (frontend split). Renders one page (3) of selectable program cards with name,
 * Max Loan, Min FICO and matching products. Selection is delegated via onSelectProgram.
 */
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { programDisplayName, programSelectKey } from "@/lib/programDisplayHelpers";
import type { EligibleProgram } from "@/components/LoanWizard";

const PAGE_SIZE = 3;

export function ProgramResultCards({
  eligible,
  currentPage,
  selectedProgram,
  showCheckboxes,
  onSelectProgram,
}: {
  eligible: EligibleProgram[];
  currentPage: number;
  selectedProgram: string | null;
  showCheckboxes: boolean;
  onSelectProgram: (selectKey: string, selecting: boolean) => void;
}) {
  const pageRows = eligible.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  return (
    <section className="grid gap-3">
      {pageRows.map((p, i) => {
        const selectKey = programSelectKey(p);
        const displayName = programDisplayName(p);
        const isSelected = selectedProgram === selectKey;
        return (
          <button
            type="button"
            key={`${selectKey}-${currentPage}-${i}`}
            onClick={() => onSelectProgram(selectKey, !isSelected)}
            className={cn(
              "w-full rounded-xl border px-4 py-3.5 text-left shadow-sm transition-all cursor-pointer hover:border-[#012a5b]/50 hover:shadow-md",
              "animate-in fade-in-0 slide-in-from-bottom-2",
              "bg-muted/30",
              isSelected ? "border-[#012a5b] ring-2 ring-[#012a5b]/30" : "border-border",
            )}
            style={{
              animationDelay: `${i * 80}ms`,
              animationFillMode: "both",
            }}
          >
            <div className="flex items-start gap-3">
              {showCheckboxes && (
                <div
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors",
                    isSelected
                      ? "border-[#012a5b] bg-[#012a5b] text-white"
                      : "border-border bg-background",
                  )}
                >
                  {isSelected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </div>
              )}
              <div className="flex-1 min-w-0">
                {/* Name + Max Loan + Min FICO on same row */}
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[16px] font-semibold text-foreground truncate">
                    {displayName}
                  </p>
                  <div className="flex shrink-0 items-baseline gap-5">
                    <div className="flex items-baseline gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Max Loan
                      </span>
                      <span className="text-[15px] font-semibold tabular-nums text-foreground">
                        {p.max_loan != null ? `$${p.max_loan.toLocaleString("en-US")}` : "—"}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Min FICO
                      </span>
                      <span className="text-[15px] font-semibold tabular-nums text-foreground">
                        {p.min_fico != null ? p.min_fico : "—"}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Products */}
                <div className="mt-2 border-t border-border pt-2">
                  <div className="flex flex-wrap gap-1">
                    {(() => {
                      const items = (p.products_matching ?? p.products ?? [])
                        .map((n: string) => n.trim())
                        .filter(Boolean);
                      return items.length > 0 ? (
                        items.map((prod: string, pi: number) => (
                          <span
                            key={`${prod}-${pi}`}
                            className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground"
                          >
                            {prod}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </section>
  );
}
