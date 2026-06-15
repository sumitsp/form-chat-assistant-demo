import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clampToMaxChars,
  DEFAULT_SCENARIO_STATUS,
  SCENARIO_DESCRIPTION_MAX_CHARS,
  SCENARIO_STATUSES,
  type SaveProfileVaultMeta,
  type ScenarioStatus,
} from "@/lib/scenarioHistoryApi";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (meta: SaveProfileVaultMeta) => Promise<void>;
  saving?: boolean;
  /** Pre-filled scenario description from the current profile (editable). */
  defaultScenarioDescription?: string;
  /** Center the modal in this workspace instead of the full browser window. */
  portalContainer?: HTMLElement | null;
};

export function SaveProfileDialog({
  open,
  onOpenChange,
  onSave,
  saving = false,
  defaultScenarioDescription = "",
  portalContainer = null,
}: Props) {
  const [borrowerName, setBorrowerName] = useState("");
  const [scenarioDescription, setScenarioDescription] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [status, setStatus] = useState<ScenarioStatus>(DEFAULT_SCENARIO_STATUS);

  useEffect(() => {
    if (open) {
      setBorrowerName("");
      setScenarioDescription(clampToMaxChars(defaultScenarioDescription.trim()));
      setClientPhone("");
      setClientEmail("");
      setStatus(DEFAULT_SCENARIO_STATUS);
    }
  }, [open, defaultScenarioDescription]);

  const descriptionChars = scenarioDescription.length;
  const descriptionOverLimit = descriptionChars > SCENARIO_DESCRIPTION_MAX_CHARS;

  const canSubmit =
    borrowerName.trim().length > 0 &&
    clientEmail.trim().length > 0 &&
    descriptionChars > 0 &&
    !descriptionOverLimit &&
    !saving;

  const handleDescriptionChange = (value: string) => {
    const singleLine = value.replace(/\r?\n/g, " ");
    setScenarioDescription(clampToMaxChars(singleLine));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSave({
      client_name: borrowerName.trim(),
      scenario_description: clampToMaxChars(scenarioDescription.trim()),
      client_phone: clientPhone.trim() || undefined,
      client_email: clientEmail.trim(),
      status,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent container={portalContainer} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save scenario</DialogTitle>
          <DialogDescription>
            Add borrower details and a short scenario description. Eligibility results will be
            stored in your vault.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
        >
          <div className="space-y-2">
            <Label htmlFor="vault-borrower-name">Borrower name *</Label>
            <Input
              id="vault-borrower-name"
              name="vault-borrower-name"
              value={borrowerName}
              onChange={(e) => setBorrowerName(e.target.value)}
              placeholder="Borrower full name"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              data-form-type="other"
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="vault-scenario-description">Scenario description *</Label>
              <span
                className={
                  descriptionOverLimit
                    ? "text-[11px] font-medium text-red-600"
                    : "text-[11px] text-muted-foreground"
                }
              >
                {descriptionChars} / {SCENARIO_DESCRIPTION_MAX_CHARS} characters
              </span>
            </div>
            <Input
              id="vault-scenario-description"
              name="vault-scenario-description"
              value={scenarioDescription}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              maxLength={SCENARIO_DESCRIPTION_MAX_CHARS}
              placeholder="e.g. Primary_FirstLien_FullDoc_FL"
              autoComplete="off"
              autoCorrect="off"
              spellCheck
              className="text-[13px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vault-client-email">Email *</Label>
            <Input
              id="vault-client-email"
              name="vault-client-email"
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="client@example.com"
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vault-client-phone">Phone (optional)</Label>
            <Input
              id="vault-client-phone"
              name="vault-client-phone"
              type="tel"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="(555) 555-5555"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vault-scenario-status">Status</Label>
            <select
              id="vault-scenario-status"
              name="vault-scenario-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ScenarioStatus)}
              autoComplete="off"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {SCENARIO_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="bg-[#012a5b] hover:bg-[#01234d]">
              {saving ? "Storing…" : "Store to Vault"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
