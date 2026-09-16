interface ApplicationFlowIdentity {
  id: string
  slug: string
}

/** Resolves the flow identifier carried by an application entry URL. */
export function resolveApplicationFlowId(
  identifier: string | null,
  flows: ApplicationFlowIdentity[],
): string | null {
  if (!identifier) return null
  return (
    flows.find((flow) => flow.id === identifier || flow.slug === identifier)
      ?.id ?? null
  )
}
