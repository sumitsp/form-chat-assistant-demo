/** Fetch wrappers for POST /api/intake/* — chat mode only. */

import type { IntakeApiResponse } from "@/lib/chatIntakeTypes";

function baseUrl(apiBase: string): string {
  return apiBase.replace(/\/$/, "");
}

async function postJson<T>(apiBase: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl(apiBase)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path} ${res.status}`);
  }
  return (await res.json()) as T;
}

export function intakeStart(
  apiBase: string,
  initialText: string,
  mode: "lo" | "underwriter" = "lo",
): Promise<IntakeApiResponse> {
  // Backend maps "underwriter" → "uw" (offers the optional batch); "lo" asks essentials only.
  return postJson(apiBase, "/api/intake/start", { initial_text: initialText, mode });
}

export function intakeMessage(
  apiBase: string,
  sessionId: string,
  userText: string,
): Promise<IntakeApiResponse> {
  return postJson(apiBase, "/api/intake/message", { session_id: sessionId, user_text: userText });
}

export function intakeChipAnswer(
  apiBase: string,
  sessionId: string,
  slotId: string,
  chipCode: string,
  chipLabel: string,
): Promise<IntakeApiResponse> {
  return postJson(apiBase, "/api/intake/chip_answer", {
    session_id: sessionId,
    slot_id: slotId,
    chip_code: chipCode,
    chip_label: chipLabel,
  });
}

export function intakeEditSlot(
  apiBase: string,
  sessionId: string,
  slotId: string,
  value: string,
): Promise<IntakeApiResponse> {
  return postJson(apiBase, "/api/intake/edit_slot", {
    session_id: sessionId,
    slot_id: slotId,
    value,
  });
}

export function intakeNextQuestion(apiBase: string, sessionId: string): Promise<IntakeApiResponse> {
  return postJson(apiBase, "/api/intake/next_question", { session_id: sessionId });
}

export function intakePreviewShown(
  apiBase: string,
  sessionId: string,
): Promise<{ ok: boolean; can_submit?: boolean }> {
  return postJson(apiBase, "/api/intake/preview-shown", { session_id: sessionId });
}

export function intakeRefine(
  apiBase: string,
  sessionId: string,
  userText: string,
): Promise<IntakeApiResponse> {
  return postJson(apiBase, "/api/intake/refine", { session_id: sessionId, user_text: userText });
}

export function intakeBulkFill(
  apiBase: string,
  sessionId: string,
  values: Record<string, string>,
): Promise<IntakeApiResponse> {
  return postJson(apiBase, "/api/intake/bulk_fill", { session_id: sessionId, values });
}

/** Human-readable extracted field row for the brain-dump summary card. */
export interface IntakeCapturedRow {
  label: string;
  value: string;
}

/** Stateless extract-only response — see backend /api/intake/extract. */
export interface IntakeExtractResponse {
  /** snake_case value delta — feed to portfolioToFormPatch. */
  extracted: Record<string, unknown>;
  /** Full merged portfolio (incl. _status/_confidence) to keep as working memory. */
  portfolio: Record<string, unknown>;
  /** Label/value rows for the "I picked these up…" summary card. */
  captured: IntakeCapturedRow[];
  /** Low-confidence extractions to confirm ("Inferred … — confirm if wrong"). */
  inferred: Array<IntakeCapturedRow & { slot: string; phrase: string }>;
  /** Near-miss enum values for the reinforcement (confirm) loop. */
  ambiguous: Array<{ slot: string; label: string; candidates: string[] }>;
  /** Short note strings for quick display. */
  notes: string[];
  /** Standard scenario-note items (same shape as intake responses). */
  scenario_notes_delta: unknown[];
}

/** Stateless extract-only call for the conversational /chat dispatcher (no session/planner). */
export function intakeExtract(
  apiBase: string,
  body: {
    text: string;
    portfolio: Record<string, unknown>;
    last_target_slots?: string[];
    mode?: "lo" | "underwriter";
  },
): Promise<IntakeExtractResponse> {
  return postJson(apiBase, "/api/intake/extract", {
    text: body.text,
    portfolio: body.portfolio,
    last_target_slots: body.last_target_slots ?? [],
    mode: body.mode ?? "lo",
  });
}

/**
 * Stateless framing call (Phase-2 of the /chat overhaul) — asks the backend to phrase
 * ONE combo/summary ask. Hard 3.5s timeout; callers ALWAYS fall back to their
 * hard-coded template on any error, so this can never block intake.
 */
export async function intakeFrame(
  apiBase: string,
  body: {
    kind: "combo" | "summary";
    questions?: string[];
    whys?: string[];
    lead?: string;
    recent?: string[];
    captured_count?: number;
    remaining_count?: number;
    themes?: string[];
  },
): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(`${baseUrl(apiBase)}/api/intake/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: body.kind,
        questions: body.questions ?? [],
        whys: body.whys ?? [],
        lead: body.lead ?? "",
        recent: body.recent ?? [],
        captured_count: body.captured_count ?? 0,
        remaining_count: body.remaining_count ?? 0,
        themes: body.themes ?? [],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    return text || null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
