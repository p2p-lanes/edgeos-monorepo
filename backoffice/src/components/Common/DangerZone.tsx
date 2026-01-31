import { Trash2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"

interface DangerZoneProps {
  title?: string
  description: string
  onDelete: () => void
  isDeleting: boolean
  confirmText?: string
  resourceName: string
}

export function DangerZone({
  title = "Danger Zone",
  description,
  onDelete,
  isDeleting,
  confirmText = "Delete",
  resourceName,
}: DangerZoneProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <Button variant="destructive" onClick={() => setIsOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            {confirmText}
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{resourceName}"? This action
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={isDeleting}>
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton
                variant="destructive"
                loading={isDeleting}
                onClick={() => {
                  onDelete()
                }}
              >
                Delete
              </LoadingButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
