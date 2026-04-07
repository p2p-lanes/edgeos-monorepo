import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { GripVertical, Pencil } from "lucide-react"
import { useRef, useState } from "react"

import { type TicketingStepPublic, TicketingStepsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { getStepTypeDefinition, TEMPLATE_DEFINITIONS } from "./constants"

interface SortableStepCardProps {
  step: TicketingStepPublic
  onEdit: (step: TicketingStepPublic) => void
}

export function SortableStepCard({ step, onEdit }: SortableStepCardProps) {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(step.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const updateMutation = useMutation({
    mutationFn: (data: { title?: string; is_enabled?: boolean }) =>
      TicketingStepsService.updateTicketingStep({
        stepId: step.id,
        requestBody: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticketing-steps"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const stepDef = getStepTypeDefinition(step.step_type)
  const Icon = stepDef?.icon
  const templateDef = TEMPLATE_DEFINITIONS.find((v) => v.key === step.template)

  const handleTitleClick = () => {
    setTitleDraft(step.title)
    setIsEditingTitle(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleTitleBlur = () => {
    setIsEditingTitle(false)
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== step.title) {
      updateMutation.mutate({ title: trimmed })
    } else {
      setTitleDraft(step.title)
    }
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") inputRef.current?.blur()
    if (e.key === "Escape") {
      setTitleDraft(step.title)
      setIsEditingTitle(false)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border bg-background px-3 py-3 shadow-sm"
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Step icon */}
      {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}

      {/* Title (inline editable) */}
      <div className="flex-1 min-w-0">
        {isEditingTitle ? (
          <Input
            ref={inputRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            className="h-7 text-sm px-1"
          />
        ) : (
          <button
            type="button"
            className="text-sm font-medium text-left truncate w-full hover:text-primary transition-colors"
            onClick={handleTitleClick}
          >
            {step.title}
          </button>
        )}
        <p className="text-xs text-muted-foreground">{step.step_type}</p>
        {step.description && (
          <p className="text-xs text-muted-foreground truncate">
            {step.description}
          </p>
        )}
        {templateDef && (
          <p className="text-xs text-muted-foreground/70">
            {templateDef.label}
          </p>
        )}
      </div>

      {/* Protected badge */}
      {step.protected && (
        <Badge variant="secondary" className="text-xs shrink-0">
          Protected
        </Badge>
      )}

      {/* Enable/disable toggle */}
      <Switch
        checked={step.is_enabled}
        disabled={step.protected}
        onCheckedChange={(checked) =>
          updateMutation.mutate({ is_enabled: checked })
        }
        aria-label={`Toggle ${step.title}`}
      />

      {/* Edit button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => onEdit(step)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
