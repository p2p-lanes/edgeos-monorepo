import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * One group of settings, closed, with its current answer on the line.
 *
 * The editor used to render all ten groups open, thirty-three fields deep.
 * Somebody asking "does this door charge anything" had to read six of them to
 * find out. Closed, the answer is on the row; the fields are one click in.
 *
 * Not "advanced settings" behind a drawer, which moves the problem rather
 * than solving it. Nothing is hidden — every answer is on screen. What is
 * collapsed is the machinery for changing it.
 */
export function ConfigSectionRow({
  title,
  description,
  answer,
  active,
  open,
  onToggle,
  children,
}: {
  title: string
  description?: string
  answer: string
  active: boolean
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className={cn("border-b last:border-b-0", open && "bg-muted/30")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/40"
      >
        <span className="w-44 shrink-0 text-sm font-semibold">{title}</span>
        <span
          className={cn(
            "min-w-0 flex-1 text-sm",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {answer}
        </span>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="border-t px-4 pb-4 pt-1">
          {description && (
            <p className="pb-2 pt-3 text-sm text-muted-foreground">
              {description}
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  )
}
