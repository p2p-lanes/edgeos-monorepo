import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { TEMPLATE_DEFINITIONS } from "./constants"

interface TemplatePickerProps {
  value: string
  onChange: (key: string) => void
  className?: string
}

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
        return (
          <button
            key={def.key}
            type="button"
            onClick={() => onChange(isSelected ? "" : def.key)}
            className={cn(
              "relative flex flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-all",
              isSelected
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:border-primary/50 hover:bg-accent/50",
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
          </button>
        )
      })}
    </div>
  )
}
