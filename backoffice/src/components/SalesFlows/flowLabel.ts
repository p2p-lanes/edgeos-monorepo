interface SalesFlowLabelSource {
  name: string
  is_default?: boolean
}

export function formatSalesFlowLabel({
  name,
  is_default,
}: SalesFlowLabelSource): string {
  return is_default ? `${name} (primary)` : name
}
