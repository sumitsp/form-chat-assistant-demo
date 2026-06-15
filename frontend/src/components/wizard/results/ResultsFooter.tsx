/**
 * Sticky results footer with three modes — extracted from LoanWizard.tsx
 * (frontend split): empty (no programs), select-mode (picking a program), and
 * default (save / know more). All actions arrive as bound callbacks.
 */
import { ArrowRight, Save, Search } from "lucide-react";

export function ResultsFooter({
  eligibleCount,
  showPickActions,
  selectedProgram,
  selectedProgramLabel,
  onEditAfterNoPrograms,
  onStartNew,
  onSkipSelection,
  onSelectProgram,
  onSaveScenario,
  canSaveToVault = true,
  onKnowMore,
}: {
  eligibleCount: number;
  showPickActions: boolean;
  selectedProgram: string | null;
  selectedProgramLabel: string;
  onEditAfterNoPrograms: () => void;
  onStartNew: () => void;
  onSkipSelection: () => void;
  onSelectProgram: () => void;
  onSaveScenario: () => void;
  canSaveToVault?: boolean;
  onKnowMore: () => void;
}) {
  return (
    <div className="sticky bottom-4 mt-5 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm sm:static sm:mt-6">
      {eligibleCount === 0 ? (
        /* Empty-state footer */
        <div className="flex items-center justify-between gap-2">
          <p className="hidden text-[12px] text-muted-foreground sm:block">
            Not seeing what you need? Tweak the scenario or start fresh.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onEditAfterNoPrograms}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              Edit Existing
            </button>
            <button
              type="button"
              onClick={onStartNew}
              className="inline-flex items-center justify-center rounded-lg bg-[#012a5b] px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[#01234d]"
            >
              Start New
            </button>
          </div>
        </div>
      ) : showPickActions ? (
        /* Select-mode footer */
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="px-1 text-sm text-muted-foreground">
            {selectedProgram ? `Selected: ${selectedProgramLabel}` : "No program selected"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSkipSelection}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Skip Selection
            </button>
            <button
              type="button"
              onClick={onSelectProgram}
              disabled={!selectedProgram}
              className="inline-flex items-center justify-center rounded-lg bg-[#012a5b] px-4 py-2.5 text-sm font-medium text-white shadow-md transition-colors hover:bg-[#01234d] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Select Program <ArrowRight className="ml-1.5 h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        /* Default results footer */
        <div className="flex items-center justify-between gap-2">
          <p className="hidden text-[12px] text-muted-foreground sm:block">
            Ready to move forward with these results?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSaveScenario}
              disabled={!canSaveToVault}
              title={
                canSaveToVault
                  ? "Store this scenario in your vault"
                  : "Edit your scenario to store again"
              }
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Store to Vault
            </button>
            <button
              type="button"
              onClick={onKnowMore}
              className="inline-flex items-center justify-center rounded-lg bg-[#012a5b] px-3 py-2 text-[12px] font-medium text-white shadow-md transition-colors hover:bg-[#01234d]"
            >
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Know More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
