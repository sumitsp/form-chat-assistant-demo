/**
 * Redesigned, Claude-style Results screen. Three regions: header, scrollable
 * body (programs card + suggestion cards), and a sticky chat dock. A right
 * slide-in half-card panel (program detail / exclusions / platform / modify)
 * shrinks the body to ~50% on desktop and becomes a full-screen takeover on mobile.
 *
 * Step 1: layout + ProgramsCard + SuggestionCards + working open/close/shrink with
 * a placeholder panel. Panel content, chat wiring, and the modify sliders land in
 * later steps.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EligibilityExclusionDetails } from "@/components/EligibilityExclusionDetails";
import { programDisplayName, programSelectKey } from "@/lib/programDisplayHelpers";
import type { ProductDisplayPrefs } from "@/lib/nqmIntegratedForm";
import type { ScenarioSnapshot } from "@/components/ProgramKnowMoreDetail";
import type { EligibleProgram, NearMissProgram } from "@/components/LoanWizard";
import type { ProgramExclusion } from "@/lib/eligibilityExclusions";
import { ProgramsCard } from "./ProgramsCard";
import { SuggestionCards } from "./SuggestionCards";
import { ResultsChatDock } from "./ResultsChatDock";
import { ResultsModifyPanel } from "./ResultsModifyPanel";

const ProgramKnowMoreDetail = lazy(() =>
  import("@/components/ProgramKnowMoreDetail").then((m) => ({
    default: m.ProgramKnowMoreDetail,
  })),
);

export type ResultsPanel = "program" | "exclusions" | "platform" | "modify" | null;

export interface ResultsScreenProps {
  eligible: EligibleProgram[];
  nearMisses: NearMissProgram[];
  geoExclusions: ProgramExclusion[];
  overlayExclusions: ProgramExclusion[];
  totalScreened: number;
  hasUnsavedChanges?: boolean;
  productPrefs?: ProductDisplayPrefs;
  scenario?: ScenarioSnapshot;
  onSaveScenario: () => void;
  canSaveToVault?: boolean;
  onStartNew: () => void;
  onDownloadPdf: () => void | Promise<void>;
  onApplyToProgram?: (selectKey: string) => void;
  /** Sends a follow-up question to the assistant; returns the reply text. */
  onAsk: (question: string) => Promise<string>;
  /** Re-runs eligibility with adjusted LTV / DTI from the modify panel. */
  onApplyModify?: (changes: { ltv: number; dti: number | null }) => void;
  /** True while eligibility is re-running — overlays the body with a spinner. */
  loading?: boolean;
}

const PANEL_TITLE: Record<Exclude<ResultsPanel, null>, string> = {
  program: "Program details",
  exclusions: "Why programs didn't match",
  platform: "About the platform",
  modify: "Apply & resubmit",
};

