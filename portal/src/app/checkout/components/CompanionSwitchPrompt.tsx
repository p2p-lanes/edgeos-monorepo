"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type CompanionSwitchMode = "prompt" | "blocked-paid"

interface CompanionSwitchPromptProps {
  open: boolean
  mode: CompanionSwitchMode
  ownerEmail: string | null
  companionCategory: string | null
  isSwitching: boolean
  onSwitch: () => void
  onCancel: () => void
}

/**
 * Modal shown to a user who hits the group-invite checkout while already
 * being a companion on someone else's application for the same popup.
 *
 * - "prompt" mode → offers to detach + create their own application
 * - "blocked-paid" mode → explains tickets were already bought; only Cancel
 *
 * On Cancel the parent should log the user out (clear the JWT) and return
 * the portal to the email-entry state — that's the contract.
 */
export function CompanionSwitchPrompt({
  open,
  mode,
  ownerEmail,
  companionCategory,
  isSwitching,
  onSwitch,
  onCancel,
}: CompanionSwitchPromptProps) {
  const ownerText = ownerEmail ?? "another applicant"
  const categoryText = companionCategory?.trim() || "guest"

  if (mode === "blocked-paid") {
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onCancel()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tickets already purchased</DialogTitle>
            <DialogDescription>
              Tickets already purchased for you by{" "}
              <span className="font-semibold">{ownerText}</span>. Please contact
              support if you have any extra questions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={onCancel}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            You're already on another guest's application
          </DialogTitle>
          <DialogDescription>
            You're currently listed as a {categoryText} on{" "}
            <span className="font-semibold">{ownerText}</span>'s application.
            Continue and purchase your own ticket? You'll be unlinked from their
            application.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isSwitching}>
            Cancel
          </Button>
          <Button onClick={onSwitch} disabled={isSwitching}>
            {isSwitching ? "Continuing…" : "Continue Here"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
