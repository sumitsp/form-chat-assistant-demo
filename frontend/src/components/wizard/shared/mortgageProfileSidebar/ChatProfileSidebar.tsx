/**
 * Chat-mode Mortgage Profile sidebar — LoanWizard rail during /chat intake (legacy path).
 */
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Home,
  PenLine,
  RotateCcw,
  X,
} from "lucide-react";

import type { WizardForm } from "@/components/wizard/loanWizardForm";
import type { EligibleProgram } from "@/components/wizard/loanWizardEligibility";
import {
  CHAT_SLOT_FIELD_MAP,
  type ProfileSection,
} from "@/components/wizard/loanWizardProfileSections";
import { programDisplayName, programGateMetricsLine } from "@/lib/programDisplayHelpers";
import { formatMoneyForInput, parseMoneyNum } from "@/lib/nqmIntegratedForm";
import { cn } from "@/lib/utils";
import { EligibleProgramsPreview } from "./EligibleProgramsPreview";

export type ChatEditPending = {
  fieldKey: string;
  slotId: string;
  value: string;
  displayValue: string;
  label: string;
};

export type ChatProfileSidebarProps = {
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  contentVisible: boolean;
  intakeMode: "form" | "chat";
  form: WizardForm;
  profileSections: ProfileSection[];
  previewOpen: boolean;
  previewLoading: boolean;
  previewPrograms: EligibleProgram[];
  onTogglePreview: () => void;
  resetActive: boolean;
  onReset: () => void;
  showActualResults: boolean;
  progCount: number;
  totalCount?: number;
  chatEditField: string | null;
  onChatEditFieldChange: (field: string | null) => void;
  chatEditDraft: string;
  onChatEditDraftChange: (value: string) => void;
  chatEditPending: ChatEditPending | null;
  onChatEditPendingChange: (pending: ChatEditPending | null) => void;
  intakeQuestionCount: number;
  intakeCanSubmit: boolean;
  onFormProfileEdit: (step: ProfileSection["step"], fieldKey: string) => void;
  onStageIntakeEdit: (
    fieldKey: string,
    slotId: string,
    value: string,
    displayValue: string,
    label: string,
  ) => void;
  onCallIntakeEditSlot: (
    slotId: string,
    value: string,
    label: string,
    displayValue: string,
  ) => void | Promise<void>;
  showFormFooter?: boolean;
  detailPhaseComplete?: boolean;
  loading?: boolean;
  isFormComplete?: boolean;
  formDirtySinceSubmit?: boolean;
  onResubmit?: () => void;
};

