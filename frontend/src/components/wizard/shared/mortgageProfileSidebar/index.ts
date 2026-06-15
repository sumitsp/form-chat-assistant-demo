export { EligibleProgramsPreview } from "./EligibleProgramsPreview";
export { FormProfileSidebar } from "./FormProfileSidebar";
export {
  ChatProfileSidebar,
  type ChatEditPending,
  type ChatProfileSidebarProps,
} from "./ChatProfileSidebar";
export {
  buildFormProfileSections,
  humanizeField,
  type FormProfileRow,
  type FormProfileSection,
} from "./formProfileSections";

/** Unified entry — dispatches by intake surface. */
export { FormProfileSidebar as MortgageProfileSidebarForm } from "./FormProfileSidebar";
export { ChatProfileSidebar as MortgageProfileSidebarChat } from "./ChatProfileSidebar";
