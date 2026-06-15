/**
 * Product-preference question cards — shared by /form (FormChatFlow) and /chat.
 * Loan term (multi-select + Continue), rate type, and I/O with lettered option cards.
 */
import { ArrowRight, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WizardForm } from "@/components/LoanWizard";
import { Button } from "@/components/ui/button";
import {
  FORM_CHAT_LOAN_TERM_NO_PREF,
  FORM_CHAT_QUESTIONS,
  formChatProductPrefOptions,
  formChatProductPrefQuestionChip,
  isNoProductPreference,
  productPrefAnswerLabel,
  type FormChatOption,
  type FormChatQuestion,
} from "@/lib/formChatFlow";
import { FORM_CHAT_T13, FORM_CHAT_T14 } from "@/lib/formChatLayout";
import { formatLoanTermStorage, parseLoanTermSelection } from "@/lib/nqmIntegratedForm";
import { cn } from "@/lib/utils";

const MOB = {
  t14: "text-[13px] md:text-[14px]",
  t13: "text-[12px] md:text-[13px]",
  t12: "text-[11px] md:text-[12px]",
  cardPad: "px-3 py-2.5 md:px-4 md:py-3",
  optionPad: "px-2.5 py-2 md:px-3 md:py-2.5",
  actionPad: "p-2.5 md:p-3",
  btn13: "text-[12px] md:text-[13px]",
} as const;

const CARD_PAD = MOB.cardPad;

const CHAT_ACTION_PANEL = cn(
  "mt-3 rounded-lg border border-blue-200/80 bg-blue-50/40 dark:border-blue-900/40 dark:bg-blue-950/20",
  MOB.actionPad,
);

const PRIMARY_ACTION_BTN = cn("gap-1.5 bg-[#012a5b] hover:bg-[#01234d]", MOB.btn13);

const letter = (i: number) => String.fromCharCode(65 + i);

function ContinueButton({
  className,
  type = "button",
  children = "Continue",
  ...props
}: React.ComponentProps<typeof Button> & { children?: React.ReactNode }) {
  return (
    <Button type={type} className={cn(PRIMARY_ACTION_BTN, className)} {...props}>
      {children} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

function OptionCard({
  letter: l,
  label,
  description,
  active = false,
  multi = false,
  disabled = false,
  onClick,
  onDeselect,
}: {
  letter: string;
  label: string;
  description?: string;
  active?: boolean;
  multi?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onDeselect?: () => void;
}) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    [],
  );

  const handleClick = () => {
    if (disabled) return;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onClick();
    }, 220);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (active && onDeselect) onDeselect();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border text-left transition-colors md:gap-3",
        MOB.optionPad,
        disabled && "cursor-not-allowed opacity-40",
        active
          ? "border-[#012a5b] bg-[#012a5b]/5"
          : "border-border bg-card hover:border-[#012a5b]/50 hover:bg-[#012a5b]/[0.06]",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#012a5b]/10 text-[11px] font-semibold text-[#012a5b] md:h-6 md:w-6 md:text-[12px]">
        {l}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-medium text-foreground", MOB.t13)}>{label}</span>
        {description && (
          <span className={cn("mt-0.5 block text-muted-foreground", MOB.t12)}>{description}</span>
        )}
      </span>
      {multi && (
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
            active ? "border-[#012a5b] bg-[#012a5b] text-white" : "border-border bg-card",
          )}
          aria-hidden="true"
        >
          {active ? <Check className="h-3.5 w-3.5 stroke-[2.5]" /> : null}
        </span>
      )}
    </button>
  );
}

function LoanTermMultiSelectPanel({
  termDraft,
  options,
  disabled,
  onToggle,
  onClearAll,
  onNoPreference,
  onContinue,
}: {
  termDraft: string;
  options: ReadonlyArray<FormChatOption>;
  disabled?: boolean;
  onToggle: (termValue: string) => void;
  onClearAll: () => void;
  onNoPreference: () => void;
  onContinue: () => void;
}) {
  const termSelected = parseLoanTermSelection(termDraft);
  return (
    <div className={CHAT_ACTION_PANEL}>
      <div className="grid grid-cols-1 gap-1.5">
        {options.map((opt, i) => {
          const active = isNoProductPreference(opt.value)
            ? termDraft.trim() !== "" && isNoProductPreference(termDraft)
            : termSelected.includes(parseInt(opt.value, 10));
          return (
            <OptionCard
              key={opt.value}
              letter={letter(i)}
              label={opt.label}
              active={active}
              disabled={disabled}
              multi={!isNoProductPreference(opt.value)}
              onClick={() => {
                if (isNoProductPreference(opt.value)) onNoPreference();
                else onToggle(opt.value);
              }}
              onDeselect={onClearAll}
            />
          );
        })}
      </div>
      {termSelected.length > 0 && (
        <div className="mt-3 flex justify-end">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!disabled) onContinue();
            }}
          >
            <ContinueButton type="submit" disabled={disabled}>
              Continue ({termSelected.length})
            </ContinueButton>
          </form>
        </div>
      )}
    </div>
  );
}

