/**
 * SessionStorage persistence for WizardShell — resume intake/results after refresh.
 */
import { useEffect, useMemo, useRef, type DependencyList } from "react";

import {
  clearWizardSession,
  isRestorableSession,
  loadWizardSession,
  saveWizardSession,
  type WizardIntakeMode,
  type WizardPersistedSession,
} from "@/lib/wizardSessionPersist";

/** Load restorable session for the current intake mode (once on mount). */
export function useWizardSessionBoot(intakeMode: WizardIntakeMode) {
  const sessionBoot = useMemo(() => {
    const saved = loadWizardSession();
    return saved && isRestorableSession(saved) && saved.intakeMode === intakeMode ? saved : null;
  }, [intakeMode]);
  const sessionRestoredRef = useRef(!!sessionBoot);
  return { sessionBoot, sessionRestoredRef, clearSession: clearWizardSession };
}

/** Debounced sessionStorage write — pass the same deps you would list in useEffect. */
export function usePersistWizardSession(
  intakeMode: WizardIntakeMode,
  buildSnapshot: () => Omit<WizardPersistedSession, "version" | "savedAt" | "intakeMode">,
  deps: DependencyList,
) {
  useEffect(() => {
    const snapshot: WizardPersistedSession = {
      version: 1,
      savedAt: Date.now(),
      intakeMode,
      ...buildSnapshot(),
    };
    if (!isRestorableSession(snapshot)) {
      clearWizardSession();
      return;
    }
    const t = window.setTimeout(() => saveWizardSession(snapshot), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
