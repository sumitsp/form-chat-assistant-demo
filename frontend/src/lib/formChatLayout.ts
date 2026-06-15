/** Shared /form + /chat guided-intake column layout (keep LoanWizard /chat in sync with FormChatFlow). */

/** Shared max width for guided chat column + Compare pricing modal. */
export const FORM_CHAT_MAX_WIDTH = "max-w-[53rem]";
export const FORM_CHAT_COLUMN = `mx-auto w-full min-w-0 ${FORM_CHAT_MAX_WIDTH}`;
/** Single horizontal inset for scroll thread + composer so edges stay aligned. */
export const FORM_CHAT_H_PAD = "px-3 sm:px-6";
export const FORM_CHAT_SCROLL_PAD = "py-4 pb-safe-sm sm:py-6 md:[scrollbar-gutter:stable]";
export const FORM_CHAT_COMPOSER_SHELL = "min-w-0 shrink-0 bg-[#eef2f7] pb-4 pb-safe pt-1";
export const FORM_CHAT_MESSAGE_STACK = "flex min-w-0 flex-col gap-3 overflow-x-hidden md:gap-4";

/** Captured / extraction cards — white on page bg (#eef2f7) so they stay distinct. */
export const FORM_CHAT_EXTRACTION_CARD =
  "rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm md:px-5 md:py-3";
export const FORM_CHAT_EXTRACTION_CARD_LG =
  "rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm md:px-5 md:py-4";
export const FORM_CHAT_EXTRACTION_DIVIDER = "border-slate-200";

/** Typography — matches FormChatFlow `MOB.t14` / `MOB.t13`. */
export const FORM_CHAT_T14 = "text-[13px] md:text-[14px]";
export const FORM_CHAT_T13 = "text-[12px] md:text-[13px]";

/** Claude-style composer card — shared by FormChatFlow and LoanWizard /chat. */
export const FORM_CHAT_COMPOSER_CARD =
  "flex flex-col rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-[#012a5b]/50 focus-within:shadow-md";
export const FORM_CHAT_COMPOSER_INPUT =
  "w-full bg-transparent px-4 pb-1 pt-3.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40 disabled:cursor-not-allowed disabled:opacity-50 md:text-[14px]";
export const FORM_CHAT_COMPOSER_CONTROLS =
  "flex items-center justify-end gap-1.5 px-2.5 pb-2.5 pt-1";
export const FORM_CHAT_COMPOSER_ICON_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-[#012a5b] disabled:cursor-not-allowed disabled:opacity-40";
export const FORM_CHAT_COMPOSER_SEND_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#012a5b] text-white transition-colors hover:bg-[#01234d] disabled:cursor-not-allowed disabled:opacity-40";

/** Placeholder overlay (e.g. two-line welcome hint) — must not expand the input row. */
export const FORM_CHAT_COMPOSER_PLACEHOLDER =
  "pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-0.5 px-4 pt-3.5 text-[13px] leading-tight text-muted-foreground/40 md:text-[14px]";

/** Max auto-grown height for /chat composer textarea (matches Tailwind `max-h-40`). */
export const FORM_CHAT_COMPOSER_TEXTAREA_MAX_PX = 160;

/**
 * Fit textarea height to wrapped content (no trailing blank rows).
 * `height: auto` leaves stale scrollHeight — reset to 0 before measuring.
 */
export function syncComposerTextareaHeight(
  el: HTMLTextAreaElement,
  maxPx = FORM_CHAT_COMPOSER_TEXTAREA_MAX_PX,
): void {
  el.style.overflowY = "hidden";
  el.style.height = "0px";
  const natural = el.scrollHeight;
  const next = Math.min(natural, maxPx);
  el.style.height = `${next}px`;
  el.style.overflowY = natural > maxPx ? "auto" : "hidden";
}
