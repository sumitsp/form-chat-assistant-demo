import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Copy, Download, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ResultsPagination } from "@/components/wizard/results/ResultsPagination";
import { cn } from "@/lib/utils";
import {
  vaultListScenarioDescription,
  vaultScenarioDescriptionDisplay,
} from "@/lib/historyScenarioDisplay";
import { downloadHistoryScenarioPdf } from "@/lib/historyScenarioPdf";
import {
  deleteFormHistory,
  fetchFormHistoryDetail,
  fetchFormHistoryList,
  SCENARIO_STATUSES,
  updateScenarioStatus,
  type FormHistoryDetail,
  type FormHistorySummary,
  type ScenarioStatus,
  type VaultSort,
  type VaultStatusFilter,
} from "@/lib/scenarioHistoryApi";

type Props = {
  onBack: () => void;
  /** When true, renders inside the LoanWizard main panel (sidebar stays visible). */
  embedded?: boolean;
  /** Start a brand-new scenario (vault toolbar +New Scenario button). */
  onNewScenario?: () => void;
  /** Open a saved scenario for editing (saves back to the same record). */
  onEditScenario?: (detail: FormHistoryDetail) => void | Promise<void>;
  /** Open a saved scenario as a clone (saving creates a new record). */
  onCloneScenario?: (detail: FormHistoryDetail) => void | Promise<void>;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function programsMatchedLabel(count: number): string {
  if (count <= 0) return "0";
  return String(count);
}

const SORT_OPTIONS: { value: VaultSort; label: string }[] = [
  { value: "modified", label: "Sort: Last modified" },
  { value: "name", label: "Sort: Borrower name" },
  { value: "matches", label: "Sort: Matches" },
];

const STATUS_FILTERS: { value: VaultStatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...SCENARIO_STATUSES,
];

// Color treatment per lifecycle status (used by the inline status pill).
const STATUS_STYLES: Record<ScenarioStatus, string> = {
  draft: "border-slate-200 bg-slate-100 text-slate-600",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  locked: "border-amber-200 bg-amber-50 text-amber-700",
  closed: "border-blue-200 bg-blue-50 text-blue-700",
  archived: "border-border bg-muted text-muted-foreground",
  lost: "border-red-200 bg-red-50 text-red-700",
};

// Shared cell typography — one size/family across every column for consistency.
const cellText = "text-[13px] leading-snug";

const selectClass =
  "h-10 shrink-0 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground " +
  "shadow-sm transition-colors hover:border-[#012a5b]/30 focus:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-[#012a5b]/30";

const actionBtnClass =
  "flex h-10 w-full items-center justify-center rounded-lg border border-border text-muted-foreground " +
  "transition-colors hover:border-[#012a5b]/40 hover:bg-[#012a5b]/[0.06] hover:text-[#012a5b] " +
  "disabled:cursor-wait disabled:opacity-50 sm:h-8 sm:w-8 sm:rounded-md";

function VaultMobileLabeledRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-[13px] leading-snug text-foreground">{children}</div>
    </div>
  );
}

