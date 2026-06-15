import type { FC, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Check,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Download,
  Eye,
  EyeOff,
  Headphones,
  Home,
  Info,
  Mic,
  RotateCcw,
  Square,
  PenLine,
  Save,
  Send,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FormChatFlow, type FormChatMode } from "@/components/wizard/FormChatFlow";
import { ChatConversationFlow } from "@/components/wizard/ChatConversationFlow";
import { ChatProfileSidebar } from "@/components/wizard/shared/mortgageProfileSidebar/ChatProfileSidebar";
import { isStepdownNA, normalizeStepdown } from "@/components/wizard/PrepaymentTermsCard";
import type { ChatThreadMsg } from "@/lib/chatThreadView";
import {
  eligibleProgramNameStub,
  type EligibleProgram,
  type NearMissProgram,
} from "@/components/wizard/loanWizardEligibility";
import { makeEmptyForm, type WizardForm } from "@/components/wizard/loanWizardForm";
import {
  buildProfileSections,
  collectMissingRequiredProfileRows,
  enrichProfileSectionsForEdit,
} from "@/components/wizard/loanWizardProfileSections";
import { STATES } from "@/lib/wizardFormUi";

import {
  CHAT_THINKING_LABELS,
  CompactThinkingBubble,
  ELIGIBILITY_RELOAD_LABEL,
  ELIGIBILITY_RUN_LABEL,
  ELIGIBILITY_THINKING_LABELS,
  KNOW_MORE_THINKING_LABELS,
  stripLoadingEllipsis,
} from "@/components/ChatThinkingSkeleton";
import { EligibilityExclusionDetails } from "@/components/EligibilityExclusionDetails";
import { SaveProfileDialog } from "@/components/SaveProfileDialog";
import { ScenarioVaultOverlay } from "@/components/wizard/shared/ScenarioVaultOverlay";
import {
  usePersistWizardSession,
  useWizardSessionBoot,
} from "@/components/wizard/hooks/useWizardSession";
import {
  formatDocChatIntro,
  getProgramDocsDisplay,
  GOOD_NEWS_RESULTS_MSG,
  KNOW_MORE_FOLLOWUP_TEXT,
  RESULTS_GENERAL_CHAT_HINT,
  limitConsiderationBullets,
  filterNotesForSummarize,
  getProgramConsiderationBullets,
  findProgramBySelectKey,
  programMetricsLookStale,
  resolveKnowMoreProgram,
  programSelectKey,
  programDisplayName,
  programGateMetricsLine,
  ProductsAvailableInline,
  renderChatAnswer,
} from "@/lib/programDisplayHelpers.tsx";

import type { ScenarioSnapshot } from "@/components/ProgramKnowMoreDetail";

const ProgramKnowMoreDetail = lazy(() =>
  import("@/components/ProgramKnowMoreDetail").then((m) => ({
    default: m.ProgramKnowMoreDetail,
  })),
);

function ProgramKnowMoreDetailFallback() {
  return (
    <div className="py-1">
      <CompactThinkingBubble labels={KNOW_MORE_THINKING_LABELS} />
    </div>
  );
}

import {
  parseExclusionsFromApi,
  type EligibilityExclusionPayload,
  type ProgramExclusion,
} from "@/lib/eligibilityExclusions";
import { downloadScenarioPdf, isMobilePdfEnvironment } from "@/lib/scenarioPdfExport";
import {
  creditEventTypesForCategory,
  CITIZENSHIP_OPTIONS,
  DOC_TYPES_INTEGRATED,
  INTEGRATED_PROPERTY_TYPES,
  isDscrPathScenario as isDscrPathScenarioFields,
  isFiveEightProperty,
  LOAN_PURPOSE_INTEGRATED,
  mapDocumentationForApi,
  formatMoneyDisplay,
  formatMoneyForInput,
  formatMoneyInt,
  parseMoneyNum,
  PAYMENT_HISTORY_OPTIONS,
  shouldShowEstablishedPrimaryRes,
  shouldShowPaymentHistory,
  shouldShowSecondLienFields,
  loanAmountFieldLabel,
  CROSS_COLLATERAL_PROPERTY_CODE,
  EXISTING_SECOND_LIEN_NONE,
  EXISTING_SECOND_LIEN_OPTIONS,
  EXISTING_SECOND_LIEN_PAID_OFF,
  EXISTING_SECOND_LIEN_SUBORDINATION,
  existingSecondLienNeedsSubordination,
  usesCltvLeverageField,
  valueLoanGridReady,
  triangulateLoanFields,
  computeLtvPercent,
  computeCltvPercent,
  type LoanTriSource,
  formatLoanTermDisplay,
  formatLoanTermStorage,
  formatProductsForScenario,
  LOAN_TERM_SELECT_OPTIONS,
  parseLoanTermSelection,
  productDisplayPrefsFromForm,
  RATE_TYPE_PREF_OPTIONS,
  formatMortgageAcronyms,
  formatSelectDisplayLabel,
  incomeTypeDisplayLabel,
  INVESTMENT_INCOME_TYPE_OPTIONS,
  ENTITY_VESTING_OPTIONS,
  YES_NO_OPTIONS,
  LIEN_POSITION_FIRST,
  LIEN_POSITION_SECOND,
  LIEN_POSITION_PIGGYBACK,
  formChatConditionsDefaults,
  isConditionsStepComplete,
  isRefiOrCashOutLoanPurpose,
  listingSeasoningRequired,
} from "@/lib/nqmIntegratedForm";
import {
  computeYearsSinceBucket,
  CREDIT_EVENT_YEAR_BUCKETS,
  formatMmYyyyInput,
} from "@/lib/creditEventTiming";
import { chatFieldCaptureLabel } from "@/lib/chatConversation";
import {
  buildCascadePatchForFormEdit,
  creditEventSidebarLabel,
  mandatoryComplete,
  portfolioSlotForFormField,
} from "@/lib/formChatFlow";
import {
  evaluateGeoFromWizard,
  fetchGeoConfig,
  geoFormFromWizard,
  geoSidebarSlotsForForm,
  geoSubFieldKeys,
  isGeoLocationComplete,
  type GeoEvaluateResponse,
  type GeoWarning,
} from "@/lib/stateGeoFollowUp";
import { mergeScenarioNotesText, sessionNotesFromDelta } from "@/lib/sessionNotes";
import { portfolioToFormPatch } from "@/lib/portfolioToFormPatch";
import {
  buildEligibilityPayloadFromForm,
  buildQuickScanPayloadFromForm,
  formHasQuickScanInput,
  type QuickEligibilityFormSnap,
} from "@/lib/quickEligibilityPayload";
import {
  postEligibilityFull,
  postEligibilityQuick,
  eligibleProgramsFromQuickApi,
  type QuickEligibilityApiResponse,
} from "@/lib/eligibilityApi";
import { ACREAGE_PROPERTY_TYPES } from "@/lib/postEssentialsOptional";
import {
  clearWizardSession,
  type WizardPersistedSession,
  type WizardPhase,
} from "@/lib/wizardSessionPersist";
import {
  saveFormHistory,
  suggestScenarioDescription,
  updateFormHistory,
  VAULT_SCENARIO_DESCRIPTION_KEY,
  type SaveProfileVaultMeta,
  type FormHistoryDetail,
  type ScenarioStatus,
} from "@/lib/scenarioHistoryApi";
import {
  buildFormFieldsForHistorySave,
  eligibilityPayloadFromSavedFields,
  wizardFormFromSavedFields,
} from "@/lib/wizardFormFromSavedFields";
import {
  FORM_CHAT_COLUMN,
  FORM_CHAT_COMPOSER_CARD,
  FORM_CHAT_COMPOSER_CONTROLS,
  FORM_CHAT_COMPOSER_ICON_BTN,
  FORM_CHAT_COMPOSER_INPUT,
  FORM_CHAT_COMPOSER_PLACEHOLDER,
  FORM_CHAT_COMPOSER_SEND_BTN,
  FORM_CHAT_COMPOSER_SHELL,
  FORM_CHAT_MESSAGE_STACK,
  FORM_CHAT_SCROLL_PAD,
  FORM_CHAT_T13,
  FORM_CHAT_T14,
} from "@/lib/formChatLayout";

export type { WizardForm, EligibleProgram, NearMissProgram };

// ── Constants ─────────────────────────────────────────────────────────────────

/** Same column width as LoanScenarioForm so the form reads identically on the right. */
/** Full width on phones; align with chat column from xs up (matches avatar gutter). */
const FORM_COLUMN = "w-full min-w-0 max-w-full xs:ml-11 xs:max-w-[calc((100%-2.75rem)*0.594)]";

const MOBILE_SIDEBAR_MQ = "(max-width: 639px)";

function isMobileSidebarLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_SIDEBAR_MQ).matches;
}

function isDesktopSidebarLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
}

const START_PROMPT_INTRO =
  "Hi! I'm your mortgage assistant, here to help you find programs that best match your property and financing needs.\n\nI'll guide you through a few quick questions to understand your scenario and help identify suitable options. Whether you're purchasing, refinancing, or exploring eligibility, I'll help narrow down the best-fit programs for you.\n\n";

const START_PROMPT_FORM = `${START_PROMPT_INTRO}Input 'Start' or 'Go' to begin.`;
const CHAT_WELCOME_SIDEBAR_TRIGGER = "Provide your base loan scenario";
const START_PROMPT_CHAT = `${START_PROMPT_INTRO}Provide your base loan scenario to get started. With your inputs, your profile and matching scenario will take shape on the left.`;

function getStartPrompt(mode: "form" | "chat"): string {
  return mode === "chat" ? START_PROMPT_CHAT : START_PROMPT_FORM;
}

/** /form uses FormChatFlow immediately; only /chat keeps the legacy "start" welcome gate. */
function resolveInitialPhase(
  intakeMode: "form" | "chat",
  sessionBoot: WizardPersistedSession | null,
): WizardPhase {
  if (!sessionBoot) {
    return intakeMode === "form" ? "first" : "start";
  }
  if (intakeMode === "form" && sessionBoot.phase === "start") {
    return "first";
  }
  return sessionBoot.phase;
}
const START_REJECT = "Your input doesn't match. Please type 'Start' or 'Go' to continue.";
const CHAT_SCENARIO_TOO_SHORT =
  "Please share a bit more about your scenario (for example: occupancy, state, loan purpose, property type, loan amount or value, and FICO). I'll ask follow-up questions and shortlist programs as we go.";
const QUESTIONNAIRE_REVEAL_MS = 250;
const ELIGIBILITY_SCAN_MSG_ID = "eligibility-scan";
const CHAT_INTAKE_LOADING_MSG_ID = "chat-intake-loading";

/** Shown in order during chat intake; stops on the last word (no loop). */
const CHAT_INTAKE_PROGRESS_WORDS = [
  "Interpreting your message",
  "Extracting key details",
  "Mapping your scenario",
  "Parsing fields",
] as const;

const RENTAL_TYPES = ["Long-term rental", "Short-term rental"] as const;
const NOCB_RELATIVE_OPTIONS = [
  "Parent",
  "Sibling",
  "Spouse / Domestic Partner",
  "Child",
  "Grandparent",
  "Aunt / Uncle",
  "Cousin",
  "Other Relative",
] as const;
const YEARS_SINCE_EVENT = CREDIT_EVENT_YEAR_BUCKETS;
const VISA_CATEGORIES = [
  { value: "employment", label: "Employment Visa" },
  { value: "treaty_investor", label: "Investor / Treaty Visa" },
  { value: "intracompany", label: "Intracompany Transfer" },
  { value: "extraordinary", label: "Extraordinary Ability / Professional" },
  { value: "religious_diplomatic", label: "Religious / Diplomatic / Special" },
  { value: "other", label: "Other / Not Listed" },
] as const;

const VISA_SUBTYPES: Record<string, { value: string; label: string; description: string }[]> = {
  employment: [
    { value: "H-1B", label: "H-1B", description: "Skilled worker" },
    { value: "H-4 EAD", label: "H-4 EAD", description: "H-1B spouse" },
    { value: "H-2A", label: "H-2A", description: "Farm worker" },
    { value: "H-2B", label: "H-2B", description: "Temp worker" },
    { value: "H-3", label: "H-3", description: "Trainee visa" },
  ],
  treaty_investor: [
    { value: "E-1", label: "E-1", description: "Treaty trader" },
    { value: "E-2", label: "E-2", description: "Treaty investor" },
    { value: "E-3", label: "E-3", description: "Australian professional" },
    { value: "EB-5", label: "EB-5", description: "Investor immigrant" },
  ],
  intracompany: [
    { value: "L-1A", label: "L-1A", description: "Executive transfer" },
    { value: "L-1B", label: "L-1B", description: "Specialized transfer" },
  ],
  extraordinary: [
    { value: "O-1", label: "O-1", description: "Extraordinary ability" },
    { value: "TN", label: "TN", description: "USMCA professional" },
  ],
  religious_diplomatic: [
    { value: "I", label: "I", description: "Media representative" },
    { value: "G-1", label: "G-1", description: "Intl organization" },
    { value: "G-2", label: "G-2", description: "Intl employee" },
    { value: "G-3", label: "G-3", description: "Foreign representative" },
    { value: "G-4", label: "G-4", description: "Intl officer" },
    { value: "G-5", label: "G-5", description: "Personal employee" },
    { value: "NATO", label: "NATO", description: "NATO personnel" },
    { value: "R-1", label: "R-1", description: "Religious worker" },
  ],
};
const TRADELINE_OPTIONS = [
  "3+ active accounts, 12+ mo history",
  "2+ active accounts, 24+ mo history",
  "Mortgage tradeline (36+ mo)",
  "Unsure / Provide via credit report",
  "None — need non-traditional credit",
] as const;
const LOAN_PURPOSE_OPTIONS = LOAN_PURPOSE_INTEGRATED;
const DOC_TYPES_INCOME = DOC_TYPES_INTEGRATED;
const CORE_PROPERTY_TYPES = INTEGRATED_PROPERTY_TYPES;
const PROPERTY_TYPES_WITH_CROSS = [
  ...CORE_PROPERTY_TYPES,
  { value: CROSS_COLLATERAL_PROPERTY_CODE, label: "Multiple Properties (Cross-Collateral)" },
] as const;
const LIEN_POSITION_OPTIONS = [
  { value: LIEN_POSITION_FIRST, label: "First Lien" },
  { value: LIEN_POSITION_SECOND, label: "Second Lien (Standalone)" },
  { value: LIEN_POSITION_PIGGYBACK, label: "Second Lien (Piggyback)" },
] as const;
const FIRST_LIEN_PURPOSE_OPTIONS = [
  { value: "Purchase", label: "Purchase" },
  { value: "Refinance", label: "Rate & Term Refinance" },
  { value: "Cash-Out Refinance", label: "Cash-Out Refinance" },
] as const;
const PIGGYBACK_PURPOSE_OPTIONS = [
  { value: "Purchase", label: "Purchase" },
  { value: "Refinance", label: "Rate & Term Refinance" },
] as const;
const SECOND_LIEN_PRODUCT_OPTIONS = [
  { value: "heloc", label: "HELOC" },
  { value: "heloan", label: "HELOAN / Closed-End Second" },
] as const;
const CREDIT_EVENT_OPTIONS_V4 = [
  { value: "BK-Ch7-Discharged", label: "Bankruptcy — Chapter 7 Discharged" },
  { value: "BK-Ch7-Dismissed", label: "Bankruptcy — Chapter 7 Dismissed" },
  { value: "BK-Ch13-Discharged", label: "Bankruptcy — Chapter 13 Discharged" },
  { value: "BK-Ch13-Dismissed", label: "Bankruptcy — Chapter 13 Dismissed" },
  { value: "FC", label: "Foreclosure" },
  { value: "SS", label: "Short Sale" },
  { value: "DIL", label: "Deed-in-Lieu" },
  { value: "Pre-FC", label: "Pre-Foreclosure" },
  { value: "Charge-Off", label: "Mortgage Charge-Off" },
  { value: "NOD", label: "Notice of Default" },
  { value: "Mod", label: "Loan Modification" },
  { value: "Forbearance", label: "Forbearance" },
  { value: "Deferral", label: "Deferral" },
] as const;
const HI_LAVA_ZONES = ["Zone 1", "Zone 2", "Zone 3-9 (lower risk)"] as const;
const OCCUPANCY = ["Primary Residence", "Second Home", "Investment Property"] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type ChatScope = "general" | "program";

type Msg = {
  id: string;
  role: "assistant" | "user";
  content: string;
  sources?: Array<{ index?: number; path?: string; text?: string; layout?: string }>;
  isChat?: boolean;
  /** Separates Chat More follow-up from Know a Program follow-up in the transcript. */
  chatScope?: ChatScope;
  isTransition?: boolean;
};

