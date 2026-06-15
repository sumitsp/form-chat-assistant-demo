/** Types for POST /api/intake/* responses (shared by chat mode). */

export type IntakeChip = { code: string; label: string };

export type IntakeSubfield = {
  slot_id: string;
  kind: string;
  label: string;
  prompt?: string;
  chips?: IntakeChip[];
  hint?: string;
  options?: IntakeChip[] | null;
};

export type OptionalSlot = {
  id: string;
  label: string;
  kind: string;
  hint?: string;
  options?: IntakeChip[];
};

export type IntakeEligibleProgram = {
  investor: string;
  investor_name: string;
  program_name: string;
  program_name_np?: string | null;
  program_type?: string | null;
  min_fico?: number | null;
  max_loan?: number | null;
  min_loan?: number | null;
  program_id?: number | null;
  [key: string]: unknown;
};

export type IntakeApiResponse = {
  session_id: string;
  bot_text: string;
  input_type?: string;
  chips?: IntakeChip[];
  hint?: string;
  action: string;
  target_slots?: string[];
  portfolio_delta?: Record<string, unknown>;
  scenario_notes_delta?: unknown[];
  question_count?: number;
  can_submit?: boolean;
  confirmed_fields?: Array<{ label: string; value: string }>;
  subfields?: IntakeSubfield[];
  dump_nudge?: string;
  still_missing?: Array<{ id: string; label: string }> | string;
  optional_slots?: OptionalSlot[];
  checklist?: {
    slots: Array<{
      id: string;
      label: string;
      kind: string;
      hint?: string;
      options: IntakeChip[];
    }>;
    can_submit: boolean;
  };
  eligible?: IntakeEligibleProgram[];
  near_misses?: IntakeEligibleProgram[];
  geo_exclusions?: unknown[];
  overlay_exclusions?: unknown[];
  geo_blocked_count?: number;
  overlay_blocked_count?: number;
  total_screened?: number;
};

export type IntakeLastQuestionMeta = {
  targetSlots: string[];
  isChipOnly?: boolean;
  isLtvChips?: boolean;
};
