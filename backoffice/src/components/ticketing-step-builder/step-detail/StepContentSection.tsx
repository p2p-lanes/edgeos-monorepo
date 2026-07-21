import { TEMPLATE_DEFINITIONS } from "@/components/ticketing-step-builder/constants"
import { TemplatePicker } from "@/components/ticketing-step-builder/TemplatePicker"
import { TEMPLATE_CONFIG_REGISTRY } from "@/components/ticketing-step-builder/template-configs"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface StepContentSectionProps {
  popupId: string
  template: string
  onTemplateChange: (key: string) => void
  templateConfig: Record<string, unknown> | null
  onTemplateConfigChange: (config: Record<string, unknown>) => void
  productCategory: string
}

export function StepContentSection({
  popupId,
  template,
  onTemplateChange,
  templateConfig,
  onTemplateConfigChange,
  productCategory,
}: StepContentSectionProps) {
  const TemplateConfigComponent = template
    ? TEMPLATE_CONFIG_REGISTRY[template]
    : undefined

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Template</CardTitle>
          <CardDescription>
            Choose how products are displayed in the checkout
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemplatePicker value={template} onChange={onTemplateChange} />
        </CardContent>
      </Card>

      {TemplateConfigComponent && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Template Configuration</CardTitle>
            <CardDescription>
              Settings specific to the{" "}
              {TEMPLATE_DEFINITIONS.find((d) => d.key === template)?.label}{" "}
              template
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateConfigComponent
              config={templateConfig}
              onChange={onTemplateConfigChange}
              popupId={popupId}
              productCategory={productCategory || null}
            />
          </CardContent>
        </Card>
      )}
    </>
  )
}
