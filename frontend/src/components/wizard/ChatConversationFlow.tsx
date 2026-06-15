/**
 * ChatConversationFlow — prose-first /chat intake column (rebuild).
 *
 * Mounts `useChatConversation` (the client turn loop) and renders the conversation in
 * the SAME visual language as Form mode (FormChatFlow): a centered chat column over the
 * `#eef2f7` canvas, white card assistant bubbles, muted user bubbles, and the shared
 * Claude-style composer. The Mortgage Profile sidebar is rendered by LoanWizard alongside
 * this column (both modes share it), so this component is the chat pane only.
 *
 * It patches the SAME wizard `form`/`setForm` its owner passes in, so the lien/purpose/LTV
 * cascade effects and the post-results edit → Resubmit loop are reused untouched. Compound
 * inputs (LTV triangle, credit-events timeline) are asked as prose for now and resolved by
 * the LLM extractor; delegating them to FormChatFlow's card components is a later phase.
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUp, Check, Mic, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  CompactThinkingBubble,
  ELIGIBILITY_THINKING_LABELS,
} from "@/components/ChatThinkingSkeleton";
import {
  missingChatQuestions,
  PRE_SUBMIT_ASSISTANT_TEXT,
  PRE_SUBMIT_TO_SCAN_DELAY_MS,
} from "@/lib/chatConversation";
import { mandatoryComplete } from "@/lib/formChatFlow";
import { toast } from "sonner";
import { formatMmYyyyInput, validateMmYyyy } from "@/lib/creditEventTiming";
import { FORM_CHAT_QUESTIONS, isAnswered, isFormChatProductPrefQuestion } from "@/lib/formChatFlow";
import { cn } from "@/lib/utils";
import type { FormChatMode } from "@/components/wizard/FormChatFlow";
import { FormChatProductPrefQuestionCard } from "@/components/wizard/FormChatProductPrefQuestion";
import { CountySearchControl } from "@/components/wizard/CountySearchControl";
import {
  useChatConversation,
  type UseChatConversationDeps,
} from "@/components/wizard/hooks/useChatConversation";
import type { WizardForm } from "@/components/LoanWizard";
import {
  FORM_CHAT_COLUMN,
  FORM_CHAT_COMPOSER_CARD,
  FORM_CHAT_COMPOSER_CONTROLS,
  FORM_CHAT_COMPOSER_INPUT,
  FORM_CHAT_COMPOSER_PLACEHOLDER,
  FORM_CHAT_COMPOSER_SHELL,
  FORM_CHAT_EXTRACTION_CARD,
  FORM_CHAT_EXTRACTION_CARD_LG,
  FORM_CHAT_EXTRACTION_DIVIDER,
  syncComposerTextareaHeight,
  FORM_CHAT_H_PAD,
  FORM_CHAT_MESSAGE_STACK,
  FORM_CHAT_SCROLL_PAD,
  FORM_CHAT_T13,
  FORM_CHAT_T14,
} from "@/lib/formChatLayout";
import { ExtractedDataPills, ExtractionCardTitle, type ChatThreadMsg } from "@/lib/chatThreadView";
import { buildChatWelcomeParagraphs, isMobileWelcomeViewport } from "@/lib/welcomeIntro";
import { useSpeechToText } from "@/lib/useSpeechToText";
const CARD_PAD = "px-3 py-2.5 md:px-4 md:py-3";

/** White pill reset — matches Form mode ProfileSubmitGateActions. */
const RESET_PILL_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-[13px] font-medium text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 dark:bg-card dark:hover:bg-red-950/30";

/** Numbered ask lines — matches "Still to go" list styling in summary / recap cards. */
function NumberedAskList({ items }: { items: Array<{ n: number; prompt: string }> }) {
  return (
    <ol className="space-y-0.5 pl-1 text-[13px] text-foreground">
      {items.map((r) => (
        <li key={r.n}>
          <span className="mr-1.5 font-semibold text-[#012a5b]">{r.n}.</span>
          {r.prompt}
        </li>
      ))}
    </ol>
  );
}

/** Progressive loading phrases while a turn is extracting (matches Form mode's dots UI). */
const CHAT_EXTRACT_LABELS = ["Extracting your data", "Matching to closest fields"] as const;

type Role = "user" | "assistant";

interface ChatMsg {
  id: string;
  role: Role;
  /** Raw content; assistant content may carry a CHAT_* prefix payload. */
  content: string;
}

export interface ChatConversationFlowProps {
  form: WizardForm;
  setForm: (updater: (prev: WizardForm) => WizardForm) => void;
  mode: FormChatMode;
  apiBase?: string;
  /** Real-time eligible-program count from the quick-scan (kept for API parity). */
  eligibleCount?: number;
  /** Run the final eligibility + results (owned by the parent). */
  onComplete: () => void;
  /** Reset the owner's eligibility state on a fresh scenario. */
  onResetScenario?: () => void;
  /** Full intake restart (form wipe + remount) — same as Form mode Reset. */
  onClearRestart?: () => void;
  /** Re-run the quick-scan after each merge (parent owns the counter). */
  triggerQuickEligibilityScan?: () => void;
  /** Push extracted scenario notes into the sidebar Session Notes (parent owns it). */
  applyScenarioNotesDelta?: (raw: unknown[]) => void;
  /** Mirror the chat thread up so the parent can retain it in the post-submit results view. */
  onThreadChange?: (messages: ChatThreadMsg[]) => void;
  /** Parent is running full eligibility — show scan labels in-thread before results mount. */
  eligibilityScanning?: boolean;
  /** Parent highlights missing required sidebar rows (blocked submit / resubmit). */
  onHighlightProfileGaps?: () => void;
  /** Register reprompt-after-sidebar-edit; receives the field ids the cascade CLEARED. */
  registerReprompt?: (fn: (clearedFieldIds?: string[]) => void) => void;
  /** Register the portfolio mirror so parent sidebar edits stay in sync with /api/intake/extract. */
  registerPortfolioSync?: (fn: (slots: Record<string, string>) => void) => void;
  /** Register the sidebar-edit echo ("X → Y" change card + cleared-values notice). */
  registerSidebarEcho?: (
    fn: (
      changes: Array<{ label: string; from: string; to: string }>,
      clearedLabels?: string[],
    ) => void,
  ) => void;
}

