export interface TemplateConfigProps {
  config: Record<string, unknown> | null
  onChange: (config: Record<string, unknown>) => void
  popupId: string
  salesFlowId: string
  productCategory: string | null
}
