/**
 * Wizard form-field components — extracted from LoanWizard.tsx (Phase 0 of the
 * frontend split). Pure presentational inputs: value + onChange, no parent state.
 */
import { useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  formatLoanTermStorage,
  formatMoneyForInput,
  formatSelectDisplayLabel,
  LOAN_TERM_SELECT_OPTIONS,
  parseLoanTermSelection,
} from "@/lib/nqmIntegratedForm";
import {
  STATES,
  WIZARD_FORM_CHIP,
  WIZARD_FORM_INPUT,
  WIZARD_FORM_LABEL,
  WIZARD_FORM_SELECT,
} from "@/lib/wizardFormUi";

export function FField({
  label,
  required: _required,
  conditional: _conditional,
  optional: _optional,
  children,
  anchorId,
  formValue: _formValue,
}: {
  label: string;
  required?: boolean;
  /** Field appears only under specific loan scenario conditions; required when visible. */
  conditional?: boolean;
  /** Field is never required — purely supplemental. */
  optional?: boolean;
  children: React.ReactNode;
  /** Scroll target when opened from profile sidebar (`profile-field-{anchorId}`). */
  anchorId?: string;
  /** Passed for scroll/profile wiring; does not affect indicators. */
  formValue?: string;
}) {
  const display =
    formatSelectDisplayLabel(label.replace(/\?/g, "").trim()) + (label.includes("?") ? "?" : "");
  return (
    <div
      id={anchorId ? `profile-field-${anchorId}` : undefined}
      className="ff scroll-mt-24 space-y-1.5"
    >
      <div className="flex items-baseline gap-1.5">
        <Label className={WIZARD_FORM_LABEL}>{display}</Label>
        {(_required || _conditional) && (
          <span className="text-[10px] font-semibold text-red-500">*</span>
        )}
        {_optional && (
          <span className="text-[10px] font-normal text-muted-foreground">(optional)</span>
        )}
      </div>
      {children}
    </div>
  );
}

