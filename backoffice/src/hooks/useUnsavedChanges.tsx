import { useStore } from "@tanstack/react-form"
import { useBlocker } from "@tanstack/react-router"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useUnsavedChanges(form: { store: any }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDirty = useStore(form.store, (s: any) => s.isDirty as boolean)

  const blocker = useBlocker({
    shouldBlockFn: () => form.store.state.isDirty as boolean,
    enableBeforeUnload: () => isDirty,
    disabled: !isDirty,
    withResolver: true,
  })

  useEffect(() => {
    if (!isDirty) return

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }

    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  return blocker
}

export function UnsavedChangesDialog({
  blocker,
}: {
  blocker: ReturnType<typeof useUnsavedChanges>
}) {
  if (blocker.status !== "blocked") return null

  return (
    <Dialog open onOpenChange={(open) => !open && blocker.reset()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            You have unsaved changes that will be lost if you leave this page.
            Are you sure you want to continue?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={blocker.reset}>
            Stay on page
          </Button>
          <Button variant="destructive" onClick={blocker.proceed}>
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
