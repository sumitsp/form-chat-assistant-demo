import { useEffect, useMemo, useRef, useState } from "react";
import {
  getProgramConsiderationBullets,
  getProgramDocsDisplay,
  KnowMoreFollowupHint,
  limitConsiderationBullets,
  ConsiderationBulletLine,
  PROGRAM_CHAT_BODY_CLASS,
  PROGRAM_CHAT_SECTION_LABEL_CLASS,
  PROGRAM_CHAT_TITLE_CLASS,
  programConsiderationsPending,
  programDisplayName,
  programSelectKey,
  UI_LIST_SEPARATOR,
  joinUiList,
} from "@/lib/programDisplayHelpers.tsx";
import {
  buildPreferredProductSet,
  formatLeveragePercentDisplay,
  formatMoneyInt,
  formatMortgageAcronyms,
  parseProductsList,
  roundLeveragePercent,
  shouldStyleProductMismatch,
  type ProductDisplayPrefs,
} from "@/lib/nqmIntegratedForm";
import {
  ProductPriceChip,
  type ProductParPrice,
  type ProductPriceFetcher,
} from "@/components/wizard/shared/results";
import { cn } from "@/lib/utils";

export type ScenarioSnapshot = {
  fico?: number | null;
  loanAmount?: number | null;
  ltv?: number | null;
  cltv?: number | null;
  /** Piggyback or subordinating 2nd — program caps are CLTV; compare borrower's CLTV. */
  usesCltvLeverage?: boolean;
  dti?: number | null;
  dscr?: number | null;
  occupancy?: string | null;
  docType?: string | null;
};

/** Program row shape from eligibility API / PROGRAM_DETAIL JSON. */
export type EligibleProgram = {
  investor?: string;
  investor_name?: string;
  program_name?: string;
  program_name_np?: string | null;
  program_type?: string | null;
  min_fico?: number | null;
  min_loan?: number | null;
  max_loan?: number | null;
  max_ltv_purchase?: number | null;
  max_ltv_rate_term?: number | null;
  max_ltv_cashout?: number | null;
  max_dti?: number | null;
  min_dscr?: number | null;
  doc_type?: string | null;
  occupancy?: string | null;
  doc_types_allowed?: string | null;
  occupancy_types?: string[] | null;
  property_types?: string[] | null;
  loan_purposes_allowed?: string[] | null;
  program_notes?: string | null;
  is_active?: boolean;
  products_available?: string | null;
  products?: string[] | null;
  products_matching?: string[] | null;
  special_overlay?: string | null;
  rag_notes?: string[] | null;
  summary_notes?: string | null;
  summary_bullets?: string[] | null;
  program_id?: number | null;
  best_match?: {
    min_fico?: number | null;
    min_loan?: number | null;
    max_loan?: number | null;
    max_ltv_purchase?: number | null;
    max_ltv_rate_term?: number | null;
    max_ltv_cashout?: number | null;
  } | null;
};

type MetricsRow = {
  label: string;
  programLimit: string;
  bestMatch: string;
  scenarioValue?: string;
  scenarioPass?: boolean | null;
  bestMatchPass?: boolean | null;
};

function formatLoanAmount(value: number | null | undefined): string | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return `$${formatMoneyInt(n)}`;
}

type Props = {
  prog: EligibleProgram;
  productPrefs?: ProductDisplayPrefs;
  onStreamComplete?: () => void;
  /** Show full card immediately (e.g. browser reload restored session). */
  instantReveal?: boolean;
  scenario?: ScenarioSnapshot;
  /** Hide the program-name heading (caller already shows it). */
  hideTitle?: boolean;
  /** When false, caller renders follow-up / Exit hint after action chips (FormChatFlow). */
  showFollowupHint?: boolean;
  /** Par-price hover chips on product names (FormChatFlow results). */
  productPrices?: Record<string, ProductParPrice | null>;
  onProductPrice?: ProductPriceFetcher;
};

const STREAM_MS_PER_ITEM = 120;

function StreamCursor({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-current align-middle opacity-60" />
  );
}

function AnimatedDots() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setCount((c) => (c % 3) + 1), 450);
    return () => clearInterval(id);
  }, []);
  return <span className="ml-[3px] align-text-bottom leading-none">{"•".repeat(count)}</span>;
}

