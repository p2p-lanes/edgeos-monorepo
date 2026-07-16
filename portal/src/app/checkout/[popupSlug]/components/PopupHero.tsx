import Image from "next/image"
import type { PopupPublic } from "@/client"
import { imageOptimization } from "@/lib/image-optimization"

interface PopupHeroProps {
  popup: PopupPublic
}

export function PopupHero({ popup }: PopupHeroProps) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm">
      {popup.image_url ? (
        <div className="relative h-56 w-full">
          <Image
            src={popup.image_url}
            alt={popup.name}
            fill
            sizes="100vw"
            className="object-cover"
            {...imageOptimization(popup.image_url)}
          />
        </div>
      ) : null}
      <div className="space-y-3 p-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {popup.name}
          </h1>
          {popup.tagline ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {popup.tagline}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          {popup.location ? <span>{popup.location}</span> : null}
          {popup.start_date ? <span>{String(popup.start_date)}</span> : null}
          {popup.end_date ? <span>→ {String(popup.end_date)}</span> : null}
        </div>
      </div>
    </section>
  )
}
