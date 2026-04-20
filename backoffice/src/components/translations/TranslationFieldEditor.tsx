import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface TranslationFieldEditorProps {
  fieldName: string
  label: string
  originalValue: string
  translatedValue: string
  onChange: (value: string) => void
  multiline?: boolean
}

export function TranslationFieldEditor({
  fieldName,
  label,
  originalValue,
  translatedValue,
  onChange,
  multiline = false,
}: TranslationFieldEditorProps) {
  const InputComponent = multiline ? Textarea : Input

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          {label} (original)
        </Label>
        <InputComponent
          value={originalValue}
          disabled
          className="bg-muted text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          {label} (translated)
        </Label>
        <InputComponent
          id={`translation-${fieldName}`}
          value={translatedValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Translate "${originalValue}"`}
          className="text-sm"
        />
      </div>
    </div>
  )
}
