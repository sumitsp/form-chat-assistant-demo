import { sessionNotesFromDelta, type SessionNoteItem } from "@/lib/sessionNotes";

/** Matches backend ``ScenarioNotesSource`` — passed as ``source`` on extract. */
export type ScenarioNotesSource = "form" | "chat" | "intake";

/**
 * Extract underwriting scenario notes from LO free text.
 * Same API for guided /form chat and conversational /chat intake.
 */
export async function extractScenarioNotes(
  text: string,
  opts: { source?: ScenarioNotesSource } = {},
): Promise<SessionNoteItem[]> {
  const res = await fetch("/api/scenario-notes/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, source: opts.source ?? "form" }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Scenario notes extract failed (${res.status})`);
  }
  const data = (await res.json()) as { scenario_notes_delta?: unknown[] };
  return sessionNotesFromDelta(data.scenario_notes_delta ?? []);
}
