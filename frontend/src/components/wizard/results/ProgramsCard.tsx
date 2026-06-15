/**
 * Centered "matched programs" card for the redesigned Results screen.
 * One grid row per program: name · max loan · products · "Know more".
 */
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  programDisplayName,
  programGateMetricsLine,
  programSelectKey,
} from "@/lib/programDisplayHelpers";
import type { EligibleProgram } from "@/components/LoanWizard";

export function ProgramsCard({
  programs,
  onKnowMore,
}: {
  programs: EligibleProgram[];
  onKnowMore: (selectKey: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[760px] rounded-xl border border-border bg-card px-6 py-5 shadow-sm">
      {/* Header: title + matched badge */}
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[15px] font-semibold text-foreground">Program Summary</span>
        <span className="rounded-full bg-[#012a5b]/10 px-2.5 py-0.5 text-[12px] font-medium text-[#012a5b]">
          {programs.length} matched
        </span>
      </div>
      <div>
        {programs.map((p, i) => {
          const key = programSelectKey(p);
          const subline = programGateMetricsLine(p);
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onKnowMore(key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onKnowMore(key);
                }
              }}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 py-3.5 transition-colors",
                i < programs.length - 1 && "border-b border-border",
              )}
            >
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium text-foreground">
                  {programDisplayName(p)}
                </div>
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {subline || "—"}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onKnowMore(key);
                }}
                className="h-8 shrink-0 gap-1 text-[12px]"
              >
                Know more <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