/** Know-more card — key metrics immediate; products then considerations stream in order. */
export function ProgramKnowMoreDetail({
  prog,
  productPrefs,
  onStreamComplete,
  instantReveal = false,
  scenario,
  hideTitle = false,
  showFollowupHint = true,
  productPrices,
  onProductPrice,
}: Props) {
  const programName = programDisplayName(prog);
  const docsDisplay = getProgramDocsDisplay(prog);
  const considerationsPending = programConsiderationsPending(prog);

  const allProductItems = useMemo(() => {
    const matching = (prog.products_matching ?? [])
      .map((s) => formatMortgageAcronyms(s.trim()))
      .filter(Boolean);
    if (matching.length > 0) return matching;
    return parseProductsList(prog.products, prog.products_available).map(formatMortgageAcronyms);
  }, [prog.products_matching, prog.products, prog.products_available]);

  const preferredProductSet = useMemo(
    () =>
      buildPreferredProductSet(
        prog.products,
        prog.products_available,
        prog.products_matching,
        productPrefs,
      ),
    [prog.products_matching, prog.products, prog.products_available, productPrefs],
  );

  const highlightProductMismatch = useMemo(
    () => shouldStyleProductMismatch(prog.products_matching, productPrefs),
    [prog.products_matching, productPrefs],
  );

  /** Matching / preferred products only — no struck-through non-matches. */
  const visibleProductItems = useMemo(() => {
    if (!highlightProductMismatch) return allProductItems;
    return allProductItems.filter((name) => preferredProductSet.has(name));
  }, [allProductItems, highlightProductMismatch, preferredProductSet]);

  const considerationBullets = useMemo(
    () => limitConsiderationBullets(getProgramConsiderationBullets(prog)),
    [prog.summary_bullets, prog.summary_notes, prog.special_overlay, prog.rag_notes],
  );

  const [productsShown, setProductsShown] = useState(0);
  const [productsComplete, setProductsComplete] = useState(false);
  const [considerationsText, setConsiderationsText] = useState("");
  const [considerationsComplete, setConsiderationsComplete] = useState(false);
  const streamRunRef = useRef(0);

  const maxLoanDisplay = formatLoanAmount(prog.max_loan);
  const minLoanDisplay = formatLoanAmount(prog.min_loan);

  const occupancyTypesList = useMemo(() => {
    const raw = prog.occupancy_types;
    if (!raw) return [] as string[];
    if (Array.isArray(raw)) return raw.map((o) => String(o).trim()).filter(Boolean);
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((o) => String(o).trim()).filter(Boolean);
        }
      } catch {
        return raw.trim() ? [raw.trim()] : [];
      }
    }
    return [];
  }, [prog.occupancy_types]);

  const fmt$ = (n: number | null | undefined) => (n != null ? `$${formatMoneyInt(n)}` : undefined);
  const fmtPct = (n: number | null | undefined) => (n != null ? `${n}%` : undefined);

  const borrowerOccupancy = (scenario?.occupancy || prog.occupancy || "").trim() || undefined;

  const bm = prog.best_match;
  const bmLoanDisplay = formatLoanAmount(bm?.max_loan ?? undefined);
  const bmMinLoanDisplay = formatLoanAmount(bm?.min_loan ?? undefined);

  const propertyTypesList = prog.property_types ?? [];
  const loanPurposesList = prog.loan_purposes_allowed ?? [];

  const usesCltv = Boolean(scenario?.usesCltvLeverage);
  const scenarioLeverage = usesCltv ? scenario?.cltv : scenario?.ltv;
  const leveragePrefix = usesCltv ? "CLTV" : "LTV";

  const leverageMetricRow = (
    suffix: string,
    programCap: number | null | undefined,
    bestMatchCap: number | null | undefined,
  ): MetricsRow => {
    const cap = roundLeveragePercent(programCap);
    const bmCap = roundLeveragePercent(bestMatchCap);
    const borrower = roundLeveragePercent(scenarioLeverage ?? undefined);
    return {
      label: `Max ${leveragePrefix} — ${suffix}`,
      programLimit: formatLeveragePercentDisplay(programCap) ?? "—",
      bestMatch: formatLeveragePercentDisplay(bestMatchCap) ?? "—",
      scenarioValue: formatLeveragePercentDisplay(scenarioLeverage ?? undefined),
      scenarioPass:
        borrower != null && cap != null
          ? borrower <= cap
          : borrower != null && bmCap != null
            ? borrower <= bmCap
            : null,
      bestMatchPass: borrower != null && bmCap != null ? borrower <= bmCap : null,
    };
  };

  const metricsRows: MetricsRow[] = [
    prog.min_fico != null && {
      label: "Min FICO",
      programLimit: String(prog.min_fico),
      bestMatch: bm?.min_fico != null ? String(bm.min_fico) : "—",
      scenarioValue: scenario?.fico != null ? String(scenario.fico) : undefined,
      scenarioPass: scenario?.fico != null ? scenario.fico >= prog.min_fico : null,
      bestMatchPass:
        scenario?.fico != null && bm?.min_fico != null ? scenario.fico >= bm.min_fico : null,
    },
    (minLoanDisplay || bmMinLoanDisplay) && {
      label: "Min Loan Amount",
      programLimit: minLoanDisplay ?? "—",
      bestMatch: bmMinLoanDisplay ?? "—",
      scenarioValue: fmt$(scenario?.loanAmount),
      scenarioPass:
        scenario?.loanAmount != null && prog.min_loan != null
          ? scenario.loanAmount >= prog.min_loan
          : null,
      bestMatchPass:
        scenario?.loanAmount != null && bm?.min_loan != null
          ? scenario.loanAmount >= bm.min_loan
          : null,
    },
    maxLoanDisplay && {
      label: "Max Loan Amount",
      programLimit: maxLoanDisplay,
      bestMatch: bmLoanDisplay ?? "—",
      scenarioValue: fmt$(scenario?.loanAmount),
      scenarioPass:
        scenario?.loanAmount != null && prog.max_loan != null
          ? scenario.loanAmount <= prog.max_loan
          : null,
      bestMatchPass:
        scenario?.loanAmount != null && bm?.max_loan != null
          ? scenario.loanAmount <= bm.max_loan
          : null,
    },
    (prog.max_ltv_purchase != null || bm?.max_ltv_purchase != null) &&
      leverageMetricRow("Purchase", prog.max_ltv_purchase ?? undefined, bm?.max_ltv_purchase),
    (prog.max_ltv_rate_term != null || bm?.max_ltv_rate_term != null) &&
      leverageMetricRow("Rate & Term", prog.max_ltv_rate_term ?? undefined, bm?.max_ltv_rate_term),
    (prog.max_ltv_cashout != null || bm?.max_ltv_cashout != null) &&
      leverageMetricRow("Cash-Out", prog.max_ltv_cashout ?? undefined, bm?.max_ltv_cashout),
    prog.max_dti != null && {
      label: "Max DTI",
      programLimit: `${prog.max_dti}%`,
      bestMatch: bm?.max_dti != null ? `${bm.max_dti}%` : "—",
      scenarioValue: fmtPct(scenario?.dti),
      scenarioPass: scenario?.dti != null ? scenario.dti <= prog.max_dti : null,
      bestMatchPass:
        scenario?.dti != null && bm?.max_dti != null ? scenario.dti <= bm.max_dti : null,
    },
    prog.min_dscr != null && {
      label: "Min DSCR",
      programLimit: String(prog.min_dscr),
      bestMatch: bm?.min_dscr != null ? String(bm.min_dscr) : "—",
      scenarioValue: scenario?.dscr != null ? String(scenario.dscr) : undefined,
      scenarioPass: scenario?.dscr != null ? scenario.dscr >= prog.min_dscr : null,
      bestMatchPass:
        scenario?.dscr != null && bm?.min_dscr != null ? scenario.dscr >= bm.min_dscr : null,
    },
  ].filter(Boolean) as MetricsRow[];

  const showBestMatchCol = bm != null;
  const hasScenarioData = scenario != null && metricsRows.some((r) => r.scenarioValue != null);

  const stableProgramKey = programSelectKey(prog);
  const allProductItemsKey = visibleProductItems.join("\u0001");
  const bulletsKey = considerationBullets.join("\u0001");

  const docTypesSorted = useMemo(() => {
    const parts = docsDisplay
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!scenario?.docType) return parts;
    const matchIdx = parts.findIndex((dt) => dt.toLowerCase() === scenario.docType!.toLowerCase());
    if (matchIdx <= 0) return parts;
    const reordered = [...parts];
    reordered.splice(matchIdx, 1);
    reordered.unshift(parts[matchIdx]);
    return reordered;
  }, [docsDisplay, scenario?.docType]);

  const onCompleteRef = useRef(onStreamComplete);
  onCompleteRef.current = onStreamComplete;

  // Phase 1 — stream products one at a time
  useEffect(() => {
    const runId = ++streamRunRef.current;
    if (instantReveal) {
      setProductsShown(visibleProductItems.length);
      setProductsComplete(true);
      return;
    }
    setProductsShown(0);
    setProductsComplete(false);

    if (visibleProductItems.length === 0) {
      setProductsComplete(true);
      return;
    }

    let i = 0;
    const iv = window.setInterval(() => {
      if (streamRunRef.current !== runId) {
        window.clearInterval(iv);
        return;
      }
      i += 1;
      setProductsShown(i);
      if (i >= visibleProductItems.length) {
        window.clearInterval(iv);
        setProductsComplete(true);
      }
    }, STREAM_MS_PER_ITEM);

    return () => window.clearInterval(iv);
  }, [stableProgramKey, allProductItemsKey, instantReveal, visibleProductItems.length]);

  // Phase 2 — after products, stream considerations (or wait for summarize)
  useEffect(() => {
    if (!productsComplete) return;

    const runId = ++streamRunRef.current;
    if (instantReveal) {
      if (considerationsPending) return;
      setConsiderationsText(
        considerationBullets.length > 0 ? considerationBullets.map((b) => `• ${b}`).join("\n") : "",
      );
      setConsiderationsComplete(true);
      return;
    }
    setConsiderationsText("");
    setConsiderationsComplete(false);

    if (considerationsPending) {
      return;
    }

    if (considerationBullets.length === 0) {
      setConsiderationsComplete(true);
      return;
    }

    let i = 0;
    const iv = window.setInterval(() => {
      if (streamRunRef.current !== runId) {
        window.clearInterval(iv);
        return;
      }
      i += 1;
      setConsiderationsText(
        considerationBullets
          .slice(0, i)
          .map((b) => `• ${b}`)
          .join("\n"),
      );
      if (i >= considerationBullets.length) {
        window.clearInterval(iv);
        setConsiderationsComplete(true);
      }
    }, STREAM_MS_PER_ITEM);

    return () => window.clearInterval(iv);
  }, [productsComplete, stableProgramKey, considerationsPending, bulletsKey, instantReveal]);

  const allStreamComplete =
    productsComplete &&
    (considerationsComplete || (!considerationsPending && considerationBullets.length === 0));

  useEffect(() => {
    if (allStreamComplete) onCompleteRef.current?.();
  }, [allStreamComplete]);

  const showProductsBlock = visibleProductItems.length > 0;
  const productsStreaming = showProductsBlock && !productsComplete;
  const showConsiderationsBlock =
    productsComplete &&
    (considerationsPending || considerationBullets.length > 0 || considerationsText.length > 0);

  return (
    <div className={cn("space-y-4", PROGRAM_CHAT_BODY_CLASS)}>
      {!hideTitle && (
        <div>
          <div className={PROGRAM_CHAT_TITLE_CLASS}>{programName}</div>
        </div>
      )}

      {metricsRows.length > 0 && (
        <div>
          <div className={PROGRAM_CHAT_SECTION_LABEL_CLASS}>Key Metrics</div>
          <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border sm:hidden">
            {metricsRows.map((row, ri) => (
              <div key={ri} className={cn("px-3 py-2", ri % 2 === 0 ? "bg-muted/30" : "bg-card")}>
                <dt className="text-[10px] font-medium text-muted-foreground">{row.label}</dt>
                <dd className="mt-1 space-y-0.5 text-[11px] md:text-[13px]">
                  <div>
                    <span className="text-muted-foreground">Program limit: </span>
                    <span className="text-foreground">{row.programLimit}</span>
                  </div>
                  {showBestMatchCol && (
                    <div>
                      <span className="text-muted-foreground">Best match: </span>
                      <span
                        className={cn(
                          row.bestMatchPass === true
                            ? "font-medium text-emerald-600"
                            : "text-foreground",
                        )}
                      >
                        {row.bestMatch}
                      </span>
                    </div>
                  )}
                  {hasScenarioData && row.scenarioValue && (
                    <div>
                      <span className="text-muted-foreground">Borrower: </span>
                      <span
                        className={cn(
                          row.scenarioPass === true
                            ? "font-medium text-emerald-600"
                            : "text-muted-foreground",
                        )}
                      >
                        {row.scenarioValue}
                      </span>
                    </div>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <div className="hidden overflow-hidden rounded-lg border border-border sm:block">
            <table className="w-full table-fixed border-collapse">
              {(showBestMatchCol || hasScenarioData) && (
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="w-[28%] px-3 py-1" />
                    <th className="px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Program Limit
                    </th>
                    {showBestMatchCol && (
                      <th className="px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Best Match
                      </th>
                    )}
                    {hasScenarioData && (
                      <th className="px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Borrower's Value
                      </th>
                    )}
                  </tr>
                </thead>
              )}
              <tbody>
                {metricsRows.map((row, ri) => (
                  <tr
                    key={ri}
                    className="border-t border-border first:border-t-0 odd:bg-muted/30 even:bg-card"
                  >
                    <td className="px-3 py-1.5 align-top font-medium text-muted-foreground">
                      {row.label}
                    </td>
                    <td className="px-3 py-1.5 text-foreground">
                      <span
                        className={
                          row.label === "Documentation Type" ? "leading-snug" : "tabular-nums"
                        }
                      >
                        {row.programLimit}
                      </span>
                    </td>
                    {showBestMatchCol && (
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            "tabular-nums",
                            row.bestMatchPass === true
                              ? "font-medium text-emerald-600"
                              : "text-foreground",
                          )}
                        >
                          {row.bestMatch}
                        </span>
                      </td>
                    )}
                    {hasScenarioData && (
                      <td className="px-3 py-1.5">
                        {row.scenarioValue ? (
                          <span
                            className={cn(
                              "tabular-nums",
                              row.scenarioPass === true
                                ? "font-medium text-emerald-600"
                                : "text-muted-foreground",
                            )}
                          >
                            {row.scenarioValue}
                          </span>
                        ) : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {occupancyTypesList.length > 0 && (
        <div>
          <div className={PROGRAM_CHAT_SECTION_LABEL_CLASS}>Occupancy Types</div>
          <p className="leading-snug">
            {occupancyTypesList.map((occ, oi) => {
              const isMatch =
                borrowerOccupancy != null && occ.toLowerCase() === borrowerOccupancy.toLowerCase();
              return (
                <span key={oi}>
                  {oi > 0 && <span className="text-muted-foreground">{UI_LIST_SEPARATOR}</span>}
                  <span className={isMatch ? "font-semibold text-emerald-600" : "text-foreground"}>
                    {occ}
                  </span>
                </span>
              );
            })}
          </p>
        </div>
      )}

      {propertyTypesList.length > 0 && (
        <div>
          <div className={PROGRAM_CHAT_SECTION_LABEL_CLASS}>Property Types</div>
          <p className="leading-snug text-foreground">{joinUiList(propertyTypesList)}</p>
        </div>
      )}

      {loanPurposesList.length > 0 && (
        <div>
          <div className={PROGRAM_CHAT_SECTION_LABEL_CLASS}>Loan Purposes</div>
          <p className="leading-snug text-foreground">{joinUiList(loanPurposesList)}</p>
        </div>
      )}

      {docsDisplay && docTypesSorted.length > 0 && (
        <div>
          <div className={PROGRAM_CHAT_SECTION_LABEL_CLASS}>Documentation</div>
          <p>
            {docTypesSorted.map((trimmed, i) => {
              const isMatch =
                scenario?.docType != null &&
                trimmed.toLowerCase() === scenario.docType.toLowerCase();
              return (
                <span key={i}>
                  {i > 0 && <span className="text-muted-foreground">{UI_LIST_SEPARATOR}</span>}
                  <span className={isMatch ? "font-semibold text-emerald-600" : "text-foreground"}>
                    {trimmed}
                  </span>
                </span>
              );
            })}
          </p>
        </div>
      )}

      {showProductsBlock && (
        <div>
          <div className={PROGRAM_CHAT_SECTION_LABEL_CLASS}>Products Available</div>
          {onProductPrice ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {visibleProductItems.slice(0, productsShown).map((name) => (
                <ProductPriceChip
                  key={name}
                  program={prog}
                  label={name}
                  prices={productPrices}
                  onProductPrice={onProductPrice}
                />
              ))}
              <StreamCursor active={productsStreaming} />
            </div>
          ) : (
            <p className="leading-snug text-foreground">
              {visibleProductItems.slice(0, productsShown).map((name, pi) => (
                <span key={pi}>
                  {pi > 0 && <span className="text-muted-foreground">{UI_LIST_SEPARATOR}</span>}
                  <span>{name}</span>
                </span>
              ))}
              <StreamCursor active={productsStreaming} />
            </p>
          )}
        </div>
      )}

      {showConsiderationsBlock && (
        <div>
          <div className={PROGRAM_CHAT_SECTION_LABEL_CLASS}>Additional Considerations</div>
          {considerationsPending ? (
            <p className="text-muted-foreground">
              Summarizing additional considerations
              <AnimatedDots />
            </p>
          ) : (
            <ul className="list-none space-y-1.5 pl-0 text-foreground">
              {considerationsText.split("\n").map((line, li) =>
                line.trim() ? (
                  <li key={li} className="leading-snug">
                    <ConsiderationBulletLine line={line} />
                  </li>
                ) : null,
              )}
              <StreamCursor active={!considerationsComplete && considerationBullets.length > 0} />
            </ul>
          )}
        </div>
      )}

      {allStreamComplete && showFollowupHint && <KnowMoreFollowupHint />}
    </div>
  );
}
