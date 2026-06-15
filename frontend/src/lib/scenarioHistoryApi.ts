import { formatScenarioDescriptorFromForm } from "@/lib/historyScenarioDisplay";

export type ScenarioStatus = "draft" | "active" | "locked" | "closed" | "archived" | "lost";

export const SCENARIO_STATUSES: { value: ScenarioStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "locked", label: "Locked" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
  { value: "lost", label: "Lost" },
];

/** New scenarios default to Draft. */
export const DEFAULT_SCENARIO_STATUS: ScenarioStatus = "draft";

export type FormHistorySummary = {
  id: number;
  session_id: string | null;
  broker_name: string;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  programs_matched: number;
  status: ScenarioStatus;
  occupancy: string | null;
  lien_position: string | null;
  documentation_type: string | null;
  state: string | null;
  /** User-edited label from save dialog (`_vaultScenarioDescription` in form_fields). */
  scenario_description: string | null;
  /** Intake mode when the scenario was saved (defaults to form before migration 018). */
  origin?: "form" | "chat";
  created_at: string | null;
};

/** Vault filter: any specific status, or "all". */
export type VaultStatusFilter = ScenarioStatus | "all";
export type VaultSort = "modified" | "name" | "matches";

export type FormHistoryDetail = FormHistorySummary & {
  form_fields: Record<string, unknown>;
  accepted_programs: string | null;
  rejected_programs: string | null;
};

export type FormHistoryListResponse = {
  items: FormHistorySummary[];
  total: number;
};

/** Persisted inside `form_fields` on vault save (not sent as a top-level API field). */
export const VAULT_SCENARIO_DESCRIPTION_KEY = "_vaultScenarioDescription";

export const SCENARIO_DESCRIPTION_MAX_CHARS = 50;

export type SaveProfileVaultMeta = {
  /** Borrower name stored as `client_name` in the vault. */
  client_name: string;
  scenario_description: string;
  client_phone?: string;
  client_email: string;
  status?: ScenarioStatus;
};

export type SaveProfilePayload = SaveProfileVaultMeta & {
  session_id?: string;
  broker_name?: string;
  origin?: "form" | "chat";
  form_fields: Record<string, unknown>;
};

/** Trim to max characters for save/edit (counter matches string length). */
export function clampToMaxChars(text: string, maxChars = SCENARIO_DESCRIPTION_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function vaultScenarioDescriptionFromFields(
  fields: Record<string, unknown> | null | undefined,
): string {
  if (!fields) return "";
  const v = fields[VAULT_SCENARIO_DESCRIPTION_KEY];
  return typeof v === "string" ? v.trim() : "";
}

/** Edit-in-place: identity fields optional (omitted → preserved). */
export type UpdateProfilePayload = {
  client_name?: string;
  client_phone?: string;
  client_email?: string;
  status?: ScenarioStatus;
  form_fields: Record<string, unknown>;
};

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
}

export async function fetchFormHistoryList(
  q = "",
  opts: { status?: VaultStatusFilter; sort?: VaultSort } = {},
): Promise<FormHistoryListResponse> {
  const base = apiBase();
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (opts.status) params.set("status", opts.status);
  if (opts.sort) params.set("sort", opts.sort);
  params.set("limit", "100");
  const res = await fetch(`${base}/api/form-history?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<FormHistoryListResponse>;
}

export async function deleteFormHistory(id: number): Promise<void> {
  const base = apiBase();
  const res = await fetch(`${base}/api/form-history/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
}

export async function updateFormHistory(
  id: number,
  payload: UpdateProfilePayload,
): Promise<{ ok: boolean; programs_matched?: number }> {
  const base = apiBase();
  const res = await fetch(`${base}/api/form-history/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    programs_matched?: number;
    detail?: string;
    message?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.detail || data.message || `HTTP ${res.status}`);
  }
  return { ok: true, programs_matched: data.programs_matched };
}

export async function updateScenarioStatus(id: number, status: ScenarioStatus): Promise<void> {
  const base = apiBase();
  const res = await fetch(`${base}/api/form-history/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
}

export async function fetchFormHistoryDetail(id: number): Promise<FormHistoryDetail> {
  const base = apiBase();
  const res = await fetch(`${base}/api/form-history/${id}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<FormHistoryDetail>;
}

export async function saveFormHistory(
  payload: SaveProfilePayload,
): Promise<{ ok: boolean; id?: number }> {
  const base = apiBase();
  const res = await fetch(`${base}/api/form-history/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    id?: number;
    detail?: string;
    message?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.detail || data.message || `HTTP ${res.status}`);
  }
  return { ok: true, id: data.id };
}

/** Snapshot of wizard fields used to build a default vault scenario label. */
export type ScenarioNameFormSnap = {
  occupancy?: string;
  lienPosition?: string;
  state?: string;
  loanAmount?: string;
  decisionCreditScore?: string;
  loanPurpose?: string;
  primaryLoanPurpose?: string;
  propertyType?: string;
  documentationType?: string;
  scenarioNotes?: string;
};

function formatLoanAmountShort(raw: string): string | null {
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

/** Short label for lists (borrower row title fallback). */
export function suggestScenarioName(form: ScenarioNameFormSnap): string {
  const parts: string[] = [];
  const occ = (form.occupancy ?? "").trim();
  if (occ === "Primary Residence") parts.push("Primary");
  else if (occ === "Investment Property") parts.push("Investment");
  else if (occ === "Second Home") parts.push("2nd Home");
  else if (occ) parts.push(occ);

  const purpose = (form.loanPurpose || form.primaryLoanPurpose || "").trim();
  if (purpose) {
    const short =
      purpose === "Purchase" ? "Purchase" : purpose.includes("Cash") ? "Cash-out" : "Refi";
    if (!parts.includes(short)) parts.push(short);
  }

  const st = (form.state ?? "").trim();
  if (st) parts.push(st);

  const loan = formatLoanAmountShort(form.loanAmount ?? "");
  if (loan) parts.push(loan);

  const fico = String(form.decisionCreditScore ?? "").replace(/\D/g, "");
  if (fico) parts.push(`${fico} FICO`);

  return parts.length > 0 ? parts.join("_") : "New scenario";
}

/** Suggested scenario description when saving — Occupancy_Lien_Doc_State (editable, max 50 chars). */
export function suggestScenarioDescription(form: ScenarioNameFormSnap): string {
  const code = formatScenarioDescriptorFromForm(form);
  if (code !== "—") return code;
  return "Mortgage_Scenario";
}
