/**
 * ChatWizard — `/chat` entry point (prose-first intake + shared results).
 *
 * Owns: ChatConversationFlow intake, retained thread above results.
 * Sidebar: legacy inline-edit rail in LoanWizard during hidden phase; intake is
 * full-bleed (no sidebar). Post-submit uses FormChatFlow sidebar.
 * Extract → chat/ChatSidebar.tsx.
 */
import type { FC } from "react";

import { WizardShell } from "@/components/wizard/shell/WizardShell";
import type { WizardShellProps } from "@/components/wizard/shell/types";

export type ChatWizardProps = WizardShellProps;

export const ChatWizard: FC<ChatWizardProps> = (props) => (
  <WizardShell {...props} intakeMode="chat" showSources={props.showSources ?? false} />
);