export function FSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  side = "bottom",
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={WIZARD_FORM_SELECT}
        >
          <span className={cn(!value && "text-muted-foreground/40")}>
            {value ? formatSelectDisplayLabel(value) : (placeholder ?? "Select...")}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50 sm:h-4 sm:w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        style={{ width: "var(--radix-popover-trigger-width)" }}
        className="p-0"
        align="start"
        side={side}
        sideOffset={4}
        avoidCollisions
        collisionPadding={16}
        sticky="always"
      >
        <Command value={value || options[0] || ""}>
          <CommandList className="max-h-[min(256px,40vh)] overflow-y-auto">
            {options.map((o) => (
              <CommandItem
                key={o}
                value={o}
                onSelect={() => {
                  onChange(value === o ? "" : o);
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", value === o ? "opacity-100" : "opacity-0")} />
                {formatSelectDisplayLabel(o)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function loanTermChipClass(active: boolean) {
  return cn(
    WIZARD_FORM_CHIP,
    active
      ? "border-[#012a5b] bg-[#012a5b] text-white"
      : "border-border bg-muted/40 text-foreground hover:border-[#012a5b]/40",
  );
}

export function FLoanTermMultiSelect({
  value,
  onChange,
}: {
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

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        onClick={() => onChange("No preference")}
        className={loanTermChipClass(noPreference)}
      >
        No preference
      </button>
      {LOAN_TERM_SELECT_OPTIONS.map((o) => {
        const active = !noPreference && selected.includes(parseInt(o.value, 10));
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={loanTermChipClass(active)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function FSelectLabeled({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  side = "bottom",
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { readonly value: string; readonly label: string }[];
  placeholder?: string;
  disabled?: boolean;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((o) => o.value === value)?.label;
  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={WIZARD_FORM_SELECT}
        >
          <span className={cn(!value && "text-muted-foreground/40")}>
            {selectedLabel ? formatSelectDisplayLabel(selectedLabel) : (placeholder ?? "Select...")}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50 sm:h-4 sm:w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        style={{ width: "var(--radix-popover-trigger-width)" }}
        className="p-0"
        align="start"
        side={side}
        sideOffset={4}
        avoidCollisions
        collisionPadding={16}
        sticky="always"
      >
        <Command>
          <CommandList className="max-h-[min(256px,40vh)] overflow-y-auto">
            {options.map((o) => (
              <CommandItem
                key={o.value}
                value={o.label}
                onSelect={() => {
                  onChange(value === o.value ? "" : o.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")}
                />
                {formatSelectDisplayLabel(o.label)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function FMoney({
  value,
  onChange,
  placeholder,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onBlur?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const cursorPos = e.target.selectionStart ?? raw.length;

    // Count digits (0-9) before the cursor in the raw (possibly already-formatted) string
    const rawBeforeCursor = raw.slice(0, cursorPos);
    const digitsBeforeCursor = (rawBeforeCursor.match(/[0-9]/g) ?? []).length;

    // Strip everything except digits and at most one decimal point
    const stripped = raw.replace(/[^0-9.]/g, "");

    // Format: if non-empty, apply comma formatting; otherwise pass through empty string
    const formatted = stripped ? formatMoneyForInput(stripped) : "";

    // Walk formatted string to find the cursor position that preserves the
    // same number of digits before it as in the raw string
    let digitsSeen = 0;
    let newCursor = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (/[0-9]/.test(formatted[i])) {
        digitsSeen++;
        if (digitsSeen === digitsBeforeCursor) {
          newCursor = i + 1;
          break;
        }
      }
    }

    onChange(formatted);

    // Restore cursor after React re-renders the input
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(newCursor, newCursor);
      }
    });
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[13px] text-muted-foreground sm:left-3 sm:text-sm">
        $
      </span>
      <Input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onBlur={(e) => {
          onChange(formatMoneyForInput(e.target.value));
          onBlur?.();
        }}
        className={cn("pl-6 placeholder:text-muted-foreground/30", WIZARD_FORM_INPUT)}
      />
    </div>
  );
}

export function FNumeric({
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
  suffix: _suffix,
  error,
  clampOnBlur = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  error?: string;
  /** When false, out-of-range values are left as typed (caution-only fields). */
  clampOnBlur?: boolean;
}) {
  return (
    <div>
      <Input
        type="number"
        value={value}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          if (!clampOnBlur) return;
          const num = parseFloat(e.target.value);
          if (isNaN(num) || e.target.value === "") return;
          if (max !== undefined && num > max) onChange(String(max));
          else if (min !== undefined && num < min) onChange(String(min));
        }}
        className={cn(
          WIZARD_FORM_INPUT,
          "placeholder:text-muted-foreground/30",
          error && "border-red-400",
        )}
      />
      {error && <p className="mt-1 text-[10px] text-red-500 sm:text-[11px]">{error}</p>}
    </div>
  );
}

export function FStateSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = STATES.find((s) => s.code === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button role="combobox" aria-expanded={open} type="button" className={WIZARD_FORM_SELECT}>
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected ? `${selected.code} - ${selected.label}` : "Select..."}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50 sm:h-4 sm:w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        style={{ width: "var(--radix-popover-trigger-width)" }}
        className="p-0"
        align="end"
        side="bottom"
        avoidCollisions
        collisionPadding={8}
      >
        <Command>
          <CommandInput placeholder="Search state..." />
          <CommandList>
            <CommandEmpty>No state found.</CommandEmpty>
            {STATES.map((state) => (
              <CommandItem
                key={state.code}
                value={`${state.code} ${state.label}`}
                onSelect={() => {
                  if (value === state.code) {
                    onChange("");
                  } else {
                    onChange(state.code);
                  }
                  setOpen(false);
                }}
              >
                <Check
                  className={cn("mr-2 h-4 w-4", value === state.code ? "opacity-100" : "opacity-0")}
                />
                {state.code} - {state.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
