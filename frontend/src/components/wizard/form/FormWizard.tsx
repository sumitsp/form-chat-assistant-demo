/**
 * FormWizard — `/form` entry point (guided chat intake + shared results).
 *
 * Owns: FormChatFlow intake, underwriter optional batch, 1003 import path.
 * Sidebar: FormChatFlow's ProfileSidebar (extract → form/FormSidebar.tsx).
 * Results: FormChatFlow in-chat results (extract → shared/ResultsExperience.tsx).
 */
import type { FC } from "react";

import { WizardShell } from "@/components/wizard/shell/WizardShell";
import type { WizardShellProps } from "@/components/wizard/shell/types";

export type FormWizardProps = WizardShellProps;

export const FormWizard: FC<FormWizardProps> = (props) => (
  <WizardShell {...props} intakeMode="form" showSources={props.showSources ?? false} />
);
