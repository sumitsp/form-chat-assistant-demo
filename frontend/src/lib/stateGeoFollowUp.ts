/**
 * Geographic follow-up — thin client over /api/geo/*.
 * No local filtering rules or hardcoded option lists.
 */

export type GeoWarningSeverity = "error" | "warning" | "info" | "success";

export type GeoWarning = {
  message: string;
  severity: GeoWarningSeverity;
};

export type GeoFieldOption = {
  code: string;
  label: string;
};

export type GeoFieldConfig = {
  slot_id: string;
  form_key: string;
  /** When set, the field is asked ONLY if the chosen county matches (state+county trigger). */
  county_match?: string;
  label: string;
  widget: "select" | "yes_no" | "zip" | "county_search";
  required: boolean;
  options: GeoFieldOption[];
  prompt?: string;
  hint?: string;
};

export type CountyRow = {
  id: number;
  county_name: string;
  state_code: string;
};

export type GeoConfigResponse = {
  followup_states: string[];
  states: Record<string, GeoFieldConfig[]>;
};

export type GeoEvaluateResponse = {
  complete: boolean;
  warnings: GeoWarning[];
  hard_block: string | null;
  has_restrictions: boolean;
  state: string;
};

/** Wizard / API field mapping for location follow-ups */
export type GeoFormData = {
  state: string;
  occupancy: string;
  rentalType: string;
  county: string;
  city: string;
  borough: string;
  zipCode: string;
  isInBaltimoreCity: string;
  isInIndianapolis: string;
  isInPhiladelphia: string;
  isInMemphis: string;
  isInLubbock: string;
};

export type GeoProfileSidebarSlot = {
  label: string;
  fieldKey: string;
  value: string;
  displayValue: string;
  priority: "essential" | "conditional" | "optional";
  options?: readonly string[];
};

/** Offline fallback — mirrors backend `GEO_STATE_FIELDS` until /api/geo/config loads. */
const GEO_STATE_FIELDS_FALLBACK: Record<string, GeoFieldConfig[]> = {
  IN: [
    {
      slot_id: "is_in_indianapolis",
      form_key: "isInIndianapolis",
      county_match: "Marion County",
      label: "Indianapolis?",
      widget: "select",
      required: true,
      options: [
        { code: "Indianapolis", label: "Indianapolis" },
        { code: "Other Marion County", label: "Other Marion County" },
      ],
      prompt: "Is the property in Indianapolis, or elsewhere in Marion County?",
    },
  ],
  MD: [
    {
      slot_id: "is_in_baltimore",
      form_key: "isInBaltimoreCity",
      county_match: "Baltimore County",
      label: "Baltimore City?",
      widget: "select",
      required: true,
      options: [
        { code: "Baltimore City", label: "Baltimore City" },
        { code: "Other Baltimore County", label: "Other Baltimore County" },
      ],
      prompt: "Is the property in Baltimore City, or elsewhere in Baltimore County?",
    },
  ],
  NJ: [
    {
      slot_id: "state_city",
      form_key: "stateCity",
      county_match: "Passaic County",
      label: "Paterson?",
      widget: "select",
      required: true,
      options: [
        { code: "Paterson", label: "Paterson" },
        { code: "Other Passaic County", label: "Other Passaic County" },
      ],
      prompt: "Is the property in Paterson, or elsewhere in Passaic County?",
    },
  ],
  PA: [
    {
      slot_id: "state_zip",
      form_key: "stateZipCode",
      county_match: "Philadelphia County",
      label: "Zip Code",
      widget: "zip",
      required: true,
      options: [],
      prompt: "What is the property's ZIP code?",
      hint: "5-digit ZIP, e.g. 19103",
    },
  ],
  TN: [
    {
      slot_id: "is_in_memphis",
      form_key: "isInMemphis",
      county_match: "Shelby County",
      label: "Memphis?",
      widget: "select",
      required: true,
      options: [
        { code: "Memphis", label: "Memphis" },
        { code: "Other Shelby County", label: "Other Shelby County" },
      ],
      prompt: "Is the property in Memphis, or elsewhere in Shelby County?",
    },
  ],
  TX: [
    {
      slot_id: "is_in_lubbock",
      form_key: "isInLubbock",
      county_match: "Lubbock County",
      label: "Lubbock?",
      widget: "select",
      required: true,
      options: [
        { code: "Lubbock", label: "Lubbock" },
        { code: "Other Lubbock County", label: "Other Lubbock County" },
      ],
      prompt: "Is the property in Lubbock, or elsewhere in Lubbock County?",
    },
  ],
};

