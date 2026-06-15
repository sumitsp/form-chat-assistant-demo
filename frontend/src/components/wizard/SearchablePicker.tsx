/**
 * Searchable combobox — inline dropdown on desktop; full-screen sheet on mobile so
 * lists aren't clipped by chat scroll containers or lost when the keyboard opens.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type SearchablePickerItem = {
  key: string;
  value: string;
  label: string;
};

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  selectedValue?: string;
  items: SearchablePickerItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: SearchablePickerItem) => void;
  onBlurCommit?: () => void;
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  /** Title shown in the mobile sheet header (defaults to placeholder). */
  mobileTitle?: string;
  className?: string;
};

const MOBILE_MQ = "(max-width: 767px)";

function useMobilePicker() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}

function PickerList({
  items,
  selectedValue,
  onSelect,
  className,
}: {
  items: SearchablePickerItem[];
  selectedValue?: string;
  onSelect: (item: SearchablePickerItem) => void;
  className?: string;
}) {
  return (
    <ul className={cn("py-1", className)}>
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(item)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2.5 text-left text-[14px] transition-colors hover:bg-muted/60 active:bg-muted/80",
              selectedValue === item.value && "font-medium text-[#012a5b] dark:text-sky-200",
            )}
          >
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                selectedValue === item.value ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <span className="truncate">{item.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-card px-3 text-[14px] shadow-sm outline-none transition-colors focus-visible:border-[#012a5b]/50 focus-visible:ring-2 focus-visible:ring-[#012a5b]/15";

export function SearchablePicker({
  query,
  onQueryChange,
  selectedValue = "",
  items,
  open,
  onOpenChange,
  onSelect,
  onBlurCommit,
  placeholder,
  disabled = false,
  loading = false,
  emptyMessage = "No matches — try a different spelling.",
  mobileTitle,
  className,
}: Props) {
  const isMobile = useMobilePicker();
  const sheetTitle = mobileTitle ?? placeholder;
  const displayLabel = query.trim() || items.find((i) => i.value === selectedValue)?.label || "";

  const close = useCallback(() => {
    onOpenChange(false);
    onBlurCommit?.();
  }, [onBlurCommit, onOpenChange]);

  const pick = useCallback(
    (item: SearchablePickerItem) => {
      if (item.value === selectedValue) {
        close();
        return;
      }
      onSelect(item);
      onOpenChange(false);
    },
    [close, onOpenChange, onSelect, selectedValue],
  );

  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  if (disabled) {
    return (
      <div className={cn("w-full", className)}>
        <input
          type="text"
          disabled
          value=""
          placeholder="Select a state first"
          className={cn(inputClass, "cursor-not-allowed opacity-60")}
        />
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className={cn("w-full", className)}>
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className={cn(
            inputClass,
            "flex items-center text-left",
            !displayLabel && "text-muted-foreground",
          )}
        >
          <span className="truncate">{displayLabel || placeholder}</span>
        </button>

        {open ? (
          <div
            className="fixed inset-0 z-[120] flex flex-col bg-card"
            role="dialog"
            aria-modal="true"
            aria-label={sheetTitle}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
              <input
                type="text"
                value={query}
                autoFocus
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder={placeholder}
                className={cn(inputClass, "min-w-0 flex-1 shadow-none")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (items.length > 0) pick(items[0]);
                  } else if (e.key === "Escape") {
                    close();
                  }
                }}
              />
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {loading ? (
                <p className="px-4 py-3 text-[13px] text-muted-foreground">Searching…</p>
              ) : items.length > 0 ? (
                <PickerList items={items} selectedValue={selectedValue} onSelect={pick} />
              ) : query.trim() ? (
                <p className="px-4 py-3 text-[13px] text-muted-foreground">{emptyMessage}</p>
              ) : (
                <p className="px-4 py-3 text-[13px] text-muted-foreground">
                  Start typing to search.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          onOpenChange(true);
        }}
        onFocus={(e) => {
          onOpenChange(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          window.setTimeout(() => {
            onOpenChange(false);
            onBlurCommit?.();
          }, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (items.length > 0) pick(items[0]);
          } else if (e.key === "Escape") {
            onOpenChange(false);
          }
        }}
        placeholder={placeholder}
        className={inputClass}
      />
      {open && (
        <>
          {loading ? (
            <div className="mt-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground shadow-sm">
              Searching…
            </div>
          ) : items.length > 0 ? (
            <ul className="mt-1 max-h-[240px] overflow-auto rounded-lg border border-border bg-card py-1 shadow-sm">
              <PickerList items={items} selectedValue={selectedValue} onSelect={pick} />
            </ul>
          ) : query.trim() ? (
            <div className="mt-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground shadow-sm">
              {emptyMessage}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
