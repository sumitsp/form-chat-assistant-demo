/**
 * "Apply & resubmit" modify panel for the Results screen. Pre-fills LTV (and DTI
 * on income-path scenarios) from the current scenario, lets the user nudge them,
 * and on submit hands the new values back to the parent, which re-runs eligibility.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

export function ResultsModifyPanel({
  initialLtv,
  initialDti,
  busy = false,
  onApply,
}: {
  initialLtv: number | null;
  initialDti: number | null;
  busy?: boolean;
  onApply: (changes: { ltv: number; dti: number | null }) => void;
}) {
  const baseLtv = initialLtv ?? 75;
  const baseDti = initialDti ?? 43;
  const showDti = initialDti != null;

  const [ltv, setLtv] = useState<number>(baseLtv);
  const [dti, setDti] = useState<number>(baseDti);

  const changed = ltv !== baseLtv || (showDti && dti !== baseDti);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] text-muted-foreground">
        Adjust your scenario and re-run program matching. Property value stays fixed — the loan
        amount recalculates from the new LTV.
      </p>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-medium text-foreground">Loan-to-value (LTV)</span>
          <span className="text-[13px] tabular-nums text-foreground">{ltv}%</span>
        </div>
        <Slider
          value={[ltv]}
          min={10}
          max={90}
          step={1}
          disabled={busy}
          onValueChange={(vals) => setLtv(vals[0] ?? ltv)}
          aria-label="Loan-to-value"
        />
        {initialLtv != null && (
          <p className="mt-1 text-[11px] text-muted-foreground">Was {initialLtv}%</p>
        )}
      </div>

      {showDti && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-foreground">Debt-to-income (DTI)</span>
            <span className="text-[13px] tabular-nums text-foreground">{dti}%</span>
          </div>
          <Slider
            value={[dti]}
            min={20}
            max={60}
            step={1}
            disabled={busy}
            onValueChange={(vals) => setDti(vals[0] ?? dti)}
            aria-label="Debt-to-income"
          />
          {initialDti != null && (
            <p className="mt-1 text-[11px] text-muted-foreground">Was {initialDti}%</p>
          )}
        </div>
      )}

      <Button
        type="button"
        disabled={busy || !changed}
        onClick={() => onApply({ ltv, dti: showDti ? dti : null })}
        className="self-start bg-[#012a5b] text-[13px] hover:bg-[#01234d]"
      >
        {busy ? "Re-running…" : "Apply & resubmit"}
      </Button>
    </div>
  );
}
