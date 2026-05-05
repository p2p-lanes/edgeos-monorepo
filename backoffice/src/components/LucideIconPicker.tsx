import { X } from "lucide-react"
import { lazy, Suspense, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LucideIcon } from "@/lib/lucide-icon"

const LucideIconGrid = lazy(() => import("./LucideIconGrid"))

interface Props {
  value: string | null | undefined
  onChange: (value: string | null) => void
  seed?: string
}

export function LucideIconPicker({ value, onChange, seed }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-2"
        >
          {value ? (
            <LucideIcon name={value} className="h-4 w-4" />
          ) : (
            <span className="h-4 w-4 rounded border border-dashed" />
          )}
          <span className="max-w-[120px] truncate">
            {value ?? "Choose icon"}
          </span>
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(null)}
            aria-label="Clear icon"
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose an icon</DialogTitle>
          </DialogHeader>
          <Suspense
            fallback={
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading icons…
              </p>
            }
          >
            <LucideIconGrid
              seed={seed}
              onPick={(slug) => {
                onChange(slug)
                setOpen(false)
              }}
            />
          </Suspense>
        </DialogContent>
      </Dialog>
    </>
  )
}
