/**
 * Persists LoanWizardV2 progress in sessionStorage so a browser refresh resumes
 * where the user left off (same tab).
 */

const STORAGE_KEY = "nqm_wizard_session_v2";

export type WizardPhase = "start" | "first" | "chat" | "done";
export type WizardIntakeMode = "form" | "chat";

export type PersistedMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  sources?: Array<{ index?: number; path?: string; text?: string; layout?: string }>;
  isChat?: boolean;
  isTransition?: boolean;
};

export type WizardFormSnapshot = Record<string, string>;

export type WizardPersistedSession = {
  version: 1;
  savedAt: number;
  intakeMode: WizardIntakeMode;
  phase: WizardPhase;
  form: WizardFormSnapshot;
  messages: PersistedMessage[];
  activeStep: 1 | 2 | 3 | 4 | 5 | 6;
  formSubmitted: boolean;
  chatIntakeStep: "questions" | null;
  eligiblePrograms: unknown[];
  nearMissPrograms?: unknown[];
  showTableProgramCheckboxes: boolean;
  eligibilityTableMsgId: string | null;
  detailsReady: boolean;
  chatStarted: boolean;
  knowMoreDetailReady: boolean;
  activeKnowMoreMsgId: string | null;
  selectedProgram: string;
  docChatActive: boolean;
  generalResultsChat?: boolean;
  sessionId: string;
  detailPhase: "none" | "complete";
  sidebarOpen: boolean;
};

function hasFormData(form: WizardFormSnapshot): boolean {
  return Object.values(form).some((v) => String(v ?? "").trim() !== "");
}

export function isRestorableSession(session: WizardPersistedSession): boolean {
  if (session.messages.length > 0) return true;
  if (session.phase !== "start") return true;
  return hasFormData(session.form);
}

export function loadWizardSession(): WizardPersistedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as WizardPersistedSession;
    if (data?.version !== 1 || !data.form || !Array.isArray(data.messages)) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveWizardSession(session: WizardPersistedSession): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, savedAt: Date.now() }));
  } catch {
    /* quota / private mode */
  }
}

export function clearWizardSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