/** Optional zero-match reason — omit empty or redundant generic copy. */
function zeroNudgeDetailLine(detail: string): string {
  const t = detail.trim();
  if (!t) return "";
  if (/don't seem to have any matches|tweak your inputs|preliminary review/i.test(t)) return "";
  return t.endsWith(".") ? t : `${t}.`;
}

function isProgramChatMessage(msg: Msg): boolean {
  if (msg.chatScope === "program") return true;
  if (msg.chatScope === "general") return false;
  if (msg.role === "user" && msg.content.startsWith("Know more:")) return true;
  if (
    msg.role === "assistant" &&
    (msg.content.startsWith("PROGRAM_DETAIL:") || msg.content.startsWith("DOC_CHAT_INTRO:"))
  ) {
    return true;
  }
  return false;
}

function isGeneralChatMessage(msg: Msg): boolean {
  if (msg.chatScope === "general") return true;
  if (msg.chatScope === "program") return false;
  if (isProgramChatMessage(msg)) return false;
  return !!msg.isChat;
}

function withoutTransientChatMessages(msgs: Msg[]): Msg[] {
  return msgs.filter((m) => m.id !== CHAT_INTAKE_LOADING_MSG_ID);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BACK_AT_RESULTS_MSG =
  "You're back at your program results. Download your results, pick a program to view details, or ask a question below.";

function parseEligibilityTableMessage(content: string): {
  eligible: EligibleProgram[];
  nearMisses: NearMissProgram[];
  totalScreened: number;
  geoBlocked: number;
  overlayBlocked: number;
  geoExclusions: ProgramExclusion[];
  overlayExclusions: ProgramExclusion[];
} | null {
  if (!content.startsWith("ELIGIBILITY_TABLE:")) return null;
  try {
    const raw = JSON.parse(content.slice("ELIGIBILITY_TABLE:".length)) as Record<string, unknown>;
    return {
      eligible: (raw.eligible as EligibleProgram[]) ?? [],
      nearMisses: (raw.nearMisses as NearMissProgram[]) ?? [],
      totalScreened: Number(raw.totalScreened ?? 0),
      geoBlocked: Number(raw.geoBlocked ?? 0),
      overlayBlocked: Number(raw.overlayBlocked ?? 0),
      geoExclusions: (raw.geoExclusions as ProgramExclusion[]) ?? [],
      overlayExclusions: (raw.overlayExclusions as ProgramExclusion[]) ?? [],
    };
  } catch {
    return null;
  }
}

function latestEligibleFromMessages(messages: Msg[]): EligibleProgram[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parsed = parseEligibilityTableMessage(messages[i].content);
    if (parsed?.eligible?.length) return parsed.eligible;
  }
  return [];
}

/** Latest ELIGIBILITY_TABLE wins over sessionStorage state (avoids stale cached rows). */
function resolveEligibleProgramPool(
  messages: Msg[],
  eligiblePrograms: EligibleProgram[],
): EligibleProgram[] {
  const fromTable = latestEligibleFromMessages(messages);
  if (fromTable.length > 0) return fromTable;
  return eligiblePrograms;
}

function validateMmYyyy(val: string): string | null {
  if (!val || val.length < 7) return null;
  const m = val.match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return "Use MM/YYYY format";
  const month = parseInt(m[1], 10);
  const year = parseInt(m[2], 10);
  if (month < 1 || month > 12) return "Month must be 01–12";
  if (year < 1970) return "Year seems too far back — check the date";
  if (year > new Date().getFullYear()) return "Date cannot be in the future";
  return null;
}

function lenderDisplayFromName(programName: string): string {
  const n = (programName || "").toLowerCase();
  if (n.startsWith("summit") || n.includes("verus")) return "Summit";
  if (n.startsWith("everest") || n.includes("deephaven")) return "Everest";
  if (n.startsWith("denali") || n.includes("nqm")) return "Denali";
  return (programName || "").split(" ")[0] || "Other";
}

function renderMd(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  text.split(/(\*\*.+?\*\*|_[^_\n]+_)/gs).forEach((chunk, i) => {
    if (chunk.startsWith("**") && chunk.endsWith("**")) {
      nodes.push(<strong key={i}>{chunk.slice(2, -2)}</strong>);
    } else if (chunk.startsWith("_") && chunk.endsWith("_")) {
      nodes.push(
        <em key={i} className="not-italic text-[0.88em] text-muted-foreground/70">
          {chunk.slice(1, -1)}
        </em>,
      );
    } else {
      chunk.split("\n").forEach((line, j) => {
        if (j > 0) nodes.push(<br key={`${i}-${j}`} />);
        if (line) nodes.push(line);
      });
    }
  });
  return <>{nodes}</>;
}
function computeExactYearsSince(mmYyyy: string): string {
  const m = mmYyyy.match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const mo = parseInt(m[1], 10) - 1;
  const yr = parseInt(m[2], 10);
  const now = new Date();
  if (yr < 1900 || yr > now.getFullYear()) return "";
  const months = (now.getFullYear() - yr) * 12 + now.getMonth() - mo;
  if (months < 0) return "0";
  return (months / 12).toFixed(2);
}

function ChatFormModeHint() {
  return (
    <p className="mb-2 text-center text-[11px] leading-snug text-muted-foreground md:text-[12px]">
      Have a form or XML —{" "}
      <Link to="/form" className="font-semibold text-[#012a5b] hover:underline">
        Switch to Form Mode
      </Link>
    </p>
  );
}

// Form fields whose stored value equals the portfolio slot code verbatim — safe to
// mirror non-empty into the chat extract portfolio after a sidebar-edit cascade.
// (Other fields use display labels, e.g. "US Citizen" vs "us_citizen"; for those only
// CLEARS — empty strings — are mirrored, which are code-agnostic.)
const PORTFOLIO_VALUE_SAFE_FIELDS = new Set([
  "state",
  "stateCounty",
  "stateCity",
  "stateBorough",
  "stateZipCode",
  "isInBaltimoreCity",
  "isInIndianapolis",
  "isInPhiladelphia",
  "isInMemphis",
  "isInLubbock",
]);

// ── Main Component ─────────────────────────────────────────────────────────────

export const LoanWizard: FC<{
  showSources: boolean;
  resetToken?: number;
  intakeMode: "form" | "chat";
  /** Guided-intake mode for /form (URL-driven). "lo" = mandatory only, "underwriter" = + optionals. */
  formMode?: FormChatMode;
  onClearEnabledChange?: (enabled: boolean) => void;
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
  onViewingHistoryScenarioChange?: (viewing: boolean) => void;
  /** True while a saved vault scenario is open (not the list). */
  viewingHistoryScenario?: boolean;
  /** Start a brand-new scenario (from the vault's +New Scenario button). */
  onNewScenario?: () => void;
}> = ({
  showSources,
  resetToken,
  intakeMode,
  formMode = "lo",
  onClearEnabledChange,
  historyOpen = false,
  onHistoryOpenChange,
  onViewingHistoryScenarioChange,
  viewingHistoryScenario = false,
  onNewScenario,
}) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL || "").trim();
  const emptyForm = makeEmptyForm();
  const { sessionBoot, sessionRestoredRef } = useWizardSessionBoot(intakeMode);
  const interruptedSubmitRecoveryRef = useRef(false);

  // ── sidebar ──────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobileSidebarLayout());
  const [isMobileViewport, setIsMobileViewport] = useState(isMobileSidebarLayout);
  const profileFocusFieldRef = useRef<string | null>(null);
  const [sidebarGlowing, setSidebarGlowing] = useState(false);
  const [sidebarIntroVisible, setSidebarIntroVisible] = useState(false);
  const [sidebarContentVisible, setSidebarContentVisible] = useState(false);

  // ── reset confirmation ────────────────────────────────────────────
  const [scenarioChoiceOpen, setScenarioChoiceOpen] = useState(false);

  // ── form state ───────────────────────────────────────────────────
  const [form, setForm] = useState(() => ({ ...emptyForm, ...(sessionBoot?.form ?? {}) }));
  const [revealForm, setRevealForm] = useState(() => ({
    ...emptyForm,
    ...(sessionBoot?.form ?? {}),
  }));
  const formSyncRef = useRef(form);
  formSyncRef.current = form;

  useEffect(() => {
    const id = window.setTimeout(() => setRevealForm({ ...form }), QUESTIONNAIRE_REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [form]);

  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(
    () => sessionBoot?.activeStep ?? 1,
  );
  const [maxReachedStep, setMaxReachedStep] = useState<number>(() => sessionBoot?.activeStep ?? 1);
  // "start" = welcome; "first" = form; "chat" = conversational intake; "done" = results
  const [phase, setPhase] = useState<WizardPhase>(() =>
    resolveInitialPhase(intakeMode, sessionBoot),
  );
  const [chatIntakeStep, setChatIntakeStep] = useState<"questions" | null>(
    () => sessionBoot?.chatIntakeStep ?? null,
  );
  const [intakeInputUnlocked, setIntakeInputUnlocked] = useState(false);
  const [optionalPickerSelections, setOptionalPickerSelections] = useState<Record<string, string>>(
    {},
  );
  const [formSubmitted, setFormSubmitted] = useState(() => sessionBoot?.formSubmitted ?? false);
  const [, setIsTransitioning] = useState(false);
  const greetMsgIdRef = useRef<string | null>(null);
  const chatExpressOfferAnsweredRef = useRef(false);
  const chatOptionalOfferShownRef = useRef(false);
  const chatFreeTextFollowupShownRef = useRef(false);
  const chatFreeTextFollowupPendingRef = useRef(false);
  const [intakeCanSubmit, setIntakeCanSubmit] = useState(false);
  const [intakeQuickCount, setIntakeQuickCount] = useState<number | null>(null);
  const [intakeQuickCountLoading, setIntakeQuickCountLoading] = useState(false);
  const [intakeQuestionCount, setIntakeQuestionCount] = useState(0);
  // When true the PREVIEW_RESULT handler auto-asks the next question instead of showing chips
  const intakePreviewAutoContinueRef = useRef(false);
  // Chat-mode sidebar inline edit
  const [chatEditField, setChatEditField] = useState<string | null>(null);
  const [chatEditDraft, setChatEditDraft] = useState("");
  const [chatEditPending, setChatEditPending] = useState<{
    fieldKey: string;
    slotId: string;
    value: string;
    displayValue: string;
    label: string;
  } | null>(null);
  const [checklistValues, setChecklistValues] = useState<Record<string, string>>({});
  const [showPreSubmitPrompt, setShowPreSubmitPrompt] = useState(false);
  const [preSubmitNote, setPreSubmitNote] = useState("");
  const [scenarioRefineActive, setScenarioRefineActive] = useState(false);
  const [geoEval, setGeoEval] = useState<GeoEvaluateResponse | null>(null);
  const [geoWarnings, setGeoWarnings] = useState<GeoWarning[]>([]);

  // ── results / chat state ─────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() =>
    withoutTransientChatMessages((sessionBoot?.messages as Msg[]) ?? []),
  );
  const [eligiblePrograms, setEligiblePrograms] = useState<EligibleProgram[]>(
    () => (sessionBoot?.eligiblePrograms as EligibleProgram[]) ?? [],
  );
  const [nearMissPrograms, setNearMissPrograms] = useState<NearMissProgram[]>(() => {
    if (sessionBoot?.nearMissPrograms?.length) {
      return sessionBoot.nearMissPrograms as NearMissProgram[];
    }
    const tableMsg = [...((sessionBoot?.messages as Msg[]) ?? [])]
      .reverse()
      .find((m) => m.content.startsWith("ELIGIBILITY_TABLE:"));
    if (!tableMsg) return [];
    return parseEligibilityTableMessage(tableMsg.content)?.nearMisses ?? [];
  });
  const [showTableProgramCheckboxes, setShowTableProgramCheckboxes] = useState(
    () => sessionBoot?.showTableProgramCheckboxes ?? false,
  );
  const [eligibilityTableMsgId, setEligibilityTableMsgId] = useState<string | null>(
    () => sessionBoot?.eligibilityTableMsgId ?? null,
  );
  const RESULTS_HEADER_FULL = "Eligible Programs For your Scenario";
  const [resultsHeaderText, setResultsHeaderText] = useState<string>(() =>
    sessionBoot?.eligibilityTableMsgId ? RESULTS_HEADER_FULL : "",
  );
  const resultsHeaderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultsHeaderStreamedIdRef = useRef<string | null>(
    sessionBoot?.eligibilityTableMsgId ?? null,
  );
  const [detailsReady, setDetailsReady] = useState(() => sessionBoot?.detailsReady ?? false);
  const [chatStarted, setChatStarted] = useState(() => sessionBoot?.chatStarted ?? false);
  const [knowMoreDetailReady, setKnowMoreDetailReady] = useState(
    () => sessionBoot?.knowMoreDetailReady ?? false,
  );
  const activeKnowMoreMsgIdRef = useRef<string | null>(sessionBoot?.activeKnowMoreMsgId ?? null);
  const [thinkingLabel, setThinkingLabel] = useState("");
  const [eligibilityLabel, setEligibilityLabel] = useState("");
  const [sneakPeekOpen, setSneakPeekOpen] = useState(false);
  const [sneakPeekPrograms, setSneakPeekPrograms] = useState<EligibleProgram[]>([]);
  const [sneakPeekLoading, setSneakPeekLoading] = useState(false);
  // Sidebar "preview results" eye-toggle — flips the Eligible-Programs count to a live list
  const [sidebarPreviewOpen, setSidebarPreviewOpen] = useState(false);
  const [sidebarPreviewPrograms, setSidebarPreviewPrograms] = useState<EligibleProgram[]>([]);
  const [sidebarPreviewLoading, setSidebarPreviewLoading] = useState(false);
  const [ofacAlertOpen, setOfacAlertOpen] = useState(false);
  const [noProgramsMessageSuppressed, setNoProgramsMessageSuppressed] = useState(false);
  const editBaseFormRef = useRef<typeof emptyForm | null>(null);
  // Real-time quick-scan count from /api/eligibility/quick (SQL only, no Qdrant).
  // Starts at 30 so sidebar shows 30/30 before any scan fires; narrows as fields fill.
  const [quickCount, setQuickCount] = useState<number | null>(30);
  const [zeroNudgeOpen, setZeroNudgeOpen] = useState(false);
  const [zeroNudgeReason, setZeroNudgeReason] = useState("");
  const zeroNudgeDismissedSnapshotRef = useRef<string>("");
  /** Last quick-scan count before the API returned (for zero-program nudge attribution). */
  const prevQuickCountForNudgeRef = useRef<number | null>(30);
  /** Form snapshot when quick count was last > 0 — diff to see what caused a drop to 0. */
  const formSnapAtLastPositiveQuickCountRef = useRef<string>("");
  /** Set when a scan transitions from count > 0 to 0 (not when already at 0). */
  const pendingZeroNudgeTransitionRef = useRef(false);
  const [quickScanNonce, setQuickScanNonce] = useState(0);
  /** Bumped after restartIntake clears form — remounts FormChatFlow on the welcome screen. */
  const [formChatMountKey, setFormChatMountKey] = useState(0);
  const [profileGapsForced, setProfileGapsForced] = useState(false);
  const chatRepromptRef = useRef<((clearedFieldIds?: string[]) => void) | null>(null);
  /** Mirrors sidebar edits + cascade clears into the chat extract portfolio (registered by ChatConversationFlow). */
  const chatPortfolioSyncRef = useRef<((slots: Record<string, string>) => void) | null>(null);
  /** Renders an "X → Y" change card (+ cleared-values notice) in the chat thread after a sidebar edit. */
  const chatSidebarEchoRef = useRef<
    | ((
        changes: Array<{ label: string; from: string; to: string }>,
        clearedLabels?: string[],
      ) => void)
    | null
  >(null);
  /** Retained /chat intake thread — shown read-only above results after submit. */
  const [retainedChatThread, setRetainedChatThread] = useState<ChatThreadMsg[]>([]);
  const quickScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickScanAbortRef = useRef<AbortController | null>(null);
  const buildCreditEventRef = useRef<(snap: typeof emptyForm) => string>(() => "");
  const finishChatIntakeRef = useRef<(snapshot?: typeof emptyForm) => Promise<void>>(
    async () => {},
  );
  const [selectedProgram, setSelectedProgram] = useState(() => sessionBoot?.selectedProgram ?? "");
  const [detailsInput, setDetailsInput] = useState("");
  const [docChatActive, setDocChatActive] = useState(() => sessionBoot?.docChatActive ?? false);
  const [generalResultsChat, setGeneralResultsChat] = useState(
    () => sessionBoot?.generalResultsChat ?? false,
  );
  const [sessionId, setSessionId] = useState(() => sessionBoot?.sessionId ?? "");
  const [detailPhase, setDetailPhase] = useState<"none" | "complete">(
    () => sessionBoot?.detailPhase ?? "none",
  );
  const [editBoundaryPhase, setEditBoundaryPhase] = useState<"none" | "complete" | null>(null);
  // /form chat-card reskin: "lo" = mandatory-only, "underwriter" = + optional questions.
  // URL-driven (see /form route's ?mode=… param) — no in-UI toggle.
  const formChatMode = formMode;
  const [typingText, setTypingText] = useState<string | null>(null);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatIntakeProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eligibilityRerunTimerRef = useRef<number | null>(null);
  const knowMoreMetricsRefreshRef = useRef(false);
  // True once the first real eligibility results have been received in this session
  const eligibilityEverRanRef = useRef(sessionBoot?.eligiblePrograms?.length ? true : false);
  // Snapshot of results state saved when entering edit mode — restored by "Back to Results"
  const savedResultsSnapshotRef = useRef<{
    messages: Msg[];
    eligiblePrograms: EligibleProgram[];
    eligibilityTableMsgId: string | null;
  } | null>(null);
  /** Wizard state captured when vault opens — restored by vault Back after viewing a saved scenario. */
  type PreVaultSnapshot = {
    form: typeof emptyForm;
    revealForm: typeof emptyForm;
    phase: WizardPhase;
    formSubmitted: boolean;
    activeStep: 1 | 2 | 3 | 4 | 5 | 6;
    maxReachedStep: number;
    chatIntakeStep: "questions" | null;
    messages: Msg[];
    eligiblePrograms: EligibleProgram[];
    eligibilityTableMsgId: string | null;
    formChatMountKey: number;
    detailPhase: "none" | "complete";
    editBoundaryPhase: "none" | "complete" | null;
    quickCount: number | null;
    resultsHeaderText: string;
    lastSubmittedFormSnapshot: string;
    lastVaultSavedSnapshot: string;
    sidebarOpen: boolean;
    showTableProgramCheckboxes: boolean;
    detailsReady: boolean;
    chatStarted: boolean;
    knowMoreDetailReady: boolean;
    generalResultsChat: boolean;
    docChatActive: boolean;
    loading: boolean;
    eligibilityEverRan: boolean;
  };
  const preVaultSnapshotRef = useRef<PreVaultSnapshot | null>(null);
  const prevHistoryOpenRef = useRef(false);
  const viewingVaultScenarioRef = useRef(false);
  const lastSubmittedFormSnapshotRef = useRef(
    sessionBoot?.detailPhase === "complete"
      ? JSON.stringify({ ...emptyForm, ...(sessionBoot?.form ?? {}) })
      : "",
  );

  const [knowMoreActivated, setKnowMoreActivated] = useState(false);
  const [knowMoreHinted, setKnowMoreHinted] = useState(false);
  const [saveProfileStatus, setSaveProfileStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [saveProfileDialogOpen, setSaveProfileDialogOpen] = useState(false);
  /** Chat + results workspace — Save Scenario dialog centers here (not full viewport). */
  const [saveDialogHost, setSaveDialogHost] = useState<HTMLDivElement | null>(null);
  // When a vault scenario is opened via Edit, this holds its record id so Save
  // updates that record in place. Cloning / fresh scenarios leave it null
  // (Save → SaveProfileDialog → new record).
  const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null);

  const serializeFormSnapshot = (snap: typeof emptyForm) => JSON.stringify(snap);

  // Bumped whenever the submitted-form snapshot is (re)captured, so the dirty
  // memo below recomputes after a (re)submit even though it reads from a ref.
  const [submittedSnapshotToken, setSubmittedSnapshotToken] = useState(0);

  const captureSubmittedFormSnapshot = (snap?: typeof emptyForm) => {
    lastSubmittedFormSnapshotRef.current = serializeFormSnapshot(snap ?? formSyncRef.current);
    setSubmittedSnapshotToken((t) => t + 1);
  };

  const lastVaultSavedSnapshotRef = useRef("");
  const [vaultSavedSnapshotToken, setVaultSavedSnapshotToken] = useState(0);

  const captureVaultSavedSnapshot = (snap?: typeof emptyForm) => {
    lastVaultSavedSnapshotRef.current = serializeFormSnapshot(snap ?? formSyncRef.current);
    setVaultSavedSnapshotToken((t) => t + 1);
  };

  const clearVaultSavedSnapshot = () => {
    lastVaultSavedSnapshotRef.current = "";
    setVaultSavedSnapshotToken((t) => t + 1);
  };

  const formDirtySinceSubmit = useMemo(() => {
    if (!lastSubmittedFormSnapshotRef.current) return false;
    const inPostSubmitPhase = detailPhase === "complete" || (formSubmitted && phase === "done");
    if (!inPostSubmitPhase) return false;
    return serializeFormSnapshot(form) !== lastSubmittedFormSnapshotRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, detailPhase, formSubmitted, phase, submittedSnapshotToken]);

  /** False once this scenario snapshot is already in the vault — re-enables after edits. */
  const canSaveToVault = useMemo(() => {
    if (!lastVaultSavedSnapshotRef.current) return true;
    return serializeFormSnapshot(form) !== lastVaultSavedSnapshotRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, vaultSavedSnapshotToken]);

  /** Chat sidebar: profile changed since last eligibility run on the results panel. */
  const chatProfileDirty = useMemo(() => {
    if (intakeMode !== "chat" || phase !== "done" || !lastSubmittedFormSnapshotRef.current) {
      return false;
    }
    return serializeFormSnapshot(form) !== lastSubmittedFormSnapshotRef.current;
  }, [form, intakeMode, phase]);

  /** True once the profile differs from the last eligibility run (both modes). */
  const profileDirtySinceSubmit = useMemo(
    () => chatProfileDirty || formDirtySinceSubmit,
    [chatProfileDirty, formDirtySinceSubmit],
  );

  const eligibleProgramPool = useMemo(
    () => resolveEligibleProgramPool(messages, eligiblePrograms),
    [messages, eligiblePrograms],
  );

  // Parsed ELIGIBILITY_TABLE meta (geo/overlay exclusions) for the in-chat
  // /form results experience — the legacy results flow still emits the message.
  const eligibilityTableMeta = useMemo(() => {
    const msg = [...messages].reverse().find((m) => m.content.startsWith("ELIGIBILITY_TABLE:"));
    return msg ? parseEligibilityTableMessage(msg.content) : null;
  }, [messages]);

  const [confirmedParseMsgIds, setConfirmedParseMsgIds] = useState<Set<string>>(new Set());
  const [, setInferredFieldKeys] = useState<Set<string>>(new Set());

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const formTopRef = useRef<HTMLFormElement>(null);
  const wasStreamingRef = useRef(false);
  const intakeModeRef = useRef(intakeMode);
  intakeModeRef.current = intakeMode;
  // Tracks whether the sidebar has been auto-opened due to the first form input yet.
  // Reset to false on a fresh start so the sidebar stays collapsed until the user types.
  const formSidebarOpenedRef = useRef(!!sessionBoot);

  useEffect(() => {
    onClearEnabledChange?.(messages.some((m) => m.role === "user"));
  }, [messages, onClearEnabledChange]);

  const appendUserChat = (content: string) => {
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content }]);
  };

  const startChatIntakeProgress = () => {
    if (chatIntakeProgressIntervalRef.current) {
      clearInterval(chatIntakeProgressIntervalRef.current);
      chatIntakeProgressIntervalRef.current = null;
    }
    const first = CHAT_INTAKE_PROGRESS_WORDS[0];
    setMessages((m) => {
      const without = m.filter((msg) => msg.id !== CHAT_INTAKE_LOADING_MSG_ID);
      return [
        ...without,
        {
          id: CHAT_INTAKE_LOADING_MSG_ID,
          role: "assistant" as const,
          content: `LOADING:${first}…`,
        },
      ];
    });
    let i = 0;
    chatIntakeProgressIntervalRef.current = setInterval(() => {
      if (i >= CHAT_INTAKE_PROGRESS_WORDS.length - 1) {
        if (chatIntakeProgressIntervalRef.current) {
          clearInterval(chatIntakeProgressIntervalRef.current);
          chatIntakeProgressIntervalRef.current = null;
        }
        return;
      }
      i += 1;
      const word = CHAT_INTAKE_PROGRESS_WORDS[i];
      setMessages((m) =>
        m.map((msg) =>
          msg.id === CHAT_INTAKE_LOADING_MSG_ID ? { ...msg, content: `LOADING:${word}…` } : msg,
        ),
      );
    }, 1800);
  };

  const stopChatIntakeProgress = () => {
    if (chatIntakeProgressIntervalRef.current) {
      clearInterval(chatIntakeProgressIntervalRef.current);
      chatIntakeProgressIntervalRef.current = null;
    }
    setMessages((m) => m.filter((msg) => msg.id !== CHAT_INTAKE_LOADING_MSG_ID));
  };

  // ── streaming helper ──────────────────────────────────────────────
  const streamMessage = (
    text: string,
    mode: "replace" | "append" = "append",
    delayMs = 0,
    onComplete?: () => void,
    onProgress?: (currentText: string) => void,
    msgId?: string,
  ) => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingText(null);
    setStreamingMsgId(null);
    const run = () => {
      const words = text.split(" ");
      let i = 0;
      setTypingText("");
      typingIntervalRef.current = setInterval(() => {
        i++;
        const current = words.slice(0, i).join(" ");
        setTypingText(current);
        onProgress?.(current);
        if (i >= words.length) {
          clearInterval(typingIntervalRef.current!);
          typingIntervalRef.current = null;
          setTypingText(null);
          const id = msgId ?? crypto.randomUUID();
          const msg = { id, role: "assistant" as const, content: text };
          if (mode === "replace") setMessages([msg]);
          else setMessages((m) => [...m, msg]);
          onComplete?.();
        }
      }, 35);
    };
    if (delayMs > 0) window.setTimeout(run, delayMs);
    else run();
  };

  // Instantly set (or remove) the wizard-transition message without streaming — used on Back.
  const setTransitionMsg = (text: string | null) => {
    setMessages((m) => {
      if (text === null) return m.filter((msg) => msg.id !== "wizard-transition");
      const updated: Msg = {
        id: "wizard-transition",
        role: "assistant",
        content: text,
        isTransition: true,
      };
      const idx = m.findIndex((msg) => msg.id === "wizard-transition");
      if (idx >= 0) return m.map((msg) => (msg.id === "wizard-transition" ? updated : msg));
      return [...m, updated];
    });
  };

  // Stream text in-place as a messages[] entry (always renders at top, not at bottom like typingText)
  const streamInPlace = (
    text: string,
    onComplete?: () => void,
    onProgress?: (currentText: string) => void,
  ) => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingText(null);
    const id = crypto.randomUUID();
    setStreamingMsgId(id);
    setMessages([{ id, role: "assistant" as const, content: "" }]);
    const words = text.split(" ");
    let i = 0;
    typingIntervalRef.current = setInterval(() => {
      i++;
      const current = words.slice(0, i).join(" ");
      setMessages([{ id, role: "assistant" as const, content: current }]);
      onProgress?.(current);
      if (i >= words.length) {
        clearInterval(typingIntervalRef.current!);
        typingIntervalRef.current = null;
        setStreamingMsgId(null);
        onComplete?.();
      }
    }, 35);
  };

  // Session restore: legacy know-more flag (FormChatFlow owns results UI on remount).
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    if (sessionBoot?.chatStarted && !sessionBoot.knowMoreDetailReady) {
      const detailMsg = [...sessionBoot.messages]
        .reverse()
        .find((m) => m.content.startsWith("PROGRAM_DETAIL:"));
      if (detailMsg) {
        activeKnowMoreMsgIdRef.current = detailMsg.id;
        setKnowMoreDetailReady(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab refresh during an in-flight /form submit — resume eligibility instead of
  // landing on the last intake question with no results.
  useEffect(() => {
    if (interruptedSubmitRecoveryRef.current || !sessionBoot) return;
    if (intakeMode !== "form") return;
    if (!formSubmitted || detailPhase !== "none" || phase !== "done" || loading) return;
    interruptedSubmitRecoveryRef.current = true;
    void submitForm({ preventDefault: () => {} } as React.FormEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist progress so refresh resumes where the user left off
  usePersistWizardSession(
    intakeMode,
    () => ({
      phase,
      form: form as unknown as WizardPersistedSession["form"],
      messages: withoutTransientChatMessages(messages),
      activeStep,
      formSubmitted,
      chatIntakeStep,
      eligiblePrograms,
      nearMissPrograms,
      showTableProgramCheckboxes,
      eligibilityTableMsgId,
      detailsReady,
      chatStarted,
      knowMoreDetailReady,
      activeKnowMoreMsgId: activeKnowMoreMsgIdRef.current,
      selectedProgram,
      docChatActive,
      generalResultsChat,
      sessionId,
      detailPhase,
      sidebarOpen: isMobileViewport ? false : sidebarOpen,
    }),
    [
      intakeMode,
      phase,
      form,
      messages,
      activeStep,
      formSubmitted,
      chatIntakeStep,
      eligiblePrograms,
      nearMissPrograms,
      showTableProgramCheckboxes,
      eligibilityTableMsgId,
      detailsReady,
      chatStarted,
      knowMoreDetailReady,
      selectedProgram,
      docChatActive,
      generalResultsChat,
      sessionId,
      detailPhase,
      sidebarOpen,
      isMobileViewport,
    ],
  );

  // Stream results header text when eligibility table first appears
  useEffect(() => {
    if (!eligibilityTableMsgId) {
      if (resultsHeaderTimerRef.current) {
        clearInterval(resultsHeaderTimerRef.current);
        resultsHeaderTimerRef.current = null;
      }
      setResultsHeaderText("");
      resultsHeaderStreamedIdRef.current = null;
      return;
    }
    if (resultsHeaderStreamedIdRef.current === eligibilityTableMsgId) return;
    if (sessionRestoredRef.current) {
      resultsHeaderStreamedIdRef.current = eligibilityTableMsgId;
      setResultsHeaderText(RESULTS_HEADER_FULL);
      return;
    }
    resultsHeaderStreamedIdRef.current = eligibilityTableMsgId;
    const words = RESULTS_HEADER_FULL.split(" ");
    let i = 0;
    setResultsHeaderText("");
    resultsHeaderTimerRef.current = setInterval(() => {
      i++;
      setResultsHeaderText(words.slice(0, i).join(" "));
      if (i >= words.length) {
        clearInterval(resultsHeaderTimerRef.current!);
        resultsHeaderTimerRef.current = null;
      }
    }, 40);
    return () => {
      if (resultsHeaderTimerRef.current) {
        clearInterval(resultsHeaderTimerRef.current);
        resultsHeaderTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibilityTableMsgId]);

  const scrollWizardFormToTop = () => {
    const run = () => {
      const container = scrollContainerRef.current;
      const formTop = formTopRef.current;
      if (!container || !formTop) return;
      const containerTop = container.getBoundingClientRect().top;
      const formTopY = formTop.getBoundingClientRect().top;
      const top = formTopY - containerTop + container.scrollTop - 12;
      container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  };

  /** Keep the latest revealed field in view as the wizard grows (mobile + desktop). */
  const scrollWizardFormFollowFill = () => {
    const container = scrollContainerRef.current;
    const form = formTopRef.current;
    if (!container) return;
    // Single rAF — layout is already settled by the time this fires (called after reveal debounce)
    requestAnimationFrame(() => {
      const margin = 72;
      const cRect = container.getBoundingClientRect();
      const lastField = form?.querySelector<HTMLElement>(".ff:last-of-type");
      if (lastField) {
        const fRect = lastField.getBoundingClientRect();
        if (fRect.bottom > cRect.bottom - margin) {
          const target = container.scrollTop + (fRect.bottom - cRect.bottom) + margin;
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          container.scrollTo({
            top: Math.min(Math.max(0, target), maxScroll),
            behavior: "auto",
          });
          return;
        }
      }
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll > container.scrollTop + 4) {
        container.scrollTo({ top: maxScroll, behavior: "auto" });
      }
    });
  };

  /** Scroll the chat/results thread to the latest content (Know More, follow-up Q&A). */
  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const run = () => {
      const container = scrollContainerRef.current;
      if (container) {
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTo({ top: maxScroll, behavior });
      }
      bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    };
    requestAnimationFrame(() => {
      run();
      window.setTimeout(run, 150);
    });
  }, []);

  // After Next / step change, show the top of the wizard form (not the footer buttons)
  useEffect(() => {
    if (phase !== "first" || formSubmitted) return;
    // Two passes: first at 80ms (step content swap), second at 350ms (form first-appear after animations)
    const t1 = window.setTimeout(scrollWizardFormToTop, 80);
    const t2 = window.setTimeout(scrollWizardFormToTop, 350);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [activeStep, phase, formSubmitted]);

  // iOS: when an input is focused the virtual keyboard shrinks the viewport — scroll the
  // focused element into view inside our container (the browser can't do it through overflow:hidden parents)
  useEffect(() => {
    if (phase !== "first") return;
    const container = scrollContainerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (!["input", "select", "textarea"].includes(tag ?? "")) return;
      if (!container.contains(target)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const cRect = container.getBoundingClientRect();
        const tRect = target.getBoundingClientRect();
        // Extra clearance so the field isn't hidden behind the keyboard
        const clearance = 140;
        if (tRect.bottom > cRect.bottom - clearance) {
          container.scrollTop += tRect.bottom - cRect.bottom + clearance;
        } else if (tRect.top < cRect.top + 8) {
          container.scrollTop -= cRect.top - tRect.top + 8;
        }
      }, 320);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      if (timer) clearTimeout(timer);
    };
  }, [phase]);

  // Scroll down as fields reveal while filling the legacy step wizard (unused — FormChatFlow owns intake).
  useEffect(() => {
    if (phase !== "first" || formSubmitted) return;
    const t = window.setTimeout(scrollWizardFormFollowFill, 30);
    return () => window.clearTimeout(t);
  }, [revealForm, activeStep, sneakPeekOpen, phase, formSubmitted]);

  useEffect(() => {
    if (phase !== "first" || formSubmitted) return;
    const root = scrollContentRef.current;
    if (!root) return;
    let scrollTimer: number | null = null;
    const ro = new ResizeObserver(() => {
      if (scrollTimer) window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        scrollWizardFormFollowFill();
        scrollTimer = null;
      }, 30);
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
      if (scrollTimer) window.clearTimeout(scrollTimer);
    };
  }, [phase, formSubmitted, activeStep]);

  // Scroll to bottom when content is added (messages, results) — not on form field reveal
  useEffect(() => {
    if (phase === "start" && streamingMsgId) return;
    if (phase === "first") return;
    scrollChatToBottom("smooth");
  }, [
    messages,
    phase,
    streamingMsgId,
    showTableProgramCheckboxes,
    detailsReady,
    eligibilityLabel,
    thinkingLabel,
    scrollChatToBottom,
  ]);

  // Scroll once when streaming starts — NOT on every word (avoids competing smooth-scroll jank)
  useEffect(() => {
    const isStreaming = typingText !== null;
    if (isStreaming && !wasStreamingRef.current) {
      scrollChatToBottom("smooth");
    }
    wasStreamingRef.current = isStreaming;
  }, [typingText, scrollChatToBottom]);

  // Fade sidebar content in after the width transition finishes
  useEffect(() => {
    if (sidebarOpen) {
      if (intakeMode === "chat" && phase === "start") {
        setSidebarContentVisible(true);
        return;
      }
      const t = window.setTimeout(() => setSidebarContentVisible(true), 460);
      return () => window.clearTimeout(t);
    }
    setSidebarContentVisible(false);
  }, [intakeMode, phase, sidebarOpen]);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_SIDEBAR_MQ);
    const sync = () => {
      const mobile = mq.matches;
      setIsMobileViewport(mobile);
      if (mobile) setSidebarOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!isMobileViewport || !sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobileViewport, sidebarOpen]);

  // History list is full-width — collapse the legacy profile rail when browsing it.
  useEffect(() => {
    if (historyOpen) setSidebarOpen(false);
  }, [historyOpen]);

  // Auto-expand sidebar the first time the user fills in any form field (form + chat).
  useEffect(() => {
    if (formSidebarOpenedRef.current) return;
    if (phase !== "first" && !(intakeMode === "chat" && phase !== "done")) return;
    const hasAny = Object.values(form).some((v) => String(v ?? "").trim() !== "");
    if (hasAny) {
      formSidebarOpenedRef.current = true;
      if (isDesktopSidebarLayout()) {
        setSidebarOpen(true);
        setSidebarIntroVisible(true);
      }
    }
  }, [form, phase, intakeMode]);

  // Results refresh only via Resubmit / form Submit — avoids stacking duplicate result cards.

  const triggerQuickEligibilityScan = useCallback(() => {
    setQuickScanNonce((n) => n + 1);
  }, []);

  // Background quick eligibility scan — 400ms debounce (form + chat intake).
  useEffect(() => {
    if (phase === "done") return;
    const snap = formSyncRef.current;
    if (!formHasQuickScanInput(snap)) return;

    if (quickScanTimerRef.current) clearTimeout(quickScanTimerRef.current);

    quickScanTimerRef.current = setTimeout(() => {
      quickScanAbortRef.current?.abort();
      quickScanAbortRef.current = new AbortController();
      const signal = quickScanAbortRef.current.signal;
      const creditEv = buildCreditEventRef.current(snap);
      const payload = buildQuickScanPayloadFromForm(snap, creditEv);

      postEligibilityQuick(apiBase, payload, { signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: QuickEligibilityApiResponse | null) => {
          if (!data || typeof data.count !== "number") return;
          const prevCount = prevQuickCountForNudgeRef.current;
          if (data.count > 0) {
            formSnapAtLastPositiveQuickCountRef.current = JSON.stringify(formSyncRef.current);
            pendingZeroNudgeTransitionRef.current = false;
          } else if ((prevCount ?? 0) > 0) {
            pendingZeroNudgeTransitionRef.current = true;
          }
          prevQuickCountForNudgeRef.current = data.count;
          setQuickCount(data.count);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
        });
    }, 400);

    return () => {
      if (quickScanTimerRef.current) clearTimeout(quickScanTimerRef.current);
    };
  }, [
    apiBase,
    phase,
    intakeMode,
    quickScanNonce,
    form.ltv,
    form.loanAmount,
    form.valueSalesPrice,
    form.decisionCreditScore,
    form.occupancy,
    form.loanPurpose,
    form.propertyType,
    form.state,
    form.documentationType,
    form.estimatedDti,
    form.dscr,
    form.prepaymentTerms,
    form.creditEventCategory,
    form.creditEventType,
    form.yearsSinceCreditEvent,
    form.creditEventDate,
    form.isSecondLien,
    form.lienPosition,
    form.secondLienProduct,
    form.primaryLoanPurpose,
    form.cltv,
    form.citizenship,
    form.firstTimeHomebuyer,
    form.firstTimeInvestor,
    form.investmentIncomePath,
    form.existingSecondLien,
    form.existingSecondLienBalance,
    form.stateCounty,
    form.stateCity,
    form.stateBorough,
    form.stateZipCode,
    form.hasCreditEvent,
    form.creditEvents,
    form.paymentHistory,
    form.isRuralProperty,
    form.acreage,
    form.hiLavaZone,
    form.nonOccupantCoBorrower,
    form.combinedDti,
    form.visaType,
    form.visaTypeOther,
    form.visaCategory,
    form.ofacSanctioned,
    form.hasUsCredit,
    form.establishedPrimaryRes,
    form.rentalType,
    form.prepayStepdown,
    form.listingSeasoning,
    form.powerOfAttorney,
    form.nonArmsLength,
    form.loanTerm,
    form.interestOnlyPref,
    form.rateTypePref,
    form.isInBaltimoreCity,
    form.isInPhiladelphia,
    form.isInIndianapolis,
    form.isInMemphis,
    form.isInLubbock,
  ]);

  // Track inferred field keys from PARSE_CONFIRM messages for sidebar status icons
  useEffect(() => {
    const lastParseConfirm = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content.startsWith("PARSE_CONFIRM:"));
    if (!lastParseConfirm) return;
    try {
      const payload = JSON.parse(lastParseConfirm.content.slice("PARSE_CONFIRM:".length)) as {
        inferred?: Array<{ fieldKey: string }>;
      };
      const keys = (payload.inferred ?? []).map((f) => f.fieldKey);
      if (keys.length > 0) {
        setInferredFieldKeys((prev) => {
          const next = new Set(prev);
          keys.forEach((k) => next.add(k));
          return next;
        });
      }
    } catch {
      /* ignore */
    }
  }, [messages]);

  // Step 5 — re-run full eligibility whenever any preference field changes
  useEffect(() => {
    if (activeStep !== 5) return;
    void refreshSidebarCount(form);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.loanTerm,
    form.interestOnlyPref,
    form.rateTypePref,
    form.firstTimeHomebuyer,
    activeStep,
  ]);

  // Track the highest step the user has reached so progress-bar clicks are gated correctly
  useEffect(() => {
    setMaxReachedStep((prev) => Math.max(prev, activeStep));
  }, [activeStep]);

  // Show OFAC alert when sanctioned country is selected
  useEffect(() => {
    if (form.ofacSanctioned === "Yes") setOfacAlertOpen(true);
  }, [form.ofacSanctioned]);

  // Lift suppression of "no programs" message after 5 fields changed since Edit
  useEffect(() => {
    if (!editBaseFormRef.current || !noProgramsMessageSuppressed) return;
    const base = editBaseFormRef.current;
    const changedCount = Object.keys(form).filter(
      (k) => (form as Record<string, unknown>)[k] !== (base as Record<string, unknown>)[k],
    ).length;
    if (changedCount >= 5) setNoProgramsMessageSuppressed(false);
  }, [form, noProgramsMessageSuppressed]);

  // ── reset ─────────────────────────────────────────────────────────

  const restartIntake = (mode: "form" | "chat") => {
    clearWizardSession();
    stopChatIntakeProgress();
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingText(null);
    setStreamingMsgId(null);
    setPhase(mode === "form" ? "first" : "start");
    setChatIntakeStep(null);
    setSidebarOpen(isDesktopSidebarLayout());
    setSidebarGlowing(false);
    setSidebarIntroVisible(false);
    formSidebarOpenedRef.current = mode === "form";
    setQuickCount(30);
    prevQuickCountForNudgeRef.current = 30;
    formSnapAtLastPositiveQuickCountRef.current = "";
    pendingZeroNudgeTransitionRef.current = false;
    setZeroNudgeOpen(false);
    setZeroNudgeReason("");
    zeroNudgeDismissedSnapshotRef.current = "";
    eligibilityEverRanRef.current = false;
    lastSubmittedFormSnapshotRef.current = "";
    lastVaultSavedSnapshotRef.current = "";
    setVaultSavedSnapshotToken((t) => t + 1);
    savedResultsSnapshotRef.current = null;
    setFormSubmitted(false);
    setActiveStep(1);
    setMaxReachedStep(1);
    setLoading(false);
    setForm({ ...emptyForm });
    setRevealForm({ ...emptyForm });
    setEligiblePrograms([]);
    setNearMissPrograms([]);
    setShowTableProgramCheckboxes(false);
    setEligibilityTableMsgId(null);
    setDetailsReady(false);
    setChatStarted(false);
    setKnowMoreDetailReady(false);
    activeKnowMoreMsgIdRef.current = null;
    setSelectedProgram("");
    setDetailsInput("");
    setDocChatActive(false);
    setGeneralResultsChat(false);
    setSessionId("");
    setEligibilityLabel("");
    setThinkingLabel("");
    setDetailPhase("none");
    setEditBoundaryPhase(null);
    setIsTransitioning(false);
    greetMsgIdRef.current = null;
    setScenarioChoiceOpen(false);
    setConfirmedParseMsgIds(new Set());
    setInferredFieldKeys(new Set());
    chatExpressOfferAnsweredRef.current = false;
    chatOptionalOfferShownRef.current = false;
    chatFreeTextFollowupShownRef.current = false;
    chatFreeTextFollowupPendingRef.current = false;
    setIntakeCanSubmit(false);
    setIntakeQuickCount(null);
    setIntakeQuickCountLoading(false);
    setIntakeQuestionCount(0);
    intakePreviewAutoContinueRef.current = false;
    setScenarioRefineActive(false);
    setMessages([]);
    setRetainedChatThread([]);
    setSaveProfileStatus("idle");
    onViewingHistoryScenarioChange?.(false);
    viewingVaultScenarioRef.current = false;
    preVaultSnapshotRef.current = null;
    // Remount FormChatFlow so chat + sidebar always restart together (form intake and results).
    setProfileGapsForced(false);
    setFormChatMountKey((k) => k + 1);
  };

  const resetAll = () => {
    setEditingHistoryId(null);
    restartIntake(intakeModeRef.current);
  };

  /** True while a saved vault scenario is open (view or edit). */
  const isVaultScenarioOpen = () =>
    viewingHistoryScenario || editingHistoryId != null || viewingVaultScenarioRef.current;

  /**
   * Reset / New Scenario from the UI. When a vault scenario is open, detach without
   * writing to that record and route through the page-level new-scenario handler
   * (home welcome). Otherwise wipe local state in place.
   */
  const requestFreshStart = useCallback(() => {
    if (isVaultScenarioOpen()) {
      if (onNewScenario) onNewScenario();
      else resetAll();
      return;
    }
    resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingHistoryScenario, editingHistoryId, onNewScenario]);

  // Chat-mode Reset (sidebar pill + pre-submit row) confirms via an in-app modal,
  // matching FormChatFlow's own reset dialog. FormChatFlow call sites skip this —
  // they confirm internally before calling requestFreshStart.
  const [confirmChatResetOpen, setConfirmChatResetOpen] = useState(false);
  const requestFreshStartConfirmed = useCallback(() => {
    setConfirmChatResetOpen(true);
  }, []);

  const handleEditAfterNoPrograms = () => {
    editBaseFormRef.current = { ...form };
    setNoProgramsMessageSuppressed(true);
    setActiveStep(1);
  };

  useLayoutEffect(() => {
    if (resetToken && resetToken > 0) resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  // Header Form/Chat toggle — full restart when mode changes
  const prevIntakeModeRef = useRef(intakeMode);
  useEffect(() => {
    if (prevIntakeModeRef.current === intakeMode) return;
    prevIntakeModeRef.current = intakeMode;
    restartIntake(intakeMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakeMode]);

  // Load unified geo follow-up config — bump revision so sidebar geo rows (county, etc.) render.
  const [geoConfigRevision, setGeoConfigRevision] = useState(0);
  useEffect(() => {
    void fetchGeoConfig()
      .then(() => setGeoConfigRevision((v) => v + 1))
      .catch((err) => console.error("fetchGeoConfig:", err));
  }, []);

  // Re-evaluate geo warnings / hard blocks when location fields change
  useEffect(() => {
    if (!form.state?.trim()) {
      setGeoEval(null);
      setGeoWarnings([]);
      return;
    }
    const t = window.setTimeout(() => {
      void evaluateGeoFromWizard(form)
        .then((res) => {
          setGeoEval(res);
          setGeoWarnings(res.warnings);
        })
        .catch(() => {
          setGeoEval(null);
          setGeoWarnings([]);
        });
    }, 300);
    return () => window.clearTimeout(t);
  }, [
    form.state,
    form.occupancy,
    form.rentalType,
    form.stateCounty,
    form.stateCity,
    form.stateBorough,
    form.stateZipCode,
    form.isInBaltimoreCity,
    form.isInIndianapolis,
    form.isInPhiladelphia,
    form.isInMemphis,
    form.isInLubbock,
  ]);

  // ── profile sidebar → form edit (read-only summary; edits in form only) ──

  const clearEligibilityResults = () => {
    setKnowMoreActivated(false);
    setKnowMoreHinted(false);
    setEligiblePrograms([]);
    setNearMissPrograms([]);
    setShowTableProgramCheckboxes(false);
    setEligibilityTableMsgId(null);
    setDetailsReady(false);
    setChatStarted(false);
    setKnowMoreDetailReady(false);
    activeKnowMoreMsgIdRef.current = null;
    setSelectedProgram("");
    setDetailsInput("");
    setDocChatActive(false);
    setGeneralResultsChat(false);
    setSessionId("");
  };

  const clearResultsThread = () => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingText(null);
    setStreamingMsgId(null);
    setMessages([]);
    setEligibilityLabel("");
    setThinkingLabel("");
  };

  const isPostEligibilityResultMessage = (msg: Msg): boolean => {
    const c = msg.content;
    if (msg.role === "user" && c.startsWith("Know more:")) return true;
    return (
      c.startsWith("ELIGIBILITY_TABLE:") ||
      c.startsWith("PROGRAM_DETAIL:") ||
      c.startsWith("DOC_CHAT_INTRO:") ||
      c === GOOD_NEWS_RESULTS_MSG ||
      c.startsWith("**No Programs Found.**") ||
      c === BACK_AT_RESULTS_MSG ||
      c.includes("back at your program results") ||
      (c.startsWith("LOADING:") && msg.id !== CHAT_INTAKE_LOADING_MSG_ID)
    );
  };

  const handleChatSidebarResubmit = async () => {
    if (!profileDirtySinceSubmit || loading) return;
    if (!profileReadyForResubmit) {
      setProfileGapsForced(true);
      toast.error("Please complete the required fields highlighted in your Mortgage Profile.");
      chatRepromptRef.current?.();
      return;
    }
    const snap = { ...formSyncRef.current };
    if (!snap.creditEventCategory.trim()) snap.creditEventCategory = "None";
    if (!snap.paymentHistory.trim()) snap.paymentHistory = "0x30";
    const hardBlock = (await evaluateGeoFromWizard(snap).catch(() => geoEval))?.hard_block;
    if (hardBlock) {
      toast.error(hardBlock);
      return;
    }

    if (eligibilityRerunTimerRef.current) {
      window.clearTimeout(eligibilityRerunTimerRef.current);
      eligibilityRerunTimerRef.current = null;
    }
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingText(null);
    setStreamingMsgId(null);

    clearEligibilityResults();
    setPhase("done");
    setDetailPhase("complete");
    setFormSubmitted(true);
    setNoProgramsMessageSuppressed(false);
    editBaseFormRef.current = null;
    setResultsHeaderText("");
    resultsHeaderStreamedIdRef.current = null;

    setMessages((m) => {
      const kept = m.filter((msg) => !isPostEligibilityResultMessage(msg));
      return [
        ...kept,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: "Rerunning with changed inputs from Sidebar…",
        },
      ];
    });

    const { docForApi, dtiForApi, prepForApi } = getApiValuesFromForm(snap);
    const creditEv = buildCreditEventFromForm(snap);
    await runEligibility({
      docForApi,
      dtiForApi,
      prepForApi,
      creditEv,
      formSnap: snap,
      showLoadingMsg: true,
    });
  };

  const resubmitEligibility = async () => {
    const snap =
      intakeMode === "form"
        ? { ...formSyncRef.current, ...formChatConditionsDefaults(formSyncRef.current) }
        : formSyncRef.current;
    if (!mandatoryComplete(snap) && !isFormComplete) {
      setProfileGapsForced(true);
      toast.error("Please complete the required fields highlighted in your Mortgage Profile.");
      return;
    }
    if (eligibilityRerunTimerRef.current) {
      window.clearTimeout(eligibilityRerunTimerRef.current);
      eligibilityRerunTimerRef.current = null;
    }
    savedResultsSnapshotRef.current = null;
    clearResultsThread();
    clearEligibilityResults();
    setPhase("done");
    setFormSubmitted(true);
    setDetailPhase("complete");
    setEditBoundaryPhase(null);
    setLoading(true);

    const stateLabel = STATES.find((s) => s.code === form.state)?.label || form.state;
    const scanningLabel = `Scanning programs for your scenario${form.state ? ` in ${stateLabel}` : ""}…`;
    setMessages([
      {
        id: ELIGIBILITY_SCAN_MSG_ID,
        role: "assistant",
        content: `LOADING:${scanningLabel}`,
      },
    ]);

    const { docForApi, dtiForApi, prepForApi } = getApiValues();
    const creditEv = buildCreditEventApi();
    await runEligibility({
      docForApi,
      dtiForApi,
      prepForApi,
      creditEv,
      showLoadingMsg: false,
      removeMsgIds: [ELIGIBILITY_SCAN_MSG_ID],
      replaceThread: true,
    });
  };

  const backToResults = () => {
    const formSnapshot = lastSubmittedFormSnapshotRef.current;
    const resultsSnapshot = savedResultsSnapshotRef.current;
    if (!formSnapshot || !resultsSnapshot) return;
    const restoredForm = JSON.parse(formSnapshot) as typeof emptyForm;
    setForm(restoredForm);
    setRevealForm(restoredForm);
    formSyncRef.current = restoredForm;
    setMessages(resultsSnapshot.messages);
    setEligiblePrograms(resultsSnapshot.eligiblePrograms);
    setEligibilityTableMsgId(resultsSnapshot.eligibilityTableMsgId);
    eligibilityEverRanRef.current = true;
    setPhase("done");
    setFormSubmitted(true);
    setDetailPhase("complete");
    setEditBoundaryPhase(null);
    setLoading(false);
  };

  const appendAssistantChat = (content: string) => {
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant" as const, content }]);
  };

  // Streams plain text word-by-word directly into the messages[] array.
  // Calls onComplete(msgId) when done; caller can then mutate the message
  // (e.g. replace plain text with a structured INTAKE_QUESTION card).
  const streamAppendInPlace = (text: string, onComplete?: (id: string) => void) => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    const id = crypto.randomUUID();
    setMessages((m) => [...m, { id, role: "assistant" as const, content: "" }]);
    const words = text.split(" ");
    let i = 0;
    typingIntervalRef.current = setInterval(() => {
      i++;
      const cur = words.slice(0, i).join(" ");
      setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, content: cur } : msg)));
      if (i >= words.length) {
        clearInterval(typingIntervalRef.current!);
        typingIntervalRef.current = null;
        onComplete?.(id);
      }
    }, 35);
  };

  const applyScenarioNotesDelta = (raw: unknown[]): void => {
    const added = sessionNotesFromDelta(raw);
    if (added.length === 0) return;
    setForm((s) => {
      const merged = mergeScenarioNotesText(s.scenarioNotes, added);
      const next = { ...s, scenarioNotes: merged };
      formSyncRef.current = next;
      return next;
    });
  };

  /** Stage a sidebar edit for chat confirmation before applying. */
  const stageIntakeEdit = (
    fieldKey: string,
    slotId: string,
    value: string,
    displayValue: string,
    label: string,
  ): void => {
    setChatEditField(null);
    setChatEditDraft("");
    setChatEditPending({ fieldKey, slotId, value, displayValue, label });
  };

  /** Apply a confirmed chat-sidebar edit — patches form + re-runs quick scan. */
  const callIntakeEditSlot = async (
    slotId: string,
    value: string,
    label: string,
    displayValue: string,
  ): Promise<void> => {
    setChatEditPending(null);
    appendUserChat(`Change ${label} to: ${displayValue}`);
    // Value / loan / LTV / CLTV are linked — route through the triangle so editing one
    // (e.g. LTV) recomputes the others (e.g. the loan amount). Everything else is a plain patch.
    const triSource: Record<string, LoanTriSource> = {
      property_value: "valueSalesPrice",
      loan_amount: "loanAmount",
      ltv: "ltv",
      cltv: "cltv",
    };
    const source = triSource[slotId];
    const prevDisplay = (() => {
      const f = formSyncRef.current as unknown as Record<string, string>;
      const key = source ?? Object.keys(portfolioToFormPatch({ [slotId]: value }))[0];
      return String((key && f[key]) ?? "").trim();
    })();
    // Field ids this edit's cascade CLEARED (emptied or reset to "No preference") —
    // the chat reprompt resets only these, so unrelated edits keep the user's place.
    let cascadeClearedIds: string[] = [];
    if (source) {
      const next = computeLoanTriForm(formSyncRef.current, source, value);
      formSyncRef.current = next;
      setForm(next);
      chatPortfolioSyncRef.current?.({
        property_value: next.valueSalesPrice,
        loan_amount: next.loanAmount,
        ltv: next.ltv,
        cltv: next.cltv,
      });
    } else {
      const snap = formSyncRef.current;
      const patch = portfolioToFormPatch({ [slotId]: value }, { form: snap });
      if (Object.keys(patch).length === 0) return;
      const cascade = buildCascadePatchForFormEdit(snap, slotId, patch);
      const next = { ...snap, ...patch, ...cascade };
      formSyncRef.current = next;
      setForm(next);
      // Mirror the edit + cascade CLEARS into the chat portfolio, else the next
      // extract turn reverts this edit / resurrects the cleared values. Non-empty
      // values are mirrored only for fields whose form value equals the slot code.
      const slots: Record<string, string> = { [slotId]: value };
      for (const [k, v] of Object.entries({ ...patch, ...cascade })) {
        if (typeof v !== "string") continue;
        const slot = portfolioSlotForFormField(k);
        if (!slot) continue;
        if (v === "" || PORTFOLIO_VALUE_SAFE_FIELDS.has(k)) slots[slot] = v;
      }
      chatPortfolioSyncRef.current?.(slots);
      cascadeClearedIds = Object.entries(cascade)
        .filter(([, v]) => typeof v === "string" && (v.trim() === "" || v === "No preference"))
        .map(([k]) => k);
    }
    triggerQuickEligibilityScan();
    // Echo the edit as a "X → Y" change card with a notice for anything the cascade
    // cleared; the reprompt then re-asks cleared fields (or returns to the same step).
    const clearedLabels = cascadeClearedIds
      .map((k) => chatFieldCaptureLabel(k))
      .filter((l): l is string => !!l);
    chatSidebarEchoRef.current?.([{ label, from: prevDisplay, to: displayValue }], clearedLabels);
    chatRepromptRef.current?.(cascadeClearedIds);
    appendAssistantChat(
      `INTAKE_CAPTURED:${JSON.stringify({
        text: "Updated —",
        fields: [{ label, value: displayValue }],
      })}`,
    );
  };

  const buildCreditEventFromForm = (snap: typeof emptyForm) => {
    const cat = snap.creditEventCategory.trim();
    const advanced = (snap.creditEvents ?? [])
      .map((ev) => {
        const yrs = snap.creditEventYears?.[ev]?.trim();
        return yrs ? `${ev} ${yrs}` : ev;
      })
      .join("; ");
    if ((!cat || cat === "None") && !advanced) return "";
    if ((!cat || cat === "None") && advanced) return advanced;
    const yearsBucket = snap.creditEventDate
      ? computeYearsSinceBucket(snap.creditEventDate)
      : snap.yearsSinceCreditEvent;
    const base = [cat, snap.creditEventType, yearsBucket].filter((x) => x?.trim()).join(" ");
    return advanced ? `${base}; ${advanced}` : base;
  };
  buildCreditEventRef.current = buildCreditEventFromForm;

  const getApiValuesFromForm = (snap: typeof emptyForm) => {
    const dscrPath = isDscrPathScenarioFields({
      occupancy: snap.occupancy,
      propertyType: snap.propertyType,
      investmentIncomePath: snap.investmentIncomePath,
    });
    const docForApi = dscrPath ? "DSCR" : mapDocumentationForApi(snap.documentationType);
    const dtiForApi = dscrPath ? snap.estimatedDti.trim() || "45" : snap.estimatedDti;
    const rawPrep = snap.prepaymentTerms === "No Penalty" ? "None" : snap.prepaymentTerms;
    const prepForApi =
      snap.occupancy === "Investment Property" ? rawPrep : rawPrep.trim() || "None";
    return { docForApi, dtiForApi, prepForApi };
  };

  const finishChatIntake = async (snapshot?: typeof emptyForm) => {
    if (loading) return;
    if (formSubmitted) return;
    const snap = { ...(snapshot ?? formSyncRef.current) };
    // Default un-answered credit fields so they don't show as Required after results
    if (!snap.creditEventCategory.trim()) {
      snap.creditEventCategory = "None";
      setForm((s) => ({ ...s, creditEventCategory: "None" }));
    }
    if (!snap.paymentHistory.trim()) {
      snap.paymentHistory = "0x30";
      setForm((s) => ({ ...s, paymentHistory: "0x30" }));
    }
    const hardBlock = (await evaluateGeoFromWizard(snap).catch(() => geoEval))?.hard_block;
    // Keep ChatConversationFlow mounted through the scan; swap to results only after
    // eligibility settles (mirrors /form submitForm ordering).
    setLoading(true);
    setFormSubmitted(true);
    setNoProgramsMessageSuppressed(false);
    editBaseFormRef.current = null;
    setChatIntakeStep(null);
    setEligiblePrograms([]);
    setNearMissPrograms([]);
    setShowTableProgramCheckboxes(false);
    setEligibilityTableMsgId(null);
    setDetailsReady(false);
    setChatStarted(false);
    setKnowMoreDetailReady(false);
    activeKnowMoreMsgIdRef.current = null;
    setSelectedProgram("");
    setDetailsInput("");
    setSessionId("");
    setDetailPhase("none");

    if (hardBlock) {
      setPhase("done");
      setDetailPhase("complete");
      setLoading(false);
      setMessages([]);
      const geoMsg = `**No Programs Found.**\n\n**Restriction:** ${hardBlock}\n\nAdjust the property location or occupancy and try again, or contact a representative for options.`;
      streamMessage(geoMsg, "replace", 0, () => {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: `ELIGIBILITY_TABLE:${JSON.stringify({
              eligible: [],
              totalScreened: 0,
              geoBlocked: 1,
              overlayBlocked: 0,
              geoExclusions: [
                { program_name: "All programs", program: "All programs", reason: hardBlock },
              ],
              overlayExclusions: [],
            })}`,
          },
        ]);
      });
      return;
    }

    setForm(snap);
    const { docForApi, dtiForApi, prepForApi } = getApiValuesFromForm(snap);
    const creditEv = buildCreditEventFromForm(snap);
    // Swap to the results view BEFORE the scan resolves: it mounts with the retained
    // thread + loading dots, then the Good News message STREAMS in and the table
    // appends — the same smooth reveal as /form. (Flipping phase after the await
    // swapped views mid-stream, which popped the results in abruptly.)
    setPhase("done");
    await runEligibility({ docForApi, dtiForApi, prepForApi, creditEv, formSnap: snap });
    setDetailPhase("complete");
  };
  finishChatIntakeRef.current = finishChatIntake;

  // ── form field sync effects ───────────────────────────────────────

  useEffect(() => {
    if (form.citizenship === "Foreign National" && form.occupancy === "Primary Residence") {
      setForm((s) => ({ ...s, occupancy: "" }));
    }
  }, [form.citizenship, form.occupancy]);

  useEffect(() => {
    setSneakPeekOpen(false);
    setSneakPeekPrograms([]);
  }, [form.state, form.stateCounty, form.stateCity, form.stateBorough, form.stateZipCode]);

  useEffect(() => {
    if (form.occupancy !== "Investment Property" && form.investmentIncomePath) {
      setForm((s) => ({ ...s, investmentIncomePath: "" }));
    }
  }, [form.occupancy, form.investmentIncomePath]);

  // Default first-time homebuyer / investor when the field becomes relevant
  useEffect(() => {
    if (
      (form.occupancy === "Primary Residence" || form.occupancy === "Second Home") &&
      !form.firstTimeHomebuyer
    ) {
      setForm((s) => ({ ...s, firstTimeHomebuyer: "No" }));
    }
    if (form.occupancy === "Investment Property" && !form.firstTimeInvestor) {
      setForm((s) => ({ ...s, firstTimeInvestor: "No" }));
    }
  }, [form.occupancy, form.firstTimeHomebuyer, form.firstTimeInvestor]);

  useEffect(() => {
    if (form.propertyType && isFiveEightProperty(form.propertyType) && form.investmentIncomePath) {
      setForm((s) => ({ ...s, investmentIncomePath: "" }));
    }
  }, [form.propertyType, form.investmentIncomePath]);

  useEffect(() => {
    const t = form.propertyType.trim().toLowerCase();
    if (t !== "2-unit" && t !== "3-4 unit") return;
    setForm((s) => ({ ...s, propertyType: "two_to_four_family" }));
  }, [form.propertyType]);

  useEffect(() => {
    if (!form.lienPosition) return;
    setForm((s) => {
      const primary = s.primaryLoanPurpose;
      if (s.lienPosition === LIEN_POSITION_FIRST) {
        return {
          ...s,
          isSecondLien: "no",
          firstLienPurpose: primary,
          loanPurpose: primary,
          secondLienProduct: "",
          piggybackPurpose: "",
        };
      }
      if (s.lienPosition === LIEN_POSITION_SECOND) {
        // Standalone second: map from primaryLoanPurpose.
        // Purchase, Refinance, and Cash-Out Refinance are all valid for standalone seconds.
        const standalonePurpose =
          primary === "Cash-Out Refinance" ? "Cash-Out Refinance" : primary || "Refinance";
        return {
          ...s,
          isSecondLien: "yes",
          loanPurpose: standalonePurpose,
          firstLienPurpose: "",
          piggybackPurpose: "",
        };
      }
      if (s.lienPosition === LIEN_POSITION_PIGGYBACK) {
        return {
          ...s,
          isSecondLien: "yes",
          piggybackPurpose: primary,
          loanPurpose: primary,
          firstLienPurpose: "",
          secondLienProduct: "",
        };
      }
      return s;
    });
  }, [form.lienPosition, form.primaryLoanPurpose]);

  useEffect(() => {
    if (form.propertyType !== CROSS_COLLATERAL_PROPERTY_CODE) return;
    const rents = parseMoneyNum(form.totalGrossRents);
    const pitia = parseMoneyNum(form.combinedPitia);
    if (rents > 0 && pitia > 0) {
      setForm((s) => ({ ...s, loanLevelDscr: (rents / pitia).toFixed(2) }));
    }
  }, [form.propertyType, form.totalGrossRents, form.combinedPitia]);

  const prevOccRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // In chat mode the server-side intake engine owns field consistency — skip cascading clears
    // so that doc_type / estimatedDti etc. set in the same portfolio delta aren't wiped out.
    if (intakeMode === "chat") {
      prevOccRef.current = form.occupancy;
      return;
    }
    if (prevOccRef.current === undefined) {
      prevOccRef.current = form.occupancy;
      return;
    }
    if (prevOccRef.current === form.occupancy) return;
    prevOccRef.current = form.occupancy;
    const nextOcc = form.occupancy;
    setForm((s) => {
      // Clear ONLY what the new occupancy invalidates. Doc Type / DTI survive
      // Primary↔Investment (valid on the income path; the income-path effect below
      // clears them if DSCR is chosen). paymentHistory is kept on every path.
      const next = {
        ...s,
        firstTimeHomebuyer: "",
        firstTimeInvestor: "",
        establishedPrimaryRes: "",
      };
      if (nextOcc !== "Investment Property") {
        next.investmentIncomePath = "";
        next.dscr = "";
        next.rentalType = "";
        if (s.documentationType === "DSCR") {
          // The DSCR sentinel doc type can't carry over to an income-doc occupancy.
          next.documentationType = "";
          next.documentationTimeframe = "";
        }
      }
      return next;
    });
    setMaxReachedStep(1);
  }, [form.occupancy]);

  // Clear fields that are incompatible with the current income path
  const prevPathRef = useRef<string>("");
  useEffect(() => {
    // In chat mode the server controls field transitions — don't cascade clears here either.
    if (intakeMode === "chat") {
      prevPathRef.current = form.investmentIncomePath;
      return;
    }
    const wasDscr = prevPathRef.current === "dscr";
    const isDscr = form.investmentIncomePath === "dscr";
    if (prevPathRef.current === form.investmentIncomePath) return;
    prevPathRef.current = form.investmentIncomePath;
    if (isDscr && !wasDscr) {
      // switched TO dscr — set DSCR doc type, clear DTI (not used on DSCR). Payment
      // history is still collected on every path, so keep it.
      setForm((s) => ({ ...s, documentationType: "DSCR", estimatedDti: "" }));
    } else if (!isDscr && wasDscr) {
      // switched FROM dscr — clear dscr fields and reset doc type
      setForm((s) => ({
        ...s,
        dscr: "",
        rentalType: "",
        prepaymentTerms: "",
        documentationType: "",
      }));
    }
    setMaxReachedStep((prev) => Math.min(prev, 2));
  }, [form.investmentIncomePath]);

  // Lock prepayment to "No Penalty" for owner-occupied — not applicable under ATR rules
  useEffect(() => {
    if (form.occupancy === "Primary Residence" || form.occupancy === "Second Home") {
      setForm((s) => ({ ...s, prepaymentTerms: "No Penalty", prepayStepdown: "" }));
    } else if (form.occupancy === "Investment Property" && form.prepaymentTerms === "No Penalty") {
      // Let investor pick — clear the forced value when switching to investment
      setForm((s) => ({ ...s, prepaymentTerms: "" }));
    }
  }, [form.occupancy]);

  // ── derived state ─────────────────────────────────────────────────

  const isDscrPath = () =>
    isDscrPathScenarioFields({
      occupancy: form.occupancy,
      propertyType: form.propertyType,
      investmentIncomePath: form.investmentIncomePath,
    });

  const occupancyChoices =
    form.citizenship === "Foreign National"
      ? OCCUPANCY.filter((o) => o !== "Primary Residence")
      : [...OCCUPANCY];
  const isCrossCollateral = form.propertyType === CROSS_COLLATERAL_PROPERTY_CODE;
  const propertyTypeChoices =
    form.occupancy === "Investment Property" ? PROPERTY_TYPES_WITH_CROSS : CORE_PROPERTY_TYPES;

  const isNonUsCitizen = form.citizenship !== "" && form.citizenship !== "US Citizen";
  const creditScoreRequired = !isNonUsCitizen;
  const needsFnGates = form.citizenship === "Foreign National";

  const propValError =
    !!form.valueSalesPrice &&
    !!form.loanAmount &&
    parseMoneyNum(form.valueSalesPrice) < parseMoneyNum(form.loanAmount);

  // Piggyback / subordination: keep CLTV in sync when other-lien balance or loan triangle changes
  useEffect(() => {
    const pv = parseMoneyNum(form.valueSalesPrice);
    const loan = parseMoneyNum(form.loanAmount);
    if (pv <= 0 || loan <= 0) return;

    if (form.isSecondLien === "yes") {
      const ltv = computeLtvPercent(form.loanAmount, form.valueSalesPrice);
      const cltv = computeCltvPercent(
        form.existingFirstLien,
        form.loanAmount,
        form.valueSalesPrice,
      );
      setForm((s) =>
        s.ltv === ltv && s.cltv === cltv ? s : { ...s, ltv: ltv || s.ltv, cltv: cltv || s.cltv },
      );
      return;
    }

    if (
      form.isSecondLien === "no" &&
      existingSecondLienNeedsSubordination(form.existingSecondLien)
    ) {
      const ltv = computeLtvPercent(form.loanAmount, form.valueSalesPrice);
      const cltv = computeCltvPercent(
        form.existingSecondLienBalance,
        form.loanAmount,
        form.valueSalesPrice,
      );
      setForm((s) =>
        s.ltv === ltv && s.cltv === cltv ? s : { ...s, ltv: ltv || s.ltv, cltv: cltv || s.cltv },
      );
    }
  }, [
    form.isSecondLien,
    form.existingSecondLien,
    form.existingFirstLien,
    form.existingSecondLienBalance,
    form.loanAmount,
    form.valueSalesPrice,
  ]);

  const parseScore = (raw: string) => parseInt(String(raw).replace(/\D/g, ""), 10);

  const creditScoreDigits = (raw: string) => raw.replace(/\D/g, "");

  /** Presence only — range is advisory (see creditScoreRangeError), not a completion gate. */
  const creditScoreOk = (() => {
    const t = form.decisionCreditScore.trim();
    if (!t) return !creditScoreRequired;
    return creditScoreDigits(t).length > 0;
  })();

  // Debounce the value used for the range caution so it doesn't flash while
  // the user is mid-typing (e.g. "7" before "720"). Wait ~2.5s after the last
  // keystroke before validating the range.
  const [debouncedCreditScore, setDebouncedCreditScore] = useState(form.decisionCreditScore);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedCreditScore(form.decisionCreditScore);
    }, 2500);
    return () => window.clearTimeout(t);
  }, [form.decisionCreditScore]);

  const creditScoreRangeError = (() => {
    const t = debouncedCreditScore.trim();
    if (!t) return false;
    // Don't flag a stale debounced value while a newer edit is still settling.
    if (debouncedCreditScore !== form.decisionCreditScore) return false;
    const n = parseScore(t);
    return !Number.isFinite(n) || n < 300 || n > 800;
  })();

  // block1 now includes lien position (moved from original step 3)
  const block1Complete = () => {
    if (
      !form.citizenship.trim() ||
      !form.occupancy.trim() ||
      !form.primaryLoanPurpose.trim() ||
      !form.loanPurpose.trim() ||
      !form.propertyType.trim()
    )
      return false;
    if (form.citizenship === "Non-Permanent Resident Alien") {
      if (!form.visaCategory.trim()) return false;
      if (form.visaCategory === "Other / Not Listed" && !form.visaTypeOther.trim()) return false;
      if (form.visaCategory !== "Other / Not Listed" && !form.visaType.trim()) return false;
    }
    if (needsFnGates) {
      if (!form.ofacSanctioned.trim()) return false;
      if (form.ofacSanctioned === "Yes") return false;
      if (!form.hasUsCredit.trim()) return false;
    }
    if (!form.lienPosition.trim()) return false;
    if (form.lienPosition === LIEN_POSITION_SECOND && !form.secondLienProduct.trim()) return false;
    if (isCrossCollateral) {
      if (
        !form.propertyCount.trim() ||
        !form.combinedPropertyValue.trim() ||
        !form.combinedLoanAmount.trim()
      ) {
        return false;
      }
    } else if (!form.valueSalesPrice.trim() || !form.loanAmount.trim() || !form.ltv.trim()) {
      return false;
    }
    if (!creditScoreOk) return false;
    if (!isCrossCollateral) {
      const ltvN = Math.round(parseMoneyNum(form.ltv));
      if (ltvN < 1 || ltvN > 100) return false;
    }
    if (!form.isSecondLien.trim()) return false;
    if (shouldShowSecondLienFields(form.isSecondLien) && !form.existingFirstLien.trim())
      return false;
    // Standalone HELOC: draw period + initial draw are part of Loan Details.
    if (form.lienPosition === LIEN_POSITION_SECOND && form.secondLienProduct === "heloc") {
      if (!form.helocDrawYears.trim() || !form.helocInitialDraw.trim()) return false;
    }
    // For first-lien refi/cash-out only: require existing second lien answer
    const _b1IsFirstLienRefi =
      form.lienPosition === LIEN_POSITION_FIRST &&
      (form.primaryLoanPurpose === "Refinance" || form.primaryLoanPurpose === "Cash-Out Refinance");
    if (form.isSecondLien === "no" && _b1IsFirstLienRefi) {
      // Payoff balance is REQUIRED on a refi (labels spec) — cash-out classification
      // and CLTV-on-subordination both need it.
      if (!form.existingFirstLien.trim()) return false;
      if (!form.existingSecondLien.trim()) return false;
      if (
        existingSecondLienNeedsSubordination(form.existingSecondLien) &&
        !form.existingSecondLienBalance.trim()
      )
        return false;
    }
    if (form.occupancy === "Primary Residence" || form.occupancy === "Second Home") {
      if (!form.firstTimeHomebuyer.trim()) return false;
    }
    if (form.occupancy === "Investment Property") {
      if (!form.firstTimeInvestor.trim()) return false;
      if (
        shouldShowEstablishedPrimaryRes(
          form.occupancy,
          form.firstTimeHomebuyer,
          form.firstTimeInvestor,
        ) &&
        !form.establishedPrimaryRes.trim()
      )
        return false;
      if (!isFiveEightProperty(form.propertyType) && !form.investmentIncomePath) return false;
    }
    if (!isCrossCollateral && propValError) return false;
    return true;
  };

  const block2Complete = () => {
    if (!block1Complete()) return false;
    if (isDscrPath()) {
      if (isCrossCollateral) {
        return (
          !!form.loanLevelDscr.trim() && !!form.rentalType.trim() && !!form.prepaymentTerms.trim()
        );
      }
      return !!form.dscr.trim() && !!form.rentalType.trim() && !!form.prepaymentTerms.trim();
    }
    if (!form.documentationType.trim() || !form.estimatedDti.trim()) return false;
    if (form.occupancy === "Investment Property" && !form.prepaymentTerms.trim()) return false;
    return true;
  };

  const resubmitButtonDisabledClass =
    "disabled:opacity-100 disabled:bg-[#9eb3d0] disabled:text-white disabled:hover:bg-[#9eb3d0]";

  // "Yes" requires at least one event with a date or years-since.
  // "No" or unanswered (empty) → satisfied; housing history check is separate.
  const creditEventBlockComplete =
    form.hasCreditEvent === "Yes"
      ? (form.creditEvents ?? []).length > 0 &&
        (form.creditEvents ?? []).every(
          (ev) => !!form.creditEventDates?.[ev]?.trim() || !!form.creditEventYears?.[ev]?.trim(),
        )
      : true;
  const advancedCreditEventsComplete = true;

  const geoFormData = geoFormFromWizard(form);
  const locationComplete = isGeoLocationComplete(geoFormData);

  const vacantRehabRelevant = isDscrPath() && isRefiOrCashOutLoanPurpose(form.loanPurpose);

  const collateralStepComplete =
    locationComplete &&
    (form.state !== "HI" || !!form.hiLavaZone) &&
    !!form.isRuralProperty &&
    !(
      form.isRuralProperty === "Yes" &&
      ACREAGE_PROPERTY_TYPES.has(form.propertyType) &&
      !form.acreage
    ) &&
    (!vacantRehabRelevant || !!form.vacantProperty) &&
    !(vacantRehabRelevant && form.vacantProperty === "Yes" && !form.recentlyRehabbed);

  const departingResidenceApplies =
    form.occupancy === "Primary Residence" &&
    (form.lienPosition === LIEN_POSITION_FIRST || form.lienPosition === LIEN_POSITION_PIGGYBACK) &&
    form.primaryLoanPurpose === "Purchase" &&
    form.citizenship !== "Foreign National";

  const conditionsGateForm =
    intakeMode === "form" ? { ...form, ...formChatConditionsDefaults(form) } : form;
  const conditionsStepComplete = isConditionsStepComplete(conditionsGateForm);

  // DTI / NOCB / Residual Income derived values
  const effectiveDti = (() => {
    if (form.nonOccupantCoBorrower === "Yes" && form.combinedDti) {
      return parseFloat(form.combinedDti);
    }
    return parseFloat(form.estimatedDti) || 0;
  })();

  const showNocbOption =
    form.occupancy === "Primary Residence" &&
    form.primaryLoanPurpose !== "Cash-Out Refinance" &&
    (parseFloat(form.estimatedDti) || 0) > 43 &&
    form.citizenship !== "Foreign National";

  const residualTriggered =
    (form.occupancy === "Primary Residence" || form.occupancy === "Second Home") &&
    !!form.estimatedDti?.trim() &&
    effectiveDti > 43;

  const computeRequiredResidual = (size: number, dti: number): number => {
    const baseline = size === 1 ? 1500 : 2500 + Math.max(0, size - 2) * 150;
    return dti > 50 ? Math.max(baseline, 3500) : baseline;
  };

  const isFormComplete = block2Complete() && collateralStepComplete && conditionsStepComplete;

  /** Mirrors submit/resubmit gates — guided chat can be ready before legacy step wizard is. */
  const profileReadyForResubmit = useMemo(() => {
    const snap = intakeMode === "form" ? { ...form, ...formChatConditionsDefaults(form) } : form;
    return mandatoryComplete(snap) || isFormComplete;
  }, [form, intakeMode, isFormComplete]);

  useEffect(() => {
    if (profileReadyForResubmit && profileGapsForced) setProfileGapsForced(false);
  }, [profileReadyForResubmit, profileGapsForced]);

  // Post-submit, an edit cascade can re-open a required field with no active intake
  // flow left to re-ask it — flag the gap in red immediately instead of waiting for
  // a blocked Resubmit click.
  useEffect(() => {
    if (formSubmitted && !profileReadyForResubmit && !profileGapsForced) {
      setProfileGapsForced(true);
    }
  }, [formSubmitted, profileReadyForResubmit, profileGapsForced]);

  // Auto-expand Additional Details if any optional field inside already has a value
  const step2OptionalFilled =
    !!form.assetsLiquidFunds?.trim() ||
    !!form.entityVesting?.trim() ||
    !!form.giftFundsPercent?.trim() ||
    !!form.otherFinancedProperties?.trim() ||
    !!form.reservesAvailable?.trim();
  const step3OptionalFilled = !!form.propertyCondition?.trim() || !!form.decliningMarket?.trim(); // Collateral
  const step4OptionalFilled = !!form.tradelines?.trim(); // Credit
  const formSubmitButtonDisabled =
    !isFormComplete || (detailPhase === "complete" && (!formDirtySinceSubmit || loading));

  // Show note when the chosen state+sub-location has any geo rules (including success-confirmed restricted counties)
  const showGeoNote = geoEval?.has_restrictions ?? false;

  const useCltvLabel = usesCltvLeverageField(form.isSecondLien, form.existingSecondLien);
  // Value/Loan/LTV shows as soon as lien position is confirmed (and product for standalone).
  const isFirstLienRefi =
    form.lienPosition === LIEN_POSITION_FIRST &&
    (form.primaryLoanPurpose === "Refinance" || form.primaryLoanPurpose === "Cash-Out Refinance");
  const showValueLoanLtv =
    !isCrossCollateral &&
    !!revealForm.lienPosition &&
    (form.lienPosition === LIEN_POSITION_FIRST ||
      (form.lienPosition === LIEN_POSITION_SECOND && !!revealForm.secondLienProduct?.trim()) ||
      form.lienPosition === LIEN_POSITION_PIGGYBACK);
  const lienDetailsComplete = (() => {
    if (!showValueLoanLtv || !revealForm.lienPosition) return false;
    // Blue box base trio must all be filled first
    if (
      !revealForm.valueSalesPrice?.trim() ||
      !revealForm.loanAmount?.trim() ||
      !revealForm.ltv?.trim()
    )
      return false;
    // Standalone second (HELOC/HELOAN) — needs existing first lien balance
    if (form.lienPosition === LIEN_POSITION_SECOND) {
      if (!revealForm.existingFirstLien?.trim()) return false;
      // HELOC also needs the draw period + day-one draw (labels spec).
      if (form.secondLienProduct === "heloc") {
        return !!form.helocDrawYears.trim() && !!form.helocInitialDraw.trim();
      }
      return true;
    }
    // Piggyback — always needs first lien amount to compute CLTV
    if (form.lienPosition === LIEN_POSITION_PIGGYBACK) {
      return !!revealForm.existingFirstLien?.trim();
    }
    // First lien purchase — complete once base trio is filled (checked above)
    if (!isFirstLienRefi) return true;
    // R&T and Cash-Out: payoff balance is REQUIRED, then the existing-second answer.
    if (!revealForm.existingFirstLien?.trim()) return false;
    if (!revealForm.existingSecondLien?.trim()) return false;
    if (existingSecondLienNeedsSubordination(form.existingSecondLien)) {
      return !!revealForm.existingSecondLienBalance?.trim() && !!revealForm.cltv?.trim();
    }
    return true;
  })();

  const cltvFieldLabel = "CLTV (%)";
  const lienPositionOptionsForPurpose = (() => {
    if (form.primaryLoanPurpose === "Purchase") {
      return [
        { value: LIEN_POSITION_FIRST, label: "First Lien" },
        { value: LIEN_POSITION_PIGGYBACK, label: "Second Lien (Piggyback)" },
      ] as const;
    }
    if (form.primaryLoanPurpose === "Cash-Out Refinance") {
      return [
        { value: LIEN_POSITION_FIRST, label: "First Lien" },
        { value: LIEN_POSITION_SECOND, label: "Second Lien (Standalone)" },
      ] as const;
    }
    return LIEN_POSITION_OPTIONS; // R&T: all three options
  })();

  const creditHistoryStepComplete =
    creditEventBlockComplete &&
    advancedCreditEventsComplete &&
    (!shouldShowPaymentHistory(form.estimatedDti, form.documentationType, form.occupancy) ||
      !!form.paymentHistory.trim());

  /** Highest step the user may open — later steps stay disabled until prerequisites are complete. */
  const maxAllowedStep = useMemo((): 1 | 2 | 3 | 4 | 5 => {
    if (!block1Complete()) return 1;
    if (!block2Complete()) return 2;
    if (!creditHistoryStepComplete) return 3;
    if (!collateralStepComplete) return 4;
    return 5;
  }, [form, creditScoreOk, propValError, creditEventBlockComplete, geoFormData]);

  const canNavigateToStep = (step: 1 | 2 | 3 | 4 | 5 | 6): boolean => step <= maxAllowedStep;

  /** Step shows a check only when all required fields for that step are complete. */
  const isStepComplete = (step: 1 | 2 | 3 | 4 | 5 | 6): boolean => {
    if (step > maxAllowedStep) return false;
    switch (step) {
      case 1:
        return block1Complete();
      case 2:
        return block2Complete();
      case 3:
        return creditHistoryStepComplete;
      case 4:
        return collateralStepComplete;
      case 5:
        return conditionsStepComplete;
      case 6:
        return (
          formSubmitted || detailPhase === "complete" || (maxReachedStep >= 6 && isFormComplete)
        );
      default:
        return false;
    }
  };

  const goToWizardStep = (step: 1 | 2 | 3 | 4 | 5 | 6) => {
    if (!canNavigateToStep(step)) return;
    setActiveStep(step);
    setMaxReachedStep((prev) => Math.max(prev, step));
  };

  // Close sneak-peek whenever the active step changes
  useEffect(() => {
    setSneakPeekOpen(false);
    setSneakPeekPrograms([]);
  }, [activeStep]);

  // Zero-program nudge — only when quick-scan *transitions* to 0 and a tracked field caused it
  useEffect(() => {
    if (quickCount !== 0) {
      toast.dismiss("zero-program-nudge");
      if (zeroNudgeOpen) setZeroNudgeOpen(false);
      return;
    }

    if (!pendingZeroNudgeTransitionRef.current) return;

    // Check if already dismissed for a near-identical form state (< 5 fields changed)
    if (zeroNudgeDismissedSnapshotRef.current) {
      try {
        const prev = JSON.parse(zeroNudgeDismissedSnapshotRef.current) as Record<string, unknown>;
        const changed = Object.keys(form).filter(
          (k) => (form as Record<string, unknown>)[k] !== prev[k],
        ).length;
        if (changed < 5) {
          pendingZeroNudgeTransitionRef.current = false;
          return;
        }
      } catch {
        /* ignore */
      }
    }

    let prevSnap: Record<string, unknown> = {};
    if (formSnapAtLastPositiveQuickCountRef.current) {
      try {
        prevSnap = JSON.parse(formSnapAtLastPositiveQuickCountRef.current) as Record<
          string,
          unknown
        >;
      } catch {
        prevSnap = {};
      }
    }
    const curr = form as Record<string, unknown>;
    const zeroNudgeTrackedKeys = [
      "ofacSanctioned",
      "hiLavaZone",
      "citizenship",
      "powerOfAttorney",
      "listingSeasoning",
      "nonArmsLength",
      "occupancy",
      "investmentIncomePath",
      "decisionCreditScore",
    ] as const;
    const changedKeys = zeroNudgeTrackedKeys.filter((k) => prevSnap[k] !== curr[k]);

    const isFN = form.citizenship === "Foreign National";
    const isDscr = form.occupancy === "Investment Property" && form.investmentIncomePath === "dscr";
    const ficoRaw = form.decisionCreditScore.trim();
    const ficoDigits = ficoRaw.replace(/\D/g, "");
    const ficoN = parseScore(ficoRaw);
    const ficoEntryComplete =
      ficoDigits.length >= 3 && Number.isFinite(ficoN) && ficoN >= 300 && ficoN <= 850;

    let reason = "";
    if (changedKeys.includes("ofacSanctioned") && form.ofacSanctioned === "Yes")
      reason = "Borrower restrictions mean no programs are available. Please check your inputs.";
    else if (
      changedKeys.includes("hiLavaZone") &&
      (form.hiLavaZone === "Zone 1" || form.hiLavaZone === "Zone 2")
    )
      reason =
        "Property location restrictions mean no programs are available for this scenario. Please check your inputs.";
    else if (changedKeys.includes("citizenship") && isFN)
      reason =
        "Foreign National restrictions mean certain programs are not available. Please check your inputs.";
    else if (changedKeys.includes("powerOfAttorney") && form.powerOfAttorney === "Yes")
      reason =
        "Borrower-specific restrictions mean certain programs are not available. Please check your inputs.";
    else if (changedKeys.includes("listingSeasoning") && form.listingSeasoning === "Yes")
      reason =
        "Listing seasoning restrictions mean no programs are available for this refinance. Please check your inputs.";
    else if (
      (changedKeys.includes("nonArmsLength") ||
        changedKeys.includes("occupancy") ||
        changedKeys.includes("investmentIncomePath")) &&
      form.nonArmsLength === "Yes" &&
      isDscr
    )
      reason =
        "Transaction type restrictions mean certain programs are not available. Please check your inputs.";
    else if (changedKeys.includes("decisionCreditScore") && ficoEntryComplete && ficoN < 620)
      reason =
        "Credit score restrictions mean certain programs are not available. Please check your inputs.";

    pendingZeroNudgeTransitionRef.current = false;

    const openWith = (detail = "") => {
      setZeroNudgeReason(detail);
      setZeroNudgeOpen(true);
    };
    if (reason) {
      openWith(reason);
      return;
    }
    // No specific cause matched — probe whether the chosen STATE is the blocker:
    // re-run the quick scan without it; if matches come back, we're simply not
    // licensed there (eligible-state allowlist).
    const st = form.state.trim();
    if (st) {
      const probeSnap = {
        ...formSyncRef.current,
        state: "",
        stateCounty: "",
      } as typeof form;
      const probePayload = buildQuickScanPayloadFromForm(
        probeSnap,
        buildCreditEventRef.current(probeSnap),
      );
      postEligibilityQuick(apiBase, probePayload)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: QuickEligibilityApiResponse | null) => {
          if (data && typeof data.count === "number" && data.count > 0) {
            openWith(`Not Licensed in the state ${st.toUpperCase()}.`);
          } else {
            openWith();
          }
        })
        .catch(() => openWith());
      return;
    }
    openWith();
  }, [quickCount, form, apiBase]);

  // Cascade-clear residual fields when residual is no longer triggered
  useEffect(() => {
    if (!residualTriggered && (form.householdSize || form.monthlyResidualIncome)) {
      setForm((s) => ({ ...s, householdSize: "", monthlyResidualIncome: "" }));
    }
  }, [residualTriggered]);

  // Close and reset preview whenever any form input changes
  useEffect(() => {
    setSneakPeekOpen(false);
    setSneakPeekPrograms([]);
  }, [form]);

  // Occupancy / path changes can invalidate later steps — clamp progress and active step.
  useEffect(() => {
    setMaxReachedStep((prev) => Math.min(prev, maxAllowedStep));
    setActiveStep((cur) => (cur > maxAllowedStep ? maxAllowedStep : cur));
  }, [maxAllowedStep]);

  const usesCombinedLeverageLtv = (snap: typeof form) =>
    snap.isSecondLien === "yes" ||
    (snap.isSecondLien === "no" && existingSecondLienNeedsSubordination(snap.existingSecondLien));

  const clampFirstLienLoanToValue = (snap: typeof form): typeof form => {
    if (usesCombinedLeverageLtv(snap)) return snap;
    const pv = parseMoneyNum(snap.valueSalesPrice);
    const la = parseMoneyNum(snap.loanAmount);
    if (pv > 0 && la > pv) {
      return {
        ...snap,
        loanAmount: formatMoneyForInput(String(pv)),
        ltv: "100",
        cltv: snap.cltv || "100",
      };
    }
    return snap;
  };

  const computeLoanTriForm = (s: typeof form, source: LoanTriSource, v: string): typeof form => {
    const syncSplitLeverage = (
      prior: typeof s,
      otherLienBalance: number,
      patch: Partial<typeof s>,
    ): typeof form => {
      const next = { ...prior, ...patch };
      const pv = parseMoneyNum(next.valueSalesPrice);
      const loan = parseMoneyNum(next.loanAmount);
      if (pv <= 0 || loan <= 0) return next;
      const ltv = computeLtvPercent(next.loanAmount, next.valueSalesPrice);
      const cltv = computeCltvPercent(
        String(otherLienBalance),
        next.loanAmount,
        next.valueSalesPrice,
      );
      return { ...next, ltv: ltv || next.ltv, cltv: cltv || next.cltv };
    };

    if (s.isSecondLien === "yes") {
      const firstLien = parseMoneyNum(s.existingFirstLien);
      const propVal = parseMoneyNum(s.valueSalesPrice);

      if (source === "valueSalesPrice") {
        return syncSplitLeverage(s, firstLien, { valueSalesPrice: v });
      }
      if (source === "loanAmount") {
        return syncSplitLeverage(s, firstLien, { loanAmount: formatMoneyForInput(v) });
      }
      if (source === "ltv") {
        const ltv = Math.min(100, Math.max(1, Math.round(parseMoneyNum(v))));
        const ltvStr = String(ltv);
        if (propVal > 0) {
          const loan = (ltv / 100) * propVal;
          return syncSplitLeverage(s, firstLien, {
            ltv: ltvStr,
            loanAmount: formatMoneyForInput(String(Math.round(loan))),
          });
        }
        return { ...s, ltv: ltvStr };
      }
      if (source === "cltv") {
        const cltv = Math.min(100, Math.max(1, Math.round(parseMoneyNum(v))));
        const cltvStr = String(cltv);
        if (propVal > 0) {
          const loan = Math.max(0, (cltv / 100) * propVal - firstLien);
          return syncSplitLeverage(s, firstLien, {
            cltv: cltvStr,
            loanAmount: formatMoneyForInput(String(Math.round(loan))),
          });
        }
        return { ...s, cltv: cltvStr };
      }
      return s;
    }

    if (s.isSecondLien === "no" && existingSecondLienNeedsSubordination(s.existingSecondLien)) {
      const secondLien = parseMoneyNum(s.existingSecondLienBalance);
      const propVal = parseMoneyNum(s.valueSalesPrice);

      if (source === "valueSalesPrice") {
        return syncSplitLeverage(s, secondLien, { valueSalesPrice: v });
      }
      if (source === "loanAmount") {
        return syncSplitLeverage(s, secondLien, { loanAmount: formatMoneyForInput(v) });
      }
      if (source === "ltv") {
        const ltv = Math.min(100, Math.max(1, Math.round(parseMoneyNum(v))));
        const ltvStr = String(ltv);
        if (propVal > 0) {
          const loan = (ltv / 100) * propVal;
          return syncSplitLeverage(s, secondLien, {
            ltv: ltvStr,
            loanAmount: formatMoneyForInput(String(Math.round(loan))),
          });
        }
        return { ...s, ltv: ltvStr };
      }
      if (source === "cltv") {
        const cltv = Math.min(100, Math.max(1, Math.round(parseMoneyNum(v))));
        const cltvStr = String(cltv);
        if (propVal > 0) {
          const loan = Math.max(0, (cltv / 100) * propVal - secondLien);
          return syncSplitLeverage(s, secondLien, {
            cltv: cltvStr,
            loanAmount: formatMoneyForInput(String(Math.round(loan))),
          });
        }
        return { ...s, cltv: cltvStr };
      }
      return s;
    }

    const tri = triangulateLoanFields(
      { valueSalesPrice: s.valueSalesPrice, loanAmount: s.loanAmount, ltv: s.ltv },
      source === "cltv" ? "ltv" : source,
      v,
    );
    return clampFirstLienLoanToValue({ ...s, ...tri, cltv: tri.ltv });
  };

  const applyLoanTri = (source: LoanTriSource, v: string) => {
    setForm((s) => computeLoanTriForm(s, source, v));
  };

  const buildCreditEventApi = () => {
    const cat = form.creditEventCategory.trim();
    const advanced = (form.creditEvents ?? [])
      .map((ev) => {
        const yrs = form.creditEventYears?.[ev]?.trim();
        return yrs ? `${ev} ${yrs}` : ev;
      })
      .join("; ");
    if ((!cat || cat === "None") && !advanced) return "";
    if ((!cat || cat === "None") && advanced) return advanced;
    const yearsBucket = form.creditEventDate
      ? computeYearsSinceBucket(form.creditEventDate)
      : form.yearsSinceCreditEvent;
    const base = [cat, form.creditEventType, yearsBucket].filter((x) => x?.trim()).join(" ");
    return advanced ? `${base}; ${advanced}` : base;
  };

  const clearStep1 = () =>
    setForm((s) => ({
      ...s,
      citizenship: "",
      primaryLoanPurpose: "",
      lienPosition: "",
      firstLienPurpose: "",
      secondLienProduct: "",
      piggybackPurpose: "",
      occupancy: "",
      loanPurpose: "",
      valueSalesPrice: "",
      ltv: "",
      loanAmount: "",
      propertyType: "",
      decisionCreditScore: "",
      firstTimeHomebuyer: "",
      firstTimeInvestor: "",
      establishedPrimaryRes: "",
      investmentIncomePath: "" as const,
      isSecondLien: "",
      existingFirstLien: "",
      cltv: "",
      visaType: "",
      ofacSanctioned: "",
      hasUsCredit: "",
      existingSecondLien: "",
      existingSecondLienBalance: "",
      refinancingExistingSecond: "",
      existingSecondBalance: "",
      propertyCount: "",
      combinedPropertyValue: "",
      combinedLoanAmount: "",
      totalGrossRents: "",
      combinedPitia: "",
      loanLevelDscr: "",
      isRuralProperty: "",
      decliningMarket: "",
      nonOccupantCoBorrower: "",
      noCbRelationship: "",
      noCbFico: "",
      noCbIncome: "",
      tradelines: "",
      acreage: "",
      cashInHandRequest: "",
      entityVesting: "",
      assetsLiquidFunds: "",
      giftFundsPercent: "",
      powerOfAttorney: "",
      listingSeasoning: "",
      scenarioNotes: "",
      // cascade: clear all subsequent steps
      documentationType: "",
      estimatedDti: "",
      prepaymentTerms: "",
      prepayStepdown: "",
      dscr: "",
      rentalType: "",
      state: "",
      stateCounty: "",
      stateCity: "",
      stateBorough: "",
      stateZipCode: "",
      isInBaltimoreCity: "",
      isInIndianapolis: "",
      isInPhiladelphia: "",
      isInMemphis: "",
      isInLubbock: "",
      creditEventCategory: "",
      creditEventType: "",
      yearsSinceCreditEvent: "",
      creditEvents: [],
      creditEventYears: {},
      paymentHistory: "",
    }));

  const clearStep2 = () => {
    setForm((s) => ({
      ...s,
      documentationType: "",
      estimatedDti: "",
      prepaymentTerms: "",
      prepayStepdown: "",
      dscr: "",
      rentalType: "",
      selfEmploymentHistory: "",
      vacantProperty: "",
      assetsLiquidFunds: "",
      entityVesting: "",
      giftFundsPercent: "",
      // cascade: clear location + credit + additional
      state: "",
      stateCounty: "",
      stateCity: "",
      stateBorough: "",
      stateZipCode: "",
      isInBaltimoreCity: "",
      isInIndianapolis: "",
      isInPhiladelphia: "",
      isInMemphis: "",
      isInLubbock: "",
      creditEventCategory: "",
      creditEventType: "",
      yearsSinceCreditEvent: "",
      creditEvents: [],
      creditEventYears: {},
      paymentHistory: "",
      acreage: "",
      nonOccupantCoBorrower: "",
      noCbRelationship: "",
      noCbFico: "",
      noCbIncome: "",
      tradelines: "",
      powerOfAttorney: "",
      listingSeasoning: "",
      scenarioNotes: "",
    }));
  };

  const clearStep3 = () => {
    setForm((s) => ({
      ...s,
      state: "",
      stateCounty: "",
      stateCity: "",
      stateBorough: "",
      stateZipCode: "",
      isInBaltimoreCity: "",
      isInIndianapolis: "",
      isInPhiladelphia: "",
      isInMemphis: "",
      isInLubbock: "",
      hiLavaZone: "",
      isRuralProperty: "",
      acreage: "",
      vacantProperty: "",
      recentlyRehabbed: "",
      decliningMarket: "",
      propertyCondition: "",
    }));
  };

  const clearStep4 = () =>
    setForm((s) => ({
      ...s,
      hasCreditEvent: "",
      creditEventCategory: "",
      creditEventType: "",
      yearsSinceCreditEvent: "",
      creditEventDate: "",
      creditEventDateUncertain: "",
      creditEvents: [],
      creditEventYears: {},
      creditEventDates: {},
      paymentHistory: "",
      tradelines: "",
    }));

  const clearStep5 = () =>
    setForm((s) => ({
      ...s,
      nonOccupantCoBorrower: "",
      noCbRelationship: "",
      noCbFico: "",
      noCbIncome: "",
      powerOfAttorney: "",
      listingSeasoning: "",
      nonArmsLength: "",
      departingResidence: "",
      departingRent: "",
      scenarioNotes: "",
    }));

  const clearStep6 = () =>
    setForm((s) => ({
      ...s,
      loanTerm: "No preference",
      rateTypePref: "No Preference",
      interestOnlyPref: "No preference",
    }));

  // ── submit ────────────────────────────────────────────────────────

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (formSubmitted && detailPhase !== "complete") return;
    let formForSubmit = formSyncRef.current;
    if (intakeMode === "form") {
      const patch = formChatConditionsDefaults(formForSubmit);
      if (Object.keys(patch).length > 0) {
        formForSubmit = { ...formForSubmit, ...patch };
        setForm(formForSubmit);
        formSyncRef.current = formForSubmit;
      }
    }
    // For guided /form chat, mandatory questions are sufficient to submit — the wizard
    // collateral/conditions gates may not all be set but the chat flow asked everything needed.
    const formModeReady = intakeMode === "form" && mandatoryComplete(formForSubmit);
    const profileReady = formModeReady || isFormComplete;

    // Re-run after editing from results (sidebar Resubmit or form Resubmit)
    if (detailPhase === "complete" && editBoundaryPhase === null) {
      if (!profileDirtySinceSubmit) return;
      if (!profileReady) {
        setProfileGapsForced(true);
        const missing: string[] = [];
        if (!block1Complete()) missing.push("Basics");
        else if (!block2Complete()) missing.push("Capacity");
        if (!collateralStepComplete) missing.push("Collateral");
        if (!conditionsStepComplete) missing.push("Conditions");
        toast.error(
          missing.length
            ? `Please complete: ${missing.join(", ")} — see highlighted fields in your profile.`
            : "Please complete all required fields highlighted in your Mortgage Profile.",
        );
        return;
      }
      await resubmitEligibility();
      return;
    }

    if (!profileReady) {
      setProfileGapsForced(true);
      const missing: string[] = [];
      if (!block1Complete()) missing.push("Basics");
      else if (!block2Complete()) missing.push("Capacity");
      if (!collateralStepComplete) missing.push("Collateral");
      if (!conditionsStepComplete) missing.push("Conditions");
      toast.error(
        missing.length
          ? `Please complete: ${missing.join(", ")} — see highlighted fields in your profile.`
          : "Please complete all required fields highlighted in your Mortgage Profile.",
      );
      return;
    }

    // Normal submit from step 5 — set loading first so FormChatFlow shows the scan state
    // before we clear matched programs (avoids a flash of "0 matched").
    setLoading(true);
    setFormSubmitted(true);
    setNoProgramsMessageSuppressed(false);
    editBaseFormRef.current = null;
    setPhase("done");
    setEligiblePrograms([]);
    setNearMissPrograms([]);
    setShowTableProgramCheckboxes(false);
    setEligibilityTableMsgId(null);
    setDetailsReady(false);
    setChatStarted(false);
    setKnowMoreDetailReady(false);
    activeKnowMoreMsgIdRef.current = null;
    setSelectedProgram("");
    setDetailsInput("");
    setSessionId("");
    setEligibilityLabel("");
    setThinkingLabel("");
    setMessages([]);
    setDetailPhase("none");
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingText(null);
    if (editBoundaryPhase !== null) setEditBoundaryPhase(null);

    const { docForApi, dtiForApi, prepForApi } = getApiValues();
    const creditEv = buildCreditEventApi();
    const stateLabel = STATES.find((s) => s.code === form.state)?.label || form.state;
    const scanningLabel = `Scanning programs for your scenario${form.state ? ` in ${stateLabel}` : ""}…`;
    setMessages([
      {
        id: ELIGIBILITY_SCAN_MSG_ID,
        role: "assistant",
        content: `LOADING:${scanningLabel}`,
      },
    ]);
    await runEligibility({
      docForApi,
      dtiForApi,
      prepForApi,
      creditEv,
      showLoadingMsg: false,
      removeMsgIds: [ELIGIBILITY_SCAN_MSG_ID],
      formSnap: intakeMode === "form" ? formForSubmit : undefined,
    });
    setDetailPhase("complete");
  };

  // Preview eligibility from Step 3 — injects safe geography defaults for missing Step 4 fields
  const previewFromStep3 = async () => {
    setFormSubmitted(true);
    setNoProgramsMessageSuppressed(false);
    editBaseFormRef.current = null;
    setPhase("done");
    setEligiblePrograms([]);
    setNearMissPrograms([]);
    setShowTableProgramCheckboxes(false);
    setEligibilityTableMsgId(null);
    setDetailsReady(false);
    setChatStarted(false);
    setKnowMoreDetailReady(false);
    activeKnowMoreMsgIdRef.current = null;
    setSelectedProgram("");
    setDetailsInput("");
    setSessionId("");
    setEligibilityLabel("");
    setThinkingLabel("");
    setMessages([]);
    setDetailPhase("none");
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingText(null);
    if (editBoundaryPhase !== null) setEditBoundaryPhase(null);

    // Build a safe-defaults snapshot for missing Step 4 fields
    const safeSnap: typeof emptyForm = {
      ...form,
      state: form.state || "",
      isRuralProperty: form.isRuralProperty || "No",
      acreage: form.acreage || "",
      decliningMarket: form.decliningMarket || "",
      propertyCondition: form.propertyCondition || "Good",
      vacantProperty: form.vacantProperty || "No",
      stateCounty: form.stateCounty || "",
      stateCity: form.stateCity || "",
      stateBorough: form.stateBorough || "",
      stateZipCode: form.stateZipCode || "",
      isInBaltimoreCity: form.isInBaltimoreCity || "No",
      isInIndianapolis: form.isInIndianapolis || "No",
      isInPhiladelphia: form.isInPhiladelphia || "No",
    };

    const { docForApi, dtiForApi, prepForApi } = getApiValuesFromForm(safeSnap);
    const creditEv = buildCreditEventFromForm(safeSnap);
    setMessages([
      {
        id: ELIGIBILITY_SCAN_MSG_ID,
        role: "assistant",
        content: `LOADING:Preview — scanning programs (geography not specified)…`,
      },
    ]);
    await runEligibility({
      docForApi,
      dtiForApi,
      prepForApi,
      creditEv,
      showLoadingMsg: false,
      removeMsgIds: [ELIGIBILITY_SCAN_MSG_ID],
      formSnap: safeSnap,
    });
    setDetailPhase("complete");
  };

  const getApiValues = () => {
    const docForApi = isDscrPath() ? "DSCR" : mapDocumentationForApi(form.documentationType);
    const dtiForApi = isDscrPath() ? form.estimatedDti.trim() || "45" : form.estimatedDti;
    const rawPrep = form.prepaymentTerms === "No Penalty" ? "None" : form.prepaymentTerms;
    const prepForApi =
      form.occupancy === "Investment Property" ? rawPrep : rawPrep.trim() || "None";
    const stepdownForApi = normalizeStepdown(
      isStepdownNA(form.prepaymentTerms) ? "Not Applicable" : form.prepayStepdown,
    );
    return { docForApi, dtiForApi, prepForApi, stepdownForApi };
  };

  const runSneakPeekStep3 = async () => {
    if (sneakPeekLoading) return;
    setSneakPeekLoading(true);
    setSneakPeekOpen(true);
    const safeForm = {
      ...form,
      state: form.state || "",
      isRuralProperty: form.isRuralProperty || "No",
      acreage: form.acreage || "",
      propertyCondition: form.propertyCondition || "Good",
      vacantProperty: form.vacantProperty || "No",
      stateCounty: form.stateCounty || "",
      stateCity: form.stateCity || "",
      stateBorough: form.stateBorough || "",
      stateZipCode: form.stateZipCode || "",
      isInBaltimoreCity: form.isInBaltimoreCity || "No",
      isInIndianapolis: form.isInIndianapolis || "No",
      isInPhiladelphia: form.isInPhiladelphia || "No",
    };
    try {
      const base = apiBase.replace(/\/$/, "");
      const creditEv = buildCreditEventFromForm(safeForm);
      const payload = buildQuickScanPayloadFromForm(
        { ...safeForm, investmentIncomePath: safeForm.investmentIncomePath },
        creditEv,
      );
      const res = await postEligibilityQuick(base, payload);
      if (res.ok) {
        const data = (await res.json()) as QuickEligibilityApiResponse;
        const names = Array.isArray(data.program_names) ? data.program_names : [];
        const programs = names.map(eligibleProgramNameStub);
        setSneakPeekPrograms(programs);
        setQuickCount(typeof data.count === "number" ? data.count : programs.length);
      }
    } catch {
      /* silently ignore */
    } finally {
      setSneakPeekLoading(false);
    }
  };

  const runSneakPeek = async () => {
    if (!locationComplete || sneakPeekLoading) return;
    setSneakPeekLoading(true);
    setSneakPeekOpen(true);
    try {
      const base = apiBase.replace(/\/$/, "");
      const creditEv = buildCreditEventFromForm(form);
      const payload = buildQuickScanPayloadFromForm(
        { ...form, investmentIncomePath: form.investmentIncomePath },
        creditEv,
      );
      const res = await postEligibilityQuick(base, payload);
      if (res.ok) {
        const data = (await res.json()) as QuickEligibilityApiResponse;
        const names = Array.isArray(data.program_names) ? data.program_names : [];
        const programs = names.map(eligibleProgramNameStub);
        setSneakPeekPrograms(programs);
        setQuickCount(typeof data.count === "number" ? data.count : programs.length);
      }
    } catch {
      /* silently ignore */
    } finally {
      setSneakPeekLoading(false);
    }
  };

  /** Sidebar eye-toggle: flip the count to a live list of currently-eligible programs. */
  const toggleSidebarPreview = async () => {
    if (sidebarPreviewOpen) {
      setSidebarPreviewOpen(false);
      return;
    }
    // Post-submit: show the actual matched programs without re-fetching.
    if (eligiblePrograms.length > 0) {
      setSidebarPreviewPrograms(eligiblePrograms);
      setSidebarPreviewOpen(true);
      return;
    }
    setSidebarPreviewLoading(true);
    setSidebarPreviewOpen(true);
    try {
      const base = apiBase.replace(/\/$/, "");
      const creditEv = buildCreditEventFromForm(form);
      const payload = buildQuickScanPayloadFromForm(
        { ...form, investmentIncomePath: form.investmentIncomePath },
        creditEv,
      );
      const res = await postEligibilityQuick(base, payload, { includePrograms: true });
      if (res.ok) {
        const data = (await res.json()) as QuickEligibilityApiResponse;
        const programs = eligibleProgramsFromQuickApi(data.eligible) as EligibleProgram[];
        setSidebarPreviewPrograms(
          programs.length > 0
            ? programs
            : (Array.isArray(data.program_names) ? data.program_names : []).map(
                eligibleProgramNameStub,
              ),
        );
        if (typeof data.count === "number") setQuickCount(data.count);
      }
    } catch {
      /* silently ignore */
    } finally {
      setSidebarPreviewLoading(false);
    }
  };

  const refreshSidebarCount = async (formSnap: typeof form) => {
    try {
      const base = apiBase.replace(/\/$/, "");
      const creditEv = buildCreditEventFromForm(formSnap);
      const formSnapForQuick: QuickEligibilityFormSnap = {
        ...formSnap,
        investmentIncomePath: formSnap.investmentIncomePath,
      };
      const payload = buildQuickScanPayloadFromForm(formSnapForQuick, creditEv);
      const res = await postEligibilityQuick(base, payload);
      if (res.ok) {
        const data = (await res.json()) as QuickEligibilityApiResponse;
        const count = typeof data.count === "number" ? data.count : 0;
        setQuickCount(count);
        // When preferences are active on step 5, also update the preliminary matches panel
        if (activeStep === 5 && Array.isArray(data.program_names)) {
          setSneakPeekPrograms(data.program_names.map(eligibleProgramNameStub));
        }
      }
    } catch {
      /* silent */
    }
  };

  const runEligibility = async (opts: {
    docForApi: string;
    dtiForApi: string;
    prepForApi: string;
    creditEv: string;
    showLoadingMsg?: boolean;
    removeMsgIds?: string[];
    formSnap?: typeof emptyForm;
    /** When true, streamed result messages replace the thread instead of appending. */
    replaceThread?: boolean;
    /** Use exact payload from saved scenario (history restore). */
    payloadOverride?: Record<string, string>;
    /** Fetch + update state only — no loading UI or chat messages. */
    silent?: boolean;
    /** Override default "Running eligibility check" loading copy. */
    loadingLabel?: string;
  }) => {
    const f = opts.formSnap ?? form;
    if (!opts.silent) setLoading(true);
    const loadingMsgId = "eligibility-loading";

    if (opts.showLoadingMsg !== false && !opts.silent) {
      setMessages((m) => [
        ...m,
        {
          id: loadingMsgId,
          role: "assistant" as const,
          content: `LOADING:${opts.loadingLabel ?? ELIGIBILITY_RUN_LABEL}`,
        },
      ]);
    }

    const removeLoadingMsg = () => {
      setLoading(false);
      setEligibilityLabel("");
      const dropIds = new Set([
        ...(opts.showLoadingMsg !== false && !opts.silent ? [loadingMsgId] : []),
        ...(opts.removeMsgIds ?? []),
      ]);
      if (dropIds.size > 0) {
        setMessages((m) => m.filter((msg) => !dropIds.has(msg.id)));
      }
    };

    try {
      const base = apiBase.replace(/\/$/, "");
      const formSnap: QuickEligibilityFormSnap = {
        ...f,
        investmentIncomePath: f.investmentIncomePath,
      };
      const payload = opts.payloadOverride ?? {
        ...buildEligibilityPayloadFromForm(formSnap, opts.creditEv ?? ""),
        creditEventType: f.creditEventType,
        yearsSinceEvent: f.creditEventDate
          ? computeExactYearsSince(f.creditEventDate)
          : f.yearsSinceCreditEvent,
        establishedPrimaryRes: f.establishedPrimaryRes,
        visaType: f.visaType,
        cashInHandRequest: f.cashInHandRequest,
        acreage: f.acreage,
        isRuralProperty: f.isRuralProperty,
        decliningMarket: f.decliningMarket,
        nonOccupantCoBorrower: f.nonOccupantCoBorrower,
        noCbRelationship: f.noCbRelationship,
        noCbFico: f.noCbFico,
        noCbIncome: f.noCbIncome,
        entityVesting: f.entityVesting,
        tradelines: f.tradelines,
        assetsLiquidFunds: f.assetsLiquidFunds,
        giftFundsPercent: f.giftFundsPercent,
        loanTerm: f.loanTerm,
        interestOnlyPref: f.interestOnlyPref,
        rateTypePref: f.rateTypePref,
        powerOfAttorney: f.powerOfAttorney,
        listingSeasoning: f.listingSeasoning,
        scenarioNotes: [
          f.scenarioNotes,
          f.lienPosition ? `LienPosition=${f.lienPosition}` : "",
          f.secondLienProduct ? `SecondLienProduct=${f.secondLienProduct}` : "",
          f.ofacSanctioned ? `OFACSanctioned=${f.ofacSanctioned}` : "",
          f.hasUsCredit ? `HasUSCredit=${f.hasUsCredit}` : "",
          f.creditEvents.length ? `AdvancedCredit=${JSON.stringify(f.creditEvents)}` : "",
          Object.keys(f.creditEventYears).length
            ? `AdvancedCreditYears=${JSON.stringify(f.creditEventYears)}`
            : "",
          f.propertyType === CROSS_COLLATERAL_PROPERTY_CODE
            ? `CrossCollateral=${JSON.stringify({
                propertyCount: f.propertyCount,
                combinedPropertyValue: f.combinedPropertyValue,
                combinedLoanAmount: f.combinedLoanAmount,
                totalGrossRents: f.totalGrossRents,
                combinedPitia: f.combinedPitia,
                loanLevelDscr: f.loanLevelDscr,
              })}`
            : "",
        ]
          .filter(Boolean)
          .join(" | "),
      };

      const res = await postEligibilityFull(base, payload);

      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        throw new Error(
          res.status === 0 || res.type === "error"
            ? "Cannot reach the API server. Make sure the backend is running on port 8080."
            : `Server returned an unreadable response (HTTP ${res.status}).`,
        );
      }
      if (!res.ok) throw new Error((data.detail as string) || `HTTP ${res.status}`);

      const eligible = (data.eligible as EligibleProgram[] | undefined) ?? [];
      const nearMisses = (data.near_misses as NearMissProgram[] | undefined) ?? [];
      const totalScreened = Number(data.total_screened ?? 0);
      const geoBlocked = Number(data.geo_blocked_count ?? 0);
      const overlayBlocked = Number(data.overlay_blocked_count ?? 0);
      const exclusions = parseExclusionsFromApi(data);
      setSessionId((data.session_id as string) || "");
      setEligiblePrograms(eligible);
      setNearMissPrograms(nearMisses);
      setSaveProfileStatus("idle");
      eligibilityEverRanRef.current = true;
      if (!opts.silent) {
        // Capture after React applies post-submit effects (LTV sync, chat defaults).
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            captureSubmittedFormSnapshot(formSyncRef.current);
          });
        });
      }

      if (opts.silent) {
        setMessages((prev) => {
          let tableIdx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].content.startsWith("ELIGIBILITY_TABLE:")) {
              tableIdx = i;
              break;
            }
          }
          if (tableIdx < 0) return prev;
          const parsed = parseEligibilityTableMessage(prev[tableIdx].content);
          if (!parsed) return prev;
          const nextContent = `ELIGIBILITY_TABLE:${JSON.stringify({
            ...parsed,
            eligible,
            nearMisses,
            totalScreened,
            geoBlocked,
            overlayBlocked,
            geoExclusions: exclusions.geoExclusions,
            overlayExclusions: exclusions.overlayExclusions,
          })}`;
          if (nextContent === prev[tableIdx].content) return prev;
          return prev.map((m, i) => (i === tableIdx ? { ...m, content: nextContent } : m));
        });
        removeLoadingMsg();
        return eligible;
      }

      if (!data.available) {
        const stateLabel = STATES.find((s) => s.code === form.state)?.label || form.state;
        const prompt = [
          "Match suitable non-agency mortgage programs for this scenario. Be concise.",
          `Citizenship: ${form.citizenship}`,
          `Occupancy: ${form.occupancy}`,
          `Loan Purpose: ${form.loanPurpose}`,
          `State: ${stateLabel} (${form.state})`,
          `Property value: $${form.valueSalesPrice}`,
          `LTV: ${form.ltv}%`,
          `${loanAmountFieldLabel(form.isSecondLien)}: $${form.loanAmount}`,
          `Estimated DTI: ${opts.dtiForApi}%`,
          `Documentation Type: ${opts.docForApi}`,
          `Property Type: ${form.propertyType}`,
          form.rentalType ? `Rental type: ${form.rentalType}` : "",
          isDscrPath() ? `DSCR: ${form.dscr}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const cr = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: prompt, session_id: sessionId, selected_program: null }),
        });
        let cd: Record<string, unknown> = {};
        try {
          cd = await cr.json();
        } catch {
          /* ignore */
        }
        const content = ((cd.reply as string) || "").trim() || "Program matching completed.";
        removeLoadingMsg();
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content,
            sources: (cd.sources as Msg["sources"]) ?? [],
          },
        ]);
        return;
      }

      removeLoadingMsg();

      if (eligible.length === 0) {
        setShowTableProgramCheckboxes(false);
        setEligibilityTableMsgId(null);
        setDetailsReady(false);
        setSelectedProgram("");
        const summaryParts = [
          geoBlocked > 0 ? `${geoBlocked} excluded by geographic restrictions` : "",
          overlayBlocked > 0 ? `${overlayBlocked} excluded by overlay rules` : "",
        ].filter(Boolean);
        let zeroMsg = `**No Programs Found.**`;
        if (summaryParts.length > 0)
          zeroMsg += `\nScreened ${totalScreened} candidate${totalScreened !== 1 ? "s" : ""}: ${summaryParts.join(", ")}.`;
        zeroMsg += `\n\nSee exclusion details below for the exact restriction language. Adjust your scenario and try again, or contact a representative for options.`;
        const zeroPayload = {
          eligible: [],
          nearMisses,
          totalScreened,
          geoBlocked,
          overlayBlocked,
          geoExclusions: exclusions.geoExclusions,
          overlayExclusions: exclusions.overlayExclusions,
        };
        const streamMode = opts.replaceThread ? "replace" : "append";
        streamMessage(zeroMsg, streamMode, 0, () => {
          setMessages((m) => [
            ...m,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: `ELIGIBILITY_TABLE:${JSON.stringify(zeroPayload)}`,
            },
          ]);
        });
        return;
      }

      const tableMsgId = crypto.randomUUID();
      setEligibilityTableMsgId(tableMsgId);
      setShowTableProgramCheckboxes(false);
      setGeneralResultsChat(false);
      setKnowMoreActivated(false);
      setKnowMoreHinted(true);
      setSelectedProgram("");
      const tablePayload = {
        eligible,
        nearMisses,
        totalScreened,
        geoBlocked,
        overlayBlocked,
        geoExclusions: exclusions.geoExclusions,
        overlayExclusions: exclusions.overlayExclusions,
      };
      const tableMsg: Msg = {
        id: tableMsgId,
        role: "assistant",
        content: `ELIGIBILITY_TABLE:${JSON.stringify(tablePayload)}`,
      };
      const appendTable = () => setMessages((m) => [...m, tableMsg]);
      const streamMode = opts.replaceThread ? "replace" : "append";
      streamMessage(GOOD_NEWS_RESULTS_MSG, streamMode, 0, appendTable);
    } catch (err: any) {
      removeLoadingMsg();
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error running eligibility check.\n\n${err?.message || String(err)}`,
        },
      ]);
    }
  };

  // Refresh stale Know More metrics (old session snapshots duplicated tier values).
  useEffect(() => {
    if (!knowMoreDetailReady) return;
    const activeId = activeKnowMoreMsgIdRef.current;
    if (!activeId) return;
    const pool = resolveEligibleProgramPool(messages, eligiblePrograms);
    const activeMsg = messages.find((m) => m.id === activeId);
    if (!activeMsg?.content.startsWith("PROGRAM_DETAIL:")) return;
    try {
      const embedded = JSON.parse(
        activeMsg.content.slice("PROGRAM_DETAIL:".length),
      ) as EligibleProgram;
      const resolved = resolveKnowMoreProgram(embedded, pool);
      if (!programMetricsLookStale(resolved)) return;
    } catch {
      return;
    }
    if (knowMoreMetricsRefreshRef.current || loading) return;
    knowMoreMetricsRefreshRef.current = true;
    const { docForApi, dtiForApi, prepForApi } = getApiValues();
    const creditEv = buildCreditEventFromForm(form);
    void runEligibility({
      docForApi,
      dtiForApi,
      prepForApi,
      creditEv,
      showLoadingMsg: false,
      silent: true,
    }).finally(() => {
      knowMoreMetricsRefreshRef.current = false;
    });
  }, [knowMoreDetailReady, messages, eligiblePrograms, form, loading]);

  const openProgramPicker = () => {
    setGeneralResultsChat(false);
    setDocChatActive(false);
    activeKnowMoreMsgIdRef.current = null;
    setChatStarted(false);
    setKnowMoreDetailReady(false);
    setDetailsReady(false);
    setDetailsInput("");
    setSelectedProgram("");
    setKnowMoreActivated(false);
    setShowTableProgramCheckboxes(true);
  };

  const closeProgramPicker = () => {
    setKnowMoreActivated(false);
    setKnowMoreHinted(false);
    setShowTableProgramCheckboxes(false);
  };

  const clearFollowUpChat = () => {
    setMessages((m) =>
      m.filter((msg) => {
        if (generalResultsChat && !docChatActive) return !isGeneralChatMessage(msg);
        return !isProgramChatMessage(msg);
      }),
    );
    setDetailsInput("");
  };

  const openResultsChat = () => {
    if (programFocusMode) return;
    setKnowMoreActivated(false);
    setKnowMoreHinted(false);
    setDocChatActive(false);
    activeKnowMoreMsgIdRef.current = null;
    setShowTableProgramCheckboxes(false);
    setGeneralResultsChat(true);
    setChatStarted(true);
    setKnowMoreDetailReady(true);
    setDetailsReady(true);
    scrollChatToBottom("smooth");
  };

  const handleSkipProgramSelection = () => {
    if (programFocusMode) return;
    openResultsChat();
  };

  const handleKnowMoreAction = () => {
    if (programFocusMode) return;
    setKnowMoreHinted(false);
    if (showTableProgramCheckboxes && !selectedProgram) {
      closeProgramPicker();
      return;
    }
    if (!showTableProgramCheckboxes) {
      openProgramPicker();
      return;
    }
    if (selectedProgram) setKnowMoreActivated(true);
  };

  const proceedWithSelectedProgram = () => {
    void proceedWithSelectedProgramAsync();
  };

  const proceedWithSelectedProgramAsync = async () => {
    if (!selectedProgram) {
      toast.error("Please select a program first.");
      return;
    }
    let pool = eligibleProgramPool;
    let prog = findProgramBySelectKey(pool, selectedProgram);
    if (!prog) {
      toast.error("Could not load the selected program. Please select again.");
      return;
    }

    if (programMetricsLookStale(resolveKnowMoreProgram(prog, pool))) {
      const { docForApi, dtiForApi, prepForApi } = getApiValues();
      const creditEv = buildCreditEventFromForm(form);
      const fresh = await runEligibility({
        docForApi,
        dtiForApi,
        prepForApi,
        creditEv,
        showLoadingMsg: false,
        silent: true,
      });
      if (fresh?.length) {
        pool = fresh;
        prog = findProgramBySelectKey(pool, selectedProgram) ?? prog;
      }
    }

    const displayProg = resolveKnowMoreProgram(prog, pool);

    const detailMsgId = crypto.randomUUID();
    activeKnowMoreMsgIdRef.current = detailMsgId;
    setDetailsReady(true);
    setShowTableProgramCheckboxes(false);
    setGeneralResultsChat(false);
    setChatStarted(true);
    setKnowMoreDetailReady(true);
    setDocChatActive(false);

    const progInitial: EligibleProgram = {
      ...displayProg,
      summary_notes: null,
      summary_bullets: null,
    };

    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: `Know more: ${programDisplayName(displayProg)}`,
        chatScope: "program",
      },
      {
        id: detailMsgId,
        role: "assistant",
        content: `PROGRAM_DETAIL:${JSON.stringify(progInitial)}`,
        chatScope: "program",
      },
    ]);
    scrollChatToBottom("smooth");

    const allRawNotes = [
      ...(displayProg.special_overlay ? [displayProg.special_overlay] : []),
      ...filterNotesForSummarize(displayProg.rag_notes ?? []),
    ];
    if (allRawNotes.length === 0) return;

    void (async () => {
      try {
        const res = await fetch("/api/summarize-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: allRawNotes,
            program_name: displayProg.program_name,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { summary?: string; bullets?: string[] };
        const summaryBullets =
          Array.isArray(data.bullets) && data.bullets.length > 0
            ? limitConsiderationBullets(data.bullets)
            : null;
        if (!summaryBullets?.length && !data.summary?.trim()) return;
        if (activeKnowMoreMsgIdRef.current !== detailMsgId) return;
        const progWithSummary: EligibleProgram = {
          ...displayProg,
          summary_notes: data.summary?.trim() || null,
          summary_bullets: summaryBullets,
        };
        const nextContent = `PROGRAM_DETAIL:${JSON.stringify(progWithSummary)}`;
        setMessages((m) => {
          const existing = m.find((msg) => msg.id === detailMsgId);
          if (existing?.content === nextContent) return m;
          return m.map((msg) => (msg.id === detailMsgId ? { ...msg, content: nextContent } : msg));
        });
        scrollChatToBottom("smooth");
      } catch {
        if (activeKnowMoreMsgIdRef.current !== detailMsgId) return;
        const fallbackBullets = limitConsiderationBullets([
          ...(prog.special_overlay ? [prog.special_overlay] : []),
          ...(prog.rag_notes ?? []),
        ]);
        if (!fallbackBullets.length) return;
        const nextContent = `PROGRAM_DETAIL:${JSON.stringify({
          ...prog,
          summary_notes: null,
          summary_bullets: fallbackBullets,
        })}`;
        setMessages((m) =>
          m.map((msg) => (msg.id === detailMsgId ? { ...msg, content: nextContent } : msg)),
        );
        scrollChatToBottom("smooth");
      }
    })();
  };

  // ── progress bars ────────────────────────────────────────────────

  const showProfileFieldGaps = profileGapsForced || detailPhase === "complete" || formSubmitted;
  const allProfileSections = useMemo(() => {
    const base = buildProfileSections(form, maxReachedStep);
    if (!showProfileFieldGaps) return base;
    const missing = collectMissingRequiredProfileRows(form, {
      creditScoreOk,
      creditScoreRequired,
    });
    return enrichProfileSectionsForEdit(base, missing);
  }, [
    form,
    maxReachedStep,
    showProfileFieldGaps,
    creditScoreOk,
    creditScoreRequired,
    geoConfigRevision,
  ]);
  // The /form chat-card reskin walks all sections without advancing activeStep,
  // so reveal every answered section (empty ones are filtered out upstream).
  const formChatActive =
    intakeMode === "form" && phase === "first" && !formSubmitted && detailPhase !== "complete";
  const showAllSections =
    formSubmitted ||
    detailPhase === "complete" ||
    phase === "done" ||
    intakeMode === "chat" ||
    formChatActive;
  const profileSections = allProfileSections.filter((s) => showAllSections || s.step <= activeStep);
  const productDisplayPrefs = useMemo(
    () => productDisplayPrefsFromForm(form),
    [form.loanTerm, form.firstTimeHomebuyer, form.interestOnlyPref, form.rateTypePref],
  );

  const selectedProgramRecord = useMemo(
    () =>
      selectedProgram ? findProgramBySelectKey(eligibleProgramPool, selectedProgram) : undefined,
    [eligiblePrograms, selectedProgram],
  );

  /** Know-more / doc chat with a chosen program — hide results table until Exit. */
  const programFocusMode =
    !!selectedProgramRecord &&
    !showTableProgramCheckboxes &&
    (docChatActive || (knowMoreDetailReady && detailsReady && chatStarted && !generalResultsChat));

  // ── Save profile to form_history_scenario ───────────────────────────────

  const capturePreVaultSnapshot = useCallback(() => {
    preVaultSnapshotRef.current = {
      form: { ...formSyncRef.current },
      revealForm: { ...revealForm },
      phase,
      formSubmitted,
      activeStep,
      maxReachedStep,
      chatIntakeStep,
      messages: messages.slice(),
      eligiblePrograms: eligiblePrograms.slice(),
      eligibilityTableMsgId,
      formChatMountKey,
      detailPhase,
      editBoundaryPhase,
      quickCount,
      resultsHeaderText,
      lastSubmittedFormSnapshot: lastSubmittedFormSnapshotRef.current,
      lastVaultSavedSnapshot: lastVaultSavedSnapshotRef.current,
      sidebarOpen,
      showTableProgramCheckboxes,
      detailsReady,
      chatStarted,
      knowMoreDetailReady,
      generalResultsChat,
      docChatActive,
      loading,
      eligibilityEverRan: eligibilityEverRanRef.current,
    };
  }, [
    revealForm,
    phase,
    formSubmitted,
    activeStep,
    maxReachedStep,
    chatIntakeStep,
    messages,
    eligiblePrograms,
    eligibilityTableMsgId,
    formChatMountKey,
    detailPhase,
    editBoundaryPhase,
    quickCount,
    resultsHeaderText,
    sidebarOpen,
    showTableProgramCheckboxes,
    detailsReady,
    chatStarted,
    knowMoreDetailReady,
    generalResultsChat,
    docChatActive,
    loading,
  ]);

  const restorePreVaultSnapshot = useCallback((snap: PreVaultSnapshot) => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingText(null);
    setStreamingMsgId(null);
    setGeneralResultsChat(snap.generalResultsChat);
    setDocChatActive(snap.docChatActive);
    setKnowMoreDetailReady(snap.knowMoreDetailReady);
    setChatStarted(snap.chatStarted);
    setShowTableProgramCheckboxes(snap.showTableProgramCheckboxes);
    setSelectedProgram("");
    setDetailsInput("");
    setDetailsReady(snap.detailsReady);
    setSaveProfileStatus("idle");
    activeKnowMoreMsgIdRef.current = null;

    setForm(snap.form);
    setRevealForm(snap.revealForm);
    formSyncRef.current = snap.form;
    setFormSubmitted(snap.formSubmitted);
    setPhase(snap.phase);
    setActiveStep(snap.activeStep);
    setMaxReachedStep(snap.maxReachedStep);
    setChatIntakeStep(snap.chatIntakeStep);
    setSidebarOpen(isDesktopSidebarLayout() ? true : snap.sidebarOpen);
    setMessages(snap.messages);
    setEligiblePrograms(snap.eligiblePrograms);
    setEligibilityTableMsgId(snap.eligibilityTableMsgId);
    setDetailPhase(snap.detailPhase);
    setEditBoundaryPhase(snap.editBoundaryPhase);
    setQuickCount(snap.quickCount);
    setResultsHeaderText(snap.resultsHeaderText);
    lastSubmittedFormSnapshotRef.current = snap.lastSubmittedFormSnapshot;
    lastVaultSavedSnapshotRef.current = snap.lastVaultSavedSnapshot;
    setSubmittedSnapshotToken((t) => t + 1);
    setVaultSavedSnapshotToken((t) => t + 1);
    setLoading(snap.loading);
    eligibilityEverRanRef.current = snap.eligibilityEverRan;
    setFormChatMountKey((k) => k + 1);
  }, []);

  const handleVaultBack = useCallback(() => {
    if (viewingVaultScenarioRef.current && preVaultSnapshotRef.current) {
      restorePreVaultSnapshot(preVaultSnapshotRef.current);
      viewingVaultScenarioRef.current = false;
      onViewingHistoryScenarioChange?.(false);
    }
    preVaultSnapshotRef.current = null;
    setEditingHistoryId(null);
    onHistoryOpenChange?.(false);
  }, [onHistoryOpenChange, onViewingHistoryScenarioChange, restorePreVaultSnapshot]);

  // Reopen the vault list (keeps the pre-vault snapshot intact) — used by the
  // "Back to Scenario Vault" link after opening a scenario via Edit/Clone.
  const handleBackToVault = useCallback(() => {
    onHistoryOpenChange?.(true);
  }, [onHistoryOpenChange]);

  /** Welcome home — exit intake/results/vault UI; FormChatFlow hides the profile sidebar. */
  const handleGoHomeIntake = useCallback(() => {
    setFormSubmitted(false);
    setPhase("first");
    setDetailPhase("none");
    setEditBoundaryPhase(null);
    setLoading(false);
    setEligiblePrograms([]);
    setNearMissPrograms([]);
    setQuickCount(30);
    setSidebarOpen(isDesktopSidebarLayout());
    setSidebarPreviewOpen(false);
    setEditingHistoryId(null);
    viewingVaultScenarioRef.current = false;
    preVaultSnapshotRef.current = null;
    onHistoryOpenChange?.(false);
    onViewingHistoryScenarioChange?.(false);
  }, [onHistoryOpenChange, onViewingHistoryScenarioChange]);

  useEffect(() => {
    if (historyOpen && !prevHistoryOpenRef.current && !viewingVaultScenarioRef.current) {
      capturePreVaultSnapshot();
    }
    prevHistoryOpenRef.current = historyOpen;
  }, [historyOpen, capturePreVaultSnapshot]);

  const handleLoadHistoryScenario = async (
    detail: FormHistoryDetail,
    opts: { editId?: number | null } = {},
  ) => {
    if (loading) return;

    // Edit → remember the record id (Save updates it in place, keeping its
    // name/contact). Clone / plain open → null (Save creates a new record).
    setEditingHistoryId(opts.editId ?? null);

    viewingVaultScenarioRef.current = true;

    const restored = {
      ...emptyForm,
      ...wizardFormFromSavedFields(detail.form_fields),
    } as typeof emptyForm;

    // Prevent occupancy/path change effects from wiping restored financial fields.
    prevOccRef.current = restored.occupancy;
    prevPathRef.current = restored.investmentIncomePath;

    onHistoryOpenChange?.(false);
    onViewingHistoryScenarioChange?.(true);

    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypingText(null);
    setStreamingMsgId(null);
    setGeneralResultsChat(false);
    setDocChatActive(false);
    setKnowMoreDetailReady(false);
    setChatStarted(false);
    setShowTableProgramCheckboxes(false);
    setKnowMoreActivated(false);
    setKnowMoreHinted(true);
    setSelectedProgram("");
    setDetailsInput("");
    setDetailsReady(false);
    setSaveProfileStatus("idle");
    activeKnowMoreMsgIdRef.current = null;

    setForm(restored);
    setRevealForm(restored);
    setFormSubmitted(true);
    setPhase("done");
    setActiveStep(5);
    setMaxReachedStep(6);
    setDetailPhase("complete");
    setEditBoundaryPhase(null);
    setChatIntakeStep(null);
    setSidebarOpen(true);
    captureSubmittedFormSnapshot(restored);
    setQuickCount(detail.programs_matched);
    eligibilityEverRanRef.current = true;
    setResultsHeaderText(RESULTS_HEADER_FULL);
    resultsHeaderStreamedIdRef.current = null;
    setMessages([]);
    setSaveProfileStatus("idle");
    captureVaultSavedSnapshot(restored);
    // Remount FormChatFlow immediately so sidebar + chat reflect restored form (not stale state).
    setFormChatMountKey((k) => k + 1);

    const { docForApi, dtiForApi, prepForApi } = getApiValuesFromForm(restored);
    const creditEv =
      String(detail.form_fields.creditEvent ?? "").trim() || buildCreditEventFromForm(restored);

    await runEligibility({
      docForApi,
      dtiForApi,
      prepForApi,
      creditEv,
      formSnap: restored,
      replaceThread: true,
      payloadOverride: eligibilityPayloadFromSavedFields(detail.form_fields),
      loadingLabel: ELIGIBILITY_RELOAD_LABEL,
    });
  };

  const buildFormFieldsForSave = useCallback(() => {
    const creditEv = buildCreditEventFromForm(form);
    const { docForApi, dtiForApi, prepForApi } = getApiValues();
    const formSnap: QuickEligibilityFormSnap = {
      ...form,
      investmentIncomePath: form.investmentIncomePath,
    };
    const eligibilityPayload = {
      ...buildEligibilityPayloadFromForm(formSnap, creditEv),
      creditEventType: form.creditEventType,
      yearsSinceEvent: form.creditEventDate
        ? computeExactYearsSince(form.creditEventDate)
        : form.yearsSinceCreditEvent,
      rentalType: form.rentalType,
      investmentIncomePath: form.investmentIncomePath,
      qualificationPath: form.investmentIncomePath,
      establishedPrimaryRes: form.establishedPrimaryRes,
      visaType: form.visaType,
      estimatedDti: dtiForApi,
      documentationType: docForApi,
      prepaymentTerms: prepForApi,
      prepayStepdown: form.prepayStepdown,
      nonOccupantCoBorrower: form.nonOccupantCoBorrower,
      entityVesting: form.entityVesting,
      tradelines: form.tradelines,
      assetsLiquidFunds: form.assetsLiquidFunds,
      giftFundsPercent: form.giftFundsPercent,
      powerOfAttorney: form.powerOfAttorney,
      listingSeasoning: form.listingSeasoning,
      scenarioNotes: form.scenarioNotes,
      propertyCondition: form.propertyCondition,
      acreage: form.acreage,
      isRuralProperty: form.isRuralProperty,
      decliningMarket: form.decliningMarket,
      cashInHandRequest: form.cashInHandRequest,
    };
    return buildFormFieldsForHistorySave(
      form as unknown as Record<string, unknown>,
      eligibilityPayload,
    );
  }, [form]);

  const handleSaveProfileMeta = async (meta: SaveProfileVaultMeta) => {
    if (programFocusMode || saveProfileStatus === "saving") return;
    setSaveProfileStatus("saving");
    try {
      await saveFormHistory({
        client_name: meta.client_name,
        scenario_description: meta.scenario_description,
        client_phone: meta.client_phone,
        client_email: meta.client_email,
        status: meta.status,
        origin: intakeMode,
        session_id: sessionId || undefined,
        form_fields: {
          ...buildFormFieldsForSave(),
          [VAULT_SCENARIO_DESCRIPTION_KEY]: meta.scenario_description,
        },
      });
      setSaveProfileStatus("saved");
      setSaveProfileDialogOpen(false);
      captureVaultSavedSnapshot();
      toast.success("Stored to Vault");
    } catch (err) {
      setSaveProfileStatus("error");
      toast.error(err instanceof Error ? err.message : "Could not save scenario");
    }
  };

  // Edit-in-place: update the record opened via Edit, keeping its name/contact.
  const handleUpdateInPlace = async () => {
    if (editingHistoryId == null || programFocusMode || saveProfileStatus === "saving") return;
    setSaveProfileStatus("saving");
    try {
      await updateFormHistory(editingHistoryId, {
        form_fields: buildFormFieldsForSave(),
      });
      setSaveProfileStatus("saved");
      captureVaultSavedSnapshot();
      toast.success("Scenario updated");
    } catch (err) {
      setSaveProfileStatus("error");
      toast.error(err instanceof Error ? err.message : "Could not update scenario");
    }
  };

  // Results-screen Save button: update the edited record in place, otherwise
  // open the dialog to store a new (or cloned) scenario.
  const handleSaveOrUpdate = () => {
    if (editingHistoryId != null) {
      void handleUpdateInPlace();
    } else {
      openSaveProfileDialog();
    }
  };

  const openSaveProfileDialog = () => {
    if (programFocusMode || !canSaveToVault) return;
    setSaveProfileStatus("idle");
    setSaveProfileDialogOpen(true);
  };

  const handleEditHistoryScenario = (detail: FormHistoryDetail) =>
    handleLoadHistoryScenario(detail, { editId: detail.id });
  const handleCloneHistoryScenario = (detail: FormHistoryDetail) =>
    handleLoadHistoryScenario(detail, { editId: null });

  /**
   * Results-screen follow-up chat. Builds the same `results_general` payload the
   * legacy done-phase chat uses and returns just the reply text — the new
   * ResultsScreen dock owns its own message thread, so we don't touch `messages`.
   */
  const handleResultsAsk = async (
    question: string,
    opts?: { program?: EligibleProgram },
  ): Promise<string> => {
    const base = apiBase.replace(/\/$/, "");
    const stateLabel = STATES.find((s) => s.code === form.state)?.label || form.state;
    const scenarioSummary = [
      `Citizenship=${form.citizenship}`,
      `Occupancy=${form.occupancy}`,
      `Purpose=${form.loanPurpose}`,
      `State=${stateLabel} (${form.state})`,
      `${loanAmountFieldLabel(form.isSecondLien)}=$${form.loanAmount}`,
      `LTV=${form.ltv}%`,
      isDscrPath() ? `DSCR=${form.dscr}` : `DTI=${form.estimatedDti}%`,
      `FICO=${form.decisionCreditScore}`,
      `Doc Type=${isDscrPath() ? "DSCR" : form.documentationType}`,
      `Property Type=${form.propertyType}`,
    ].join(" | ");

    let focused = opts?.program;
    if (!focused && selectedProgram && knowMoreActivated) {
      focused = findProgramBySelectKey(eligiblePrograms, selectedProgram);
    }

    let chatBody: Record<string, unknown>;
    if (focused) {
      const selectedForApi = [
        focused.investor_name || focused.investor,
        programDisplayName(focused),
      ]
        .filter(Boolean)
        .join(" - ");
      chatBody = {
        message: question,
        user_text: question,
        session_id: sessionId,
        scenario_summary: scenarioSummary,
        selected_program:
          selectedForApi || (focused.program_id != null ? `pid:${focused.program_id}` : null),
        program_id: focused.program_id ?? null,
        program: programDisplayName(focused),
      };
    } else {
      const eligibilityTableMsg = [...messages]
        .reverse()
        .find((msg) => msg.content.startsWith("ELIGIBILITY_TABLE:"));
      const eligibilityMeta = eligibilityTableMsg
        ? parseEligibilityTableMessage(eligibilityTableMsg.content)
        : null;
      const { docForApi, dtiForApi, prepForApi } = getApiValues();
      const creditEv = buildCreditEventApi();
      const dscrForApi = isDscrPath();

      chatBody = {
        message: question,
        mode: "results_general",
        session_id: sessionId,
        scenario_summary: scenarioSummary,
        matched_programs: eligibilityMeta?.eligible ?? eligiblePrograms,
        geo_exclusions: eligibilityMeta?.geoExclusions ?? [],
        overlay_exclusions: eligibilityMeta?.overlayExclusions ?? [],
        total_screened: eligibilityMeta?.totalScreened ?? eligiblePrograms.length,
        eligibility_request: {
          occupancy: form.occupancy,
          loanPurpose: form.loanPurpose,
          state: form.state,
          valueSalesPrice: form.valueSalesPrice,
          loanAmount: form.loanAmount,
          ltv: form.ltv,
          estimatedDti: dtiForApi,
          documentationType: docForApi,
          prepaymentTerms: prepForApi,
          propertyType: form.propertyType,
          citizenship: form.citizenship,
          decisionCreditScore: form.decisionCreditScore,
          existingFirstLien: form.existingFirstLien,
          cltv: form.cltv,
          dscr: dscrForApi ? form.dscr : "",
          creditEvent: creditEv,
          creditEventType: form.creditEventType,
          yearsSinceEvent: form.creditEventDate
            ? computeExactYearsSince(form.creditEventDate)
            : form.yearsSinceCreditEvent,
          firstTimeHomebuyer: form.firstTimeHomebuyer,
          paymentHistory: form.paymentHistory,
          firstTimeInvestor: form.firstTimeInvestor,
          establishedPrimaryRes: form.establishedPrimaryRes,
          isSecondLien: form.isSecondLien,
          stateCounty: form.stateCounty,
          stateCity: form.stateCity,
          stateBorough: form.stateBorough,
          stateZipCode: form.stateZipCode,
          isInBaltimoreCity: form.isInBaltimoreCity,
          isInIndianapolis: form.isInIndianapolis,
          isInPhiladelphia: form.isInPhiladelphia,
          isInMemphis: form.isInMemphis,
          isInLubbock: form.isInLubbock,
          loanTerm: form.loanTerm,
          interestOnlyPref: form.interestOnlyPref,
          rateTypePref: form.rateTypePref,
          nonOccupantCoBorrower: form.nonOccupantCoBorrower,
          noCbFico: form.noCbFico,
        },
      };
    }

    const cr = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody),
    });
    let cd: Record<string, unknown> = {};
    try {
      cd = await cr.json();
    } catch {
      throw new Error(`Cannot reach API server (HTTP ${cr.status}).`);
    }
    if (!cr.ok) throw new Error((cd.detail as string) || `HTTP ${cr.status}`);
    return ((cd.reply as string) || "").trim() || "I couldn't find an answer for that question.";
  };

  /**
   * Results "Apply & resubmit" — adjusts LTV (and DTI on income-path scenarios)
   * on a form snapshot, recomputes the loan amount from the fixed property value,
   * and re-runs eligibility (mirrors resubmitEligibility, but with the snapshot).
   */
  const handleApplyModify = async (changes: { ltv: number; dti: number | null }) => {
    const snap = { ...form };
    snap.ltv = String(Math.round(changes.ltv));
    const valueNum = Number(String(snap.valueSalesPrice).replace(/[,$\s]/g, ""));
    if (valueNum > 0) {
      snap.loanAmount = String(Math.round((valueNum * changes.ltv) / 100));
    }
    if (changes.dti != null) {
      snap.estimatedDti = String(Math.round(changes.dti));
    }

    if (eligibilityRerunTimerRef.current) {
      window.clearTimeout(eligibilityRerunTimerRef.current);
      eligibilityRerunTimerRef.current = null;
    }
    savedResultsSnapshotRef.current = null;
    clearResultsThread();
    clearEligibilityResults();
    setForm(snap);
    setPhase("done");
    setFormSubmitted(true);
    setDetailPhase("complete");
    setEditBoundaryPhase(null);

    const stateLabel = STATES.find((s) => s.code === snap.state)?.label || snap.state;
    const scanningLabel = `Scanning programs for your scenario${snap.state ? ` in ${stateLabel}` : ""}…`;
    setMessages([
      { id: ELIGIBILITY_SCAN_MSG_ID, role: "assistant", content: `LOADING:${scanningLabel}` },
    ]);

    const { docForApi, dtiForApi, prepForApi } = getApiValuesFromForm(snap);
    const creditEv = buildCreditEventFromForm(snap);
    await runEligibility({
      docForApi,
      dtiForApi,
      prepForApi,
      creditEv,
      formSnap: snap,
      showLoadingMsg: false,
      removeMsgIds: [ELIGIBILITY_SCAN_MSG_ID],
      replaceThread: true,
    });
  };

  // ── PDF export (page 1: borrower profile, page 2+: program scenarios) ──
  const handleDownloadOptions = async () => {
    if (programFocusMode || pdfDownloading) return;
    const sectionsForPdf = allProfileSections.map((sec) => ({
      title: sec.title,
      rows: sec.rows.map((r) => ({ label: r.label, value: r.value })),
    }));
    const programsForPdf = eligiblePrograms.map((p) => ({
      program_title: programDisplayName(p),
      investor_name: formatMortgageAcronyms(p.investor_name || p.investor || ""),
      products_display:
        formatProductsForScenario(p.products, p.products_available, productDisplayPrefs) ||
        p.products_available ||
        "",
      min_fico: p.min_fico,
      max_loan: p.max_loan,
      max_ltv_purchase: p.max_ltv_purchase,
      max_ltv_rate_term: p.max_ltv_rate_term,
      max_ltv_cashout: p.max_ltv_cashout,
      max_dti: p.max_dti,
      min_dscr: p.min_dscr,
      doc_type: p.doc_type,
      occupancy: p.occupancy,
      documentation_type: getProgramDocsDisplay(p) || undefined,
      special_overlay: p.special_overlay,
      considerations: limitConsiderationBullets(getProgramConsiderationBullets(p)),
    }));

    setPdfDownloading(true);
    const mobilePdf = isMobilePdfEnvironment();
    const mobilePdfWindow = mobilePdf ? window.open("about:blank", "_blank") : null;
    try {
      const result = await downloadScenarioPdf(
        apiBase,
        {
          profile_sections: sectionsForPdf,
          programs: programsForPdf,
          form_fields: buildFormFieldsForSave(),
        },
        { mobilePreviewWindow: mobilePdfWindow },
      );
      if (mobilePdfWindow && !mobilePdfWindow.closed && result !== "opened") {
        mobilePdfWindow.close();
      }
    } finally {
      setPdfDownloading(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────

  const showInFlowSidebar = !isMobileViewport || !sidebarOpen;
  const showMobileSidebarPortal = isMobileViewport && sidebarOpen;

  // FormChatFlow (its own sidebar + chat) renders full-bleed for:
  //  • /form intake (phase "first") AND
  //  • the post-submit RESULTS of BOTH modes (phase "done").
  // This makes the Chat-mode and Form-mode results experience identical —
  // chat intake (phase "chat") still uses the legacy chat UI, but once results
  // are ready both modes show the same in-chat FormChatFlow results.
  const isFormChatExperience =
    !historyOpen && ((intakeMode === "form" && phase === "first") || phase === "done");
  // Back-compat alias (older code paths reference this name).
  const isFormFreshIntake = isFormChatExperience;
  // /chat intake — prose-first ChatConversationFlow; results still use FormChatFlow.
  const isChatConversationIntake = !historyOpen && intakeMode === "chat" && phase !== "done";
  const showLegacyProfileSidebar = !historyOpen && !isFormChatExperience;
  // Once a scenario has actually been submitted (and a run isn't in flight), the
  // counter must reflect the REAL matched count — including 0 after an edit +
  // resubmit. The live quick-scan preview (quickCount) is only correct before the
  // first submit; during an in-flight (re)submit we keep showing the preview so the
  // count doesn't flash to 0. Using `eligiblePrograms.length > 0 ? … : quickCount`
  // here was the bug: a submit that matched 0 fell back to the stale quickCount.
  const showSubmittedMatchCount = (formSubmitted || detailPhase === "complete") && !loading;
  const formChatEligibleCount =
    form.ofacSanctioned === "Yes"
      ? 0
      : showSubmittedMatchCount
        ? eligiblePrograms.length
        : (quickCount ?? 30);

  const profileSidebarAsideClass = cn(
    "flex shrink-0 flex-col overflow-hidden border-r border-border bg-card",
    "transition-[width,box-shadow] duration-500 ease-in-out",
    sidebarOpen
      ? "w-[min(100vw,23rem)] pt-[env(safe-area-inset-top,0px)] shadow-xl sm:relative sm:inset-auto sm:z-auto sm:w-[23rem] sm:pt-0 sm:shadow-none"
      : "pointer-events-none w-0 min-w-0 overflow-hidden border-r-0 sm:pointer-events-auto sm:w-12",
    sidebarGlowing && "shadow-[0_0_0_1.5px_rgba(1,42,91,0.13),0_0_36px_rgba(1,42,91,0.13)]",
  );

  // Reset (header pill) is live once the scenario has any data or chat history.
  const sidebarResetActive = profileSections.length > 0 || messages.some((m) => m.role === "user");

  const wizardComposerColumn = FORM_CHAT_COLUMN;

  const sidebarShowActualResults = showSubmittedMatchCount;
  const sidebarProgCount =
    form.ofacSanctioned === "Yes"
      ? 0
      : showSubmittedMatchCount
        ? eligiblePrograms.length
        : (quickCount ?? 30);

  const handleProfileEdit = (_step: 1 | 2 | 3 | 4 | 5 | 6, _fieldKey?: string) => {
    // Form-mode edits are handled inside FormChatFlow; chat sidebar is display-only here.
  };

  const profileSidebarInner = (
    <ChatProfileSidebar
      expanded={sidebarOpen}
      onExpandedChange={setSidebarOpen}
      contentVisible={sidebarContentVisible}
      intakeMode={intakeMode}
      form={form}
      profileSections={profileSections}
      previewOpen={sidebarPreviewOpen}
      previewLoading={sidebarPreviewLoading}
      previewPrograms={sidebarPreviewPrograms}
      onTogglePreview={() => void toggleSidebarPreview()}
      resetActive={sidebarResetActive}
      onReset={requestFreshStartConfirmed}
      showActualResults={sidebarShowActualResults}
      progCount={sidebarProgCount}
      chatEditField={chatEditField}
      onChatEditFieldChange={setChatEditField}
      chatEditDraft={chatEditDraft}
      onChatEditDraftChange={setChatEditDraft}
      chatEditPending={chatEditPending}
      onChatEditPendingChange={setChatEditPending}
      intakeQuestionCount={intakeQuestionCount}
      intakeCanSubmit={intakeCanSubmit}
      onFormProfileEdit={handleProfileEdit}
      onStageIntakeEdit={stageIntakeEdit}
      onCallIntakeEditSlot={callIntakeEditSlot}
      showFormFooter={intakeMode === "form" && profileSections.length > 0}
      detailPhaseComplete={detailPhase === "complete"}
      loading={loading}
      isFormComplete={profileReadyForResubmit}
      formDirtySinceSubmit={formDirtySinceSubmit}
      onResubmit={() => void resubmitEligibility()}
    />
  );

  return (
    <div
      className={cn(
        "np-wizard-app relative flex h-full min-h-0 w-full overflow-hidden",
        intakeMode === "chat" ? FORM_CHAT_T14 : "text-[13px] sm:text-[13.5px]",
      )}
    >
      {/* Mobile: full-viewport blur over header + chat (portaled above app chrome) */}
      {showMobileSidebarPortal &&
        showLegacyProfileSidebar &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100] bg-background/50 backdrop-blur-xl"
              aria-hidden
              onClick={() => setSidebarOpen(false)}
            />
            <aside className={cn(profileSidebarAsideClass, "fixed inset-y-0 left-0 z-[101]")}>
              {profileSidebarInner}
            </aside>
          </>,
          document.body,
        )}

      {/* ════════════════════════════════════════
          LEFT — collapsible profile sidebar (in-flow on desktop / mobile closed)
          ════════════════════════════════════════ */}
      {showInFlowSidebar && showLegacyProfileSidebar && (
        <aside className={profileSidebarAsideClass}>{profileSidebarInner}</aside>
      )}

      {/* ════════════════════════════════════════
          RIGHT — full chat + form experience
          ════════════════════════════════════════ */}
      <div
        ref={setSaveDialogHost}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <SaveProfileDialog
          open={saveProfileDialogOpen}
          onOpenChange={setSaveProfileDialogOpen}
          onSave={handleSaveProfileMeta}
          saving={saveProfileStatus === "saving"}
          defaultScenarioDescription={suggestScenarioDescription(form)}
          portalContainer={saveDialogHost}
        />
        {/* /form fresh intake — full-bleed FormChatFlow experience (own sidebar + chat) */}
        {isFormFreshIntake && (
          <div className="absolute inset-0 z-30 flex min-w-0 flex-col overflow-hidden bg-card">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <FormChatFlow
                key={formChatMountKey}
                form={form}
                setForm={setForm}
                mode={formChatMode}
                onComplete={() =>
                  void submitForm({
                    preventDefault: () => {},
                  } as React.FormEvent)
                }
                eligibleCount={formChatEligibleCount}
                totalCount={30}
                previewOpen={sidebarPreviewOpen}
                previewLoading={sidebarPreviewLoading}
                previewPrograms={sidebarPreviewPrograms}
                onTogglePreview={() => void toggleSidebarPreview()}
                onResetScenario={() => {
                  setEligiblePrograms([]);
                  setNearMissPrograms([]);
                  setQuickCount(30);
                  setSidebarPreviewOpen(false);
                }}
                submitted={formSubmitted}
                resultsReady={detailPhase === "complete"}
                loading={loading}
                matched={eligiblePrograms}
                dirtySinceSubmit={profileDirtySinceSubmit}
                canResubmit={profileReadyForResubmit}
                highlightProfileGaps={profileGapsForced}
                onResubmit={() =>
                  void (intakeMode === "chat"
                    ? handleChatSidebarResubmit()
                    : submitForm({ preventDefault: () => {} } as React.FormEvent))
                }
                onDownloadPdf={() => void handleDownloadOptions()}
                onSaveScenario={handleSaveOrUpdate}
                saveLabel={editingHistoryId != null ? "Update Scenario" : "Save Scenario"}
                canSaveToVault={canSaveToVault}
                onClearRestart={requestFreshStart}
                vaultScenarioOpen={isVaultScenarioOpen()}
                onGoHome={handleGoHomeIntake}
                onFormImported={() => setSidebarOpen(true)}
                onBackToVault={
                  !historyOpen && (viewingHistoryScenario || editingHistoryId != null)
                    ? handleBackToVault
                    : undefined
                }
                reloadingSavedResults={viewingHistoryScenario}
                productPrefs={productDisplayPrefs}
                geoExclusions={eligibilityTableMeta?.geoExclusions ?? []}
                overlayExclusions={eligibilityTableMeta?.overlayExclusions ?? []}
                nearMisses={
                  nearMissPrograms.length > 0
                    ? nearMissPrograms
                    : (eligibilityTableMeta?.nearMisses ?? [])
                }
                onAsk={handleResultsAsk}
                priorChatThread={intakeMode === "chat" ? retainedChatThread : undefined}
              />
            </div>
          </div>
        )}
        {isChatConversationIntake && (
          <div className="absolute inset-0 z-30 flex flex-col bg-[#eef2f7]">
            <div className="flex min-h-0 flex-1 flex-col">
              <ChatConversationFlow
                key={formChatMountKey}
                form={form}
                setForm={setForm}
                mode={formChatMode}
                apiBase={apiBase}
                eligibleCount={formChatEligibleCount}
                eligibilityScanning={loading && formSubmitted && phase !== "done"}
                onComplete={() => void finishChatIntake({ ...formSyncRef.current })}
                onResetScenario={() => {
                  setEligiblePrograms([]);
                  setNearMissPrograms([]);
                  setQuickCount(30);
                  setSidebarPreviewOpen(false);
                }}
                onClearRestart={requestFreshStartConfirmed}
                triggerQuickEligibilityScan={triggerQuickEligibilityScan}
                applyScenarioNotesDelta={applyScenarioNotesDelta}
                onThreadChange={setRetainedChatThread}
                onHighlightProfileGaps={() => setProfileGapsForced(true)}
                registerReprompt={(fn) => {
                  chatRepromptRef.current = fn;
                }}
                registerPortfolioSync={(fn) => {
                  chatPortfolioSyncRef.current = fn;
                }}
                registerSidebarEcho={(fn) => {
                  chatSidebarEchoRef.current = fn;
                }}
              />
            </div>
          </div>
        )}
        {historyOpen && (
          <ScenarioVaultOverlay
            onBack={handleVaultBack}
            onNewScenario={onNewScenario}
            onEditScenario={(detail) => void handleEditHistoryScenario(detail)}
            onCloneScenario={(detail) => void handleCloneHistoryScenario(detail)}
          />
        )}
        {/* Mobile-only profile launcher (hidden on sm+ where the collapsed rail is used) */}
        {!historyOpen &&
          !sidebarOpen &&
          phase !== "start" &&
          (profileSections.length > 0 || intakeMode === "chat") && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              title="Open Mortgage Profile"
              aria-label="Open Mortgage Profile"
              className="absolute left-0 top-4 z-20 flex min-h-11 min-w-11 items-center justify-center rounded-r-lg border border-l-0 border-border bg-card text-muted-foreground/70 shadow-md transition-colors hover:text-foreground sm:hidden"
            >
              <User className="h-4 w-4" />
            </button>
          )}
      </div>
      {/* Chat-mode Reset confirmation — mirrors FormChatFlow's reset dialog */}
      <AlertDialog open={confirmChatResetOpen} onOpenChange={setConfirmChatResetOpen}>
        <AlertDialogContent className="gap-4">
          <AlertDialogHeader className="space-y-3 text-left">
            <AlertDialogTitle>
              {isVaultScenarioOpen() ? "Leave saved scenario?" : "Start a new scenario?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Confirm reset of the current intake session.
            </AlertDialogDescription>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {isVaultScenarioOpen()
                ? "You'll return to the home screen to create a new scenario. The saved scenario in your vault will not be changed."
                : "All answers and results will be cleared so you can begin fresh. This can't be undone."}
            </p>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="text-[13px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmChatResetOpen(false);
                requestFreshStart();
              }}
              className="mt-2 gap-1.5 border border-input bg-background text-[13px] font-medium text-red-600 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:mt-0"
            >
              <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* OFAC hard-stop modal */}
      <AlertDialog open={ofacAlertOpen} onOpenChange={setOfacAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No Eligible Programs</AlertDialogTitle>
            <AlertDialogDescription>
              Borrower restrictions mean no programs are available. Please check your inputs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setOfacAlertOpen(false)}>
              Understood
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Zero-program nudge — quick scan settled at 0 matches. Continue keeps editing;
          Reset starts over WITHOUT a second confirmation. */}
      <AlertDialog open={zeroNudgeOpen} onOpenChange={setZeroNudgeOpen}>
        <AlertDialogContent className="gap-4">
          <AlertDialogHeader className="space-y-3 text-left">
            <AlertDialogTitle>Warning: No Eligible Programs</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              No eligible programs for the current scenario inputs.
            </AlertDialogDescription>
            <div className="space-y-3 text-[13px] leading-relaxed text-muted-foreground">
              <p>
                Based on a preliminary review, we couldn&apos;t find any matching programs for your
                current inputs.
              </p>
              {(() => {
                const detail = zeroNudgeDetailLine(zeroNudgeReason);
                return detail ? (
                  <p>
                    <span className="font-semibold text-muted-foreground">Reason</span>: {detail}
                  </p>
                ) : null;
              })()}
              <p>
                A few small adjustments may help uncover additional options. Continue refining your
                scenario, or reset your inputs to start over.
              </p>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel
              onClick={() => {
                zeroNudgeDismissedSnapshotRef.current = JSON.stringify(form);
                setZeroNudgeOpen(false);
              }}
              className="text-[13px]"
            >
              Continue
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setZeroNudgeOpen(false);
                restartIntake(intakeMode);
              }}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "mt-2 gap-1.5 text-[13px] font-medium text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:mt-0",
              )}
            >
              <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
