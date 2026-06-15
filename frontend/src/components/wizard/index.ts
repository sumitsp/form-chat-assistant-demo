/**
 * Mortgage wizard modules — form vs chat intake with shared results/vault/profile.
 *
 * ```
 * routes/form.tsx  → form/FormWizard
 * routes/chat.tsx  → chat/ChatWizard
 *                         ↓
 *                   shell/WizardShell (LoanWizard today)
 *                         ↓
 *     ┌───────────────────┴───────────────────┐
 *     FormChatFlow (intake + results)    ChatConversationFlow (intake)
 *     shared/* (vault, know more, …)
 * ```
 */
export * from "./shell";
export * from "./form";
export * from "./chat";
export * from "./shared";

export { FormChatFlow, type FormChatMode } from "./FormChatFlow";
export { ChatConversationFlow } from "./ChatConversationFlow";
