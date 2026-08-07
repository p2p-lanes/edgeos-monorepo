import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

export type ConfigFieldKind =
  | "boolean"
  | "number"
  | "currency"
  | "text"
  | "secret"
  | "select"

interface ConfigFieldRowProps {
  fieldKey: string
  label: string
  description?: string
  kind: ConfigFieldKind
  options?: { value: string; label: string }[]
  value: string
  onValueChange: (value: string) => void
  readOnly?: boolean
}

/**
 * A plain setting on a sales flow.
 *
 * It replaces the three-state inherit/override control this used to be.
 * Since sdd/sales-flows-rediseno slice 7 a flow owns these columns, so
 * there is no second place the value could come from and nothing to
 * decide beyond the value itself.
 */
export function ConfigFieldRow({
  fieldKey,
  label,
  description,
  kind,
  options,
  value,
  onValueChange,
  readOnly = false,
}: ConfigFieldRowProps) {
  const controlId = `flow-config-${fieldKey}`

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={controlId} className="text-sm font-medium">
          {label}
        </label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {kind === "boolean" && (
          <Switch
            id={controlId}
            checked={value === "true"}
            onCheckedChange={(checked) => onValueChange(String(checked))}
            disabled={readOnly}
          />
        )}
        {(kind === "number" || kind === "currency") && (
          <Input
            id={controlId}
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
            id={controlId}
            type="text"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={readOnly}
            className="w-56 text-sm"
          />
        )}
        {kind === "secret" && (
          <Input
            id={controlId}
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
            <SelectTrigger id={controlId} className="w-48 text-sm" size="sm">
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
      </div>
    </div>
  )
}
