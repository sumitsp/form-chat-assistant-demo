/**
 * Form-mode Mortgage Profile sidebar — used by FormChatFlow (intake + results).
 */
import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Eye, Home, Pencil, RotateCcw, X } from "lucide-react";

import type { WizardForm } from "@/components/wizard/loanWizardForm";
import type { EligibleProgram } from "@/components/wizard/loanWizardEligibility";
import { programDisplayName, programGateMetricsLine } from "@/lib/programDisplayHelpers";
import { cn } from "@/lib/utils";
import { buildFormProfileSections, type FormProfileSection } from "./formProfileSections";

const RESET_PILL_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-[13px] font-medium text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 dark:bg-card dark:hover:bg-red-950/30";

import { EligibleProgramsPreview } from "./EligibleProgramsPreview";

// ── Mortgage Profile sidebar (left rail) ─────────────────────────────────────
export function FormProfileSidebar({
  form,
  answeredQIds,
  submitted,
  eligibleCount,
  totalCount,
  previewOpen,
  previewLoading,
  previewPrograms,
  onTogglePreview,
  onReset,
  onEditField,
  resetActive,
  importedFieldKeys,
  includeOptional,
  showScenarioNotes = false,
  scenarioNotesSkipped = false,
  onScenarioNotesEdit,
  mobileOpen = false,
  onMobileClose,
  /** Bumped when /api/geo/config finishes loading so county/city rows appear. */
  geoConfigRevision = 0,
  highlightGaps = false,
}: {
  form: WizardForm;
  answeredQIds: Set<string>;
  submitted: boolean;
  eligibleCount: number;
  totalCount: number;
  previewOpen: boolean;
  previewLoading: boolean;
  previewPrograms: EligibleProgram[];
  onTogglePreview?: () => void;
  onReset: () => void;
  onEditField?: (qId: string, fieldId?: string) => void;
  /** Highlight the Reset button (light red) once the borrower has filled values. */
  resetActive: boolean;
  /** Sidebar row ids whose values came from an uploaded 1003 / URLA file. */
  importedFieldKeys: Set<string>;
  /** Underwriter mode also asks UW-only mandatory fields + remaining optional questions. */
  includeOptional: boolean;
  /** Show the scenario-notes card once structured questions are complete. */
  showScenarioNotes?: boolean;
  /** True once the LO explicitly skipped scenario notes (show a "No inputs" note). */
  scenarioNotesSkipped?: boolean;
  /** Re-open the scenario-notes prompt in the main chat to edit them. */
  onScenarioNotesEdit?: () => void;
  /** Slide-over drawer on viewports below `md`. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  geoConfigRevision?: number;
  highlightGaps?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const sections = useMemo(
    () =>
      buildFormProfileSections(
        form,
        answeredQIds,
        submitted,
        includeOptional,
        importedFieldKeys,
        highlightGaps,
      ),
    [
      form,
      answeredQIds,
      submitted,
      includeOptional,
      importedFieldKeys,
      geoConfigRevision,
      highlightGaps,
    ],
  );
  const hasImportedHighlight = importedFieldKeys.size > 0;
  // Scenario note paraphrases (one per line) — shown below Considerations.
  const scenarioNoteLines = (form.scenarioNotes ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const pct = totalCount > 0 ? Math.round((eligibleCount / totalCount) * 100) : 0;
  // Color thresholds: >5 green · 3–5 yellow · ≤2 red
  const numColor =
    eligibleCount > 5 ? "text-emerald-600" : eligibleCount > 2 ? "text-amber-500" : "text-red-500";
  const barColor =
    eligibleCount > 5 ? "bg-emerald-500" : eligibleCount > 2 ? "bg-amber-400" : "bg-red-500";

  // Collapsed rail — a slim strip: expand control, Reset, and the live count.
  if (collapsed) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-4 md:flex">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand Mortgage Profile"
          aria-label="Expand Mortgage Profile"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#012a5b]"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!resetActive}
          title={resetActive ? "Reset scenario" : "Nothing to reset yet"}
          aria-label="Reset scenario"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
            resetActive
              ? "border-red-200 bg-red-100 text-red-600 hover:bg-red-200"
              : "cursor-not-allowed border-border text-muted-foreground/40",
          )}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span className={cn("mt-1 text-lg font-semibold", numColor)}>{eligibleCount}</span>
      </aside>
    );
  }

  const profileAsideClass = cn(
    "flex w-[min(100vw-0.5rem,23rem)] shrink-0 flex-col border-r border-border bg-card px-4 py-4",
    "fixed inset-y-0 left-0 z-50 shadow-xl transition-transform duration-200 ease-out md:static md:z-auto md:w-[23rem] md:translate-x-0 md:shadow-none",
    mobileOpen
      ? "pointer-events-auto translate-x-0"
      : "-translate-x-full pointer-events-none md:pointer-events-auto md:translate-x-0",
    previewOpen ? "overflow-hidden" : "overflow-y-auto",
  );

  return (
    <aside className={profileAsideClass}>
      {previewOpen ? (
        <EligibleProgramsPreview
          previewPrograms={previewPrograms}
          previewLoading={previewLoading}
          totalCount={totalCount}
          onBack={() => onTogglePreview?.()}
        />
      ) : (
        <>
          <div className="mb-3.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Home className="h-3.5 w-3.5 text-[#012a5b]" aria-hidden="true" />
              Mortgage Profile
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onReset}
                disabled={!resetActive}
                className={cn(
                  RESET_PILL_BTN,
                  "px-2.5 py-1 text-[11px]",
                  !resetActive &&
                    "cursor-not-allowed opacity-50 hover:border-border hover:bg-white",
                )}
                title={resetActive ? "Reset scenario" : "Nothing to reset yet"}
              >
                <RotateCcw className="h-3 w-3 shrink-0" aria-hidden="true" />
                Reset
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                title="Collapse Mortgage Profile"
                aria-label="Collapse Mortgage Profile"
                className="hidden h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onMobileClose}
                title="Close Mortgage Profile"
                aria-label="Close Mortgage Profile"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Eligible Programs card */}
          <div className="mb-4 rounded-lg border border-border p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Eligible Programs
              </span>
              <button
                type="button"
                onClick={onTogglePreview}
                aria-label="Preview eligible programs"
                title="Preview eligible programs"
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-[#012a5b] transition-colors hover:bg-muted/40"
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="leading-none">
              <span className={cn("text-3xl font-medium", numColor)}>{eligibleCount}</span>
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

          {/* Answered fields, grouped by step — click a row to edit it. */}
          {sections.length > 0 && (
            <div className="mb-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right text-[10px] text-muted-foreground/60">
              {hasImportedHighlight && (
                <span className="flex items-center gap-1.5 not-italic">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-sm bg-[#012a5b]/25 ring-1 ring-[#012a5b]/40"
                    aria-hidden
                  />
                  <span className="font-medium text-[#012a5b]">
                    Extracted from Highlighted Form
                  </span>
                </span>
              )}
              <span className="flex items-center gap-1 italic">
                <Pencil className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                Click any field to edit
              </span>
            </div>
          )}
          {sections.map((sec) => (
            <div key={sec.name} className="mb-3">
              <div className="mb-1.5 mt-2.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {sec.name}
              </div>
              {sec.rows.map((r) =>
                r.editable === false ? (
                  <div
                    key={r.id}
                    className="grid w-full cursor-default grid-cols-[14px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-1.5 px-1 py-1 text-left text-[11px]"
                    aria-readonly="true"
                  >
                    <Check
                      className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">
                      {r.label}
                      {r.mandatory && <span className="text-red-500">&nbsp;*</span>}
                    </span>
                    <span className="break-words text-right font-medium text-foreground">
                      {r.value}
                    </span>
                  </div>
                ) : (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      onEditField?.(r.editId, r.id);
                      onMobileClose?.();
                    }}
                    title={
                      r.missing
                        ? "Required — click to answer"
                        : r.fromImport
                          ? "From uploaded form — click to edit"
                          : "Edit this answer"
                    }
                    className={cn(
                      "grid w-full grid-cols-[14px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-1.5 rounded-md px-1 py-1 text-left text-[11px] transition-colors hover:bg-[#012a5b]/[0.06]",
                      r.fromImport && "bg-[#012a5b]/[0.07] ring-1 ring-inset ring-[#012a5b]/15",
                    )}
                  >
                    {r.missing ? (
                      <span
                        className="mt-0.5 text-center text-[9px] font-bold leading-none text-red-500"
                        aria-hidden
                      >
                        ●
                      </span>
                    ) : (
                      <Check
                        className={cn(
                          "mt-0.5 h-3 w-3 shrink-0",
                          r.fromImport ? "text-[#012a5b]" : "text-emerald-600",
                        )}
                        aria-hidden="true"
                      />
                    )}
                    <span className="text-muted-foreground">
                      {r.label}
                      {r.mandatory && <span className="text-red-500">&nbsp;*</span>}
                    </span>
                    <span
                      className={cn(
                        "break-words text-right font-medium",
                        r.missing
                          ? "italic text-red-600/90"
                          : r.fromImport
                            ? "text-[#012a5b]"
                            : "text-foreground",
                      )}
                    >
                      {r.missing ? "Required" : r.value}
                    </span>
                  </button>
                ),
              )}
            </div>
          ))}

          {/* Scenario Notes — bordered card; click anywhere to edit in the chat. */}
          {showScenarioNotes && (
            <button
              type="button"
              onClick={onScenarioNotesEdit}
              title="Edit scenario notes"
              className="mb-3 w-full rounded-lg border border-border p-2.5 text-left transition-colors hover:bg-[#012a5b]/[0.04]"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Scenario Notes
                </span>
                <Pencil
                  className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60"
                  aria-hidden="true"
                />
              </div>
              {scenarioNoteLines.length > 0 ? (
                <div className="space-y-0.5">
                  {scenarioNoteLines.map((line, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-1.5 text-[11px]"
                    >
                      <Check className="mt-0.5 h-3 w-3 text-emerald-600" aria-hidden="true" />
                      <span className="break-words text-foreground">{line}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-1.5 text-[11px]">
                  <Check className="mt-0.5 h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
                  <span className="text-muted-foreground">No inputs for scenario notes.</span>
                </div>
              )}
            </button>
          )}
        </>
      )}
    </aside>
  );
}
