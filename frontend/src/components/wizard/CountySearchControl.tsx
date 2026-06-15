/**
 * Searchable county picker — queries /api/geo/counties (dim_county) filtered by state.
 * Resets when `state` changes so county always matches the selected state.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { SearchablePicker, type SearchablePickerItem } from "@/components/wizard/SearchablePicker";
import { fetchCountiesForState, type CountyRow } from "@/lib/stateGeoFollowUp";
import { cn } from "@/lib/utils";

type Props = {
  state: string;
  value?: string;
  onPick: (countyName: string) => void;
  placeholder?: string;
  className?: string;
};

export function CountySearchControl({
  state,
  value = "",
  onPick,
  placeholder = "Search for the county in the selected state",
  className,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<CountyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const prevStateRef = useRef(state);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (prevStateRef.current === state) return;
    prevStateRef.current = state;
    setQuery("");
    setMatches([]);
    setOpen(false);
  }, [state]);

  const loadMatches = useCallback(
    async (q: string) => {
      const st = state.trim();
      if (!st) {
        setMatches([]);
        return;
      }
      setLoading(true);
      try {
        const rows = await fetchCountiesForState(st, q, 60);
        setMatches(rows);
      } catch {
        setMatches([]);
      } finally {
        setLoading(false);
      }
    },
    [state],
  );

  useEffect(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void loadMatches(query.trim());
    }, 180);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [query, loadMatches]);

  const items: SearchablePickerItem[] = matches.map((row) => ({
    key: String(row.id),
    value: row.county_name,
    label: row.county_name,
  }));

  const tryCommitQuery = () => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = matches.find((m) => m.county_name.toLowerCase() === q);
    if (exact) {
      if (exact.county_name !== value) onPick(exact.county_name);
      setQuery(exact.county_name);
    } else if (matches.length === 1) {
      if (matches[0].county_name !== value) onPick(matches[0].county_name);
      setQuery(matches[0].county_name);
    }
  };

  const disabled = !state.trim();

  return (
    <SearchablePicker
      className={cn(className)}
      query={query}
      onQueryChange={setQuery}
      selectedValue={value}
      items={items}
      open={open}
      onOpenChange={setOpen}
      onSelect={(item) => {
        onPick(item.value);
        setQuery(item.label);
      }}
      onBlurCommit={tryCommitQuery}
      placeholder={placeholder}
      disabled={disabled}
      loading={loading}
      mobileTitle="Select county"
      emptyMessage="No county found — try a different spelling."
    />
  );
}
