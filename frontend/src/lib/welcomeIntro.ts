/** Shared welcome intro copy for /form (FormChatFlow) and /chat (ChatConversationFlow). */

export const WELCOME_INTRO =
  "Hi! I'm your mortgage assistant, here to help you find programs that best match your property and financing needs.";

export const WELCOME_GUIDE =
  "I'll guide you through a few quick questions to understand your scenario and help identify suitable options.";

export const WELCOME_GUIDE_DESKTOP_TAIL =
  " Whether you're purchasing, refinancing, or exploring eligibility, I'll help narrow down the best-fit programs for you.";

export const CHAT_WELCOME_CTA =
  "Provide your base loan scenario to get started. With your inputs, your profile and matching scenario will progressively take shape on the left.";

export const FORM_WELCOME_CTA =
  "Click Start to begin a fresh intake — or Upload an existing Form 1003 (PDF) or URLA v3.4 (XML) file to pre-fill answers and pick up from the first missing field.";

const MOBILE_WELCOME_MQ = "(max-width: 767px)";

export function isMobileWelcomeViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_WELCOME_MQ).matches;
}

export function welcomeGuideParagraph(isMobile: boolean): string {
  return isMobile ? WELCOME_GUIDE : WELCOME_GUIDE + WELCOME_GUIDE_DESKTOP_TAIL;
}

export function buildWelcomeParagraphs(
  isMobile: boolean,
  cta: string,
): readonly [string, string, string] {
  return [WELCOME_INTRO, welcomeGuideParagraph(isMobile), cta];
}

export function buildChatWelcomeParagraphs(
  isMobile: boolean = isMobileWelcomeViewport(),
): readonly [string, string, string] {
  return buildWelcomeParagraphs(isMobile, CHAT_WELCOME_CTA);
}

export function buildFormWelcomeParagraphs(
  isMobile: boolean = isMobileWelcomeViewport(),
): readonly [string, string, string] {
  return buildWelcomeParagraphs(isMobile, FORM_WELCOME_CTA);
}
