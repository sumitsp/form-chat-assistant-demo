// ─────────────────────────────────────────────────────────────────────────────
// chatThreadView.tsx — read-only render of a retained /chat intake thread.
//
// After submitting in /chat, the post-submit experience switches to the shared
// FormChatFlow results view (same as Form mode). The conversational intake happened
// in ChatConversationFlow (a different component with its own messages), so without
// this its thread would be lost. LoanWizard mirrors that thread up and hands it to
// FormChatFlow, which renders it above the results via <RetainedChatThread>.
//
// Standalone (imports only `cn` + an icon) so both ChatConversationFlow and FormChatFlow
// can use the type without a circular import.
// ─────────────────────────────────────────────────────────────────────────────
import { Check } from "lucide-react";

import { PRE_SUBMIT_ASSISTANT_TEXT } from "@/lib/chatConversation";
import { FORM_CHAT_EXTRACTION_CARD } from "@/lib/formChatLayout";
import { cn } from "@/lib/utils";

/** Shared heading on every extraction / capture card in /chat. */
export const EXTRACTION_CARD_TITLE = "I picked these up from what you said";

export function ExtractionCardTitle({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#012a5b]",
        className,
      )}
    >
      {EXTRACTION_CARD_TITLE}
    </p>
  );
}

export interface ChatThreadMsg {
  id: string;
  role: "user" | "assistant";
  /** Raw content; assistant content may carry a CHAT_* prefix payload. */
  content: string;
}

export type ChatCapturedRow = { label: string; value: string };
export type ChatChangedRow = { label: string; from: string; to: string };
type Captured = ChatCapturedRow;
type Row =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; kind: "prose"; text: string }
  | {
      id: string;
      role: "assistant";
      kind: "captured";
      captured: Captured[];
      changes?: ChatChangedRow[];
      header?: string;
    };

