import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact header trigger matching Form / Chat styling. */
export function ScenarioHistoryButton({
  onClick,
  className,
  active = false,
}: {
  onClick: () => void;
  className?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 py-0 text-[11px] font-semibold leading-none transition-colors sm:h-9 sm:px-2.5",
        active
          ? "border-[#01234d] bg-[#01234d] text-white shadow-sm"
          : "border-[#012a5b] bg-[#012a5b] text-white hover:bg-[#01234d] hover:border-[#01234d]",
        className,
      )}
      title="Scenario vault"
      aria-label="Scenario vault"
      aria-pressed={active}
    >
      <Archive className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">Vault</span>
    </button>
  );
}
