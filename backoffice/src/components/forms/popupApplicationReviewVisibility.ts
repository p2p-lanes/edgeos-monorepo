export function applicationReviewVisibility({
  isEdit,
  takesApplications,
}: {
  isEdit: boolean
  takesApplications: boolean
}) {
  return {
    strategy: isEdit,
    reviewers: isEdit && takesApplications,
  }
}
