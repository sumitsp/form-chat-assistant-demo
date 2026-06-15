export type SessionNoteItem = {
  text: string;
  paraphrase: string;
  related_slot?: string | null;
};

export function sessionNotesFromDelta(raw: unknown[]): SessionNoteItem[] {
  return raw
    .map((n) => {
      const o = n as Record<string, unknown>;
      const text = String(o.text ?? "").trim();
      const paraphrase = String(o.paraphrase ?? o.text ?? "").trim();
      if (!paraphrase && !text) return null;
      return {
        text: text || paraphrase,
        paraphrase: paraphrase || text,
        related_slot: (o.related_slot as string | null) ?? null,
      };
    })
    .filter((x): x is SessionNoteItem => x !== null);
}

/** Append new note lines without duplicating prior text. */
const SCENARIO_NOTES_SKIP = new Set([
  "skip",
  "nothing to add",
  "nothing",
  "no",
  "none",
  "n/a",
  "na",
  "next",
  "continue",
  "submit",
  "no notes",
  "no note",
]);

/** True when the LO wants to skip optional scenario notes (form chat + intake). */
export function isScenarioNotesSkipMessage(text: string): boolean {
  const norm = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
  if (!norm) return true;
  if (SCENARIO_NOTES_SKIP.has(norm)) return true;
  return norm.startsWith("skip") && norm.split(" ").length <= 2;
}

const SCENARIO_NOTES_GIBBERISH_EXACT = new Set([
  "asdf",
  "asd",
  "qwerty",
  "qwertyuiop",
  "abc",
  "abcd",
  "xyz",
  "test",
  "testing",
  "blah",
  "lorem",
  "ipsum",
  "idk",
  "dunno",
  "whatever",
  "meh",
  "hmm",
  "uh",
  "um",
]);

/** Off-topic / keyboard mash / non-substantive input — treat like Skip (no notes). */
export function isScenarioNotesGibberish(text: string): boolean {
  const raw = text.trim();
  if (!raw) return true;
  if (isScenarioNotesSkipMessage(raw)) return false;

  const norm = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return true;
  if (SCENARIO_NOTES_GIBBERISH_EXACT.has(norm)) return true;

  const letters = (raw.match(/[a-zA-Z]/g) ?? []).length;
  if (letters === 0) return true;

  const words = raw.match(/[a-zA-Z']+/g) ?? [];
  if (words.length === 0) return true;

  if (words.filter((w) => w.length >= 3).length === 0) return true;

  if (/(.)\1{4,}/i.test(raw)) return true;

  if (words.length === 1 && words[0].length >= 4) {
    const w = words[0].toLowerCase();
    if (!(w.match(/[aeiou]/g) ?? []).length) return true;
  }

  if (raw.length >= 4 && letters / raw.length < 0.45) return true;

  return false;
}

/** Skip phrase or gibberish — default to empty scenario notes (sidebar "No inputs"). */
export function shouldTreatScenarioNotesAsSkip(text: string): boolean {
  return isScenarioNotesSkipMessage(text) || isScenarioNotesGibberish(text);
}

export function mergeScenarioNotesText(prev: string, added: SessionNoteItem[]): string {
  const lines = prev
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const n of added) {
    const line = n.paraphrase.trim();
    if (
      line &&
      !lines.some((l) => {
        const a = l.toLowerCase();
        const b = line.toLowerCase();
        return a === b || a.includes(b) || b.includes(a);
      })
    ) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}
