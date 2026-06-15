/**
 * AccessGate — sign-in screen shown on landing at /form or /chat before any intake.
 *
 * Default (Loan Officer) access is the promoted primary action; Admin/Underwriter
 * credentials unlock the optional underwriting questions. The chosen role drives the
 * intake's form mode for the session (see lib/access.ts).
 */
import { type FC, type FormEvent, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CircleCheck,
  CircleDollarSign,
  Eye,
  EyeOff,
  FileText,
  Lock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NEWPOINT_LOGO_URL } from "@/lib/brand";
import { type AccessRole, authenticate } from "@/lib/access";

type Props = {
  /**
   * Fired with the granted role once the user signs in or continues with default
   * access. `remember` reflects the "Remember me on this device" checkbox so the
   * caller can persist to localStorage (vs. sessionStorage).
   */
  onGranted: (role: AccessRole, remember: boolean) => void;
};

const FEATURES = [
  { icon: CircleCheck, label: "Program\nEligibility" },
  { icon: BarChart3, label: "Product\nComparison" },
  { icon: CircleDollarSign, label: "Pricing\nInsights" },
  { icon: FileText, label: "Scenario\nAnalysis" },
];

export const AccessGate: FC<Props> = ({ onGranted }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSignIn = (e: FormEvent) => {
    e.preventDefault();
    const role = authenticate(username, password);
    if (!role) {
      setError("Incorrect username or password.");
      return;
    }
    setError(null);
    onGranted(role, true);
  };

  const canSubmit = username.trim().length > 0 && password.length > 0;

  const inputClass =
    "h-10 rounded-lg border-slate-200 bg-white px-3.5 text-[15px] shadow-none placeholder:text-slate-400 focus-visible:border-[#012a5b] focus-visible:ring-[#012a5b]/20 sm:h-11";

  const signInForm = (
    <form id="access-sign-in-form" onSubmit={handleSignIn} className="space-y-3 sm:space-y-4">
      <div className="space-y-1.5 sm:space-y-2">
        <Label htmlFor="access-username" className="text-[13px] font-medium text-foreground">
          Username
        </Label>
        <Input
          id="access-username"
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Enter username"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5 sm:space-y-2">
        <Label htmlFor="access-password" className="text-[13px] font-medium text-foreground">
          Password
        </Label>
        <div className="relative">
          <Input
            id="access-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Enter password"
            className={`${inputClass} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-slate-400 transition-colors hover:text-[#012a5b] sm:h-11"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] font-medium text-destructive">{error}</p>}

      <Button
        type="submit"
        disabled={!canSubmit}
        className="h-10 w-full rounded-lg bg-[#012a5b] text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#01234d] disabled:cursor-not-allowed disabled:bg-slate-400 disabled:opacity-100 sm:h-11 sm:text-[15px]"
      >
        Sign in
      </Button>
    </form>
  );

  return (
    <div className="h-dvh max-h-dvh overflow-y-auto overscroll-y-contain bg-[#eef2f7] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:py-12">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-start py-3 sm:min-h-0 sm:justify-center sm:py-0">
        <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-5 shadow-xl shadow-slate-900/[0.06] sm:px-10 sm:py-10">
          {/* Brand */}
          <div className="flex flex-col items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-white p-2 shadow-sm ring-1 ring-black/5 sm:mb-3 sm:h-16 sm:w-16 sm:rounded-2xl sm:p-3">
              <img
                src={NEWPOINT_LOGO_URL}
                alt="NewPoint Mortgage"
                className="h-full w-full object-contain"
              />
            </div>
            <h1 className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-2xl">
              NewPoint Mortgage Assistant
            </h1>
            <p className="mt-1.5 max-w-[18rem] text-balance text-[11px] leading-snug text-muted-foreground sm:mt-3 sm:text-[13px] sm:leading-relaxed">
              Your hub for broker matrices, program guidances and overlays.
            </p>
          </div>

          {/* Primary action — default (Loan Officer) access */}
          <button
            type="button"
            onClick={() => onGranted("lo", true)}
            className="group mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#012a5b] text-[13px] font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#01234d] hover:shadow-lg hover:shadow-[#012a5b]/20 sm:mt-8 sm:h-12 sm:text-[15px]"
          >
            Continue as Loan Officer
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>

          {/* Feature list */}
          <div className="mt-5 grid grid-cols-4 gap-1.5 sm:mt-8 sm:gap-3">
            {FEATURES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1 text-center sm:gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eaf1fb] sm:h-12 sm:w-12">
                  <Icon className="h-4 w-4 text-[#3b6cb0] sm:h-5 sm:w-5" strokeWidth={1.6} />
                </span>
                <span className="whitespace-pre-line text-[9px] leading-tight text-muted-foreground sm:text-[11px] sm:leading-snug">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Divider + Admin & Underwriter credentials */}
          <div className="my-5 flex items-center gap-3 sm:my-8">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[10px] font-semibold tracking-wider text-slate-400 sm:text-[11px]">
              OR
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <h2 className="mb-3 text-center font-display text-[14px] font-semibold text-foreground sm:mb-4 sm:text-[15px]">
            Admin &amp; Underwriter Sign-In
          </h2>

          {signInForm}
        </div>

        {/* Secure footer */}
        <div className="mt-3 shrink-0 text-center text-muted-foreground/80 sm:mt-6">
          <p className="flex items-center justify-center gap-1 text-[10px] font-medium sm:text-[11px]">
            <Lock className="h-3 w-3" />
            Secure Platform
          </p>
          <p className="mt-0.5 hidden text-[10px] sm:block">
            Your data is encrypted in transit and at rest.
          </p>
        </div>
      </div>
    </div>
  );
};
