/**
 * Scenario Vault full-bleed overlay — shared by Form and Chat routes.
 */
import type { FC } from "react";

import { ScenarioHistoryView, VAULT_CONTAINER_MAX } from "@/components/ScenarioHistoryView";
import type { FormHistoryDetail } from "@/lib/scenarioHistoryApi";
import { cn } from "@/lib/utils";

export type ScenarioVaultOverlayProps = {
  onBack: () => void;
  onNewScenario?: () => void;
  onEditScenario: (detail: FormHistoryDetail) => void;
  onCloneScenario: (detail: FormHistoryDetail) => void;
};

export const ScenarioVaultOverlay: FC<ScenarioVaultOverlayProps> = ({
  onBack,
  onNewScenario,
  onEditScenario,
  onCloneScenario,
}) => (
  <div className="absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain bg-background app-scroll">
    <div
      className={cn(
        "mx-auto w-full min-w-0 px-3 py-3 pb-safe-sm sm:px-6 sm:py-6",
        VAULT_CONTAINER_MAX,
      )}
    >
      <ScenarioHistoryView
        embedded
        onBack={onBack}
        onNewScenario={onNewScenario}
        onEditScenario={onEditScenario}
        onCloneScenario={onCloneScenario}
      />
    </div>
  </div>
);
