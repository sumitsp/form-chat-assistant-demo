/**
 * Self-contained follow-up chat for the Results screen. Renders its own message
 * thread above a (sticky, when `bordered`) input row and delegates the actual
 * request to `onAsk` — the parent (LoanWizard) owns the `/api/chat`
 * `results_general` payload, so this component stays purely presentational.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

import { CHAT_THINKING_LABELS, CompactThinkingBubble } from "@/components/ChatThinkingSkeleton";
import {
  ChatMessageActions,
  type MessageFeedbackVote,
} from "@/components/wizard/ChatMessageActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { renderChatAnswer } from "@/lib/programDisplayHelpers";

type DockMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Assistant line from `/api/chat`. */
  ragReply?: boolean;
};

export function ResultsChatDock({
  onAsk,
  bordered = true,
  placeholder = "Ask anything about these results…",
}: {
  onAsk: (question: string) => Promise<string>;
  bordered?: boolean;
  placeholder?: string;
}) {
  const [messages, setMessages] = useState<DockMsg[]>([]);
  const [messageFeedback, setMessageFeedback] = useState<Record<string, "up" | "down">>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const setFeedbackVote = (id: string, vote: MessageFeedbackVote) => {
    setMessageFeedback((prev) => {
      if (vote == null) {
        if (!(id in prev)) return prev;
        const { [id]: _removed, ...rest } = prev;
        return rest;
      }
      if (prev[id] === vote) return prev;
      return { ...prev, [id]: vote };
    });
  };
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const deleteExchange = (assistantId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === assistantId);
      if (idx < 0) return prev;
      const copy = [...prev];
      if (idx > 0 && copy[idx - 1]?.role === "user") {
        copy.splice(idx - 1, 2);
      } else {
        copy.splice(idx, 1);
      }
      return copy;
    });
  };

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: q }]);
    setBusy(true);
    try {
      const reply = await onAsk(q);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: reply, ragReply: true },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Sorry — ${err instanceof Error ? err.message : "something went wrong"}.`,
          ragReply: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("bg-background", bordered && "border-t border-border")}>
      {(messages.length > 0 || busy) && (
        <div
          ref={threadRef}
          className="mx-auto max-h-[320px] w-full max-w-[760px] space-y-3 overflow-y-auto px-6 py-4"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              {m.role === "user" ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-[#012a5b] px-3.5 py-2 text-[14px] leading-[1.5] text-white">
                  {m.content}
                </div>
              ) : (
                <div className="max-w-[85%]">
                  <div className="rounded-lg bg-muted px-3.5 py-2 text-[14px] leading-[1.5] text-foreground">
                    {renderChatAnswer(m.content) ?? m.content}
                  </div>
                  {m.ragReply ? (
                    <ChatMessageActions
                      copyText={m.content}
                      vote={messageFeedback[m.id] ?? null}
                      onVoteChange={(v) => setFeedbackVote(m.id, v)}
                      onDelete={() => deleteExchange(m.id)}
                    />
                  ) : null}
                </div>
              )}
            </div>
          ))}
          {busy && <CompactThinkingBubble className="py-1" labels={CHAT_THINKING_LABELS} />}
        </div>
      )}
      <form
        className="mx-auto flex max-w-[760px] items-center gap-2 px-6 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          aria-label="Ask a follow-up question"
          placeholder={placeholder}
          className="h-11 text-[14px]"
        />
        <Button
          type="submit"
          size="icon"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="h-11 w-11 shrink-0 bg-[#012a5b] hover:bg-[#01234d]"
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
