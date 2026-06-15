/**
 * "Programs you just missed" section of the results table — programs that pass
 * all scenario filters except a small loan-amount/LTV adjustment. Extracted from
 * LoanWizard.tsx (frontend split). Renders nothing unless there are <3 eligible
 * programs and at least one near-miss.
 */
import { programDisplayName, programSelectKey } from "@/lib/programDisplayHelpers";
import type { NearMissProgram } from "@/components/LoanWizard";

export function NearMissesSection({
  nearMisses,
  eligibleCount,
}: {
  nearMisses: NearMissProgram[];
  eligibleCount: number;
}) {
  if (!(eligibleCount < 3 && nearMisses.length > 0)) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[13px] font-semibold text-foreground">Programs you just missed</p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        These pass your other scenario filters — only loan amount or LTV needs a small adjustment.
      </p>
      <div className="grid gap-2">
        {nearMisses.map((p, i) => (
          <div
            key={`near-miss-${programSelectKey(p)}-${i}`}
            className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-xl border border-amber-200/80 bg-amber-50/40 px-3 py-2.5"
            style={{
              animationDelay: `${i * 80}ms`,
              animationFillMode: "both",
            }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[12px] font-semibold text-foreground">{programDisplayName(p)}</p>
              <div className="flex shrink-0 items-baseline gap-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                    Max Loan
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums text-foreground">
                    {p.max_loan != null ? `$${p.max_loan.toLocaleString("en-US")}` : "—"}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                    Min FICO
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums text-foreground">
                    {p.min_fico != null ? p.min_fico : "—"}
                  </span>
                </div>
              </div>
            </div>
            {p.near_miss_hint && (
              <p className="mt-1.5 text-[11px] leading-snug text-amber-800">{p.near_miss_hint}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
