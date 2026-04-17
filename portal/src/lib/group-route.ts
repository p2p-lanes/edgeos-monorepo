export const getPublicGroupPath = (groupSlug: string) => `/groups/${groupSlug}`

export const getPublicGroupLink = (origin: string, groupSlug: string) => {
  return new URL(getPublicGroupPath(groupSlug), origin).toString()
}
