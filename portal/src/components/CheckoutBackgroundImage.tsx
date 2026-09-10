"use client"

import Image from "next/image"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"

export function CheckoutBackgroundImage({
  url,
  position = "fixed",
}: {
  url: string
  position?: "absolute" | "fixed"
}) {
  return (
    <div
      aria-hidden
      className={cn(
        position === "absolute" ? "absolute" : "fixed",
        "pointer-events-none inset-0 -z-10",
      )}
    >
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
