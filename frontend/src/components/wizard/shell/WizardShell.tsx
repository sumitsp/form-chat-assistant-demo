/**
 * WizardShell — shared orchestrator for form + chat intake, eligibility, vault,
 * and post-submit results.
 *
 * Today this re-exports `LoanWizard` while the monolith is split incrementally.
 * Target layout:
 *   WizardShell (form state, eligibility, vault, session)
 *     ├── FormWizard  → FormChatFlow intake + shared results
 *     └── ChatWizard  → ChatConversationFlow intake + shared results
 *
 * Shared UI (Know More, program cards, Scenario Vault, profile sidebar) lives under
 * `wizard/shared/` and is composed by the mode wrappers + FormChatFlow results tail.
 */
export { LoanWizard as WizardShell } from "@/components/LoanWizard";
