const validateVideoUrl = (
  videoUrl: string | boolean | string[] | string[][] | null,
  fields?: Set<string> | null,
) => {
  // If videoUrl has a value, consider it valid
  // If fields exists, also check that video_url is among the fields
  const hasValue = String(videoUrl)?.length > 0
  const fieldExists = fields ? fields?.has("video_url") : true

  return hasValue || !fieldExists // Returns true if it has a value or the field does not exist
}

export { validateVideoUrl }
