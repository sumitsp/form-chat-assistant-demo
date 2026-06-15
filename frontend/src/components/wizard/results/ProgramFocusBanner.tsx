/**
 * "Selected program" focus banner — shown on the results screen while a single
 * program is selected (Know More mode). Extracted from LoanWizard.tsx. Renders
 * nothing unless `show` is true.
 */
import { Button } from "@/components/ui/button";

export function ProgramFocusBanner({
  show,
  title,
  onExit,
}: {
  show: boolean;
  title: string;
  onExit: () => void;
}) {
  if (!show) return null;
  return (
    <div className="rounded-lg border border-[#012a5b]/30 bg-[#012a5b]/[0.06] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#012a5b]">
            Selected program
          </p>
          <p className="text-[14px] font-semibold text-foreground">{title}</p>
          <p className="text-[12px] leading-snug text-muted-foreground">
            All follow-up questions apply to this program until you type{" "}
            <strong className="text-foreground">Exit</strong> in the chat box or return to{" "}
            <strong className="text-foreground">All Programs</strong>.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExit}
          className="shrink-0 text-[11px]"
        >
          ← All Programs
        </Button>
      </div>
    </div>
  );
}