const STREAM_CHARS_PER_TICK = 2;
const STREAM_TICK_MS = 12;

const uid = () => crypto.randomUUID();

/** Reveal `text` character-by-character on mount; calls onDone when finished. */
function useStreamedLength(text: string, onDone?: () => void, onTick?: () => void) {
  const [shown, setShown] = useState(0);
  const doneRef = useRef(onDone);
  const tickRef = useRef(onTick);
  doneRef.current = onDone;
  tickRef.current = onTick;
  useEffect(() => {
    if (!text.length) {
      doneRef.current?.();
      return;
    }
    setShown(0);
    let i = 0;
    let done = false;
    const id = window.setInterval(() => {
      i += STREAM_CHARS_PER_TICK;
      setShown(i);
      tickRef.current?.();
      if (i >= text.length) {
        window.clearInterval(id);
        if (!done) {
          done = true;
          doneRef.current?.();
        }
      }
    }, STREAM_TICK_MS);
    return () => window.clearInterval(id);
  }, [text]);
  return Math.min(shown, text.length);
}

/** Bold lead-in on the third welcome paragraph once streaming completes. */
function formatChatWelcomeParagraph(text: string) {
  const lead = "Provide your base loan scenario";
  if (!text.startsWith(lead)) return text;
  return (
    <>
      <strong className="font-semibold">{lead}</strong>
      {text.slice(lead.length)}
    </>
  );
}

/** Assistant prose — streams paragraph-by-paragraph (`\n\n` blocks), then the next line. */
function StreamedBubbleText({
  text,
  onStreamDone,
  onTick,
}: {
  text: string;
  onStreamDone?: () => void;
  onTick?: () => void;
}) {
  const parts = text.includes("\n\n") ? text.split("\n\n") : [text];
  const full = parts.join("\n\n");
  const shown = useStreamedLength(full, onStreamDone, onTick);
  const done = shown >= full.length;

  let offset = 0;
  return (
    <div className="space-y-2">
      {parts.map((p, i) => {
        const start = offset;
        offset += p.length + (i < parts.length - 1 ? 2 : 0);
        const sliceLen = Math.max(0, Math.min(p.length, shown - start));
        if (sliceLen === 0 && !done) return null;
        const slice = p.slice(0, sliceLen);
        return (
          <p key={i} className="leading-relaxed whitespace-pre-line text-foreground">
            {done ? p : slice}
          </p>
        );
      })}
    </div>
  );
}

/** Streams a card's prompt (paragraph-by-paragraph), then reveals controls below. */
function StreamedPromptGroup({
  prompt,
  promptClassName = "mb-2.5 leading-relaxed",
  onTick,
  onStreamDone,
  children,
}: {
  prompt?: string;
  promptClassName?: string;
  onTick?: () => void;
  onStreamDone?: () => void;
  children: React.ReactNode;
}) {
  const full = prompt ?? "";
  const parts = full.includes("\n\n") ? full.split("\n\n") : full ? [full] : [];
  const joined = parts.join("\n\n");
  const [controlsReady, setControlsReady] = useState(parts.length === 0);
  const shown = useStreamedLength(
    joined,
    () => {
      setControlsReady(true);
      onStreamDone?.();
    },
    onTick,
  );
  const doneStreaming = parts.length === 0 || shown >= joined.length;

  let offset = 0;
  return (
    <>
      {parts.length > 0 ? (
        <div className="space-y-2">
          {parts.map((p, i) => {
            const start = offset;
            offset += p.length + (i < parts.length - 1 ? 2 : 0);
            const sliceLen = Math.max(0, Math.min(p.length, shown - start));
            if (sliceLen === 0 && !doneStreaming) return null;
            return (
              <p key={i} className={cn(promptClassName, "whitespace-pre-line")}>
                {doneStreaming ? p : p.slice(0, sliceLen)}
              </p>
            );
          })}
        </div>
      ) : null}
      {controlsReady ? children : null}
    </>
  );
}

/** Single assistant line — streams on mount (pre-submit prelude). */
function StreamedLine({
  text,
  onDone,
  onTick,
}: {
  text: string;
  onDone?: () => void;
  onTick?: () => void;
}) {
  const shown = useStreamedLength(text, onDone, onTick);
  return <p className="leading-relaxed text-foreground">{text.slice(0, shown)}</p>;
}

/** Welcome intro — streams paragraph-by-paragraph like Form mode. */
function StreamingWelcome({
  paragraphs,
  onStreamDone,
}: {
  paragraphs: readonly string[];
  onStreamDone?: () => void;
}) {
  const parts = [...paragraphs];
  const full = parts.join("\n\n");
  const shown = useStreamedLength(full, onStreamDone);
  const done = shown >= full.length;

  let offset = 0;
  return (
    <div className="space-y-2">
      {parts.map((p, i) => {
        const start = offset;
        offset += p.length + (i < parts.length - 1 ? 2 : 0);
        const sliceLen = Math.max(0, Math.min(p.length, shown - start));
        const slice = p.slice(0, sliceLen);
        return (
          <p key={i} className="leading-relaxed text-foreground">
            {!done ? slice : i === parts.length - 1 ? formatChatWelcomeParagraph(p) : p}
          </p>
        );
      })}
    </div>
  );
}

