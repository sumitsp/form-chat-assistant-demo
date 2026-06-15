import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AccessGate } from "@/components/AccessGate";
import { ChatWizard } from "@/components/wizard/chat/ChatWizard";
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
 * Like `/form`, the intake mode is URL-driven: `/chat?mode=underwriter` requests
 * the underwriter intake (the server offers the optional-slot batch), while a
 * plain `/chat` defaults to the loan-officer ("lo") flow that asks essentials only.
 */
export const Route = createFileRoute("/chat")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { mode?: FormChatMode } => {
    if (String(search.mode ?? "").toLowerCase() === "underwriter") return { mode: "underwriter" };
    return {};
  },
  component: ChatPage,
  head: () => ({
    meta: [
      { title: "Acme Mortgage Assistant — Chat" },
      {
        name: "description",
        content: "Mortgage eligibility assistant — conversational chat mode.",
      },
    ],
  }),
});

function ChatPage() {
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
  const [showHistory, setShowHistory] = useState(false);
  const [viewingHistoryScenario, setViewingHistoryScenario] = useState(false);
  const [resetToken, setResetToken] = useState(0);

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

  // Gate: not signed in / skipped yet → show the access screen in place so
  // signing in here keeps the user in Chat mode (no forced /form redirect).
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
      <AppHeader
        intakeMode="chat"
        formMode={formMode}
        accessLabel={ACCESS_ROLE_LABEL[role]}
        onSignOut={handleSignOut}
        // Lock the mode toggle only while browsing the vault list — keep it
        // enabled once a scenario is open so it can be switched to Form.
        historyActive={showHistory}
        onHistoryClick={() => setShowHistory((prev) => !prev)}
        onNewScenarioClick={handleNewScenario}
      />
      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <ChatWizard
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
