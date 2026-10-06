import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { type BadgeBulkAwardResult, BadgesService } from "@/client"
import {
  PeoplePicker,
  type Person,
  parseEmails,
} from "@/components/Badges/IssuerPolicies"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

type RecipientMode = "people" | "emails"

const MODE_LABELS: Record<RecipientMode, string> = {
  people: "Specific people",
  emails: "A list of emails",
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/** Give one badge to many people at once, picked or pasted as emails. */
export function GiveBadgeDialog({
  badgeId,
  open,
  onOpenChange,
}: {
  badgeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [mode, setMode] = useState<RecipientMode>("people")
  const [people, setPeople] = useState<Person[]>([])
  const [emailsText, setEmailsText] = useState("")
  const [message, setMessage] = useState("")
  // Shown instead of the form when someone was skipped, so it isn't missed.
  const [result, setResult] = useState<BadgeBulkAwardResult | null>(null)
  const emails = parseEmails(emailsText)

  const close = (next: boolean) => {
    if (!next) {
      setMode("people")
      setPeople([])
      setEmailsText("")
      setMessage("")
      setResult(null)
    }
    onOpenChange(next)
  }

  const give = useMutation({
    mutationFn: () =>
      BadgesService.awardBadgeBulk({
        badgeId,
        requestBody: {
          // Only the chosen mode is sent, whatever the other one holds.
          recipient_human_ids: mode === "people" ? people.map((p) => p.id) : [],
          recipient_emails: mode === "emails" ? emails.valid : [],
          message: message.trim() || null,
        },
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["badge-awards"] })
      queryClient.invalidateQueries({ queryKey: ["badges"] })
      if (data.already_had.length === 0 && data.unknown_emails.length === 0) {
        showSuccessToast(
          `Given to ${plural(data.awarded.length, "person", "people")}`,
        )
        close(false)
      } else {
        setResult(data)
      }
    },
    onError: createErrorHandler(showErrorToast),
  })

  const invalid = mode === "emails" && emails.invalid.length > 0
  const nobody =
    mode === "people" ? people.length === 0 : emails.valid.length === 0

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Give this badge</DialogTitle>
          <DialogDescription>
            It shows up on their profile and their public link.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p>Given to {plural(result.awarded.length, "person", "people")}.</p>
            {result.already_had.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">Already had it, skipped:</p>
                <p className="text-muted-foreground">
                  {result.already_had
                    .map(
                      (h) =>
                        [h.first_name, h.last_name].filter(Boolean).join(" ") ||
                        h.email,
                    )
                    .join(", ")}
                </p>
              </div>
            )}
            {result.unknown_emails.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">
                  Nobody signed up with these emails:
                </p>
                <p className="text-muted-foreground">
                  {result.unknown_emails.join(", ")}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Give it to</Label>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as RecipientMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABELS) as RecipientMode[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {MODE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mode === "people" ? (
                <PeoplePicker value={people} onChange={setPeople} />
              ) : (
                <>
                  <Textarea
                    value={emailsText}
                    onChange={(e) => setEmailsText(e.target.value)}
                    rows={4}
                    placeholder="Paste emails, separated by commas, spaces or new lines"
                    aria-label="Emails"
                  />
                  {emails.valid.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {plural(emails.valid.length, "email", "emails")}. Only
                      people who already signed up get it.
                    </p>
                  )}
                  {emails.invalid.length > 0 && (
                    <p className="text-xs text-destructive">
                      Not valid: {emails.invalid.join(", ")}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="give-badge-message">Message (optional)</Label>
              <Textarea
                id="give-badge-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="Only they and admins can read it"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <LoadingButton
                loading={give.isPending}
                disabled={nobody || invalid}
                onClick={() => give.mutate()}
              >
                Give badge
              </LoadingButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
