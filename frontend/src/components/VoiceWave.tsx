import { cn } from "@/lib/utils";

type Props = {
  listening: boolean;
  speaking?: boolean;
  className?: string;
};

/** Small audio bars shown while the mic is listening / user is speaking. */
export function VoiceWave({ listening, speaking = false, className }: Props) {
  if (!listening) return null;

  return (
    <div className={cn("flex h-4 items-end gap-[2px]", className)} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "voice-wave-bar w-[3px] rounded-full bg-red-500",
            speaking ? "opacity-100" : "h-1 opacity-50",
          )}
          style={speaking ? { animationDelay: `${i * 0.12}s` } : undefined}
        />
      ))}
    </div>
  );
}
