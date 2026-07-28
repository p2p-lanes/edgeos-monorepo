import {
  getStepTypeDefinition,
  TEMPLATE_DEFINITIONS,
} from "@/components/ticketing-step-builder/constants"
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
  const DefaultIcon = stepTypeDef?.icon
  const templateLabel = template
    ? TEMPLATE_DEFINITIONS.find((d) => d.key === template)?.label
    : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="step-title">Title</Label>
      <div className="flex gap-1.5">
        <div className="relative w-16">
          <Input
            id="step-emoji"
            aria-label="Step emoji"
            value={emoji}
            onChange={(e) => onEmojiChange(e.target.value.slice(0, 8))}
            className="w-full text-center text-lg"
          />
          {/* When the operator hasn't picked a custom emoji, render the
          step-type's resolved default icon inside the input so the
          preview matches what the checkout nav will actually show.
          Replaces the legacy hardcoded "🎟️" placeholder which made
          every step look like Tickets by default. */}
          {!emoji && DefaultIcon ? (
            <DefaultIcon
              className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
          ) : null}
        </div>
        <Input
          id="step-title"
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
        Optional emoji replaces the default icon in the checkout step nav. Leave
        blank to keep the built-in icon (shown faded above).
      </p>
    </div>
  )
}
