/**
 * Cross-mode UI — composed by FormWizard, ChatWizard, and FormChatFlow results.
 *
 * | Module | Role |
 * |--------|------|
 * | ScenarioVaultOverlay | Saved scenarios list / edit / clone |
 * | SaveProfileDialog | Save scenario metadata |
 * | ProgramKnowMoreDetail | Know More slide-in (metrics, docs, follow-ups) |
 * | EligibilityExclusionDetails | Geo/overlay exclusion lists |
 * | PostEssentialsOptionalPicker | End-of-intake optional batch (UW) |
 * | formChatResultsUi | Results cards, headline banner, suggestion pills |
 * | MortgageProfileSidebar | *Future* — unify Form + Chat profile rails |
 */

export { ScenarioVaultOverlay, type ScenarioVaultOverlayProps } from "./ScenarioVaultOverlay";

export {
  FormProfileSidebar,
  ChatProfileSidebar,
  EligibleProgramsPreview,
  buildFormProfileSections,
  humanizeField,
  type FormProfileRow,
  type FormProfileSection,
  type ChatEditPending,
  type ChatProfileSidebarProps,
} from "./mortgageProfileSidebar";

export { SaveProfileDialog } from "@/components/SaveProfileDialog";
export { ScenarioHistoryView } from "@/components/ScenarioHistoryView";
export { ProgramKnowMoreDetail } from "@/components/ProgramKnowMoreDetail";
export type { ScenarioSnapshot } from "@/components/ProgramKnowMoreDetail";
export { EligibilityExclusionDetails } from "@/components/EligibilityExclusionDetails";
export { PostEssentialsOptionalPicker } from "@/components/PostEssentialsOptionalPicker";

export {
  ResultsCard,
  ResultsHeadlineBanner,
  SuggestionPills,
  abbreviateProduct,
  programDetailText,
  programProductsLabel,
  resultsHeadlineVariant,
  FORM_CHAT_RESULTS_PAGE_SIZE,
} from "./results";

/** Unified profile sidebar — today split across Form + Chat profile rails. */
export const MORTGAGE_PROFILE_SIDEBAR_MODULE = "shared/mortgageProfileSidebar" as const;
