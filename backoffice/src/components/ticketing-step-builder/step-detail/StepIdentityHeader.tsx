import {
  getStepTypeDefinition,
  TEMPLATE_DEFINITIONS,
} from "@/components/ticketing-step-builder/constants"
import { StepIconPicker } from "@/components/ticketing-step-builder/step-detail/StepIconPicker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface StepIdentityHeaderProps {
  stepType: string
  emoji: string
  onEmojiChange: (value: string) => void
  title: string
  onTitleChange: (value: string) => void
  template: string
}

export function StepIdentityHeader({
  stepType,
  emoji,
  onEmojiChange,
  title,
  onTitleChange,
  template,
}: StepIdentityHeaderProps) {
  const stepTypeDef = getStepTypeDefinition(stepType)
  const templateLabel = template
    ? TEMPLATE_DEFINITIONS.find((d) => d.key === template)?.label
    : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="step-title">Title</Label>
      <div className="flex gap-1.5">
        <StepIconPicker
          value={emoji}
          onChange={onEmojiChange}
          stepType={stepType}
          template={template || null}
        />
        <Input
          id="step-title"
          aria-label="Title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="flex-1"
        />
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        {stepTypeDef?.defaultTitle ?? stepType}
        {templateLabel ? ` · ${templateLabel} template` : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        Pick a curated icon — or an emoji — for the checkout step nav. Leave it
        on the default to keep the built-in icon (shown faded above).
      </p>
    </div>
  )
}
