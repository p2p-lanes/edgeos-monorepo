import type { Metadata } from "next"

export interface ShareMetadataInput {
  title: string
  /** OpenGraph/Twitter title; defaults to `title`. */
  socialTitle?: string
  description?: string
  imageUrl?: string | null
  imageAlt?: string
}

/** Build OpenGraph + Twitter metadata without hardcoded image dimensions. */
export function buildShareMetadata(input: ShareMetadataInput): Metadata {
  const { title, description, imageUrl, imageAlt = title } = input
  const socialTitle = input.socialTitle ?? title
  const ogImages = imageUrl ? [{ url: imageUrl, alt: imageAlt }] : undefined

  return {
    title,
    description,
    openGraph: {
      title: socialTitle,
      description,
      type: "website",
      ...(ogImages && { images: ogImages }),
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: socialTitle,
      description,
      ...(imageUrl && { images: [imageUrl] }),
    },
  }
}
