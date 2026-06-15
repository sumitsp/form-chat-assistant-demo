/**
 * Results action toolbar (PDF download · New/Edit scenario · Contact) — extracted
 * from LoanWizard.tsx (frontend split, interactive Phase A). Shared by form + chat
 * results screens. Pure presentational: all state/handlers arrive as props.
 */
import type { ReactNode } from "react";
import { Download, Headphones, PenLine } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function ScenarioChoiceMenu({
  onStartNew,
  onEditExisting,
}: {
  onStartNew: () => void;
  onEditExisting: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onEditExisting}
        className="w-full rounded-md bg-[#012a5b] py-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#01428f] sm:py-2 sm:text-[11.5px]"
      >
        Edit Existing
      </button>
      <button
        type="button"
        onClick={onStartNew}
        className="w-full rounded-md border border-border py-2.5 text-[11px] font-semibold text-foreground transition-colors hover:border-[#012a5b] hover:bg-[#012a5b] hover:text-white sm:py-2 sm:text-[11.5px]"
      >
        Start New
      </button>
    </div>
  );
}

export interface ResultsToolbarProps {
  knowMoreActivated: boolean;
  selectedProgram: string | null;
  docChatActive: boolean;
  knowMoreDetailReady: boolean;
  detailsReady: boolean;
  chatStarted: boolean;
  generalResultsChat: boolean;
  knowMoreHinted: boolean;
  programFocusMode: boolean;
  eligiblePrograms: readonly unknown[];
  pdfDownloading: boolean;
  handleDownloadOptions: () => void | Promise<void>;
  intakeMode: "form" | "chat";
  phase: string;
  scenarioChoiceOpen: boolean;
  setScenarioChoiceOpen: (open: boolean) => void;
  startNewScenario: () => void;
  editExistingScenario: () => void;
}

export function ResultsToolbar({
  knowMoreActivated,
  selectedProgram,
  docChatActive,
  knowMoreDetailReady,
  detailsReady,
  chatStarted,
  generalResultsChat,
  knowMoreHinted,
  programFocusMode,
  eligiblePrograms,
  pdfDownloading,
  handleDownloadOptions,
  intakeMode,
  phase,
  scenarioChoiceOpen,
  setScenarioChoiceOpen,
  startNewScenario,
  editExistingScenario,
}: ResultsToolbarProps) {
  const knowMoreDeep =
    (knowMoreActivated && !!selectedProgram) ||
    docChatActive ||
    (knowMoreDetailReady && detailsReady && chatStarted && !generalResultsChat);
  /** Solid navy when Know More is selected (picker open, program ticked, or program chat). */
  const knowMoreToolbarActive = knowMoreDeep;
  const knowMoreHint = knowMoreHinted && !knowMoreToolbarActive && !generalResultsChat;
  /** Desktop: soft blue on Know More at rest only (not selected). */
  const knowMoreDesktopDefault = !knowMoreToolbarActive && !knowMoreHint && !generalResultsChat;
  /** Lock toolbar only while a program is selected (detail/doc chat), not in the picker. */
  const knowMoreToolbarLock = programFocusMode;
  // Retained for parity with the original closure (Know More visual state derivation).
  void knowMoreToolbarActive;
  void knowMoreHint;
  void knowMoreDesktopDefault;
  const exitModeHint = "Type Exit or choose All Programs before switching modes.";
  const wrapDisabled = (node: ReactNode, locked: boolean) =>
    locked ? (
      <span className="inline-flex cursor-not-allowed" title={exitModeHint}>
        {node}
      </span>
    ) : (
      node
    );
  return (
    <TooltipProvider delayDuration={300}>
      <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            {wrapDisabled(
              <button
                type="button"
                disabled={eligiblePrograms.length === 0 || knowMoreToolbarLock || pdfDownloading}
                onClick={() => void handleDownloadOptions()}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md transition-colors disabled:opacity-40",
                  pdfDownloading
                    ? "bg-blue-50 text-[#012a5b]"
                    : "text-muted-foreground hover:bg-blue-50 hover:text-[#012a5b]",
                )}
                aria-label="Download Scenario as PDF"
                aria-busy={pdfDownloading}
              >
                <Download className="h-4 w-4" />
              </button>,
              knowMoreToolbarLock,
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {knowMoreToolbarLock ? exitModeHint : "Download Scenario as PDF"}
          </TooltipContent>
        </Tooltip>
        {(intakeMode === "form" || phase === "done") && (
          <Popover open={scenarioChoiceOpen} onOpenChange={setScenarioChoiceOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                      scenarioChoiceOpen
                        ? "bg-[#012a5b] text-white"
                        : "text-muted-foreground hover:bg-blue-50 hover:text-[#012a5b]",
                    )}
                    aria-label="New/Edit Scenario"
                  >
                    <PenLine className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">New/Edit Scenario</TooltipContent>
            </Tooltip>
            <PopoverContent
              align="end"
              side="bottom"
              className="z-50 w-[200px] border-border/80 bg-popover/90 p-3 shadow-lg backdrop-blur-md"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <ScenarioChoiceMenu
                onStartNew={startNewScenario}
                onEditExisting={editExistingScenario}
              />
            </PopoverContent>
          </Popover>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="https://newpointmortgage.com/contact/"
              target="_blank"
              rel="noreferrer"
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-blue-50 hover:text-[#012a5b]"
              aria-label="Contact Us"
            >
              <Headphones className="h-4 w-4" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="bottom">Contact Us</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
