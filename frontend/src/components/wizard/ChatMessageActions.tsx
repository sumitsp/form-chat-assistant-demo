/**
 * Claude-style action row below an assistant message — copy, feedback, optional delete.
 */
import { useState } from "react";
import { Check, Copy, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label={copied ? "Copied" : "Copy"}
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

export type MessageFeedbackVote = "up" | "down" | null;

export function ChatMessageActions({
  copyText,
  onDelete,
  vote: voteProp,
  onVoteChange,
}: {
  copyText: string;
  /** Removes this Q&A exchange from the thread (typically user + assistant pair). */
  onDelete?: () => void;
  /** Controlled feedback — keeps vote across parent re-renders when lifted to the thread owner. */
  vote?: MessageFeedbackVote;
  onVoteChange?: (vote: MessageFeedbackVote) => void;
}) {
  const [internalVote, setInternalVote] = useState<MessageFeedbackVote>(null);
  const controlled = onVoteChange != null;
  const vote = controlled ? (voteProp ?? null) : internalVote;

  const setVote = (next: MessageFeedbackVote) => {
    if (controlled) onVoteChange(next);
    else setInternalVote(next);
  };

  const toggleVote = (choice: "up" | "down") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setVote(vote === choice ? null : choice);
  };

  const iconBtn = (active: boolean) =>
    cn(
      "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
      active
        ? "bg-[#012a5b]/15 text-[#012a5b] ring-1 ring-[#012a5b]/25 dark:bg-sky-500/20 dark:text-sky-300 dark:ring-sky-500/30"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <div
      className="relative z-10 mt-1.5 flex items-center gap-0.5 px-1"
      onClick={(e) => e.stopPropagation()}
    >
      <CopyButton text={copyText} />
      <button
        type="button"
        onClick={toggleVote("up")}
        className={iconBtn(vote === "up")}
        aria-label="Good response"
        aria-pressed={vote === "up"}
        title="Good response"
      >
        <ThumbsUp className={cn("h-4 w-4", vote === "up" && "fill-current")} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={toggleVote("down")}
        className={iconBtn(vote === "down")}
        aria-label="Bad response"
        aria-pressed={vote === "down"}
        title="Bad response"
      >
        <ThumbsDown
          className={cn("h-4 w-4", vote === "down" && "fill-current")}
          aria-hidden="true"
        />
      </button>
      {onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          aria-label="Delete message"
          title="Delete this exchange"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
