/** Per-program exclusion from eligibility screening (exact guideline clause). */
export type ProgramExclusion = {
  program_name: string;
  reason: string;
  /** Legacy API field — same as program_name */
  program?: string;
};

export type EligibilityExclusionPayload = {
  geoExclusions: ProgramExclusion[];
  overlayExclusions: ProgramExclusion[];
  ragIneligible: ProgramExclusion[];
};

export function parseExclusionsFromApi(data: Record<string, unknown>): EligibilityExclusionPayload {
  const mapRow = (r: unknown): ProgramExclusion | null => {
    if (!r || typeof r !== "object") return null;
    const row = r as Record<string, unknown>;
    const program_name = String(row.program_name || row.program || "").trim();
    const reason = String(row.reason || "").trim();
    if (!program_name && !reason) return null;
    return {
      program_name: program_name || "Program",
      program: program_name || "Program",
      reason: reason || "Restriction applies",
    };
  };

  const geoExclusions = ((data.geo_exclusions as unknown[]) || [])
    .map(mapRow)
    .filter((x): x is ProgramExclusion => x !== null);
  const overlayExclusions = ((data.overlay_exclusions as unknown[]) || [])
    .map(mapRow)
    .filter((x): x is ProgramExclusion => x !== null);
  const ragIneligible = ((data.rag_ineligible as unknown[]) || [])
    .map(mapRow)
    .filter((x): x is ProgramExclusion => x !== null);

  return { geoExclusions, overlayExclusions, ragIneligible };
}

/** Customer-facing exclusion panel (geo + overlay only; RAG guideline hits are internal). */
export function hasExclusionDetails(payload: EligibilityExclusionPayload): boolean {
  return payload.geoExclusions.length > 0 || payload.overlayExclusions.length > 0;
}

/** Unique restriction clauses (deduped) for summary messages. */
export function uniqueExclusionClauses(items: ProgramExclusion[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const clause = formatExclusionReason(item.reason);
    if (!clause || seen.has(clause)) continue;
    seen.add(clause);
    out.push(clause);
  }
  return out;
}

/**
 * Clean bullet artifacts from ingested guideline clauses.
 *
 * Source PDFs use the letter "o" as a sub-bullet marker, which the PDF→text
 * ingest flattens to a literal standalone "o" (e.g. "Ineligible: o A o B o").
 * Strip those leading/trailing markers and turn interior ones into "; "
 * separators so the clause reads as plain prose. Standalone "o" never occurs
 * as a real word in these clauses, so this is safe.
 */
function stripBulletArtifacts(input: string): string {
  let t = input.trim();
  t = t.replace(/\s+o\s*$/, ""); // trailing bullet
  t = t.replace(/^o\s+/, ""); // leading bullet
  t = t.replace(/:\s+o\s+/g, ": "); // bullet right after a colon
  t = t.replace(/\s+o\s+/g, "; "); // interior bullets → separators
  t = t.replace(/\s*;\s*$/, ""); // tidy any trailing separator
  return t.replace(/\s{2,}/g, " ").trim();
}

/** Normalize exclusion reason text (e.g. licensed-state wording). */
export function formatExclusionReason(reason: string): string {
  const t = stripBulletArtifacts(reason);
  const licensed = /^we are not licensed in the state (.+)$/i.exec(t);
  if (licensed) return `Not Licensed in the state ${licensed[1].trim().toUpperCase()}`;
  const licensedChosen = /^we are not licensed in the state chosen \((.+)\)\.?$/i.exec(t);
  if (licensedChosen) return `Not Licensed in the state ${licensedChosen[1].trim().toUpperCase()}`;
  if (/^not licensed in the state /i.test(t)) {
    const st = t.replace(/^not licensed in the state /i, "").trim();
    return `Not Licensed in the state ${st.toUpperCase()}`;
  }
  return t;
}
