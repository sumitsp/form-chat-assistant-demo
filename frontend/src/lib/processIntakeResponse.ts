/**
 * Process a POST /api/intake/* response into chat UI side-effects.
 * Kept separate from the hook so form/chat can share the same mapping rules.
 */
import type { IntakeApiResponse } from "@/lib/chatIntakeTypes";

export type ProcessIntakeResponseDeps = {
  setSessionId: (id: string) => void;
  setCanSubmit: (v: boolean) => void;
  setQuestionCount: (n: number) => void;
  onPortfolioDelta: (delta: Record<string, unknown>) => void;
  onScenarioNotesDelta: (raw: unknown[]) => void;
  appendAssistantChat: (content: string) => void;
  appendUserChat: (content: string) => void;
  streamAppendInPlace: (text: string, onStreamed?: (msgId: string) => void) => void;
  morphMessageToIntakeQuestion: (msgId: string, payloadStr: string) => void;
  setInputUnlocked: (v: boolean) => void;
  setOptionalPickerSelections: (v: Record<string, string>) => void;
  setScenarioRefineActive: (v: boolean) => void;
  setEligiblePrograms: (programs: IntakeApiResponse["eligible"]) => void;
  setQuickCount: (n: number) => void;
  fetchQuickCount: () => void;
  finishChatIntake: () => void;
  continueIntake: () => void;
  intakeCanSubmit: boolean;
};

