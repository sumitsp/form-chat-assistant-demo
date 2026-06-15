import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AccessGate } from "@/components/AccessGate";
import { FormWizard } from "@/components/wizard/form/FormWizard";
import type { FormChatMode } from "@/components/wizard/FormChatFlow";
import { Toaster } from "@/components/ui/sonner";
import {
  ACCESS_ROLE_LABEL,
  type AccessRole,
  clearAccessRole,
  getAccessRole,
  roleToFormMode,
  setAccessRole,
} from "@/lib/access";

/**
 * Guided-intake mode is driven by the URL, e.g. `/form?mode=underwriter` or
 * `/form?mode=loanofficer`. Anything else (including no param) defaults to the
 * loan-officer ("lo") flow, which asks the mandatory questions only. Only the
 * non-default ("underwriter") value is kept in the URL so the loan-officer flow
 * stays at a clean `/form`.
 *
 * `?vault=true` opens the Scenario Vault on arrival — used when the vault is
 * launched from Chat mode (saved scenarios always open as Form).
 */
export const Route = createFileRoute("/form")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { mode?: FormChatMode; vault?: boolean } => {
    const out: { mode?: FormChatMode; vault?: boolean } = {};
    if (String(search.mode ?? "").toLowerCase() === "underwriter") out.mode = "underwriter";
    if (search.vault === true || String(search.vault ?? "").toLowerCase() === "true")
      out.vault = true;
    return out;
  },
  component: FormPage,
  head: () => ({
    meta: [
      { title: "NewPoint Mortgage Assistant — Form" },
      { name: "description", content: "Mortgage eligibility wizard — step-by-step form." },
    ],
  }),
});

function FormPage() {
  const { vault } = Route.useSearch();
  const navigate = useNavigate();
  const [role, setRole] = useState<AccessRole | null>(() => getAccessRole());
  // Re-read after mount: localStorage isn't readable during SSR/hydration, so a
  // remembered user can start as null here. Re-sync on the client.
  useEffect(() => {
    if (!role) {
      const stored = getAccessRole();
      if (stored) setRole(stored);
    }
  }, [role]);
  const [showHistory, setShowHistory] = useState(!!vault);
  const [viewingHistoryScenario, setViewingHistoryScenario] = useState(false);
  const [resetToken, setResetToken] = useState(0);

  // Consume the one-shot `?vault` param: open the vault, then strip it so a
  // refresh / later navigation doesn't force the vault open again.
  useEffect(() => {
    if (!vault) return;
    setShowHistory(true);
    void navigate({
      to: "/form",
      search: (prev) => ({ ...prev, vault: undefined }),
      replace: true,
    });
  }, [vault, navigate]);

  const handleNewScenario = () => {
    setShowHistory(false);
    setViewingHistoryScenario(false);
    setResetToken((t) => t + 1);
  };

  const handleSignOut = () => {
    clearAccessRole();
    setRole(null);
    void navigate({ to: "/" });
  };

  // Gate: not signed in / skipped yet → show the access screen. Form is the
  // default landing, so a grant here just reveals the wizard in place.
  if (!role) {
    return (
      <AccessGate
        onGranted={(granted, remember) => {
          setAccessRole(granted, remember);
          setRole(granted);
        }}
      />
    );
  }

  const formMode = roleToFormMode(role);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <div className="relative">
        <AppHeader
          intakeMode="form"
          formMode={formMode}
          accessLabel={ACCESS_ROLE_LABEL[role]}
          onSignOut={handleSignOut}
          // Lock the mode toggle only while browsing the vault list — keep it
          // enabled once a scenario is open (Form stays the default here).
          historyActive={showHistory}
          onHistoryClick={() => setShowHistory((prev) => !prev)}
          onNewScenarioClick={handleNewScenario}
        />
      </div>
      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <FormWizard
          formMode={formMode}
          historyOpen={showHistory}
          onHistoryOpenChange={setShowHistory}
          viewingHistoryScenario={viewingHistoryScenario}
          onViewingHistoryScenarioChange={setViewingHistoryScenario}
          onNewScenario={handleNewScenario}
          resetToken={resetToken}
        />
      </main>
      <Toaster />
    </div>
  );
}
