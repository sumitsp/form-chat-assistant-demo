import { FField, FSelect } from "@/components/wizard/form/fields";

const PREPAY = ["5 Year", "4 Year", "3 Year", "2 Year", "1 Year", "No Penalty"] as const;
const STEPDOWN_OPTIONS = ["Yes", "No", "No Preference"] as const;

export const isStepdownNA = (prepay: string) =>
  !prepay || prepay === "No Penalty" || prepay === "1 Year" || prepay === "2 Year";

export const normalizeStepdown = (v: string) => {
  if (!v || v === "Not Applicable" || v === "Doesn't Matter") return "No Preference";
  return v;
};

export function PrepaymentTermsCard({
  prepaymentTerms,
  prepayStepdown,
  occupancy,
  onPrepaymentChange,
  onStepdownChange,
}: {
  prepaymentTerms: string;
  prepayStepdown: string;
  occupancy: string;
  onPrepaymentChange: (v: string) => void;
  onStepdownChange: (v: string) => void;
}) {
  const prepayLocked = occupancy === "Primary Residence" || occupancy === "Second Home";
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-900/40 dark:bg-blue-950/20">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">
        Prepayment Terms
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <FField label="Max penalty term" conditional formValue={prepaymentTerms}>
            <FSelect
              value={prepaymentTerms}
              onChange={onPrepaymentChange}
              options={[...PREPAY]}
              side="top"
              disabled={prepayLocked}
            />
          </FField>
        </div>
        <div className="min-w-0 flex-1">
          <FField label="Prefer Stepdown?" conditional>
            <FSelect
              value={
                prepayLocked || isStepdownNA(prepaymentTerms) ? "No Preference" : prepayStepdown
              }
              onChange={onStepdownChange}
              options={[...STEPDOWN_OPTIONS]}
              side="top"
              disabled={prepayLocked || isStepdownNA(prepaymentTerms)}
            />
          </FField>
        </div>
      </div>
      {prepayLocked && (
        <p className="mt-2 text-[11px] leading-snug text-blue-600 dark:text-blue-400">
          Penalties not applicable for non-investment properties.
        </p>
      )}
    </div>
  );
}
