import { TEMPLATE_DEFINITIONS } from "@/components/ticketing-step-builder/constants"
import { TemplatePicker } from "@/components/ticketing-step-builder/TemplatePicker"
import { TEMPLATE_CONFIG_REGISTRY } from "@/components/ticketing-step-builder/template-configs"
import { CollapsibleSection } from "./CollapsibleSection"

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
  const templateLabel = TEMPLATE_DEFINITIONS.find(
    (d) => d.key === template,
  )?.label

  return (
    <>
      {/* Collapsed by default once a template is picked: the 12-item grid is
          rarely changed again, and folding it lets the operator reach the
          config and display settings without scrolling past it. */}
      <CollapsibleSection
        title="Template"
        description={
          templateLabel
            ? `${templateLabel} · how products are displayed in the checkout`
            : "Choose how products are displayed in the checkout"
        }
        defaultOpen={!template}
      >
        <TemplatePicker value={template} onChange={onTemplateChange} />
      </CollapsibleSection>

      {TemplateConfigComponent && (
        <CollapsibleSection
          title="Template Configuration"
          description={`Settings specific to the ${templateLabel} template`}
          defaultOpen
        >
          <TemplateConfigComponent
            config={templateConfig}
            onChange={onTemplateConfigChange}
            popupId={popupId}
            productCategory={productCategory || null}
          />
        </CollapsibleSection>
      )}
    </>
  )
}