function parsePayload(body: string): unknown | null {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function optionListText(options: Array<{ label: string }> | undefined): string {
  if (!options?.length) return "";
  return options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.label}`).join("\n");
}

/** Reconstruct scrollback rows from CHAT_* assistant payloads (read-only, no controls). */
function retainedAssistantRows(id: string, kind: string, body: string): Row[] {
  const payload = parsePayload(body);
  if (!payload) return [];

  switch (kind) {
    case "CHAT_CAPTURED": {
      const p = payload as { captured?: Captured[]; changes?: ChatChangedRow[] };
      const captured = p.captured ?? [];
      const changes = p.changes ?? [];
      if (!captured.length && !changes.length) return [];
      return [{ id, role: "assistant", kind: "captured", captured, changes }];
    }
    case "CHAT_BULK_SUMMARY": {
      const p = payload as {
        captured?: Captured[];
        inferred?: Array<{ value: string; phrase?: string }>;
        notes?: string[];
        stockTake?: string;
      };
      const captured = p.captured ?? [];
      const footer: string[] = [];
      (p.notes ?? []).forEach((n) => footer.push(`· ${n}`));
      (p.inferred ?? []).forEach((r) =>
        footer.push(`· Inferred ${r.value}${r.phrase ? ` from "${r.phrase}"` : ""}`),
      );
      if (p.stockTake) footer.push(p.stockTake);
      if (!captured.length && !footer.length) return [];
      return [
        {
          id,
          role: "assistant",
          kind: "captured",
          captured,
          header: footer.length ? footer.join("\n") : undefined,
        },
      ];
    }
    case "CHAT_SUMMARY_ASK": {
      const p = payload as {
        text?: string;
        captured?: Array<{ title: string; rows: Captured[] }>;
        remaining?: Array<{ n: number; prompt: string }>;
        invite?: string;
      };
      const sections = (p.captured ?? []).filter((s) => s.rows.length > 0);
      const captured = sections.flatMap((s) => s.rows);
      const lines: string[] = [];
      if (p.text) lines.push(p.text);
      if (sections.length) lines.push("\nWhat we have so far");
      if (p.remaining?.length) {
        lines.push("\nStill to go:");
        p.remaining.forEach((r) => lines.push(`${r.n}. ${r.prompt}`));
      }
      if (p.invite) lines.push(`\n${p.invite}`);
      const header = lines.join("\n").trim();
      if (!header && !captured.length) return [];
      return [{ id, role: "assistant", kind: "captured", captured, header: header || undefined }];
    }
    case "CHAT_RECAP": {
      const p = payload as {
        text?: string;
        sections?: Array<{ title: string; rows: Captured[] }>;
        invite?: string;
      };
      const sections = (p.sections ?? []).filter((s) => s.rows.length > 0);
      const captured = sections.flatMap((s) => s.rows);
      const header = (p.text?.trim() || "Looks like I have everything.").trim();
      if (!header && !captured.length) return [];
      // The notes/change invite reads as a footer below the captured values.
      return [
        { id, role: "assistant", kind: "captured", captured, header },
        ...(p.invite
          ? [
              {
                id: `${id}-invite`,
                role: "assistant" as const,
                kind: "prose" as const,
                text: p.invite,
              },
            ]
          : []),
      ];
    }
    case "CHAT_OPTIONS": {
      const p = payload as {
        prompt?: string;
        options?: Array<{ label: string }>;
        fallback?: boolean;
      };
      let text = p.fallback
        ? `We didn't quite catch that — let's make it easy.\n\n${p.prompt ?? ""}`
        : (p.prompt ?? "");
      const opts = optionListText(p.options);
      if (opts) text = `${text}\n\n${opts}`.trim();
      return text.trim() ? [{ id, role: "assistant", kind: "prose", text: text.trim() }] : [];
    }
    case "CHAT_PRE_SUBMIT": {
      const p = payload as { text?: string };
      return [
        {
          id,
          role: "assistant",
          kind: "prose",
          text: p.text ?? PRE_SUBMIT_ASSISTANT_TEXT,
        },
      ];
    }
    case "CHAT_CLARIFY": {
      const p = payload as { text?: string; candidates?: string[] };
      let text = p.text ?? "";
      if (p.candidates?.length) text += `\n\n${p.candidates.join(" · ")}`;
      return text.trim() ? [{ id, role: "assistant", kind: "prose", text: text.trim() }] : [];
    }
    case "CHAT_FINAL_CTA": {
      const p = payload as { text?: string };
      return [
        {
          id,
          role: "assistant",
          kind: "prose",
          text: p.text ?? "Ready to run the numbers?",
        },
      ];
    }
    case "CHAT_OPTIONAL_BATCH": {
      const p = payload as { text?: string; fields?: Array<{ prompt: string }> };
      const lines = [p.text ?? "A few optional details:"];
      (p.fields ?? []).forEach((f) => lines.push(`· ${f.prompt}`));
      return [{ id, role: "assistant", kind: "prose", text: lines.join("\n") }];
    }
    case "CHAT_CREDIT_EVENTS": {
      const p = payload as { prompt?: string; label?: string };
      const text = p.prompt ?? (p.label ? `Credit event: ${p.label}` : "Credit history question");
      return [{ id, role: "assistant", kind: "prose", text }];
    }
    case "CHAT_COUNTY_SEARCH": {
      const p = payload as { prompt?: string };
      return p.prompt?.trim() ? [{ id, role: "assistant", kind: "prose", text: p.prompt }] : [];
    }
    case "CHAT_PRODUCT_PREF":
      return [{ id, role: "assistant", kind: "prose", text: "Product preference question" }];
    default:
      return [];
  }
}

/** Map a raw message to renderable rows, or empty to drop it from scrollback. */
function toRows(m: ChatThreadMsg): Row[] {
  if (m.role === "user") {
    return m.content.trim() ? [{ id: m.id, role: "user", text: m.content }] : [];
  }
  const match = /^([A-Z_]+):(.*)$/s.exec(m.content);
  if (!match) {
    return m.content.trim()
      ? [{ id: m.id, role: "assistant", kind: "prose", text: m.content }]
      : [];
  }
  const [, kind, body] = match;
  if (kind.startsWith("CHAT_")) {
    const rows = retainedAssistantRows(m.id, kind, body);
    if (rows.length) return rows;
  }
  return [];
}

/**
 * Shared extracted-data pills — same styling for bulk summary and per-answer capture.
 * `changes` rows render as "Label: old → new" (amber) so overwrites stand out from
 * first-time captures.
 */
export function ExtractedDataPills({
  captured,
  changes = [],
  className,
}: {
  captured: readonly ChatCapturedRow[];
  changes?: readonly ChatChangedRow[];
  className?: string;
}) {
  if (captured.length === 0 && changes.length === 0) return null;
  return (
    <div className={cn("space-y-2.5 text-[11px]", className)}>
      {captured.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {captured.map((row, i) => {
            // Long values (e.g. Scenario Notes) get a full-width pill that wraps; short
            // values stay as compact inline no-wrap pills.
            const longVal = (row.value?.length ?? 0) > 48;
            return (
              <span
                key={i}
                className={cn(
                  "inline-flex gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1 shadow-sm",
                  longVal ? "w-full max-w-full items-start" : "items-center whitespace-nowrap",
                )}
              >
                <Check
                  className={cn("h-3 w-3 shrink-0 text-emerald-600", longVal && "mt-0.5")}
                  aria-hidden="true"
                />
                <span className="shrink-0 text-muted-foreground">{row.label}</span>
                <span
                  className={cn("font-semibold text-foreground", longVal && "min-w-0 break-words")}
                >
                  {row.value}
                </span>
              </span>
            );
          })}
        </div>
      )}
      {changes.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {changes.map((row, i) => (
              <span
                key={`c${i}`}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 shadow-sm"
              >
                <span className="text-muted-foreground">{row.label}</span>
                <span className="text-muted-foreground/70 line-through">{row.from}</span>
                <span className="text-amber-700" aria-hidden="true">
                  →
                </span>
                <span className="font-semibold text-foreground">{row.to}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only retained intake thread, shown above results so the /chat conversation isn't lost. */
export function RetainedChatThread({ messages }: { messages: readonly ChatThreadMsg[] }) {
  const rows = messages.flatMap(toRows);
  if (rows.length === 0) return null;

  return (
    <div className="min-w-0 w-full max-w-full space-y-2 border-b border-border/60 pb-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Your conversation
      </p>
      {rows.map((r) => {
        if (r.role === "user") {
          return (
            <div key={r.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-xl border border-slate-300 bg-muted px-3 py-1.5 text-[13px] text-foreground">
                {r.text}
              </div>
            </div>
          );
        }
        if (r.kind === "captured") {
          return (
            <div key={r.id} className={FORM_CHAT_EXTRACTION_CARD}>
              <ExtractionCardTitle />
              <ExtractedDataPills captured={r.captured} changes={r.changes} />
              {r.header ? (
                <p className="mt-2.5 whitespace-pre-line border-t border-slate-200 pt-2.5 text-[12px] leading-relaxed text-muted-foreground">
                  {r.header}
                </p>
              ) : null}
            </div>
          );
        }
        return (
          <div
            key={r.id}
            className={cn(
              "rounded-2xl border border-border bg-white px-3 py-2.5 text-[13px] leading-relaxed text-foreground shadow-sm",
              "whitespace-pre-line",
            )}
          >
            {r.text}
          </div>
        );
      })}
    </div>
  );
}
