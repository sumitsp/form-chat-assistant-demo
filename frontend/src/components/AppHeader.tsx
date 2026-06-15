import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, LogOut, Plus, UserRound } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { NEWPOINT_LOGO_URL } from "@/lib/brand";
import { fetchFormHistoryList } from "@/lib/scenarioHistoryApi";

// Placeholder identity — no auth/user system yet. Swap for real session data
// when authentication lands.
const PROFILE = {
  name: "Alex Evans",
  email: "alex.evans@newpoint.com",
  accessType: "Loan Officer",
  initials: "AE",
};

const HEADER_CONTROL_WIDTH = "w-[4.5rem] sm:w-[8.25rem]";

type Props = {
  intakeMode?: "form" | "chat";
  /** Guided /form intake: "underwriter" shows in profile Access Type. */
  formMode?: "lo" | "underwriter";
  /** Signed-in role label for the Access Type badge (overrides the formMode default). */
  accessLabel?: string;
  /** When provided, enables the profile menu's Sign out action. */
  onSignOut?: () => void;
  historyActive?: boolean;
  onHistoryClick?: () => void;
  onNewScenarioClick?: () => void;
};

export function AppHeader({
  intakeMode = "form",
  formMode = "lo",
  accessLabel,
  onSignOut,
  historyActive = false,
  onHistoryClick,
  onNewScenarioClick,
}: Props) {
  const [pendingMode, setPendingMode] = useState<"form" | "chat" | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const navigate = useNavigate();

  // Live count for the profile menu's Scenario Vault badge.
  useEffect(() => {
    let cancelled = false;
    fetchFormHistoryList("")
      .then((data) => {
        if (!cancelled) setSavedCount(data.total ?? data.items.length);
      })
      .catch(() => {
        if (!cancelled) setSavedCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [historyActive]);

  const confirmModeSwitch = () => {
    if (pendingMode) void navigate({ to: pendingMode === "chat" ? "/chat" : "/form" });
    setPendingMode(null);
  };

  return (
    <>
      <AlertDialog
        open={pendingMode !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMode(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to {pendingMode === "chat" ? "Chat" : "Form"} mode?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Switching modes will clear your current inputs and start a fresh session. Any progress
              in the current {pendingMode === "chat" ? "form" : "chat"} will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmModeSwitch}>
              Yes, switch to {pendingMode === "chat" ? "Chat" : "Form"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <header className="sticky top-0 z-20 border-b border-border bg-surface-elevated/80 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl">
        <div className="flex w-full items-center justify-between gap-1.5 px-3 py-2 sm:gap-3 sm:px-8 sm:py-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden bg-white sm:h-9 sm:w-9">
              <img
                src={NEWPOINT_LOGO_URL}
                alt="NewPoint Mortgage"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate font-display text-[12px] font-semibold sm:text-base">
                NewPoint Mortgage Assistant
              </div>
              <div className="hidden text-[13px] text-muted-foreground md:block">
                Your hub for broker matrices, program guidances and overlays.
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <div
              className={cn(
                "flex h-8 shrink-0 items-center rounded-lg border border-border bg-muted/40 p-0.5 sm:h-9",
                HEADER_CONTROL_WIDTH,
                historyActive && "opacity-60",
              )}
              title="Switch intake mode"
            >
              <button
                type="button"
                disabled={historyActive}
                onClick={() => intakeMode !== "form" && setPendingMode("form")}
                className={cn(
                  "flex h-full flex-1 items-center justify-center rounded-md text-[10px] font-semibold transition-colors disabled:cursor-default sm:text-[11px]",
                  intakeMode === "form"
                    ? "bg-[#012a5b] text-white shadow-sm"
                    : "text-muted-foreground hover:text-[#012a5b]",
                )}
              >
                Form
              </button>
              <button
                type="button"
                disabled={historyActive}
                onClick={() => intakeMode !== "chat" && setPendingMode("chat")}
                className={cn(
                  "flex h-full flex-1 items-center justify-center rounded-md text-[10px] font-semibold transition-colors disabled:cursor-default sm:text-[11px]",
                  intakeMode === "chat"
                    ? "bg-[#012a5b] text-white shadow-sm"
                    : "text-muted-foreground hover:text-[#012a5b]",
                )}
              >
                Chat
              </button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#012a5b]/20 bg-[#012a5b] text-[11px] font-semibold text-white transition-colors hover:bg-[#01234d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#012a5b]/40 sm:h-9 sm:w-9 sm:text-[12px]",
                    historyActive && "ring-2 ring-[#012a5b]/40",
                  )}
                  title={PROFILE.name}
                  aria-label="Open profile menu"
                >
                  {PROFILE.initials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-64 p-0">
                <div className="px-3 pt-3 pb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#012a5b] text-[12px] font-semibold text-white">
                      {PROFILE.initials}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-foreground">
                        {PROFILE.name}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {PROFILE.email}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between rounded-md bg-[#012a5b]/[0.06] px-2.5 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#012a5b]">
                      Access Type
                    </span>
                    <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-foreground shadow-sm">
                      {accessLabel ??
                        (formMode === "underwriter" ? "Underwriter" : PROFILE.accessType)}
                    </span>
                  </div>
                </div>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onSelect={() => {
                    // Saved scenarios always open in Form mode. From Chat, route
                    // to /form with the vault open so Edit/Clone load as Form.
                    if (intakeMode === "form") onHistoryClick?.();
                    else void navigate({ to: "/form", search: { vault: true } });
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px]"
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1">Scenario Vault</span>
                  {savedCount !== null && (
                    <span className="rounded-full bg-[#012a5b]/[0.08] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#012a5b]">
                      {savedCount}
                    </span>
                  )}
                </DropdownMenuItem>

                <DropdownMenuItem
                  onSelect={() => onNewScenarioClick?.()}
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px]"
                >
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>New Scenario</span>
                </DropdownMenuItem>

                <DropdownMenuItem
                  disabled
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px]"
                >
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>View Profile</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  disabled={!onSignOut}
                  onSelect={() => onSignOut?.()}
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-destructive data-[disabled]:text-destructive/60"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
    </>
  );
}
