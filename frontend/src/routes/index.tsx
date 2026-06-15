import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AccessGate } from "@/components/AccessGate";
import { type AccessRole, getAccessRole, setAccessRole } from "@/lib/access";

/**
 * Landing route. Unlike a blind redirect to /form, this shows the access gate at
 * "/" so the URL doesn't flip to /form before the user has signed in (or skipped).
 * Once access is granted — or if it was already granted this session — we send the
 * user to /form, the default experience.
 */
export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexPage,
});

function IndexPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<AccessRole | null>(() => getAccessRole());

  // Re-read after mount: during SSR/hydration localStorage isn't readable, so the
  // initial value can be null even for a remembered user. Re-sync on the client.
  useEffect(() => {
    if (!role) {
      const stored = getAccessRole();
      if (stored) setRole(stored);
    }
  }, [role]);

  // Already signed in (this session or remembered) → straight to the default form.
  useEffect(() => {
    if (role) void navigate({ to: "/form", replace: true });
  }, [role, navigate]);

  if (role) return null;

  return (
    <AccessGate
      onGranted={(granted, remember) => {
        setAccessRole(granted, remember);
        void navigate({ to: "/form" });
      }}
    />
  );
}
