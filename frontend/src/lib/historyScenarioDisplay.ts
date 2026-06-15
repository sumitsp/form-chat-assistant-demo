import { docTypeLabelFromCode } from "@/lib/nqmIntegratedForm";
import {
  clampToMaxChars,
  SCENARIO_DESCRIPTION_MAX_CHARS,
  type FormHistorySummary,
} from "@/lib/scenarioHistoryApi";

/** Collapse a phrase to PascalCase with no spaces/punctuation (e.g. "Full Documentation" → "FullDoc"). */
function pascal(raw: string): string {
  return raw
    .replace(/&/g, " And ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function shortOccupancy(raw: string | null | undefined): string {
  const v = raw?.trim();
  if (!v) return "";
  const map: Record<string, string> = {
    "Primary Residence": "Primary",
    "Investment Property": "Investment",
    "Second Home": "SecondHome",
  };
  return map[v] ?? pascal(v);
}

function shortLien(raw: string | null | undefined): string {
  const v = raw?.trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  if (lower.includes("piggyback") || lower.includes("piggy")) return "Piggyback";
  if (lower.includes("first") || lower === "first_lien") return "FirstLien";
  if (lower.includes("second") || lower === "second_lien") return "SecondLien";
  return pascal(v);
}

function shortDoc(raw: string | null | undefined): string {
  const v = raw?.trim();
  if (!v) return "";
  const label = docTypeLabelFromCode(v) || v;
  const map: Record<string, string> = {
    "Full Documentation": "FullDoc",
    DSCR: "DSCR",
    "Bank Statement": "BankStmt",
    "Bank Statements": "BankStmt",
    "1099": "1099",
    "Asset Utilization": "AssetUtil",
    PLO: "PLO",
    WVOE: "WVOE",
    "Profit & Loss": "PnL",
  };
  return map[label] ?? pascal(label);
}

function shortState(raw: string | null | undefined): string {
  const v = raw?.trim();
  if (!v) return "";
  return v.length === 2 ? v.toUpperCase() : v;
}

/** Long Occupancy_Lien_Doc_State label, e.g. "Primary_FirstLien_FullDoc_FL". */
export function formatHistoryScenarioDescriptor(
  item: Pick<FormHistorySummary, "occupancy" | "lien_position" | "documentation_type" | "state">,
): string {
  const parts = [
    shortOccupancy(item.occupancy),
    shortLien(item.lien_position),
    shortDoc(item.documentation_type),
    shortState(item.state),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("_") : "—";
}

/** Vault table + tooltips — saved description, else auto Occupancy_Lien_Doc_State. */
export function vaultListScenarioDescription(
  item: Pick<
    FormHistorySummary,
    "scenario_description" | "occupancy" | "lien_position" | "documentation_type" | "state"
  >,
): string {
  const saved = item.scenario_description?.trim();
  if (saved) return clampToMaxChars(saved, SCENARIO_DESCRIPTION_MAX_CHARS);
  return formatHistoryScenarioDescriptor(item);
}

/** Vault table cell text — preserves underscores in Occupancy_Lien_Doc_State labels. */
export function vaultScenarioDescriptionDisplay(text: string): string {
  return text.trim();
}

/** Same descriptor from wizard `/form` fields (Save Scenario default). */
export function formatScenarioDescriptorFromForm(form: {
  occupancy?: string;
  lienPosition?: string;
  documentationType?: string;
  state?: string;
}): string {
  return formatHistoryScenarioDescriptor({
    occupancy: form.occupancy ?? null,
    lien_position: form.lienPosition ?? null,
    documentation_type: form.documentationType ?? null,
    state: form.state ?? null,
  });
}
