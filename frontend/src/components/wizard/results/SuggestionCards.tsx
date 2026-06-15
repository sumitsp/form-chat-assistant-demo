/**
 * Five "what would you like to do next?" action cards for the Results screen.
 * Each is a <button>; handlers are supplied by the parent (ResultsScreen).
 */
import { Download, HelpCircle, Info, Mail, RefreshCw } from "lucide-react";
import type { ComponentType } from "react";

export function SuggestionCards({
  onApply,
  onExclusions,
  onPlatform,
  onPdf,
  onEmail,
}: {
  onApply: () => void;
  onExclusions: () => void;
  onPlatform: () => void;
  onPdf: () => void;
  onEmail: () => void;
}) {
  const cards: {
    Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
    title: string;
    body: string;
    onClick: () => void;
  }[] = [
    {
      Icon: RefreshCw,
      title: "Apply & resubmit",
      body: "Tweak constraints",
      onClick: onApply,
    },
    {
      Icon: HelpCircle,
      title: "Understand exclusions",
      body: "Why programs were skipped",
      onClick: onExclusions,
    },
    {
      Icon: Info,
      title: "About the platform",
      body: "Learn about programs",
      onClick: onPlatform,
    },
    {
      Icon: Download,
      title: "Scenario PDF",
      body: "Download a summary",
      onClick: onPdf,
    },
    {
      Icon: Mail,
      title: "Email support",
      body: "Route to your AE",
      onClick: onEmail,
    },
  ];

  return (
    <div className="mx-auto mt-6 w-full max-w-[760px]">
      <h2 className="text-[16px] font-medium text-foreground">What would you like to do next?</h2>
      <div
        className="mt-3 grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
      >
        {cards.map(({ Icon, title, body, onClick }) => (
          <button
            key={title}
            type="button"
            onClick={onClick}
            className="group rounded-lg border border-border bg-card p-4 text-left transition-all duration-150 hover:border-[#012a5b]/40 hover:shadow-sm"
          >
            <Icon className="h-5 w-5 text-[#012a5b]" aria-hidden="true" />
            <p className="mt-3 text-[14px] font-medium text-foreground">{title}</p>
            <p className="mt-1 text-[12px] leading-[1.4] text-muted-foreground">{body}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
