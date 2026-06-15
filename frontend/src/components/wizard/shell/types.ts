/**
 * Shared wizard shell contracts — used by FormWizard, ChatWizard, and future
 * extracted hooks (session, eligibility, vault).
 */
import type { FormChatMode } from "@/components/wizard/FormChatFlow";

/** Intake surface: URL-driven, no in-app toggle without navigation. */
export type WizardIntakeMode = "form" | "chat";

/** Shared props for both mode entry points (vault, reset, mode variant). */
export type WizardShellProps = {
  showSources?: boolean;
  resetToken?: number;
  formMode?: FormChatMode;
  onClearEnabledChange?: (enabled: boolean) => void;
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
  onViewingHistoryScenarioChange?: (viewing: boolean) => void;
  viewingHistoryScenario?: boolean;
  onNewScenario?: () => void;
};

/** Phase machine shared by both modes (subset — full type lives in LoanWizard). */
export type WizardPhase = "start" | "first" | "chat" | "done";
