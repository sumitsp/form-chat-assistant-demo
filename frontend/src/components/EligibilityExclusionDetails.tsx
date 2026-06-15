import { formatMortgageAcronyms } from "@/lib/nqmIntegratedForm";
import {
  formatExclusionReason,
  hasExclusionDetails,
  type EligibilityExclusionPayload,
  type ProgramExclusion,
} from "@/lib/eligibilityExclusions";

function ExclusionGroup({ title, items }: { title: string; items: ProgramExclusion[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/90 dark:text-amber-200/90">
        {title}
      </p>
      <ul className="mt-1.5 list-none space-y-2 pl-0">
        {items.map((e, i) => (
          <li key={`${e.program_name}-${i}`} className="text-[12px] leading-snug text-foreground">
            <span className="font-medium">{formatMortgageAcronyms(e.program_name)}</span>
            <span className="text-muted-foreground"> — </span>
            <span>{formatExclusionReason(e.reason)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EligibilityExclusionDetails({
  geoExclusions,
  overlayExclusions,
}: Pick<EligibilityExclusionPayload, "geoExclusions" | "overlayExclusions">) {
  if (!hasExclusionDetails({ geoExclusions, overlayExclusions, ragIneligible: [] })) return null;

  return (
    <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100">
        Exclusion details
      </p>
      <div className="space-y-3">
        <ExclusionGroup title="Geographic restrictions" items={geoExclusions} />
        <ExclusionGroup title="Overlay / credit restrictions" items={overlayExclusions} />
      </div>
    </div>
  );
}
