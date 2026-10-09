"use client"

import { Award, X } from "lucide-react"
import Image from "next/image"
import { useTranslation } from "react-i18next"
import type { MyBadgeAward } from "@/client"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { imageOptimization } from "@/lib/image-optimization"

interface BadgeTileProps {
  name: string
  imageUrl?: string | null
  count?: number
  category?: string | null
  description?: string | null
  /** Private recognition history; public profiles pass only the description. */
  awards?: MyBadgeAward[]
}

/** Uniform collectible card with full recognition details available on demand. */
export function BadgeTile({
  name,
  imageUrl,
  count = 1,
  category,
  description,
  awards = [],
}: BadgeTileProps) {
  const { t, i18n } = useTranslation()

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={name}
          className="flex h-full min-w-0 cursor-pointer flex-col rounded-xl border bg-card p-2 text-left text-card-foreground shadow-sm hover:border-foreground/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-safe:transition-[border-color,box-shadow]"
        >
          <span className="relative flex aspect-[5/4] w-full items-center justify-center rounded-lg border border-border/50 bg-muted/40 p-2">
            <span className="relative h-28 w-28 max-w-full sm:h-32 sm:w-32">
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt={name}
                  fill
                  sizes="(min-width: 640px) 128px, 112px"
                  className="object-contain drop-shadow-sm"
                  {...imageOptimization(imageUrl)}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <Award
                    aria-hidden="true"
                    className="h-14 w-14 text-muted-foreground"
                  />
                </span>
              )}
            </span>
            {count > 1 && (
              <span className="absolute right-2 top-2 rounded-md border bg-card px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums">
                ×{count}
              </span>
            )}
          </span>
          <span className="block w-full px-1 pb-2 pt-3">
            <span className="mb-1.5 block h-4 truncate font-mono text-[10px] leading-4 tracking-wide text-muted-foreground uppercase">
              {category}
            </span>
            <span className="line-clamp-2 min-h-10 text-sm font-semibold leading-5 [overflow-wrap:anywhere]">
              {name}
            </span>
          </span>
        </button>
      </DialogTrigger>

      <DialogContent
        hasCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl bg-card p-5 text-card-foreground sm:rounded-2xl sm:p-6 motion-reduce:animate-none"
      >
        <DialogClose
          aria-label={t("profile.badges.close")}
          className="absolute right-3 top-3 z-10 rounded-full border bg-card p-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </DialogClose>

        <div className="flex items-center justify-center rounded-xl border border-border/50 bg-muted/40 py-8">
          <div className="relative h-48 w-48 max-w-full">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={name}
                fill
                sizes="192px"
                className="object-contain drop-shadow-sm"
                {...imageOptimization(imageUrl)}
              />
            ) : (
              <Award
                aria-hidden="true"
                className="absolute inset-0 m-auto h-24 w-24 text-muted-foreground"
              />
            )}
          </div>
        </div>

        <div className="space-y-2">
          {category && (
            <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase [overflow-wrap:anywhere]">
              {category}
            </p>
          )}
          <DialogTitle className="text-xl leading-snug [overflow-wrap:anywhere]">
            {name}
          </DialogTitle>
          <DialogDescription
            className={
              description
                ? "whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]"
                : "sr-only"
            }
          >
            {description || t("profile.badges.subtitle")}
          </DialogDescription>
          {count > 1 && (
            <p className="text-xs text-muted-foreground">
              {t("profile.badges.received_count", { count })}
            </p>
          )}
        </div>

        {awards.length > 0 && (
          <div className="space-y-4 border-t pt-4">
            <h3 className="text-sm font-semibold">
              {t("profile.badges.recognition")}
            </h3>
            {awards.map((award, index) => {
              const date = new Date(award.awarded_at)
              const validDate = !Number.isNaN(date.getTime())
              return (
                <div key={`${award.awarded_at}-${index}`} className="space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {award.issuer_name && (
                      <span className="font-medium [overflow-wrap:anywhere]">
                        {award.issuer_name}
                      </span>
                    )}
                    {validDate && (
                      <time dateTime={award.awarded_at}>
                        {date.toLocaleDateString(i18n.resolvedLanguage, {
                          dateStyle: "medium",
                        })}
                      </time>
                    )}
                  </div>
                  {award.message && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
                      {award.message}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