function ProductPrefStep({
  q,
  form,
  disabled,
  onConfirm,
  termDraft,
  onToggleTerm,
  onClearSelection,
}: {
  q: FormChatQuestion;
  form: WizardForm;
  disabled?: boolean;
  onConfirm: (patch: Partial<WizardForm>, label: string) => void;
  termDraft: string;
  onToggleTerm: (termValue: string) => void;
  onClearSelection: () => void;
}) {
  const options = formChatProductPrefOptions(q);

  if (q.id === "loanTerm") {
    const commit = (term: string) => {
      const patch = { loanTerm: term };
      onConfirm(patch, productPrefAnswerLabel("loanTerm", { ...form, ...patch }));
    };
    return (
      <LoanTermMultiSelectPanel
        termDraft={termDraft}
        options={options}
        disabled={disabled}
        onToggle={onToggleTerm}
        onClearAll={onClearSelection}
        onNoPreference={() => commit(FORM_CHAT_LOAN_TERM_NO_PREF)}
        onContinue={() => commit(termDraft)}
      />
    );
  }

  if (q.id === "rateTypePref" || q.id === "interestOnlyPref") {
    const commit = (value: string) => {
      const patch = { [q.id]: value } as Partial<WizardForm>;
      onConfirm(patch, productPrefAnswerLabel(q.id, { ...form, ...patch }));
    };
    return (
      <div className="mt-3">
        <div className="grid grid-cols-1 gap-1.5">
          {options.map((opt, i) => (
            <OptionCard
              key={opt.value}
              letter={letter(i)}
              label={opt.label}
              description={opt.description}
              disabled={disabled}
              onClick={() => commit(opt.value)}
              onDeselect={onClearSelection}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export function FormChatProductPrefQuestionCard({
  questionId,
  form,
  disabled = false,
  onConfirm,
  chipLabel,
}: {
  questionId: string;
  form: WizardForm;
  disabled?: boolean;
  onConfirm: (patch: Partial<WizardForm>, label: string) => void;
  /** Override the section·question kicker (e.g. /chat shows a friendly lead instead). */
  chipLabel?: string;
}) {
  const q = FORM_CHAT_QUESTIONS.find((x) => x.id === questionId);
  const [termDraft, setTermDraft] = useState("");

  if (!q || q.special !== "product_pref") return null;

  const chip = chipLabel ?? formChatProductPrefQuestionChip(q.sectionName, q.id);

  const toggleLoanTermDraft = (termValue: string) => {
    if (isNoProductPreference(termValue)) {
      setTermDraft(FORM_CHAT_LOAN_TERM_NO_PREF);
      return;
    }
    const n = parseInt(termValue, 10);
    setTermDraft((prev) => {
      const selected = parseLoanTermSelection(prev);
      const base = selected.length === 0 ? [] : selected;
      const next = base.includes(n)
        ? base.filter((t) => t !== n)
        : [...base, n].sort((a, b) => a - b);
      return formatLoanTermStorage(next);
    });
  };

  const clearSelection = () => {
    if (q.id === "loanTerm") setTermDraft("");
  };

  return (
    <div className="flex flex-col">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {chip}
        </span>
      </div>
      <div className={cn("rounded-2xl border border-border bg-white shadow-sm", CARD_PAD)}>
        {q.prompt.trim() ? (
          <p className={cn(FORM_CHAT_T14, "font-normal leading-relaxed text-[#475569]")}>
            {q.prompt}
          </p>
        ) : null}
        {q.promptSubline ? (
          <p className={cn("mt-1.5 leading-relaxed text-muted-foreground", FORM_CHAT_T13)}>
            {q.promptSubline}
          </p>
        ) : null}
        <ProductPrefStep
          q={q}
          form={form}
          disabled={disabled}
          onConfirm={onConfirm}
          termDraft={termDraft}
          onToggleTerm={toggleLoanTermDraft}
          onClearSelection={clearSelection}
        />
        <p className={cn("mt-2 text-muted-foreground", FORM_CHAT_T13)}>
          Click or type your pick — say “no preference” or “skip” to leave it as No Preference.
        </p>
      </div>
    </div>
  );
}