function VaultStatusSelect({
  item,
  onChange,
  mobileBlock = false,
}: {
  item: FormHistorySummary;
  onChange: (next: ScenarioStatus) => void;
  /** Full-width row style on mobile vault cards. */
  mobileBlock?: boolean;
}) {
  return (
    <select
      value={item.status}
      onChange={(e) => onChange(e.target.value as ScenarioStatus)}
      aria-label={`Status for ${item.client_name || "scenario"}`}
      title="Change status"
      className={cn(
        "max-w-full cursor-pointer border font-medium capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-[#012a5b]/30",
        mobileBlock
          ? "h-10 w-full rounded-lg px-3 text-[13px]"
          : "rounded-full px-2.5 py-1 text-[11px] sm:text-[12px]",
        STATUS_STYLES[item.status],
      )}
    >
      {SCENARIO_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

const VAULT_PAGE_SIZE = 10;
/** ~10% wider than max-w-5xl (64rem) — extra width goes to scenario description column. */
export const VAULT_CONTAINER_MAX = "max-w-[70.4rem]";
const VAULT_TABLE_MIN_W = "min-w-[946px]";
const VAULT_SCENARIO_DESC_COL = "min-w-[12rem] max-w-[28.4rem]";

export function ScenarioHistoryView({
  onBack,
  embedded = false,
  onNewScenario,
  onEditScenario,
  onCloneScenario,
}: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<VaultStatusFilter>("all");
  const [sort, setSort] = useState<VaultSort>("modified");
  const [items, setItems] = useState<FormHistorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FormHistorySummary | null>(null);
  const [page, setPage] = useState(0);

  const loadList = useCallback(async (q: string, sf: VaultStatusFilter, so: VaultSort) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFormHistoryList(q, { status: sf, sort: so });
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList(query, statusFilter, sort);
  }, [loadList, query, statusFilter, sort]);

  useEffect(() => {
    setPage(0);
  }, [query, statusFilter, sort]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(items.length / VAULT_PAGE_SIZE) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [items.length, page]);

  const pageItems = items.slice(page * VAULT_PAGE_SIZE, page * VAULT_PAGE_SIZE + VAULT_PAGE_SIZE);

  const openWith = async (
    id: number,
    handler?: (detail: FormHistoryDetail) => void | Promise<void>,
  ) => {
    if (!handler || busyId !== null || downloadingId !== null) return;
    setBusyId(id);
    setError(null);
    try {
      const detail = await fetchFormHistoryDetail(id);
      await handler(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open scenario");
    } finally {
      setBusyId(null);
    }
  };

  const downloadPdf = async (id: number) => {
    if (downloadingId !== null || busyId !== null) return;
    setDownloadingId(id);
    setError(null);
    try {
      const detail = await fetchFormHistoryDetail(id);
      const ok = await downloadHistoryScenarioPdf(detail);
      if (!ok) setError("Could not generate PDF — try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download PDF");
    } finally {
      setDownloadingId(null);
    }
  };

  const changeStatus = async (item: FormHistorySummary, next: ScenarioStatus) => {
    if (next === item.status) return;
    // Optimistic update so the pill reacts instantly.
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)));
    setError(null);
    try {
      await updateScenarioStatus(item.id, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change status");
    } finally {
      // Re-sync so the active filter (and sort) is respected.
      await loadList(query, statusFilter, sort);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setBusyId(id);
    setError(null);
    try {
      await deleteFormHistory(id);
      await loadList(query, statusFilter, sort);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete scenario");
    } finally {
      setBusyId(null);
    }
  };

  const headerBlock = (
    <div className="flex w-full min-w-0 items-start justify-between gap-2 sm:gap-3">
      <div className="min-w-0 flex-1">
        <h2
          className={cn(
            "font-display font-semibold text-foreground",
            embedded ? "text-lg sm:text-2xl" : "text-xl sm:text-2xl",
          )}
        >
          Scenario Vault
        </h2>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-[13px]">
          {loading
            ? "Loading saved scenarios…"
            : `${items.length} saved scenario${items.length !== 1 ? "s" : ""} — open, search, and manage.`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {onNewScenario && (
          <button
            type="button"
            onClick={onNewScenario}
            className="flex h-10 items-center gap-1.5 rounded-lg border border-[#012a5b] bg-[#012a5b] px-2.5 text-[12px] font-semibold text-white transition-colors hover:border-[#01234d] hover:bg-[#01234d] sm:h-9 sm:px-3 sm:text-[13px]"
            title="New Scenario"
            aria-label="New Scenario"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="sm:hidden">New</span>
            <span className="hidden sm:inline">New Scenario</span>
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-[#012a5b]/30 hover:bg-muted/40 hover:text-foreground sm:h-9 sm:w-9"
          title="Close vault"
          aria-label="Close Scenario Vault"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const showPagination = items.length > VAULT_PAGE_SIZE;

  const paginationBar = showPagination ? (
    <ResultsPagination
      totalCount={items.length}
      currentPage={page}
      onPageChange={setPage}
      pageSize={VAULT_PAGE_SIZE}
    />
  ) : null;

  const toolbar = (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-row sm:items-center">
      <div className="relative min-w-0 sm:flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search borrower, state, status…"
          className="h-10 bg-card pl-9 text-sm shadow-sm sm:h-10"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:contents">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as VaultStatusFilter)}
          className={cn(selectClass, "w-full min-w-0 sm:w-auto")}
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as VaultSort)}
          className={cn(selectClass, "w-full min-w-0 sm:w-auto")}
          aria-label="Sort scenarios"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const thClass =
    "whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground";

  const skeletonBar = (className?: string) => (
    <div className={cn("h-3.5 animate-pulse rounded bg-muted", className)} />
  );

  const loadingRows = Array.from({ length: VAULT_PAGE_SIZE }, (_, rowIdx) => (
    <tr key={`loading-${rowIdx}`} className="border-b border-border/60">
      <td className="px-4 py-3 align-middle">{skeletonBar("w-6")}</td>
      <td className="px-4 py-3 align-middle">{skeletonBar("w-28")}</td>
      <td className={cn("px-4 py-3 align-middle", VAULT_SCENARIO_DESC_COL)}>
        {skeletonBar("w-full max-w-[20rem]")}
      </td>
      <td className="whitespace-nowrap px-4 py-3 align-middle">{skeletonBar("w-[7.5rem]")}</td>
      <td className="px-4 py-3 align-middle">{skeletonBar("w-8")}</td>
      <td className="px-4 py-3 align-middle">
        <div className="h-7 w-[6.5rem] animate-pulse rounded-full bg-muted" />
      </td>
      <td className="px-2 py-3 align-middle">
        <div className="flex items-center gap-1">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-8 w-8 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </td>
    </tr>
  ));

  const action = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    opts: { disabled?: boolean; danger?: boolean } = {},
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={opts.disabled}
          onClick={onClick}
          aria-label={label}
          className={cn(
            actionBtnClass,
            opts.danger &&
              "hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive",
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  const renderScenarioActions = (item: FormHistorySummary, anyBusy: boolean) => (
    <div className="grid grid-cols-4 gap-1.5 sm:flex sm:items-center sm:justify-start sm:gap-1">
      {onEditScenario &&
        action(
          "Edit",
          busyId === item.id ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Pencil className="h-4 w-4" aria-hidden />
          ),
          () => void openWith(item.id, onEditScenario),
          { disabled: anyBusy },
        )}
      {onCloneScenario &&
        action(
          "Clone",
          <Copy className="h-4 w-4" aria-hidden />,
          () => void openWith(item.id, onCloneScenario),
          { disabled: anyBusy },
        )}
      {action(
        "Download PDF",
        downloadingId === item.id ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        ),
        () => void downloadPdf(item.id),
        { disabled: anyBusy },
      )}
      {action("Delete", <Trash2 className="h-4 w-4" aria-hidden />, () => setPendingDelete(item), {
        disabled: anyBusy,
        danger: true,
      })}
    </div>
  );

  const loadingMobileCards = Array.from({ length: 5 }, (_, rowIdx) => (
    <div
      key={`loading-mobile-${rowIdx}`}
      className="rounded-xl border border-border bg-card p-3.5 shadow-sm"
    >
      {skeletonBar("mb-3 h-5 w-10")}
      <div className="space-y-2.5">
        {skeletonBar("h-8 w-full")}
        {skeletonBar("h-8 w-full")}
        {skeletonBar("h-8 w-2/3")}
        {skeletonBar("h-8 w-1/2")}
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5 border-t border-border/50 pt-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  ));

  const listPanel = (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-border bg-card shadow-sm",
        embedded && cn("w-full", VAULT_CONTAINER_MAX),
      )}
    >
      <div className="flex flex-col gap-2 p-2 sm:hidden">
        {loading && items.length === 0 ? (
          loadingMobileCards
        ) : items.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] text-muted-foreground">
            No saved scenarios{statusFilter !== "all" ? " for this status" : ""}.
          </p>
        ) : (
          pageItems.map((item, idx) => {
            const anyBusy = busyId !== null || downloadingId !== null;
            const descriptor = vaultListScenarioDescription(item);
            const descriptorDisplay = vaultScenarioDescriptionDisplay(descriptor);
            const rowNum = page * VAULT_PAGE_SIZE + idx + 1;
            return (
              <div
                key={item.id}
                className="rounded-xl border border-border bg-card p-3.5 shadow-sm"
              >
                <span className="mb-3 inline-flex rounded-md bg-muted/70 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                  #{rowNum}
                </span>
                <div className="space-y-2.5">
                  <VaultMobileLabeledRow label="Borrower Name:">
                    <span className="font-semibold break-words">
                      {item.client_name || "Unnamed scenario"}
                    </span>
                  </VaultMobileLabeledRow>
                  <VaultMobileLabeledRow label="Description:">
                    <span className="block break-words text-muted-foreground" title={descriptor}>
                      {descriptorDisplay}
                    </span>
                  </VaultMobileLabeledRow>
                  <VaultMobileLabeledRow label="Last Modified:">
                    <span className="text-muted-foreground">{formatWhen(item.created_at)}</span>
                  </VaultMobileLabeledRow>
                  <VaultMobileLabeledRow label="Matches:">
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        item.programs_matched > 0 ? "text-emerald-600" : "text-muted-foreground",
                      )}
                    >
                      {programsMatchedLabel(item.programs_matched)}
                    </span>
                  </VaultMobileLabeledRow>
                  <VaultMobileLabeledRow label="Status:">
                    <VaultStatusSelect
                      item={item}
                      mobileBlock
                      onChange={(next) => void changeStatus(item, next)}
                    />
                  </VaultMobileLabeledRow>
                </div>
                <div className="mt-3 border-t border-border/50 pt-3">
                  <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Actions:</p>
                  {renderScenarioActions(item, anyBusy)}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className={cn("w-full border-collapse text-left", VAULT_TABLE_MIN_W)}>
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className={cn(thClass, "w-14")}>SNo</th>
              <th className={cn(thClass, "w-[16rem]")}>Borrower</th>
              <th className={cn(thClass, VAULT_SCENARIO_DESC_COL)}>Scenario Description</th>
              <th className={cn(thClass, "w-[10.5rem]")}>Last Modified</th>
              <th className={cn(thClass, "w-20")}>Matches</th>
              <th className={cn(thClass, "w-[11rem]")}>Status</th>
              <th className={cn(thClass, "w-[10rem]")}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              loadingRows
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                  No saved scenarios{statusFilter !== "all" ? " for this status" : ""}.
                </td>
              </tr>
            ) : (
              pageItems.map((item, idx) => {
                const anyBusy = busyId !== null || downloadingId !== null;
                const descriptor = vaultListScenarioDescription(item);
                const descriptorDisplay = vaultScenarioDescriptionDisplay(descriptor);
                const rowNum = page * VAULT_PAGE_SIZE + idx + 1;
                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "border-b border-border/60 transition-colors hover:bg-[#012a5b]/[0.04]",
                      idx % 2 === 1 && "bg-muted/30",
                    )}
                  >
                    <td
                      className={cn(
                        "px-4 py-3 align-middle tabular-nums text-muted-foreground",
                        cellText,
                      )}
                    >
                      {rowNum}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className={cn("font-semibold text-foreground", cellText)}>
                        {item.client_name || "Unnamed scenario"}
                      </span>
                    </td>
                    <td className={cn("px-4 py-3 align-middle", VAULT_SCENARIO_DESC_COL)}>
                      <span
                        className={cn(
                          "block whitespace-normal break-words text-muted-foreground",
                          cellText,
                        )}
                        title={descriptor}
                      >
                        {descriptorDisplay}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-4 py-3 align-middle text-muted-foreground",
                        cellText,
                      )}
                    >
                      {formatWhen(item.created_at)}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          cellText,
                          item.programs_matched > 0 ? "text-emerald-600" : "text-muted-foreground",
                        )}
                      >
                        {programsMatchedLabel(item.programs_matched)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <VaultStatusSelect
                        item={item}
                        onChange={(next) => void changeStatus(item, next)}
                      />
                    </td>
                    <td className="px-2 py-3 align-middle">
                      {renderScenarioActions(item, anyBusy)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {paginationBar ? (
        <div className="border-t border-border px-2 py-2.5 sm:px-3">{paginationBar}</div>
      ) : null}
    </div>
  );

  const body = (
    <>
      {headerBlock}
      {toolbar}
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          {error}
        </p>
      )}
      {listPanel}
    </>
  );

  const deleteDialog = (
    <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this scenario?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDelete?.client_name
              ? `"${pendingDelete.client_name}" will be permanently removed from your vault. This cannot be undone.`
              : "This scenario will be permanently removed from your vault. This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void confirmDelete()}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <TooltipProvider delayDuration={250}>
      {embedded ? (
        <div className={cn("mx-auto w-full min-w-0 space-y-3", VAULT_CONTAINER_MAX)}>
          {body}
          {deleteDialog}
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-4 bg-background p-4 sm:p-6">
          {body}
          {deleteDialog}
        </div>
      )}
    </TooltipProvider>
  );
}
