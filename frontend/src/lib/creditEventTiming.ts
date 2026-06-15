/** Credit-event date (MM/YYYY) helpers — shared by form chat and the stepped wizard. */

export const CREDIT_EVENT_YEAR_BUCKETS = [
  "<1 year",
  "1-2 years",
  "2-3 years",
  "3-4 years",
  "4-7 years",
  "7+ years",
] as const;

/** Legacy bucket labels still accepted from saved profiles / older UI. */
const LEGACY_CREDIT_EVENT_YEAR_BUCKETS = ["<2 years"] as const;

export type CreditEventYearBucket = (typeof CREDIT_EVENT_YEAR_BUCKETS)[number];

export function validateMmYyyy(val: string): string | null {
  if (!val || val.length < 7) return null;
  const m = val.match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return "Use MM/YYYY format";
  const month = parseInt(m[1], 10);
  const year = parseInt(m[2], 10);
  if (month < 1 || month > 12) return "Month must be 01–12";
  if (year < 1970) return "Year seems too far back — check the date";
  if (year > new Date().getFullYear()) return "Date cannot be in the future";
  return null;
}

/** Auto-insert `/` after month digits while typing. */
export function formatMmYyyyInput(raw: string): string {
  let v = raw.replace(/[^0-9/]/g, "");
  if (v.length === 2 && !v.includes("/")) v = `${v}/`;
  const monthPart = v.split("/")[0];
  if (monthPart && parseInt(monthPart, 10) > 12 && !v.includes("/")) v = "12";
  return v.slice(0, 7);
}

/** Map an event date (MM/YYYY) to the eligibility seasoning bucket. */
export function computeYearsSinceBucket(mmYyyy: string): CreditEventYearBucket | "" {
  const m = mmYyyy.match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const mo = parseInt(m[1], 10) - 1;
  const yr = parseInt(m[2], 10);
  const now = new Date();
  if (yr < 1900 || yr > now.getFullYear()) return "";
  const months = (now.getFullYear() - yr) * 12 + now.getMonth() - mo;
  if (months < 12) return "<1 year";
  if (months < 24) return "1-2 years";
  if (months < 36) return "2-3 years";
  if (months < 48) return "3-4 years";
  if (months < 84) return "4-7 years";
  return "7+ years";
}

/** Normalize stored bucket strings (including legacy) for display and API. */
export function normalizeCreditEventYearBucket(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if ((LEGACY_CREDIT_EVENT_YEAR_BUCKETS as readonly string[]).includes(v)) {
    return "<1 year";
  }
  if ((CREDIT_EVENT_YEAR_BUCKETS as readonly string[]).includes(v)) return v;
  return v;
}

export function creditEventBucketForForm(
  dates: Record<string, string> | undefined,
  years: Record<string, string> | undefined,
  code: string,
): string {
  const dateVal = dates?.[code]?.trim();
  if (dateVal) {
    const fromDate = computeYearsSinceBucket(dateVal);
    if (fromDate) return fromDate;
  }
  return years?.[code]?.trim() ?? "";
}
