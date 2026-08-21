export function salesFlowsQueryKey(popupId: string | null | undefined) {
  return ["sales-flows", { popupId }] as const
}