/** Split an assistant message into a CHAT_* prefix payload, if present. */
function parseAssistant(content: string): { kind: string; payload: unknown; text: string } {
  const m = /^([A-Z_]+):(.*)$/s.exec(content);
  if (!m) return { kind: "prose", payload: null, text: content };
  try {
    return { kind: m[1], payload: JSON.parse(m[2]), text: "" };
  } catch {
    return { kind: "prose", payload: null, text: content };
  }
}

export function ChatConversationFlow({
  form,
  setForm,
  mode,
  apiBase = "",
  onComplete,
  onResetScenario,
  onClearRestart,
  triggerQuickEligibilityScan,
  applyScenarioNotesDelta,
  onThreadChange,
  eligibilityScanning = false,
  onHighlightProfileGaps,
  registerReprompt,
  registerPortfolioSync,
  registerSidebarEcho,
}: ChatConversationFlowProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const preSubmitGateMsgIdRef = useRef<string | null>(null);
  const pendingSubmitTimerRef = useRef<number | null>(null);
  const intakeCompleteStartedRef = useRef(false);
  const [preludeStreaming, setPreludeStreaming] = useState(false);
  const [welcomeParagraphs] = useState(() => buildChatWelcomeParagraphs(isMobileWelcomeViewport()));

  // Auto-grow the composer textarea to fit wrapped lines only (no extra blank rows).
  // Measure on the next frame so the max-w column width is settled first — measuring
  // at a too-narrow width over-counts wraps and leaves empty space below the text.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) syncComposerTextareaHeight(el);
    });
    return () => cancelAnimationFrame(id);
  }, [input]);

  // Keep a live ref of `form` for the hook (avoids stale closures in async turns).
  const formSyncRef = useRef<WizardForm>(form);
  formSyncRef.current = form;

  const appendUserChat = useCallback((content: string) => {
    setMessages((m) => [...m, { id: uid(), role: "user", content }]);
  }, []);
  const scrollToBottom = useCallback(() => {
    // Double rAF so layout (streamed text, submit bar) is painted before measuring.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }, []);

  const appendAssistantChat = useCallback(
    (content: string, opts?: { preSubmitOpensGate?: boolean }) => {
      const id = uid();
      if (content.startsWith("CHAT_PRE_SUBMIT:")) {
        if (opts?.preSubmitOpensGate) {
          preSubmitGateMsgIdRef.current = id;
        }
        setPreludeStreaming(true);
      }
      setMessages((m) => [...m, { id, role: "assistant", content }]);
      requestAnimationFrame(scrollToBottom);
    },
    [scrollToBottom],
  );

  const deps: UseChatConversationDeps = {
    apiBase,
    mode,
    formSyncRef,
    setForm,
    triggerQuickEligibilityScan: triggerQuickEligibilityScan ?? (() => {}),
    applyScenarioNotesDelta: applyScenarioNotesDelta ?? (() => {}),
    appendUserChat,
    appendAssistantChat,
    setLoading,
  };
  const chat = useChatConversation(deps);

  useEffect(() => {
    registerReprompt?.((clearedFieldIds) => chat.repromptAfterSidebarEdit(clearedFieldIds));
  }, [registerReprompt, chat.repromptAfterSidebarEdit]);

  useEffect(() => {
    registerPortfolioSync?.(chat.syncPortfolioSlots);
  }, [registerPortfolioSync, chat.syncPortfolioSlots]);

  useEffect(() => {
    registerSidebarEcho?.(chat.echoSidebarChange);
  }, [registerSidebarEcho, chat.echoSidebarChange]);

  const triggerIntakeComplete = useCallback(() => {
    if (intakeCompleteStartedRef.current) return;
    intakeCompleteStartedRef.current = true;
    chat.setSubmitProfileGate(false);
    setPreludeStreaming(false);
    preSubmitGateMsgIdRef.current = null;
    if (pendingSubmitTimerRef.current != null) {
      window.clearTimeout(pendingSubmitTimerRef.current);
      pendingSubmitTimerRef.current = null;
    }
    onComplete();
  }, [onComplete, chat]);

  const beginProfileSubmit = useCallback(() => {
    if (
      intakeCompleteStartedRef.current ||
      preludeStreaming ||
      eligibilityScanning ||
      !chat.submitProfileGate
    ) {
      return;
    }
    const snap = formSyncRef.current;
    const mandatoryMissing = missingChatQuestions(snap, mode, {
      productPrefConfirmed: chat.productPrefConfirmed,
    }).some((q) => q.priority === "mandatory");
    if (!mandatoryComplete(snap) || mandatoryMissing) {
      onHighlightProfileGaps?.();
      toast.error("Please complete the required fields highlighted in your Mortgage Profile.");
      void chat.repromptAfterSidebarEdit();
      return;
    }
    chat.setSubmitProfileGate(false);
    if (pendingSubmitTimerRef.current != null) {
      window.clearTimeout(pendingSubmitTimerRef.current);
    }
    pendingSubmitTimerRef.current = window.setTimeout(() => {
      pendingSubmitTimerRef.current = null;
      triggerIntakeComplete();
    }, PRE_SUBMIT_TO_SCAN_DELAY_MS);
  }, [
    chat,
    mode,
    preludeStreaming,
    eligibilityScanning,
    triggerIntakeComplete,
    onHighlightProfileGaps,
  ]);

  const handlePreSubmitStreamDone = useCallback(
    (msgId: string) => {
      if (preSubmitGateMsgIdRef.current === msgId) {
        preSubmitGateMsgIdRef.current = null;
        setPreludeStreaming(false);
        chat.setSubmitProfileGate(true);
        scrollToBottom();
        return;
      }
    },
    [chat, scrollToBottom],
  );

  const handleProfileReset = useCallback(() => {
    if (intakeCompleteStartedRef.current || preludeStreaming || eligibilityScanning) return;
    if (onClearRestart) {
      onClearRestart();
      return;
    }
    chat.reset();
    intakeCompleteStartedRef.current = false;
    setPreludeStreaming(false);
    preSubmitGateMsgIdRef.current = null;
    if (pendingSubmitTimerRef.current != null) {
      window.clearTimeout(pendingSubmitTimerRef.current);
      pendingSubmitTimerRef.current = null;
    }
    setMessages([]);
    setStreamThroughIndex(-1);
    onResetScenario?.();
  }, [chat, preludeStreaming, eligibilityScanning, onClearRestart, onResetScenario]);

  /** Only reveal the next thread message after the prior one finishes streaming. */
  const [streamThroughIndex, setStreamThroughIndex] = useState(-1);

  useEffect(() => {
    if (messages.length === 0) setStreamThroughIndex(-1);
    else if (streamThroughIndex < 0) setStreamThroughIndex(0);
  }, [messages.length, streamThroughIndex]);

  const handleMessageStreamDone = useCallback(
    (index: number) => {
      setStreamThroughIndex((prev) => Math.max(prev, index + 1));
      scrollToBottom();
    },
    [scrollToBottom],
  );

  useEffect(
    () => () => {
      if (pendingSubmitTimerRef.current != null) {
        window.clearTimeout(pendingSubmitTimerRef.current);
      }
    },
    [],
  );

  const stt = useSpeechToText();
  // Mirror the live transcript into the input while dictating.
  useEffect(() => {
    if (stt.isListening) setInput(stt.liveTranscript);
  }, [stt.isListening, stt.liveTranscript]);

  // Auto-scroll when the thread grows or the submit gate / scan UI appears.
  useEffect(() => {
    scrollToBottom();
  }, [
    messages,
    loading,
    chat.submitProfileGate,
    preludeStreaming,
    eligibilityScanning,
    scrollToBottom,
  ]);

  // Mirror the thread up so LoanWizard can show it above the results after submit (chat retain).
  useEffect(() => {
    onThreadChange?.(messages);
  }, [messages, onThreadChange]);

  const composerLocked = loading || eligibilityScanning || preludeStreaming;
  const showSubmitProfileActions =
    chat.submitProfileGate && !eligibilityScanning && !intakeCompleteStartedRef.current;

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || composerLocked) return;
    if (stt.isListening) stt.stopListening();
    setInput("");
    await chat.submitUserTurn(text);
  }, [input, composerLocked, chat, stt]);

  const toggleMic = () => {
    if (stt.isListening) stt.stopListening();
    else void stt.startListening(input);
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-[#eef2f7]", FORM_CHAT_T14)}>
      <div className={cn("flex min-h-0 flex-1 flex-col", FORM_CHAT_H_PAD)}>
        {/* Thread */}
        <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto", FORM_CHAT_SCROLL_PAD)}>
          <div className={cn(FORM_CHAT_COLUMN, FORM_CHAT_MESSAGE_STACK, "text-[#1f2937]")}>
            {/* Welcome — streams in like Form mode before the user sends a scenario. */}
            <BotBubble card>
              <StreamingWelcome paragraphs={welcomeParagraphs} />
            </BotBubble>

            {messages.map((m, i) =>
              i > streamThroughIndex ? null : (
                <MessageRow
                  key={m.id}
                  msg={m}
                  form={form}
                  loading={loading || eligibilityScanning}
                  showSubmitProfileGate={showSubmitProfileActions}
                  onProfileSubmit={beginProfileSubmit}
                  onProfileReset={handleProfileReset}
                  onRunPrograms={triggerIntakeComplete}
                  onPreSubmitStreamDone={handlePreSubmitStreamDone}
                  onPreSubmitStreamTick={scrollToBottom}
                  onSkipOptionals={chat.skipOptionals}
                  onSelectOption={chat.selectOption}
                  onConfirmProductPref={chat.confirmProductPref}
                  onConfirmProductPrefInBatch={chat.confirmProductPrefInBatch}
                  onConfirmCreditEvents={chat.confirmCreditEvents}
                  onResolveBkType={chat.resolveBkType}
                  onSetCreditEventTiming={chat.setCreditEventTiming}
                  onStreamTick={scrollToBottom}
                  onStreamDone={() => handleMessageStreamDone(i)}
                  productPrefConfirmed={chat.productPrefConfirmed}
                  onClarify={(c) => void chat.submitUserTurn(c)}
                  onPickCounty={(county) => void chat.submitUserTurn(county)}
                />
              ),
            )}

            {loading && !eligibilityScanning && (
              <CompactThinkingBubble labels={CHAT_EXTRACT_LABELS} />
            )}
            {eligibilityScanning && <CompactThinkingBubble labels={ELIGIBILITY_THINKING_LABELS} />}
          </div>
        </div>

        {/* Composer (shared Claude-style card) */}
        <div className={FORM_CHAT_COMPOSER_SHELL}>
          <div className={FORM_CHAT_COLUMN}>
            <p className="mb-2 text-right text-[11px] leading-snug text-muted-foreground md:text-[12px]">
              Have a 1003 / URLA v3.4?{" "}
              <Link
                to="/form"
                className="font-semibold text-[#012a5b] underline underline-offset-2 hover:text-[#012a5b]/90"
              >
                Switch to Form Mode →
              </Link>
            </p>
            <div className={FORM_CHAT_COMPOSER_CARD}>
              <div className="relative">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    // Resize against the real element now so a paste can't leave a tall box.
                    syncComposerTextareaHeight(e.currentTarget);
                  }}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter inserts a newline.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder=""
                  className={cn(FORM_CHAT_COMPOSER_INPUT, "resize-none leading-snug")}
                />
                {!input && (
                  <div className={FORM_CHAT_COMPOSER_PLACEHOLDER}>
                    {stt.isListening ? (
                      <span>Listening…</span>
                    ) : messages.length === 0 ? (
                      // First turn only — mobile: one flowing line across full width; desktop: stacked.
                      <>
                        <p className="w-full leading-snug md:hidden">
                          <span>Provide your base loan scenario here </span>
                          <em className="italic text-muted-foreground/35">
                            e.g. I have a borrower who is a US Citizen with FICO 720 buying a $800K
                            investment property in Texas at 75% LTV
                          </em>
                        </p>
                        <div className="hidden w-full flex-col gap-0.5 md:flex">
                          <span>Provide your base loan scenario here</span>
                          <em className="italic text-muted-foreground/35">
                            e.g. I have a borrower who is a US Citizen with FICO 720 buying a $800K
                            investment property in Texas at 75% LTV
                          </em>
                        </div>
                      </>
                    ) : showSubmitProfileActions ? (
                      <span>Use the buttons above to submit or restart</span>
                    ) : preludeStreaming ? (
                      <span>One moment…</span>
                    ) : (
                      // Mid-conversation — collapse to a simple placeholder.
                      <span>Type your reply…</span>
                    )}
                  </div>
                )}
              </div>
              <div className={FORM_CHAT_COMPOSER_CONTROLS}>
                {stt.isSupported && (
                  <button
                    type="button"
                    onClick={toggleMic}
                    aria-label={stt.isListening ? "Stop recording" : "Voice input"}
                    title={stt.isListening ? "Stop recording" : "Voice input"}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                      stt.isListening
                        ? "animate-pulse bg-red-600 text-white"
                        : "text-muted-foreground hover:bg-muted hover:text-[#012a5b]",
                    )}
                  >
                    {stt.isListening ? (
                      <Square className="h-[15px] w-[15px] fill-current" aria-hidden="true" />
                    ) : (
                      <Mic className="h-[18px] w-[18px]" aria-hidden="true" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!input.trim() || composerLocked}
                  aria-label="Send"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#012a5b] text-white transition-colors hover:bg-[#01234d] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp className="h-[18px] w-[18px]" aria-hidden="true" />
                </button>
              </div>
            </div>
            {stt.error && (
              <p className="mt-1.5 text-center text-[11px] text-red-500">{stt.error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bubbles (mirror FormChatFlow BotBubble / UserBubble) ─────────────────────

function BotBubble({ children, card = false }: { children: React.ReactNode; card?: boolean }) {
  return (
    <div className="flex flex-col">
      <div
        className={cn(
          card && "rounded-2xl border border-border bg-white shadow-sm",
          card && CARD_PAD,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "flex max-w-[80%] items-center gap-2 rounded-xl border border-slate-300 bg-muted px-3 py-1.5 text-foreground md:px-3.5 md:py-2",
          FORM_CHAT_T13,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** User turns don't stream — advance the sequential gate immediately. */
function UserMessageRow({ content, onStreamDone }: { content: string; onStreamDone?: () => void }) {
  const doneRef = useRef(onStreamDone);
  doneRef.current = onStreamDone;
  useEffect(() => {
    doneRef.current?.();
  }, []);
  return <UserBubble>{content}</UserBubble>;
}

/** Non-streaming assistant cards — advance the gate on mount. */
function InstantStreamComplete({
  onStreamDone,
  children,
}: {
  onStreamDone?: () => void;
  children: React.ReactNode;
}) {
  const doneRef = useRef(onStreamDone);
  doneRef.current = onStreamDone;
  useEffect(() => {
    doneRef.current?.();
  }, []);
  return <>{children}</>;
}

/** Submit / Reset row inside the pre-submit assistant bubble (mirrors FormChatFlow). */
function ProfileSubmitGateActions({
  onSubmit,
  onReset,
}: {
  onSubmit: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        onClick={onSubmit}
        className="gap-1.5 rounded-full bg-[#012a5b] px-5 text-[13px] shadow-sm hover:bg-[#01234d]"
      >
        Submit and Find Programs
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      <button type="button" onClick={onReset} className={RESET_PILL_BTN}>
        <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
        Reset
      </button>
    </div>
  );
}

// ── Credit-events fallback card (multi-select → per-event timing) ────────────

const CHIP_BTN =
  "rounded-lg border px-3 py-1.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40";

function ChatCreditEventsCard({
  payload,
  loading,
  onConfirmCreditEvents,
  onResolveBkType,
  onSetCreditEventTiming,
  onStreamTick,
  onStreamDone,
}: {
  payload: {
    mode?: "select" | "timing" | "bk_type";
    prompt?: string;
    options?: Array<{ value: string; label: string }>;
    code?: string;
    label?: string;
    buckets?: string[];
  };
  loading: boolean;
  onConfirmCreditEvents: (codes: string[]) => void;
  onResolveBkType: (code: string, label: string) => void;
  onSetCreditEventTiming: (code: string, value: string) => void;
  onStreamTick?: () => void;
  onStreamDone?: () => void;
}) {
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [done, setDone] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const disabled = loading || done;

  // BK chapter/status — single-select lettered options; a click resolves it.
  if (payload.mode === "bk_type") {
    return (
      <BotBubble card>
        <StreamedPromptGroup
          prompt={payload.prompt}
          onTick={onStreamTick}
          onStreamDone={onStreamDone}
        >
          <div className="flex flex-col gap-1.5">
            {(payload.options ?? []).map((o, i) => (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setDone(true);
                  onResolveBkType(o.value, o.label);
                }}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-left text-[13px] transition-colors hover:border-[#012a5b] hover:bg-[#eff4fb] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="font-semibold text-[#012a5b]">{String.fromCharCode(65 + i)}</span>
                <span>{o.label}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Click one — or type it (e.g. “Ch. 13 dismissed”).
          </p>
        </StreamedPromptGroup>
      </BotBubble>
    );
  }

  if (payload.mode === "timing" && payload.code) {
    const code = payload.code;
    const dateError = dateInput.length >= 7 ? validateMmYyyy(dateInput) : null;
    return (
      <BotBubble card>
        <StreamedPromptGroup
          prompt={payload.prompt}
          onTick={onStreamTick}
          onStreamDone={onStreamDone}
        >
          <div className="flex flex-wrap gap-1.5">
            {(payload.buckets ?? []).map((b) => (
              <button
                key={b}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setDone(true);
                  onSetCreditEventTiming(code, b);
                }}
                className={cn(CHIP_BTN, "border-border hover:border-[#012a5b] hover:bg-[#eff4fb]")}
              >
                {b}
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              type="text"
              value={dateInput}
              disabled={disabled}
              onChange={(e) => setDateInput(formatMmYyyyInput(e.target.value))}
              placeholder="or MM/YYYY"
              className="w-28 rounded-lg border border-border px-2.5 py-1.5 text-[13px] outline-none focus:border-[#012a5b]"
            />
            <button
              type="button"
              disabled={disabled || dateInput.length < 7 || !!dateError}
              onClick={() => {
                setDone(true);
                onSetCreditEventTiming(code, dateInput);
              }}
              className="rounded-lg bg-[#012a5b] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#01234d] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Set date
            </button>
            {dateError ? <span className="text-[11px] text-red-500">{dateError}</span> : null}
          </div>
        </StreamedPromptGroup>
      </BotBubble>
    );
  }

  // "None — clean history" is exclusive: picking it clears events and vice versa.
  const toggle = (code: string) =>
    setSel((s) => {
      const next = new Set(s);
      if (next.has(code)) {
        next.delete(code);
        return next;
      }
      if (code === "NONE") return new Set(["NONE"]);
      next.delete("NONE");
      next.add(code);
      return next;
    });

  return (
    <BotBubble card>
      <StreamedPromptGroup
        prompt={payload.prompt}
        onTick={onStreamTick}
        onStreamDone={onStreamDone}
      >
        <div className="flex flex-col gap-1.5">
          {(payload.options ?? []).map((o) => {
            const checked = sel.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                onClick={() => toggle(o.value)}
                className={cn(
                  CHIP_BTN,
                  "flex items-center gap-2",
                  checked
                    ? "border-[#012a5b] bg-[#eff4fb]"
                    : "border-border hover:border-[#012a5b] hover:bg-[#eff4fb]",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-[#012a5b] bg-[#012a5b] text-white" : "border-border bg-white",
                  )}
                >
                  {checked ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                </span>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={disabled || sel.size === 0}
          onClick={() => {
            setDone(true);
            onConfirmCreditEvents([...sel]);
          }}
          className="mt-2.5 rounded-lg bg-[#012a5b] px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#01234d] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Confirm events
        </button>
      </StreamedPromptGroup>
    </BotBubble>
  );
}

// ── Message renderers ────────────────────────────────────────────────────────

function MessageRow({
  msg,
  form,
  loading,
  showSubmitProfileGate,
  onProfileSubmit,
  onProfileReset,
  onRunPrograms,
  onPreSubmitStreamDone,
  onPreSubmitStreamTick,
  onSkipOptionals,
  onSelectOption,
  onConfirmProductPref,
  onConfirmProductPrefInBatch,
  onConfirmCreditEvents,
  onResolveBkType,
  onSetCreditEventTiming,
  productPrefConfirmed,
  onClarify,
  onPickCounty,
  onStreamTick,
  onStreamDone,
}: {
  msg: ChatMsg;
  form: WizardForm;
  loading: boolean;
  showSubmitProfileGate: boolean;
  onProfileSubmit: () => void;
  onProfileReset: () => void;
  onRunPrograms: () => void;
  onPreSubmitStreamDone: (msgId: string) => void;
  onPreSubmitStreamTick?: () => void;
  onSkipOptionals: () => void;
  onSelectOption: (questionId: string, value: string, label: string) => void;
  onConfirmProductPref: (questionId: string, patch: Partial<WizardForm>, label: string) => void;
  onConfirmProductPrefInBatch: (questionId: string, patch: Partial<WizardForm>) => void;
  onConfirmCreditEvents: (codes: string[]) => void;
  onResolveBkType: (code: string, label: string) => void;
  onSetCreditEventTiming: (code: string, value: string) => void;
  productPrefConfirmed: ReadonlySet<string>;
  onClarify: (candidate: string) => void;
  onPickCounty: (countyName: string) => void;
  /** Keeps the thread pinned to the bottom while a question streams in. */
  onStreamTick?: () => void;
  /** Fires when this row finishes streaming (unlocks the next message). */
  onStreamDone?: () => void;
}) {
  if (msg.role === "user") {
    return <UserMessageRow content={msg.content} onStreamDone={onStreamDone} />;
  }

  const { kind, payload, text } = parseAssistant(msg.content);

  if (kind === "CHAT_BULK_SUMMARY") {
    const p = (payload ?? {}) as {
      captured?: Array<{ label: string; value: string }>;
      inferred?: Array<{ label: string; value: string; phrase: string }>;
      notes?: string[];
      stockTake?: string;
    };
    const captured = p.captured ?? [];
    const inferred = p.inferred ?? [];
    const notes = p.notes ?? [];
    const hasFooter = notes.length > 0 || inferred.length > 0;
    return (
      <InstantStreamComplete onStreamDone={onStreamDone}>
        <div className="flex flex-col">
          <div className={FORM_CHAT_EXTRACTION_CARD_LG}>
            <ExtractionCardTitle className="mb-3" />
            <ExtractedDataPills captured={captured} />
            {hasFooter && (
              <div
                className={cn(
                  "mt-3 space-y-1 border-t pt-2.5 text-[12px] text-muted-foreground",
                  FORM_CHAT_EXTRACTION_DIVIDER,
                )}
              >
                {notes.length > 0 && (
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#012a5b]">
                    Scenario Notes
                  </p>
                )}
                {notes.map((n, i) => (
                  <p key={`n${i}`}>· {n}</p>
                ))}
                {inferred.map((r, i) => (
                  <p key={`i${i}`}>
                    · Inferred {r.value}
                    {r.phrase ? ` from “${r.phrase}”` : ""} — confirm if wrong.
                  </p>
                ))}
              </div>
            )}
            {p.stockTake ? (
              <p
                className={cn(
                  "mt-3 border-t pt-2.5 text-[12px] font-medium text-[#012a5b]",
                  FORM_CHAT_EXTRACTION_DIVIDER,
                )}
              >
                {p.stockTake}
              </p>
            ) : null}
          </div>
        </div>
      </InstantStreamComplete>
    );
  }

  if (kind === "CHAT_SUMMARY_ASK") {
    // ③ stock-take question — captured so far + numbered remaining; free-text reply.
    const p = (payload ?? {}) as {
      text?: string;
      captured?: Array<{ title: string; rows: Array<{ label: string; value: string }> }>;
      remaining?: Array<{ n: number; prompt: string }>;
      invite?: string;
    };
    const sections = (p.captured ?? []).filter((s) => s.rows.length > 0);
    const remaining = p.remaining ?? [];
    return (
      <div className="flex flex-col">
        <div className={FORM_CHAT_EXTRACTION_CARD_LG}>
          <StreamedPromptGroup
            prompt={p.text}
            promptClassName="mb-3 leading-relaxed text-foreground"
            onTick={onStreamTick}
            onStreamDone={onStreamDone}
          >
            {sections.length > 0 && (
              <div className="space-y-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#012a5b]">
                  What we have so far
                </p>
                {sections.map((s) => (
                  <div key={s.title}>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">{s.title}</p>
                    <ExtractedDataPills captured={s.rows} />
                  </div>
                ))}
              </div>
            )}
            {remaining.length > 0 && (
              <div className={cn("mt-3 border-t pt-2.5", FORM_CHAT_EXTRACTION_DIVIDER)}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#012a5b]">
                  Still to go
                </p>
                <NumberedAskList items={remaining} />
              </div>
            )}
            {p.invite ? (
              <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{p.invite}</p>
            ) : null}
          </StreamedPromptGroup>
        </div>
      </div>
    );
  }

  if (kind === "CHAT_RECAP") {
    // Closing recap — the full captured picture + notes / change-anything invite.
    const p = (payload ?? {}) as {
      text?: string;
      sections?: Array<{ title: string; rows: Array<{ label: string; value: string }> }>;
      invite?: string;
    };
    const sections = (p.sections ?? []).filter((s) => s.rows.length > 0);
    return (
      <div className="flex flex-col">
        <div className={FORM_CHAT_EXTRACTION_CARD_LG}>
          <StreamedPromptGroup
            prompt={p.text || "Looks like I have everything."}
            promptClassName="mb-3 leading-relaxed font-medium text-foreground"
            onTick={onStreamTick}
            onStreamDone={onStreamDone}
          >
            {sections.length > 0 && (
              <div className="space-y-2.5">
                {sections.map((s) => (
                  <div key={s.title}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#012a5b]">
                      {s.title}
                    </p>
                    <ExtractedDataPills captured={s.rows} />
                  </div>
                ))}
              </div>
            )}
            {p.invite ? (
              <div className={`mt-3 border-t pt-3 ${FORM_CHAT_EXTRACTION_DIVIDER}`}>
                <p className="text-[13px] leading-relaxed text-foreground md:text-[14px]">
                  {p.invite}
                </p>
              </div>
            ) : null}
          </StreamedPromptGroup>
        </div>
      </div>
    );
  }

  if (kind === "CHAT_CAPTURED") {
    const p = (payload ?? {}) as {
      captured?: Array<{ label: string; value: string }>;
      changes?: Array<{ label: string; from: string; to: string }>;
    };
    const captured = p.captured ?? [];
    const changes = p.changes ?? [];
    if (captured.length === 0 && changes.length === 0) return null;
    return (
      <InstantStreamComplete onStreamDone={onStreamDone}>
        <div className={FORM_CHAT_EXTRACTION_CARD}>
          <ExtractionCardTitle />
          <ExtractedDataPills captured={captured} changes={changes} />
        </div>
      </InstantStreamComplete>
    );
  }

  if (kind === "CHAT_CLARIFY") {
    const p = (payload ?? {}) as { text?: string; candidates?: string[] };
    const candidates = p.candidates ?? [];
    // Ambiguous clarification — clickable candidate cards; a click resolves it.
    return (
      <BotBubble card>
        <StreamedPromptGroup prompt={p.text} onTick={onStreamTick} onStreamDone={onStreamDone}>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((c) => (
              <button
                key={c}
                type="button"
                disabled={loading}
                onClick={() => onClarify(c)}
                className="rounded-lg border border-border px-3 py-1.5 text-[13px] transition-colors hover:border-[#012a5b] hover:bg-[#eff4fb] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {c}
              </button>
            ))}
          </div>
        </StreamedPromptGroup>
      </BotBubble>
    );
  }

  if (kind === "CHAT_PRODUCT_PREF") {
    const p = (payload ?? {}) as { questionId?: string };
    const questionId = p.questionId ?? "";
    const answered = productPrefConfirmed.has(questionId);
    return (
      <InstantStreamComplete onStreamDone={onStreamDone}>
        <FormChatProductPrefQuestionCard
          questionId={questionId}
          form={form}
          disabled={loading || answered}
          onConfirm={(patch, label) => onConfirmProductPref(questionId, patch, label)}
          chipLabel="Making it easier"
        />
      </InstantStreamComplete>
    );
  }

  if (kind === "CHAT_OPTIONS") {
    const p = (payload ?? {}) as {
      questionId?: string;
      prompt?: string;
      options?: Array<{ value: string; label: string }>;
      fallback?: boolean;
      footerHint?: string;
      multiSelect?: boolean;
    };
    const options = p.options ?? [];
    const questionId = p.questionId ?? "";
    const q = FORM_CHAT_QUESTIONS.find((qq) => qq.id === questionId);
    const answered = q
      ? isFormChatProductPrefQuestion(q)
        ? productPrefConfirmed.has(questionId)
        : isAnswered(form, q)
      : false;
    // Clickable A/B/C/D options; `fallback` marks the follow-up after a missed answer.
    const prompt = p.fallback
      ? `We didn't quite catch that — let's make it easy.\n\n${p.prompt ?? ""}`.trim()
      : p.prompt;
    return (
      <BotBubble card>
        <StreamedPromptGroup prompt={prompt} onTick={onStreamTick} onStreamDone={onStreamDone}>
          <div className="flex flex-col gap-1.5">
            {options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                disabled={loading || answered}
                onClick={() => onSelectOption(questionId, o.value, o.label)}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-left text-[13px] transition-colors hover:border-[#012a5b] hover:bg-[#eff4fb] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="font-semibold text-[#012a5b]">{String.fromCharCode(65 + i)}</span>
                <span>{o.label}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {p.footerHint ??
              (p.multiSelect
                ? "Type all that apply or say no preference — or click an option."
                : "Click an option — or just type or say its letter (A, B, …)")}
          </p>
        </StreamedPromptGroup>
      </BotBubble>
    );
  }

  if (kind === "CHAT_CREDIT_EVENTS") {
    return (
      <ChatCreditEventsCard
        payload={
          (payload ?? {}) as {
            mode?: "select" | "timing";
            prompt?: string;
            options?: Array<{ value: string; label: string }>;
            code?: string;
            label?: string;
            buckets?: string[];
          }
        }
        loading={loading}
        onConfirmCreditEvents={onConfirmCreditEvents}
        onResolveBkType={onResolveBkType}
        onSetCreditEventTiming={onSetCreditEventTiming}
        onStreamTick={onStreamTick}
        onStreamDone={onStreamDone}
      />
    );
  }

  if (kind === "CHAT_COUNTY_SEARCH") {
    const p = (payload ?? {}) as { prompt?: string; state?: string };
    const st = (p.state || form.state || "").trim();
    return (
      <BotBubble card>
        <StreamedPromptGroup prompt={p.prompt} onTick={onStreamTick} onStreamDone={onStreamDone}>
          <CountySearchControl
            state={st}
            value={form.stateCounty}
            onPick={(county) => onPickCounty(county)}
            placeholder="Search counties for the selected state…"
          />
        </StreamedPromptGroup>
      </BotBubble>
    );
  }

  if (kind === "CHAT_PRE_SUBMIT") {
    const p = (payload ?? {}) as { text?: string };
    const line = p.text ?? PRE_SUBMIT_ASSISTANT_TEXT;
    return (
      <BotBubble card>
        <StreamedLine
          text={line}
          onDone={() => {
            onPreSubmitStreamDone(msg.id);
            onStreamDone?.();
          }}
          onTick={onPreSubmitStreamTick}
        />
        {showSubmitProfileGate ? (
          <ProfileSubmitGateActions onSubmit={onProfileSubmit} onReset={onProfileReset} />
        ) : null}
      </BotBubble>
    );
  }

  if (kind === "CHAT_FINAL_CTA") {
    const p = (payload ?? {}) as { text?: string };
    return (
      <BotBubble card>
        <StreamedPromptGroup
          prompt={p.text ?? "Ready to run the numbers?"}
          promptClassName="mb-2.5 leading-relaxed"
          onStreamDone={onStreamDone}
        >
          <button
            type="button"
            onClick={onRunPrograms}
            disabled={loading}
            className="rounded-lg bg-[#012a5b] px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#01234d] disabled:opacity-40"
          >
            Run matching programs
          </button>
        </StreamedPromptGroup>
      </BotBubble>
    );
  }

  if (kind === "CHAT_OPTIONAL_BATCH") {
    // ⑤ — one end-of-intake card for everything optional, incl. product preferences.
    const p = (payload ?? {}) as {
      text?: string;
      fields?: Array<{ id: string; prompt: string; productPref?: boolean }>;
    };
    const fields = p.fields ?? [];
    return (
      <BotBubble card>
        <StreamedPromptGroup
          prompt={p.text ?? "A few optional details:"}
          promptClassName="mb-1.5 leading-relaxed"
          onTick={onStreamTick}
          onStreamDone={onStreamDone}
        >
          {fields.length > 0 && (
            <ul className="mb-2.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {fields.map((f) => (
                <li key={f.id}>{f.prompt}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onSkipOptionals}
            disabled={loading}
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            Continue — no preference on the rest
          </button>
        </StreamedPromptGroup>
      </BotBubble>
    );
  }

  return (
    <BotBubble card>
      <StreamedBubbleText
        text={text || msg.content}
        onTick={onStreamTick}
        onStreamDone={onStreamDone}
      />
    </BotBubble>
  );
}
