import { ChevronDown } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

interface CollapsibleSectionProps {
  title: string
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

/** Uniform collapsible wrapper for the step detail sections, so any one of
 *  them can be folded away to reach the others without scrolling. */
export function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center justify-between gap-2 p-4 text-left"
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-semibold leading-none">
              {title}
            </span>
            {description && (
              <span className="text-xs font-normal text-muted-foreground">
                {description}
              </span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