export function ChatProfileSidebar({
  expanded,
  onExpandedChange,
  contentVisible,
  intakeMode,
  form,
  profileSections,
  previewOpen,
  previewLoading,
  previewPrograms,
  onTogglePreview,
  resetActive,
  onReset,
  showActualResults,
  progCount,
  totalCount = 30,
  chatEditField,
  onChatEditFieldChange,
  chatEditDraft,
  onChatEditDraftChange,
  chatEditPending,
  onChatEditPendingChange,
  intakeQuestionCount,
  intakeCanSubmit,
  onFormProfileEdit,
  onStageIntakeEdit,
  onCallIntakeEditSlot,
  showFormFooter,
  detailPhaseComplete,
  loading,
  isFormComplete,
  formDirtySinceSubmit,
  onResubmit,
}: ChatProfileSidebarProps) {
  if (!expanded) {
    return (
      <div className="hidden w-12 shrink-0 flex-col items-center gap-2 py-4 sm:flex">
        <button
          type="button"
          onClick={() => onExpandedChange(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#012a5b]"
          title="Expand Mortgage Profile"
          aria-label="Expand Mortgage Profile"
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
        <span
          className={cn(
            "mt-1 text-lg font-semibold",
            progCount > 5 ? "text-emerald-600" : progCount > 2 ? "text-amber-500" : "text-red-500",
          )}
        >
          {progCount}
        </span>
      </div>
    );
  }

  const count = progCount;

  return (
    <div
      className={cn(
        "flex h-full flex-col transition-opacity duration-200",
        contentVisible ? "opacity-100" : "opacity-0",
      )}
    >
      {previewOpen ? (
        <EligibleProgramsPreview
          previewPrograms={previewPrograms}
          previewLoading={previewLoading}
          totalCount={totalCount}
          onBack={onTogglePreview}
        />
      ) : (
        <>
          {/* Header row — matches /form ProfileSidebar (Home + Reset pill + collapse) */}
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-3.5 pt-4">
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
                  "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 dark:bg-card dark:hover:bg-red-950/30",
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
                onClick={() => onExpandedChange(false)}
                className="hidden h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
                title="Collapse Mortgage Profile"
                aria-label="Collapse Mortgage Profile"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onExpandedChange(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
                title="Close Mortgage Profile"
                aria-label="Close Mortgage Profile"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Profile content */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {(() => {
              const showActual = showActualResults;
              // Color thresholds: >5 green · 3–5 yellow · ≤2 red
              const counterColor =
                count > 5 ? "text-emerald-600" : count > 2 ? "text-amber-500" : "text-red-500";
              const barColor =
                count > 5 ? "bg-emerald-500" : count > 2 ? "bg-amber-400" : "bg-red-500";
              return (
                <div className="space-y-3">
                  {/* Eligible Programs counter + preview-results eye toggle */}
                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Eligible Programs
                      </span>
                      <button
                        type="button"
                        onClick={() => void toggleSidebarPreview()}
                        aria-label={
                          previewOpen ? "Hide eligible program list" : "Preview eligible programs"
                        }
                        title={previewOpen ? "Show count" : "Preview eligible programs"}
                        aria-pressed={previewOpen}
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                          previewOpen
                            ? "border-[#012a5b] bg-[#012a5b] text-white"
                            : "border-border text-[#012a5b] hover:bg-muted/40",
                        )}
                      >
                        {previewOpen ? (
                          <EyeOff className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <Eye className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    </div>

                    {previewOpen ? (
                      <div className="mt-1">
                        {previewLoading ? (
                          <p className="py-2 text-[10.5px] text-muted-foreground">
                            Checking programs…
                          </p>
                        ) : previewPrograms.length === 0 ? (
                          <p className="py-2 text-[10.5px] text-muted-foreground">
                            No programs match yet — keep answering.
                          </p>
                        ) : (
                          <ul className="max-h-44 space-y-0.5 overflow-y-auto">
                            {previewPrograms.map((prog, index) => (
                              <li
                                key={`${programDisplayName(prog)}-${index}`}
                                className="rounded px-1 py-1 text-[10.5px] leading-snug text-foreground"
                              >
                                <div className="flex items-start gap-1.5">
                                  <span className="mt-px text-[9px] text-emerald-600" aria-hidden>
                                    ✓
                                  </span>
                                  <span className="min-w-0 break-words font-medium">
                                    {programDisplayName(prog)}
                                  </span>
                                </div>
                                <p className="ml-3.5 mt-0.5 text-[9.5px] text-muted-foreground">
                                  {programGateMetricsLine(prog)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground/50">
                          {showActual
                            ? "Final matched programs."
                            : "Preliminary preview · narrows as you answer."}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="leading-none">
                          <span className={cn("text-3xl font-medium", counterColor)}>{count}</span>
                          <span className="text-[13px] text-muted-foreground"> / 30</span>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              barColor,
                            )}
                            style={{ width: `${Math.round((count / totalCount) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/60">
                          {showActual
                            ? "Final Results After Submission"
                            : "Preliminary Estimate · Submit to apply the special overlays"}
                        </p>
                      </>
                    )}
                  </div>

                  {profileSections.length > 0 && (
                    <>
                      <p className="mb-1 mt-1 flex items-center justify-end gap-1 text-right text-[10px] italic text-muted-foreground/60">
                        <PenLine className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                        Click any field to edit
                      </p>
                      <div className="space-y-3">
                        {profileSections.map((sec) => (
                          <div key={sec.step}>
                            <div className="mb-1.5 mt-2.5">
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {sec.title}
                              </span>
                            </div>
                            <div className="space-y-0.5">
                              {sec.rows.map((row) => {
                                const slotDef = CHAT_SLOT_FIELD_MAP[row.fieldKey];
                                const isEditing =
                                  intakeMode === "chat" && chatEditField === row.fieldKey;
                                // Editing enabled once profile rows exist (legacy 5-question gate removed).
                                const editUnlocked =
                                  intakeMode !== "chat" ||
                                  intakeCanSubmit ||
                                  profileSections.length > 0;
                                const canEdit =
                                  intakeMode === "chat" &&
                                  !!slotDef &&
                                  editUnlocked &&
                                  !row.missing;
                                return (
                                  <div key={`${sec.step}-${row.fieldKey}`}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (intakeMode === "form") {
                                          onFormProfileEdit(sec.step, row.fieldKey);
                                        } else if (canEdit) {
                                          if (chatEditField === row.fieldKey) {
                                            onChatEditFieldChange(null);
                                          } else {
                                            onChatEditFieldChange(row.fieldKey);
                                            onChatEditDraftChange(
                                              slotDef.kind === "currency"
                                                ? formatMoneyForInput(row.value)
                                                : slotDef.kind !== "enum"
                                                  ? row.value.replace(/^\$/, "").replace(/%$/, "")
                                                  : "",
                                            );
                                          }
                                        }
                                      }}
                                      className={cn(
                                        "grid w-full grid-cols-[14px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-1.5 rounded-md px-1 py-1 text-left text-[11px] transition-colors",
                                        intakeMode === "form" || canEdit
                                          ? "cursor-pointer hover:bg-[#012a5b]/[0.06]"
                                          : "cursor-default",
                                        isEditing && "rounded-b-none bg-sky-50/80",
                                      )}
                                      title={
                                        intakeMode === "form"
                                          ? `Edit ${row.label} in the form`
                                          : canEdit
                                            ? `Edit ${row.label}`
                                            : intakeMode === "chat" && !!slotDef && !editUnlocked
                                              ? "Editing unlocks after 5 questions"
                                              : undefined
                                      }
                                    >
                                      {row.missing ? (
                                        <span
                                          className="mt-0.5 text-center text-[9px] font-bold leading-none text-red-500"
                                          aria-hidden
                                        >
                                          ●
                                        </span>
                                      ) : (
                                        <Check
                                          className="mt-0.5 h-3 w-3 text-emerald-600"
                                          aria-hidden="true"
                                        />
                                      )}
                                      <span className="text-muted-foreground">
                                        {row.label}
                                        {(row.missing ||
                                          (row.priority && row.priority !== "optional")) && (
                                          <span className="text-red-500">&nbsp;*</span>
                                        )}
                                      </span>
                                      <span
                                        className={cn(
                                          "break-words text-right font-medium capitalize",
                                          row.missing
                                            ? "italic text-red-600/90"
                                            : "text-foreground",
                                        )}
                                      >
                                        {row.missing ? "Required" : row.value}
                                      </span>
                                    </button>

                                    {/* Inline edit panel — chat mode only */}
                                    {isEditing && slotDef && (
                                      <div className="rounded-b-md border border-t-0 border-sky-200/70 bg-sky-50/60 px-2 pb-2 pt-1.5 dark:border-sky-800/40 dark:bg-sky-950/30">
                                        {slotDef.kind === "enum" && slotDef.options ? (
                                          <div className="flex flex-wrap gap-1">
                                            {slotDef.options.map((opt) => {
                                              const isCurrent =
                                                opt.code === row.value ||
                                                (opt.formValue &&
                                                  opt.formValue.toLowerCase() ===
                                                    row.value.toLowerCase()) ||
                                                opt.label.toLowerCase() === row.value.toLowerCase();
                                              return (
                                                <button
                                                  key={opt.code}
                                                  type="button"
                                                  onClick={() =>
                                                    onStageIntakeEdit(
                                                      row.fieldKey,
                                                      slotDef.slotId,
                                                      opt.code,
                                                      opt.formValue ?? opt.label,
                                                      row.label,
                                                    )
                                                  }
                                                  className={cn(
                                                    "rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                                                    isCurrent
                                                      ? "border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-600 dark:bg-sky-900/50 dark:text-sky-200"
                                                      : "border-border/60 bg-white text-foreground/80 hover:border-sky-300 hover:bg-sky-50 dark:bg-muted dark:hover:bg-sky-900/30",
                                                  )}
                                                >
                                                  {opt.label}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1.5">
                                            {slotDef.kind === "currency" && (
                                              <span className="text-[11px] text-muted-foreground">
                                                $
                                              </span>
                                            )}
                                            <input
                                              type={slotDef.kind === "text" ? "text" : "number"}
                                              value={chatEditDraft}
                                              onChange={(e) =>
                                                onChatEditDraftChange(e.target.value)
                                              }
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter" && chatEditDraft.trim()) {
                                                  const raw = chatEditDraft.trim();
                                                  const v =
                                                    slotDef.kind === "currency"
                                                      ? String(parseMoneyNum(raw))
                                                      : raw;
                                                  const disp =
                                                    slotDef.kind === "currency"
                                                      ? `$${formatMoneyForInput(raw)}`
                                                      : raw;
                                                  onStageIntakeEdit(
                                                    row.fieldKey,
                                                    slotDef.slotId,
                                                    v,
                                                    disp,
                                                    row.label,
                                                  );
                                                }
                                                if (e.key === "Escape") onChatEditFieldChange(null);
                                              }}
                                              className="h-6 w-full rounded border border-border/60 bg-white px-1.5 text-[11px] focus:border-sky-400 focus:outline-none dark:bg-muted"
                                              placeholder={
                                                slotDef.kind === "currency"
                                                  ? "Amount"
                                                  : slotDef.kind === "number"
                                                    ? "Value"
                                                    : "Enter value"
                                              }
                                              autoFocus
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (!chatEditDraft.trim()) return;
                                                const raw = chatEditDraft.trim();
                                                const v =
                                                  slotDef.kind === "currency"
                                                    ? String(parseMoneyNum(raw))
                                                    : raw;
                                                const disp =
                                                  slotDef.kind === "currency"
                                                    ? `$${formatMoneyForInput(raw)}`
                                                    : raw;
                                                onStageIntakeEdit(
                                                  row.fieldKey,
                                                  slotDef.slotId,
                                                  v,
                                                  disp,
                                                  row.label,
                                                );
                                              }}
                                              className="shrink-0 rounded bg-sky-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-sky-700"
                                            >
                                              Save
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => onChatEditFieldChange(null)}
                                              className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                                            >
                                              ✕
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {/* Pending confirmation panel */}
                                    {chatEditPending?.fieldKey === row.fieldKey && (
                                      <div className="rounded-b-md border border-t-0 border-amber-200/70 bg-amber-50/60 px-2 pb-2 pt-1.5 dark:border-amber-800/40 dark:bg-amber-950/30">
                                        <p className="mb-1.5 text-[10px] text-amber-800 dark:text-amber-300">
                                          Change <span className="font-semibold">{row.label}</span>{" "}
                                          to{" "}
                                          <span className="font-semibold">
                                            {chatEditPending.displayValue}
                                          </span>
                                          ?
                                        </p>
                                        <div className="flex gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void onCallIntakeEditSlot(
                                                chatEditPending.slotId,
                                                chatEditPending.value,
                                                chatEditPending.label,
                                                chatEditPending.displayValue,
                                              )
                                            }
                                            className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-amber-700"
                                          >
                                            Confirm ✓
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => onChatEditPendingChange(null)}
                                            className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Sidebar footer actions — form (step/edit) mode only; chat submits & resets
      live in-chat and in the header to mirror the /form experience. */}
          {showFormFooter && (
            <div className="shrink-0 space-y-2 px-4 py-3">
              {detailPhaseComplete && (
                <button
                  type="button"
                  onClick={() => void onResubmit?.()}
                  disabled={loading || !isFormComplete || !formDirtySinceSubmit}
                  title={
                    !isFormComplete
                      ? "Complete all required fields to resubmit"
                      : formDirtySinceSubmit
                        ? "Run program matching with your updated profile"
                        : "Change your profile to enable resubmit"
                  }
                  className="w-full rounded-lg border border-[#012a5b] bg-[#012a5b] py-2 text-[11px] font-semibold text-white transition-colors hover:border-[#01234d] hover:bg-[#01234d] disabled:cursor-not-allowed disabled:border-[#9eb3d0] disabled:bg-[#9eb3d0] disabled:text-white disabled:opacity-100"
                >
                  Resubmit
                </button>
              )}
              <button
                type="button"
                onClick={onReset}
                title="Clear scenario and start over"
                aria-label="Clear scenario"
                className="w-full rounded-lg border border-border py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-[#012a5b] hover:bg-[#012a5b] hover:text-white"
              >
                Reset Scenario
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