let _configCache: GeoConfigResponse | null = null;
let _configPromise: Promise<GeoConfigResponse> | null = null;

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
}

export async function fetchGeoConfig(force = false): Promise<GeoConfigResponse> {
  if (_configCache && !force) return _configCache;
  if (_configPromise && !force) return _configPromise;
  _configPromise = (async () => {
    const res = await fetch(`${apiBase()}/api/geo/config`);
    if (!res.ok) throw new Error(`geo/config ${res.status}`);
    const data = (await res.json()) as GeoConfigResponse;
    _configCache = data;
    return data;
  })();
  return _configPromise;
}

/** Typeahead search against dim_county for the selected state. */
export async function fetchCountiesForState(
  state: string,
  q = "",
  limit = 50,
): Promise<CountyRow[]> {
  const st = (state || "").trim().toUpperCase();
  if (!st) return [];
  const params = new URLSearchParams({ state: st, limit: String(limit) });
  if (q.trim()) params.set("q", q.trim());
  const res = await fetch(`${apiBase()}/api/geo/counties?${params}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { counties?: CountyRow[] };
  return data.counties ?? [];
}

export function getCachedGeoConfig(): GeoConfigResponse | null {
  return _configCache;
}

export function getGeoFieldsForState(state: string): GeoFieldConfig[] {
  const st = (state || "").trim().toUpperCase();
  const fromApi = _configCache?.states[st];
  if (fromApi?.length) return fromApi;
  return GEO_STATE_FIELDS_FALLBACK[st] ?? [];
}

/** County-gated follow-ups: only the fields whose `county_match` equals the chosen county. */
export function getGeoFieldsForCounty(state: string, county: string): GeoFieldConfig[] {
  const fields = getGeoFieldsForState(state);
  if (!county.trim()) return [];
  const countyKey = normalizeCountyName(county);
  return fields.filter((f) => {
    const cm = (f.county_match || "").trim();
    if (!cm) return true;
    return normalizeCountyName(cm) === countyKey;
  });
}

export function stateNeedsGeoFollowUp(state: string): boolean {
  return getGeoFieldsForState(state).length > 0;
}

/** True when the chosen county triggers at least one follow-up question. */
export function countyNeedsGeoFollowUp(state: string, county: string): boolean {
  return getGeoFieldsForCounty(state, county).length > 0;
}

/** Map LoanWizardV2 form slice → geo evaluator input */
export function geoFormFromWizard(form: {
  state: string;
  occupancy: string;
  rentalType: string;
  stateCounty: string;
  stateCity: string;
  stateBorough: string;
  stateZipCode: string;
  isInBaltimoreCity: string;
  isInIndianapolis: string;
  isInPhiladelphia: string;
  isInMemphis: string;
  isInLubbock: string;
}): GeoFormData {
  return {
    state: form.state,
    occupancy: form.occupancy,
    rentalType: form.rentalType,
    county: form.stateCounty,
    city: form.stateCity,
    borough: form.stateBorough,
    zipCode: form.stateZipCode,
    isInBaltimoreCity: form.isInBaltimoreCity,
    isInIndianapolis: form.isInIndianapolis,
    isInPhiladelphia: form.isInPhiladelphia,
    isInMemphis: form.isInMemphis,
    isInLubbock: form.isInLubbock,
  };
}

function geoPayloadFromWizard(form: {
  state: string;
  occupancy: string;
  rentalType: string;
  stateCounty: string;
  stateCity: string;
  stateBorough: string;
  stateZipCode: string;
  isInBaltimoreCity: string;
  isInIndianapolis: string;
  isInPhiladelphia: string;
  isInMemphis: string;
  isInLubbock: string;
}): Record<string, string> {
  return {
    state: form.state,
    occupancy: form.occupancy,
    rentalType: form.rentalType,
    stateCounty: form.stateCounty,
    stateCity: form.stateCity,
    stateBorough: form.stateBorough,
    stateZipCode: form.stateZipCode,
    isInBaltimoreCity: form.isInBaltimoreCity,
    isInIndianapolis: form.isInIndianapolis,
    isInPhiladelphia: form.isInPhiladelphia,
    isInMemphis: form.isInMemphis,
    isInLubbock: form.isInLubbock,
  };
}

export async function evaluateGeoFromWizard(form: {
  state: string;
  occupancy: string;
  rentalType: string;
  stateCounty: string;
  stateCity: string;
  stateBorough: string;
  stateZipCode: string;
  isInBaltimoreCity: string;
  isInIndianapolis: string;
  isInPhiladelphia: string;
  isInMemphis: string;
  isInLubbock: string;
}): Promise<GeoEvaluateResponse> {
  const res = await fetch(`${apiBase()}/api/geo/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geoPayloadFromWizard(form)),
  });
  if (!res.ok) throw new Error(`geo/evaluate ${res.status}`);
  return (await res.json()) as GeoEvaluateResponse;
}

