import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ESSENTIALS_PICKER_HINT,
  ESSENTIALS_PICKER_INTRO,
  LOAN_TERM_SELECT_OPTIONS,
  type EssentialsPickerCategory,
  type EssentialsPickerOption,
  type OptionalPickerFormValues,
  visibleOptionalPickerCategories,
  type EssentialsFormSlice,
} from "@/lib/postEssentialsOptional";
import { formatLoanTermStorage, parseLoanTermSelection } from "@/lib/nqmIntegratedForm";

type Props = {
  form: EssentialsFormSlice;
  formValues: OptionalPickerFormValues;
  disabled?: boolean;
  selections: Record<string, string>;
  onFieldPatch: (patch: Partial<OptionalPickerFormValues>) => void;
  onSelect: (categoryId: string, option: EssentialsPickerOption, customValue?: string) => void;
  onSubmit: () => void;
};

function CategoryRow({
  category,
  disabled,
  selectedCode,
  onSelect,
  showMoreForCategory,
  onToggleMore,
}: {
  category: EssentialsPickerCategory;
  disabled: boolean;
  selectedCode: string | null;
  onSelect: (option: EssentialsPickerOption, customValue?: string) => void;
  showMoreForCategory: boolean;
  onToggleMore: () => void;
}) {
  const baseOpts = category.options ?? [];
  const moreOpts = showMoreForCategory ? (category.moreOptions ?? []) : [];
  const allOpts = [...baseOpts, ...moreOpts];
  const hasMore = (category.moreOptions?.length ?? 0) > 0;

  const pillClass = (active: boolean, isSkip?: boolean) =>
    cn(
      "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
      active && !isSkip
        ? "border-[#012a5b] bg-[#012a5b] text-white"
        : isSkip
          ? "border-border bg-transparent text-muted-foreground hover:border-[#012a5b]/30"
          : "border-border bg-muted/40 text-foreground/85 hover:border-[#012a5b]/35 hover:bg-[#012a5b]/8",
      disabled && "pointer-events-none opacity-40",
    );

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {category.title}
        {category.subtitle ? (
          <span className="font-normal normal-case text-muted-foreground/50">
            {" "}
            · {category.subtitle}
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {allOpts.map((opt, oi) => {
          const active = selectedCode === opt.code && !opt.skip;
          return (
            <button
              key={opt.code}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(opt)}
              className={pillClass(active, opt.skip)}
            >
              {active && !opt.skip ? (
                <span className="mr-0.5">✓</span>
              ) : !opt.skip ? (
                <span
                  className={`mr-1 font-bold ${active ? "text-white/70" : "text-muted-foreground/50"}`}
                >
                  {String.fromCharCode(65 + oi)} ·
                </span>
              ) : null}
              {opt.label}
            </button>
          );
        })}
        {hasMore && !showMoreForCategory ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onToggleMore}
            className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground hover:border-[#012a5b]/30 hover:text-[#012a5b]"
          >
            +{category.moreOptions!.length} more
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SelectRow({
  category,
  disabled,
  value,
  onChange,
}: {
  category: EssentialsPickerCategory;
  disabled: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const options = category.selectOptions ?? [];
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {category.title}
      </p>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground focus:border-[#012a5b]/40 focus:outline-none disabled:opacity-40"
      >
        <option value="">Select…</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function LoanTermMultiRow({
  category,
  disabled,
  value,
  onChange,
}: {
  category: EssentialsPickerCategory;
  disabled: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const selected = parseLoanTermSelection(value);
  const noPreference = selected.length === 0;

  const toggle = (term: string) => {
    const n = parseInt(term, 10);
    const base = noPreference ? [] : selected;
    const next = base.includes(n)
      ? base.filter((t) => t !== n)
      : [...base, n].sort((a, b) => a - b);
    onChange(formatLoanTermStorage(next));
  };

  const chipClass = (active: boolean) =>
    cn(
      "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
      active
        ? "border-[#012a5b] bg-[#012a5b] text-white"
        : "border-border bg-muted/40 text-foreground/85 hover:border-[#012a5b]/35 hover:bg-[#012a5b]/8",
      disabled && "pointer-events-none opacity-40",
    );

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {category.title}
        {category.subtitle ? (
          <span className="font-normal normal-case text-muted-foreground/50">
            {" "}
            · {category.subtitle}
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("No preference")}
          className={chipClass(noPreference)}
        >
          No preference
        </button>
        {LOAN_TERM_SELECT_OPTIONS.map((o) => {
          const active = !noPreference && selected.includes(parseInt(o.value, 10));
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              onClick={() => toggle(o.value)}
              className={chipClass(active)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberRow({
  category,
  disabled,
  value,
  onChange,
  suffix = "ac",
}: {
  category: EssentialsPickerCategory;
  disabled: boolean;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {category.title}
        {category.subtitle ? (
          <span className="font-normal normal-case text-muted-foreground/50">
            {" "}
            · {category.subtitle}
          </span>
        ) : null}
      </p>
      <div className="relative max-w-[10rem]">
        <input
          type="number"
          min={0}
          step={0.1}
          value={value}
          disabled={disabled}
          placeholder={category.placeholder ?? "0"}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border bg-background py-2 pl-2.5 pr-9 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:border-[#012a5b]/40 focus:outline-none disabled:opacity-40"
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ScenarioNotesRow({
  category,
  disabled,
  value,
  onChange,
}: {
  category: EssentialsPickerCategory;
  disabled: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {category.title}
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder={category.placeholder}
        className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[12px] leading-snug text-foreground placeholder:text-muted-foreground/50 focus:border-[#012a5b]/40 focus:outline-none disabled:opacity-40"
      />
    </div>
  );
}

export function PostEssentialsOptionalPicker({
  form,
  formValues,
  disabled,
  selections,
  onFieldPatch,
  onSelect,
  onSubmit,
}: Props) {
  const [expandedCategoryMore, setExpandedCategoryMore] = useState<Set<string>>(new Set());
  const categories = visibleOptionalPickerCategories(form);

  return (
    <div className="rounded-lg border border-border/80 bg-card px-3.5 py-3.5 shadow-sm sm:px-4 sm:py-4">
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-[13px] font-medium leading-snug text-foreground">
            {ESSENTIALS_PICKER_INTRO}
          </p>
          <p className="text-[11.5px] leading-snug text-muted-foreground/70">
            {ESSENTIALS_PICKER_HINT}
          </p>
        </div>

        <div className="space-y-3.5">
          {categories.map((cat) => {
            if (cat.kind === "text") {
              return (
                <ScenarioNotesRow
                  key={cat.id}
                  category={cat}
                  disabled={!!disabled}
                  value={formValues.scenarioNotes}
                  onChange={(v) => onFieldPatch({ scenarioNotes: v })}
                />
              );
            }
            if (cat.kind === "select") {
              const fieldKey = {
                rate_type: "rateTypePref",
                interest_only: "interestOnlyPref",
                non_occupant_co: "nonOccupantCoBorrower",
                power_of_attorney: "powerOfAttorney",
                listing_seasoning: "listingSeasoning",
              }[cat.id] as keyof OptionalPickerFormValues | undefined;
              if (!fieldKey) return null;
              const raw = String(formValues[fieldKey] ?? "");
              const selectValue = cat.id === "interest_only" && raw === "Yes — IO" ? "Yes" : raw;
              return (
                <SelectRow
                  key={cat.id}
                  category={cat}
                  disabled={!!disabled}
                  value={selectValue}
                  onChange={(v) =>
                    onFieldPatch({ [fieldKey]: v } as Partial<OptionalPickerFormValues>)
                  }
                />
              );
            }
            if (cat.kind === "number") {
              return (
                <NumberRow
                  key={cat.id}
                  category={cat}
                  disabled={!!disabled}
                  value={formValues.acreage}
                  onChange={(v) => onFieldPatch({ acreage: v })}
                />
              );
            }
            if (cat.kind === "loan_term_multi") {
              return (
                <LoanTermMultiRow
                  key={cat.id}
                  category={cat}
                  disabled={!!disabled}
                  value={formValues.loanTerm}
                  onChange={(v) => onFieldPatch({ loanTerm: v })}
                />
              );
            }
            return (
              <CategoryRow
                key={cat.id}
                category={cat}
                disabled={!!disabled}
                selectedCode={selections[cat.id] ?? null}
                showMoreForCategory={expandedCategoryMore.has(cat.id)}
                onToggleMore={() =>
                  setExpandedCategoryMore((prev) => {
                    const next = new Set(prev);
                    if (next.has(cat.id)) next.delete(cat.id);
                    else next.add(cat.id);
                    return next;
                  })
                }
                onSelect={(opt, custom) => onSelect(cat.id, opt, custom)}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-end border-t border-border/60 pt-3">
          <button
            type="button"
            disabled={disabled}
            onClick={onSubmit}
            className="shrink-0 rounded-lg bg-[#012a5b] px-5 py-2 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-[#01428f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
