import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

/** Remove trailing ellipsis / dot runs so we don't stack extra punctuation. */
export function stripLoadingEllipsis(text: string): string {
  return text
    .replace(/[….•]+$/u, "")
    .replace(/[.\s]+$/u, "")
    .trim();
}

/** Three bouncing dots beside loading status text. */
export function ThinkingAnimatedDots({ className }: { className?: string }) {
  return (
    <span className={cn("ml-1 inline-flex items-center gap-px", className)} aria-hidden="true">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="inline-block h-1 w-1 animate-bounce rounded-full bg-[#012a5b]/50 dark:bg-sky-400/55"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/** Time on each status phrase before advancing (does not loop — stops on the last). */
export const STATUS_LABEL_STEP_MS = 2800;

/** Advance 0 → 1 → … → last, then hold on the final phrase. */
function useProgressiveStatusIndex(length: number, stepMs = STATUS_LABEL_STEP_MS): number {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i < length - 1 ? i + 1 : i));
    }, stepMs);
    return () => window.clearInterval(id);
  }, [length, stepMs]);
  return idx;
}

/** Left-aligned status chip — matches /form Know More + eligibility + RAG loading. */
export function CompactThinkingBubble({
  label = "Thinking",
  labels,
  className,
}: {
  label?: string;
  /** Progress phrases while waiting (1 → 2 → … → last, then hold). */
  labels?: readonly string[];
  className?: string;
}) {
  const cycle = labels?.length ? labels : null;
  const idx = useProgressiveStatusIndex(cycle?.length ?? 0);
  const display =
    (cycle ? stripLoadingEllipsis(cycle[Math.min(idx, cycle.length - 1)]) : null) ||
    stripLoadingEllipsis(label ?? "") ||
    "Thinking";

  return (
    <div className={cn("flex justify-start", className)}>
      <div
        className="rounded-2xl border border-border/80 bg-card px-3 py-2.5 shadow-sm"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <InlineThinkingLabel label={display} className="text-[13px] text-muted-foreground" />
      </div>
    </div>
  );
}

/** Compact status line with animated dots (no trailing ellipsis). */
export function InlineThinkingLabel({
  label = "Thinking",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const base = stripLoadingEllipsis(label) || "Thinking";
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap", className)}>
      <span>{base}</span>
      <ThinkingAnimatedDots />
    </span>
  );
}

export const CHAT_THINKING_LABELS = [
  "Querying lender guidelines",
  "Scanning program matrices",
  "Checking overlays and geo rules",
  "Matching your scenario",
  "Composing your answer",
] as const;

/** Know More — loading bubble before the program card appears. */
export const KNOW_MORE_FETCH_LABEL = "Fetching Program Details";

/** Full eligibility run / resubmit (form chat results). */
export const ELIGIBILITY_RUN_LABEL = "Running eligibility check";
export const ELIGIBILITY_REFRESH_LABEL = "Refreshing eligibility";
/** Vault Edit/Clone — reopening a saved scenario's results. */
export const ELIGIBILITY_RELOAD_LABEL = "Reloading results";

/** Know More program card — while notes summarize / card loads. */
export const KNOW_MORE_THINKING_LABELS = [
  "Fetching program details",
  "Reviewing lender guidelines",
  "Scanning product matrices",
  "Summarizing considerations",
  "Preparing your overview",
] as const;

/** Post-submit Know More Q&A — searching guideline / matrix stores. */
export const RAG_FOLLOWUP_LABELS = [
  "Querying lender guidelines",
  "Searching program documentation",
  "Retrieving matching rules",
  "Cross-checking overlays",
  "Composing your answer",
] as const;

/** Full eligibility run (form chat results). */
export const ELIGIBILITY_THINKING_LABELS = [
  "Running eligibility check",
  "Searching lender matrices",
  "Applying geo restrictions",
  "Checking overlay rules",
  "Finalizing matches",
] as const;

export const ELIGIBILITY_REFRESH_LABELS = [
  "Refreshing eligibility",
  "Re-scanning lender matrices",
  "Updating geo and overlays",
  "Rebuilding your match list",
  "Almost done",
] as const;

export const ELIGIBILITY_RELOAD_LABELS = [
  "Reloading results",
  "Restoring saved programs",
  "Refreshing match list",
  "Applying saved scenario",
  "Almost done",
] as const;

type ChatThinkingSkeletonProps = {
  /** Fixed label; when omitted, progresses through `labels` or CHAT_THINKING_LABELS. */
  label?: string;
  /** Progress phrases (fixed-width bubble — stops on last). */
  labels?: readonly string[];
  className?: string;
};

/** Matches post-results / Know More follow-up chat loading (label + skeleton bars). */
export function ChatThinkingSkeleton({ label, labels, className }: ChatThinkingSkeletonProps) {
  const cycle = labels ?? CHAT_THINKING_LABELS;
  const idx = useProgressiveStatusIndex(label ? 0 : cycle.length);
  const display =
    label ?? stripLoadingEllipsis(cycle[Math.min(idx, cycle.length - 1)] ?? "Thinking");

  return (
    <div
      className={cn(
        "w-[15.5rem] shrink-0 space-y-2.5 rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="min-h-[1.125rem] truncate text-[12px] font-medium text-muted-foreground">
        <InlineThinkingLabel label={display} />
        <span className="sr-only"> — please wait</span>
      </p>
      <div className="space-y-1.5">
        <div className="h-2 w-[88%] animate-pulse rounded-full bg-muted" />
        <div className="h-2 w-[62%] animate-pulse rounded-full bg-muted/70" />
        <div className="h-2 w-[44%] animate-pulse rounded-full bg-muted/50" />
      </div>
    </div>
  );
}

type ChatThinkingSkeletonRowProps = ChatThinkingSkeletonProps & {
  showAvatar?: boolean;
};

/** Bot avatar + skeleton bubble (thread layout). */
export function ChatThinkingSkeletonRow({
  label,
  labels,
  className,
  showAvatar = true,
}: ChatThinkingSkeletonRowProps) {
  return (
    <div className="flex gap-2 sm:gap-3">
      {showAvatar && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[image:var(--gradient-brand)] text-white">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <ChatThinkingSkeleton label={label} labels={labels} className={className} />
    </div>
  );
}
