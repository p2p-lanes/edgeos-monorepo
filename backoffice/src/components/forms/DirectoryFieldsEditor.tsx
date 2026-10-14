import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type DirectoryFieldConfig = {
  id: string
  label: string
  source: "human" | "application" | "attendee"
  key: string
  shareable: boolean
}

type Props = {
  fields: DirectoryFieldConfig[]
  onChange: (fields: DirectoryFieldConfig[]) => void
  disabled?: boolean
}

export function DirectoryFieldsEditor({ fields, onChange, disabled }: Props) {
  const update = (index: number, patch: Partial<DirectoryFieldConfig>) =>
    onChange(
      fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    )

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Directory fields</p>
        <p className="text-xs text-muted-foreground">
          Choose values from a profile, application answers, or companion data.
          People must opt in to the directory and each field starts hidden.
        </p>
      </div>
      {fields.map((field, index) => (
        <div
          key={`${field.id}-${index}`}
          className="grid gap-2 rounded-md border p-3 md:grid-cols-5"
        >
          <div className="space-y-1">
            <Label htmlFor={`directory-label-${index}`}>Column label</Label>
            <Input
              id={`directory-label-${index}`}
              value={field.label}
              disabled={disabled}
              onChange={(event) => update(index, { label: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`directory-id-${index}`}>Field ID</Label>
            <Input
              id={`directory-id-${index}`}
              value={field.id}
              disabled={disabled}
              onChange={(event) => update(index, { id: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`directory-source-${index}`}>Source</Label>
            <select
              id={`directory-source-${index}`}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={field.source}
              disabled={disabled}
              onChange={(event) =>
                update(index, {
                  source: event.target.value as DirectoryFieldConfig["source"],
                })
              }
            >
              <option value="human">Human profile</option>
              <option value="application">Application</option>
              <option value="attendee">Attendee data</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`directory-key-${index}`}>Source key</Label>
            <Input
              id={`directory-key-${index}`}
              value={field.key}
              disabled={disabled}
              onChange={(event) => update(index, { key: event.target.value })}
            />
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                id={`directory-shareable-${index}`}
                checked={field.shareable}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  update(index, { shareable: checked === true })
                }
              />
              <Label htmlFor={`directory-shareable-${index}`}>
                Allow individual sharing
              </Label>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove directory field"
              disabled={disabled}
              onClick={() => onChange(fields.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...fields,
            {
              id: "",
              label: "",
              source: "application",
              key: "",
              shareable: true,
            },
          ])
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        Add field
      </Button>
    </div>
  )
}