function labelForOption(fields: GeoFieldConfig[], formKey: string, code: string): string {
  const field = fields.find((f) => f.form_key === formKey);
  return field?.options.find((o) => o.code === code)?.label ?? code;
}

/** Build location follow-up slots for chat profile sidebar (state-specific extras after county). */
const GEO_SIDEBAR_FALLBACK: Array<{ form_key: string; label: string }> = [
  { form_key: "stateCity", label: "City" },
  { form_key: "stateZipCode", label: "Zip Code" },
  { form_key: "isInBaltimoreCity", label: "Baltimore City" },
  { form_key: "isInIndianapolis", label: "Indianapolis" },
  { form_key: "isInMemphis", label: "Memphis" },
  { form_key: "isInLubbock", label: "Lubbock" },
];

export function geoSidebarSlotsForForm(form: {
  state: string;
  stateCounty: string;
  stateCity: string;
  stateBorough: string;
  stateZipCode: string;
  isInBaltimoreCity: string;
  isInIndianapolis: string;
  isInPhiladelphia: string;
  isInMemphis: string;
  isInLubbock: string;
}): GeoProfileSidebarSlot[] {
  const fields = getGeoFieldsForCounty(form.state, form.stateCounty);
  if (!fields.length) {
    // Geo config may still be loading — show any filled sub-fields we already have.
    return GEO_SIDEBAR_FALLBACK.flatMap((field) => {
      const raw = String((form as Record<string, string>)[field.form_key] ?? "").trim();
      if (!raw) return [];
      return [
        {
          label: field.label,
          fieldKey: field.form_key,
          value: raw,
          displayValue: raw,
          priority: "conditional" as const,
        },
      ];
    });
  }

  return fields.map((field) => {
    const raw = String((form as Record<string, string>)[field.form_key] ?? "").trim();
    let displayValue = raw;
    if (field.widget === "select" && raw) {
      displayValue = labelForOption(fields, field.form_key, raw);
    }
    return {
      label: field.label,
      fieldKey: field.form_key,
      value: raw,
      displayValue,
      priority: "conditional" as const,
      options:
        field.widget === "yes_no" ? (["Yes", "No"] as const) : field.options.map((o) => o.label),
    };
  });
}

/** Map sidebar display label → stored code for geo enum fields */
export function geoFieldValueFromLabel(state: string, fieldKey: string, label: string): string {
  const field = getGeoFieldsForState(state).find((f) => f.form_key === fieldKey);
  if (!field) return label;
  return field.options.find((o) => o.label === label)?.code ?? label;
}

