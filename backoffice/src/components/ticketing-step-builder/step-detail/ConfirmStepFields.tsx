import { Link } from "@tanstack/react-router"
import { Info } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CollapsibleSection } from "./CollapsibleSection"

interface ConfirmStepFieldsProps {
  popupId: string
  insuranceEnabled: boolean
  templateConfig: Record<string, unknown> | null
  onTemplateConfigChange: (config: Record<string, unknown>) => void
}

export function ConfirmStepFields({
  popupId,
  insuranceEnabled,
  templateConfig,
  onTemplateConfigChange,
}: ConfirmStepFieldsProps) {
  const insurance = templateConfig?.insurance as Record<string, unknown>

  return (
    <>
      <CollapsibleSection
        title="Pay Button"
        description="The button that completes the purchase"
        defaultOpen
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-cta-label">Button Label</Label>
          <Input
            id="confirm-cta-label"
            value={(templateConfig?.cta_label as string) ?? ""}
            onChange={(e) =>
              onTemplateConfigChange({
                ...templateConfig,
                cta_label: e.target.value || undefined,
              })
            }
            placeholder="Pagar"
          />
          <p className="text-xs text-muted-foreground">
            Shown on both the bottom bar's button and the one inside the confirm
            card. They always read the same. Leave empty to use the checkout's
            own wording, translated per shopper. Once set, translate it in this
            step's Translations tab.
          </p>
        </div>
      </CollapsibleSection>

      {insuranceEnabled ? (
        <CollapsibleSection
          title="Insurance Card"
          description="Text displayed inside the insurance toggle card in this step"
          defaultOpen
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="insurance-card-title">Card Title</Label>
              <Input
                id="insurance-card-title"
                value={(insurance?.card_title as string) ?? ""}
                onChange={(e) =>
                  onTemplateConfigChange({
                    ...templateConfig,
                    insurance: {
                      ...insurance,
                      card_title: e.target.value || undefined,
                    },
                  })
                }
                placeholder="Insurance"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="insurance-card-subtitle">Card Subtitle</Label>
              <Input
                id="insurance-card-subtitle"
                value={(insurance?.card_subtitle as string) ?? ""}
                onChange={(e) =>
                  onTemplateConfigChange({
                    ...templateConfig,
                    insurance: {
                      ...insurance,
                      card_subtitle: e.target.value || undefined,
                    },
                  })
                }
                placeholder="Change of plans coverage"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="insurance-toggle-label">Toggle Label</Label>
              <Input
                id="insurance-toggle-label"
                value={(insurance?.toggle_label as string) ?? ""}
                onChange={(e) =>
                  onTemplateConfigChange({
                    ...templateConfig,
                    insurance: {
                      ...insurance,
                      toggle_label: e.target.value || undefined,
                    },
                  })
                }
                placeholder="Add insurance"
              />
              <p className="text-xs text-muted-foreground">
                Accessible label for the insurance toggle button.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="insurance-benefits">
                Benefits (one per line)
              </Label>
              <Textarea
                id="insurance-benefits"
                value={
                  Array.isArray(insurance?.benefits)
                    ? (insurance?.benefits as string[]).join("\n")
                    : ""
                }
                onChange={(e) =>
                  onTemplateConfigChange({
                    ...templateConfig,
                    insurance: {
                      ...insurance,
                      benefits: e.target.value
                        ? e.target.value
                            .split("\n")
                            .map((l) => l.trim())
                            .filter(Boolean)
                        : [],
                    },
                  })
                }
                placeholder={
                  "Full refund up to 14 days before the event\n50% refund up to 7 days before\nFree date change at no extra cost"
                }
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Each line becomes a benefit bullet in the card.
              </p>
            </div>
          </div>
        </CollapsibleSection>
      ) : (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Enable insurance in gathering settings to configure the card
            content.{" "}
            <Link
              to="/popups/$id/edit"
              params={{ id: popupId }}
              className="underline font-medium"
            >
              Go to Gathering Settings
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}
