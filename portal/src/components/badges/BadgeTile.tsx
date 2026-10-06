import { Award } from "lucide-react"
import Image from "next/image"
import { imageOptimization } from "@/lib/image-optimization"

interface BadgeTileProps {
  name: string
  imageUrl?: string | null
  count?: number
  /** Optional line under the name (latest message, description...). */
  caption?: string | null
}

/** Badge artwork with its name and, for repeatable badges, how many. */
export function BadgeTile({
  name,
  imageUrl,
  count = 1,
  caption,
}: BadgeTileProps) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="relative h-20 w-20 sm:h-24 sm:w-24">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={name}
            fill
            sizes="96px"
            className="object-contain drop-shadow-sm"
            {...imageOptimization(imageUrl)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-full bg-muted">
            <Award className="h-1/2 w-1/2 text-muted-foreground" />
          </div>
        )}
        {count > 1 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            ×{count}
          </span>
        )}
      </div>
      <p className="text-sm font-medium leading-tight">{name}</p>
      {caption && (
        <p className="line-clamp-2 text-xs italic text-muted-foreground">
          {caption}
        </p>
      )}
    </div>
  )
}
