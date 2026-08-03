import { RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { OverrideMode } from "@/lib/salesFlowOverrides"

export type OverrideFieldKind =
  | "boolean"
  | "number"
  | "currency"
  | "text"
  | "select"
  | "secret"

interface OverrideFieldRowProps {
  fieldKey: string
  label: string
  description?: string
  kind: OverrideFieldKind
  options?: { value: string; label: string }[]
  popupValue: string | number | boolean | null | undefined
  mode: OverrideMode
  value: string
  onModeChange: (mode: OverrideMode) => void
  onValueChange: (value: string) => void
  readOnly?: boolean
}

function formatPopupValue(
  kind: OverrideFieldKind,
  popupValue: string | number | boolean | null | undefined,
): string {
  if (popupValue === null || popupValue === undefined || popupValue === "") {
    return "Not set"
  }
  if (kind === "boolean") return popupValue ? "On" : "Off"
  if (kind === "currency") return `$${popupValue}`
  if (kind === "secret") return "Configured"
  return String(popupValue)
}

/**
 * One Class-B "inheritable override" field (design D1). Displays the
 * inherited popup value when mode is "inherit" and an editable control when
 * mode is "override", so the NULL-means-inherit contract is visible rather
 * than implied. See `salesFlowOverrides.ts` for the pure mode/value logic.
 */
export function OverrideFieldRow({
  fieldKey,
  label,
  description,
  kind,
  options,
  popupValue,
  mode,
  value,
  onModeChange,
  onValueChange,
  readOnly = false,
}: OverrideFieldRowProps) {
  const isOverridden = mode === "override"

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          {!isOverridden && (
            <Badge variant="outline" className="font-normal">
              Inherited from event: {formatPopupValue(kind, popupValue)}
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isOverridden ? (
          <>
            {kind === "boolean" && (
              <Switch
                checked={value === "true"}
                onCheckedChange={(checked) => onValueChange(String(checked))}
                disabled={readOnly}
              />
            )}
            {(kind === "number" || kind === "currency") && (
              <Input
                type="number"
                step={kind === "currency" ? "0.01" : "1"}
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                disabled={readOnly}
                className="w-28 text-sm"
              />
            )}
            {kind === "text" && (
              <Input
                type="text"
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                disabled={readOnly}
                className="w-56 text-sm"
              />
            )}
            {kind === "secret" && (
              <Input
                type="password"
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                disabled={readOnly}
                className="w-56 text-sm"
              />
            )}
            {kind === "select" && (
              <Select
                value={value}
                onValueChange={onValueChange}
                disabled={readOnly}
              >
                <SelectTrigger className="w-48 text-sm" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Reset ${label} to inherited`}
                onClick={() => onModeChange("inherit")}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
          </>
        ) : (
          !readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onModeChange("override")}
              data-testid={`override-${fieldKey}`}
            >
              Override
            </Button>
          )
        )}
      </div>
    </div>
  )
}
