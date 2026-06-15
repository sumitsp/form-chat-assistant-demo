/**
 * Full-page eligible programs list (shared form + chat sidebars).
 */
import { Check, ChevronLeft } from "lucide-react";
import type { EligibleProgram } from "@/components/wizard/loanWizardEligibility";
import { programDisplayName, programGateMetricsLine } from "@/lib/programDisplayHelpers";
import { cn } from "@/lib/utils";

export function EligibleProgramsPreview({
  previewPrograms,
  previewLoading,
  totalCount,
  onBack,
}: {
  previewPrograms: EligibleProgram[];
  previewLoading: boolean;
  totalCount: number;
  onBack: () => void;
}) {
  const count = previewPrograms.length;
  const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
  // Match the outer Eligible Programs card: count color follows >5 green · 3–5 amber · ≤2 red.
  const numColor = count > 5 ? "text-emerald-600" : count > 2 ? "text-amber-500" : "text-red-500";
  const barColor = count > 5 ? "bg-emerald-500" : count > 2 ? "bg-amber-400" : "bg-red-500";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-start gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to profile"
          title="Back to profile"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[#012a5b] shadow-sm transition-colors hover:bg-muted/50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight text-foreground">
            Eligible Programs
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {previewLoading
              ? "Checking programs against your scenario…"
              : count === 0
                ? "No matches yet — keep answering questions."
                : `${count} of ${totalCount} programs currently eligible`}
          </p>
        </div>
      </div>

      {!previewLoading && (
        <div className="mb-3.5 rounded-lg border border-border p-3">
          <div className="leading-none">
            <span className={cn("text-3xl font-medium", numColor)}>{count}</span>
            <span className="text-[13px] text-muted-foreground"> / {totalCount}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all duration-500", barColor)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/60">
            Preliminary Estimate · Submit to apply the special overlays
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {previewLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-lg border border-border/60 bg-muted/40"
              />
            ))}
          </div>
        ) : count === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/25 px-3 py-6 text-center">
            <p className="text-[12px] font-medium text-foreground">No eligible programs yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Complete more of the scenario to see preliminary matches.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {previewPrograms.map((prog, index) => {
              const name = programDisplayName(prog);
              const metrics = programGateMetricsLine(prog);
              return (
                <li
                  key={`${name}-${index}`}
                  className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-card px-3 py-2.5 shadow-sm"
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                    aria-hidden="true"
                  >
                    <Check className="h-3 w-3 stroke-[2.5]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-snug text-foreground">{name}</p>
                    {metrics ? (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{metrics}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground/50">
                    {index + 1}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
