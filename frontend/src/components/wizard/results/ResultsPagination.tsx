/**
 * Pager for the eligible-programs table — extracted from LoanWizard.tsx (frontend split).
 * Renders nothing when total fits on one page.
 */
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZE = 3;

export function ResultsPagination({
  totalCount,
  currentPage,
  onPageChange,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  totalCount: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  /** Programs per page (wizard step table: 3; /form chat results: 5). */
  pageSize?: number;
}) {
  if (totalCount <= pageSize) return null;
  const totalPages = Math.ceil(totalCount / pageSize);
  const from = currentPage * pageSize + 1;
  const to = Math.min((currentPage + 1) * pageSize, totalCount);
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[11px] text-muted-foreground sm:text-[12px]">
      <span>
        {from}–{to} of {totalCount}
      </span>
      <div className="flex max-w-[min(100%,16rem)] flex-wrap items-center justify-end gap-1 sm:max-w-none">
        <button
          type="button"
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
          className="rounded px-2 py-0.5 font-medium transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-30"
        >
          ‹ Prev
        </button>
        {Array.from({ length: totalPages }, (_, pi) => (
          <button
            key={pi}
            type="button"
            onClick={() => onPageChange(pi)}
            className={cn(
              "h-6 min-w-[24px] rounded px-1.5 font-medium transition-colors",
              pi === currentPage ? "bg-[#012a5b] text-white" : "hover:bg-muted",
            )}
          >
            {pi + 1}
          </button>
        ))}
        <button
          type="button"
          disabled={currentPage === totalPages - 1}
          onClick={() => onPageChange(currentPage + 1)}
          className="rounded px-2 py-0.5 font-medium transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-30"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
