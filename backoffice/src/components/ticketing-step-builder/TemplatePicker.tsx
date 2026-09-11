import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { TEMPLATE_DEFINITIONS } from "./constants"

interface TemplatePickerProps {
  value: string
  onChange: (key: string) => void
  className?: string
}

/**
 * Which template a step renders with.
 *
 * A deprecated template stays on this grid rather than disappearing from it.
 * Its rows still exist: tenants are selling through steps on the old
 * template, the checkout still renders them, and an operator opening such a
 * step has to be able to see what it is on. So it is shown, greyed, saying
 * what replaced it, and it cannot be picked for anything that is not already
 * using it.
 */
export function TemplatePicker({
  value,
  onChange,
  className,
}: TemplatePickerProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      {TEMPLATE_DEFINITIONS.map((def) => {
        const Icon = def.icon
        const isSelected = value === def.key
        // Retired, and not what this step is already on. Selecting it is the
        // only thing being taken away: a step that has it keeps its card
        // live so the operator can read it and switch off it.
        const retired = !!def.deprecatedBy && !isSelected
        const successor = def.deprecatedBy
          ? TEMPLATE_DEFINITIONS.find((other) => other.key === def.deprecatedBy)
          : undefined

        return (
          <button
            key={def.key}
            type="button"
            disabled={retired}
            aria-describedby={
              def.deprecatedBy ? `template-retired-${def.key}` : undefined
            }
            onClick={() => onChange(isSelected ? "" : def.key)}
            className={cn(
              "relative flex flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-all",
              retired && "cursor-not-allowed opacity-55",
              isSelected
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : !retired &&
                    "border-border hover:border-primary/50 hover:bg-accent/50",
              retired && "border-dashed border-border",
            )}
          >
            {isSelected && (
              <Check className="absolute top-2 right-2 h-3.5 w-3.5 text-primary" />
            )}
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium leading-tight">{def.label}</span>
            <span className="text-xs text-muted-foreground leading-tight">
              {def.description}
            </span>
            {def.deprecatedBy && (
              <span
                id={`template-retired-${def.key}`}
                className="text-xs font-medium leading-tight text-amber-600"
              >
                {isSelected
                  ? `Still working, but no longer maintained. Move this step to ${successor?.label ?? def.deprecatedBy} when you can.`
                  : `Replaced by ${successor?.label ?? def.deprecatedBy}`}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