/** Sync completion check using cached config (fallback until API evaluate). */
export function isGeoLocationComplete(data: GeoFormData): boolean {
  if (!data.state.trim()) return false;
  if (!data.county.trim()) return false;
  const fields = getGeoFieldsForCounty(data.state, data.county);
  for (const field of fields) {
    if (!field.required) continue;
    const key = field.form_key;
    let val = "";
    if (key === "stateCounty") val = data.county;
    else if (key === "stateCity") val = data.city;
    else if (key === "stateBorough") val = data.borough;
    else if (key === "stateZipCode") val = data.zipCode;
    else if (key === "isInBaltimoreCity") val = data.isInBaltimoreCity;
    else if (key === "isInIndianapolis") val = data.isInIndianapolis;
    else if (key === "isInPhiladelphia") val = data.isInPhiladelphia;
    else if (key === "isInMemphis") val = data.isInMemphis;
    else if (key === "isInLubbock") val = data.isInLubbock;
    if (field.widget === "zip") {
      const digits = val.replace(/\D/g, "");
      if (digits.length !== 5) return false;
    } else if (!val.trim()) {
      return false;
    }
  }
  return true;
}

/** @deprecated Use evaluateGeoFromWizard — sync stub returns null until evaluated */
export function getGeoWarnings(_data: GeoFormData): GeoWarning[] {
  return [];
}

/** @deprecated Use evaluateGeoFromWizard */
export function hasGeoRestrictionsForLocation(_data: GeoFormData): boolean {
  return false;
}

/** @deprecated Use evaluateGeoFromWizard */
export function getGeoHardBlock(_data: GeoFormData): string | null {
  return null;
}

/** User-facing message when geo rules block the entire search */
export function formatGeoHaltMessage(reason: string): string {
  return `**0 programs found** after screening.\n\n**Reason:** ${reason}\n\nAdjust the property location or occupancy and try again, or contact a representative for options.`;
}

/** Options for FSelectLabeled — { value, label } from API config */
export function geoSelectOptions(
  state: string,
  formKey: string,
): { value: string; label: string }[] {
  const field = getGeoFieldsForState(state).find((f) => f.form_key === formKey);
  return (field?.options ?? []).map((o) => ({ value: o.code, label: o.label }));
}

/** Start loading geo config as early as possible (module init + FormChatFlow mount). */
void fetchGeoConfig().catch(() => {});

/** Clear geo sub-fields when state changes */
export function geoSubFieldKeys(): string[] {
  return [
    "stateCounty",
    "stateCity",
    "stateBorough",
    "stateZipCode",
    "isInBaltimoreCity",
    "isInIndianapolis",
    "isInPhiladelphia",
    "isInMemphis",
    "isInLubbock",
  ];
}

export type GeoFollowupFormPatch = Partial<
  Pick<
    {
      stateCity: string;
      stateBorough: string;
      stateZipCode: string;
      isInBaltimoreCity: string;
      isInIndianapolis: string;
      isInPhiladelphia: string;
      isInMemphis: string;
      isInLubbock: string;
    },
    | "stateCity"
    | "stateBorough"
    | "stateZipCode"
    | "isInBaltimoreCity"
    | "isInIndianapolis"
    | "isInPhiladelphia"
    | "isInMemphis"
    | "isInLubbock"
  >
>;

/** Clear state-specific geo follow-ups (not universal county). */
export function clearGeoFollowupFieldsPatch(): GeoFollowupFormPatch {
  const patch: Record<string, string> = {};
  for (const k of geoSubFieldKeys()) {
    if (k === "stateCounty") continue;
    patch[k] = "";
  }
  return patch as GeoFollowupFormPatch;
}

/** Normalize county display names for rule/inference matching. */
export function normalizeCountyName(county: string): string {
  let v = (county || "").trim().toLowerCase().replace(/-/g, " ");
  for (const suffix of [" county", " counties", " parish", " borough"]) {
    if (v.endsWith(suffix)) v = v.slice(0, -suffix.length).trim();
  }
  return v;
}

/**
 * Pre-fill ONLY the geo signals the county pick already determines.
 * Ambiguous counties still get the city question asked.
 */
export function inferGeoFollowupsFromCounty(state: string, county: string): GeoFollowupFormPatch {
  const st = (state || "").trim().toUpperCase();
  const countyNorm = normalizeCountyName(county);
  if (!st || !countyNorm) return {};

  if (st === "MD" && countyNorm === "baltimore city") {
    return { isInBaltimoreCity: "Baltimore City" };
  }
  if (st === "PA" && countyNorm === "philadelphia") {
    return { isInPhiladelphia: "Yes" };
  }
  return {};
}
