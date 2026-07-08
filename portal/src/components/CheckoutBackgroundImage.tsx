"use client"

import Image from "next/image"
import { imageOptimization } from "@/lib/image-optimization"

// Full-bleed image rendered behind the checkout, mirroring the fixed
// positioning of CheckoutBackgroundVideo. The fixed wrapper reproduces the
// old CSS `background-attachment: fixed` look while the photo itself loads
// through next/image.
export function CheckoutBackgroundImage({ url }: { url: string }) {
  return (
    <div aria-hidden className="fixed inset-0 -z-10">
      <Image
        src={url}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        {...imageOptimization(url)}
      />
    </div>
  )
}
