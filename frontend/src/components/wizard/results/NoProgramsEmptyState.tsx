/**
 * "No programs matched" empty-state card for the results screen. Extracted from
 * LoanWizard.tsx (frontend split). Purely presentational.
 */
import { SearchX } from "lucide-react";

export function NoProgramsEmptyState() {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#012a5b]/[0.06]">
          <SearchX className="h-4 w-4 text-[#012a5b]" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground">
            No programs matched your scenario
          </p>
          <p className="text-[11px] text-muted-foreground">
            Try adjusting loan amount, LTV, or credit profile.
          </p>
        </div>
      </div>
    </div>
  );
}