export function ResultsScreen({
  eligible,
  geoExclusions,
  overlayExclusions,
  hasUnsavedChanges = false,
  productPrefs,
  scenario,
  onSaveScenario,
  canSaveToVault = true,
  onStartNew,
  onDownloadPdf,
  onApplyToProgram,
  onAsk,
  onApplyModify,
  loading = false,
}: ResultsScreenProps) {
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ResultsPanel>(null);

  const openPanel = (panel: Exclude<ResultsPanel, null>, programKey?: string) => {
    setSelectedProgram(programKey ?? null);
    setActivePanel(panel); // only one panel open at a time
  };
  const closePanel = () => {
    setActivePanel(null);
    setSelectedProgram(null);
  };

  // ESC closes any open panel
  useEffect(() => {
    if (!activePanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePanel]);

  const panelOpen = activePanel !== null;
  const programCount = eligible.length;
  const selectedProgramRecord = selectedProgram
    ? (eligible.find((p) => programSelectKey(p) === selectedProgram) ?? null)
    : null;
  const panelTitle =
    activePanel === "program" && selectedProgramRecord
      ? programDisplayName(selectedProgramRecord)
      : activePanel
        ? PANEL_TITLE[activePanel]
        : "";
  const hasExclusions = geoExclusions.length > 0 || overlayExclusions.length > 0;

  return (
    <div className="flex min-h-full w-full flex-col bg-background">
      {/* ── 1. HEADER ── */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h1 className="text-[18px] font-semibold text-foreground">
          Results — {programCount} program{programCount !== 1 ? "s" : ""} matched
        </h1>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={hasUnsavedChanges ? "default" : "outline"}
            size="sm"
            onClick={onSaveScenario}
            disabled={!canSaveToVault}
            title={
              canSaveToVault
                ? "Store this scenario in your vault"
                : "Edit your scenario to store again"
            }
            className={cn(
              "text-[13px]",
              hasUnsavedChanges && "bg-[#012a5b] hover:bg-[#01234d]",
              !canSaveToVault && "opacity-50",
            )}
          >
            Store to Vault
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onStartNew}
            className="text-[13px]"
          >
            Start new
          </Button>
        </div>
      </header>

      {/* ── 2. BODY + side panel ── */}
      <div className="flex flex-1">
        <div
          className={cn(
            "flex flex-col transition-[width] duration-200 ease-out",
            panelOpen ? "hidden w-1/2 md:flex" : "w-full",
          )}
        >
          <div className="relative px-6 py-6">
            {loading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
                <Loader2 className="h-6 w-6 animate-spin text-[#012a5b]" aria-hidden="true" />
                <p className="text-[13px] text-muted-foreground">Re-running eligibility…</p>
              </div>
            )}
            <ProgramsCard programs={eligible} onKnowMore={(key) => openPanel("program", key)} />
            <SuggestionCards
              onApply={() => openPanel("modify")}
              onExclusions={() => openPanel("exclusions")}
              onPlatform={() => openPanel("platform")}
              onPdf={() => void onDownloadPdf()}
              onEmail={() => toast("Email to support is coming soon.")}
            />
          </div>
        </div>

        {panelOpen && (
          <aside
            role="dialog"
            aria-labelledby="results-panel-title"
            className="flex w-full flex-col border-l border-border bg-muted/30 duration-250 animate-in slide-in-from-right md:w-1/2"
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 id="results-panel-title" className="text-[18px] font-semibold text-foreground">
                {panelTitle}
              </h2>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close program details"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {activePanel === "program" &&
                (selectedProgramRecord ? (
                  <Suspense
                    fallback={
                      <p className="text-[13px] text-muted-foreground">Fetching Program Details…</p>
                    }
                  >
                    <ProgramKnowMoreDetail
                      prog={selectedProgramRecord}
                      productPrefs={productPrefs}
                      scenario={scenario}
                      instantReveal
                    />
                  </Suspense>
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    Select a program to see its details.
                  </p>
                ))}

              {activePanel === "exclusions" &&
                (hasExclusions ? (
                  <EligibilityExclusionDetails
                    geoExclusions={geoExclusions}
                    overlayExclusions={overlayExclusions}
                  />
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    No specific exclusions to show — nothing was individually blocked for this
                    scenario.
                  </p>
                ))}

              {activePanel === "platform" && (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    Ask about products, programs, documentation, or how eligibility works. Answers
                    are grounded in your current scenario.
                  </p>
                  <ResultsChatDock
                    onAsk={onAsk}
                    bordered={false}
                    placeholder="Ask about products, eligibility, or the platform…"
                  />
                </div>
              )}

              {activePanel === "modify" && (
                <ResultsModifyPanel
                  initialLtv={scenario?.ltv ?? null}
                  initialDti={scenario?.dti ?? null}
                  busy={loading}
                  onApply={(changes) => {
                    onApplyModify?.(changes);
                    closePanel();
                  }}
                />
              )}
            </div>

            {activePanel === "program" && selectedProgramRecord && (
              <div className="flex flex-wrap gap-2 border-t border-border bg-background px-6 py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toast("Talk to AE is coming soon.")}
                  className="text-[13px]"
                >
                  Talk to AE
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    onApplyToProgram
                      ? onApplyToProgram(programSelectKey(selectedProgramRecord))
                      : toast("Apply flow is coming soon.")
                  }
                  className="bg-[#012a5b] text-[13px] hover:bg-[#01234d]"
                >
                  Apply to this program
                </Button>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ── 3. STICKY CHAT ── */}
      <ResultsChatDock onAsk={onAsk} />
    </div>
  );
}