export function processIntakeResponse(
  data: IntakeApiResponse,
  deps: ProcessIntakeResponseDeps,
): void {
  deps.setSessionId(data.session_id);
  deps.setCanSubmit(data.can_submit ?? false);
  if (typeof data.question_count === "number") deps.setQuestionCount(data.question_count);

  if (data.portfolio_delta && Object.keys(data.portfolio_delta).length > 0) {
    deps.onPortfolioDelta(data.portfolio_delta);
  }
  if (data.scenario_notes_delta?.length) {
    deps.onScenarioNotesDelta(data.scenario_notes_delta);
  }

  if (data.action === "REFINE_COMPLETE") {
    deps.setScenarioRefineActive(false);
    const refinePayload = {
      bot_text: data.bot_text || "",
      confirmed_fields: data.confirmed_fields ?? [],
      session_notes_added: data.scenario_notes_delta ?? [],
      chips: data.chips ?? [{ code: "_rerun_eligibility", label: "Run Eligibility" }],
    };
    deps.appendAssistantChat(`INTAKE_REFINE_RESULT:${JSON.stringify(refinePayload)}`);
    return;
  }

  if (data.confirmed_fields && data.confirmed_fields.length > 0) {
    const captureText =
      (data.question_count ?? 0) <= 1
        ? "Thanks for the scenario! Here's what I've captured — I need a few more details before I can proceed."
        : undefined;
    deps.appendAssistantChat(
      `INTAKE_CAPTURED:${JSON.stringify({ text: captureText, fields: data.confirmed_fields })}`,
    );
  }

  const botText = data.bot_text || "";
  const isAskAction =
    data.action === "ASK_SLOT_DEFINITIVE" ||
    data.action === "ASK_SLOT_COMBINED" ||
    data.action === "ASK_CLARIFY";

  if (data.action === "GREETING") {
    if (botText) deps.streamAppendInPlace(botText);
    return;
  }

  if (data.action === "OFFER_CHECKLIST" && data.checklist) {
    if (botText) deps.streamAppendInPlace(botText);
    deps.appendAssistantChat(`INTAKE_CHECKLIST:${JSON.stringify(data.checklist)}`);
    return;
  }

  if (data.action === "OFFER_PREVIEW") {
    const stillMissing = Array.isArray(data.still_missing) ? data.still_missing : [];
    const previewPayload = JSON.stringify({
      can_submit: data.can_submit ?? false,
      still_missing: stillMissing,
    });
    if (botText) deps.streamAppendInPlace(botText);
    deps.appendAssistantChat(`INTAKE_PREVIEW:${previewPayload}`);
    deps.fetchQuickCount();
    return;
  }

  if (data.action === "PREVIEW_RESULT") {
    const eligible = data.eligible ?? [];
    const n = eligible.length;
    deps.setQuickCount(n);
    if (n > 0) deps.setEligiblePrograms(eligible);
    deps.appendAssistantChat(
      `CHAT_PRELIM_PREVIEW:${JSON.stringify({ eligible, can_submit: data.can_submit ?? false })}`,
    );
    if (data.can_submit) {
      const previewChipsPayload = JSON.stringify({
        prompt: "All required fields are filled.",
        hint: undefined,
        chips: [
          { code: "_submit", label: "Run full eligibility" },
          { code: "_keep_going", label: "Add more detail →" },
        ],
        input_type: "chips",
        showQPrefix: false,
        target_slots: [],
      });
      deps.appendAssistantChat(`INTAKE_QUESTION:${previewChipsPayload}`);
    } else {
      setTimeout(() => deps.continueIntake(), 600);
    }
    return;
  }

  if (data.action === "OFFER_SUBMIT") {
    deps.appendAssistantChat("LOADING:Running eligibility check");
    deps.finishChatIntake();
    return;
  }

  if (data.action === "OFFER_OPTIONAL_BATCH") {
    if (botText) deps.streamAppendInPlace(botText);
    deps.setOptionalPickerSelections({});
    deps.appendAssistantChat("INTAKE_OPTIONAL_PICKER:{}");
    return;
  }

  if (data.action === "OFFER_FREE_TEXT") {
    const rawPrompt = (data.bot_text || "").trim();
    let prompt = rawPrompt;
    let stillMissing = (typeof data.still_missing === "string" ? data.still_missing : "").trim();
    if (!stillMissing && /\.\s*Still looking for:/i.test(rawPrompt)) {
      const [head, tail] = rawPrompt.split(/\.\s*Still looking for:\s*/i);
      prompt = head.trim();
      stillMissing = tail.replace(/\.\s*$/, "").trim();
    }
    const intakePayloadStr = JSON.stringify({
      prompt,
      still_missing: stillMissing || undefined,
      hint:
        data.hint ||
        'Say "Skip" or "Nothing to Add" if you prefer option-based questions. Otherwise type extra details in your own words.',
      chips: [],
      input_type: "text",
      showQPrefix: true,
      target_slots: [],
    });
    deps.setInputUnlocked(true);
    if (prompt) {
      deps.streamAppendInPlace(prompt, (id) => {
        deps.morphMessageToIntakeQuestion(id, intakePayloadStr);
      });
    } else {
      deps.appendAssistantChat(`INTAKE_QUESTION:${intakePayloadStr}`);
    }
    return;
  }

  if (data.dump_nudge && !isAskAction) {
    const legacyRaw = String(data.dump_nudge).trim();
    let legacyPrompt = legacyRaw;
    let legacyStillMissing = (
      typeof data.still_missing === "string" ? data.still_missing : ""
    ).trim();
    if (!legacyStillMissing && /\.\s*Still looking for:/i.test(legacyRaw)) {
      const [head, tail] = legacyRaw.split(/\.\s*Still looking for:\s*/i);
      legacyPrompt = head.trim();
      legacyStillMissing = tail.replace(/\.\s*$/, "").trim();
    }
    const intakePayloadStr = JSON.stringify({
      prompt: legacyPrompt,
      still_missing: legacyStillMissing || undefined,
      hint:
        data.hint ||
        'Say "Skip" or "Nothing to Add" if you prefer option-based questions. Otherwise type extra details in your own words.',
      chips: [],
      input_type: "text",
      showQPrefix: true,
      target_slots: [],
    });
    deps.setInputUnlocked(true);
    deps.appendAssistantChat(`INTAKE_QUESTION:${intakePayloadStr}`);
    return;
  }

  const isCombined = data.action === "ASK_SLOT_COMBINED";
  const hasChips = (data.chips ?? []).length > 0;
  const intakePayloadStr = JSON.stringify({
    prompt: botText,
    hint: data.hint,
    chips: data.chips ?? [],
    input_type: data.input_type ?? "text",
    showQPrefix: isAskAction,
    subfields: isCombined ? (data.subfields ?? []) : undefined,
    target_slots: data.target_slots ?? [],
  });

  if (isAskAction || hasChips) {
    deps.setInputUnlocked(true);
    if (botText) {
      deps.streamAppendInPlace(botText, (id) => {
        deps.morphMessageToIntakeQuestion(id, intakePayloadStr);
      });
    } else {
      deps.appendAssistantChat(`INTAKE_QUESTION:${intakePayloadStr}`);
    }
  } else if (botText) {
    deps.streamAppendInPlace(botText);
  }
}
