"use client"

// Side-effect import: /u/[token] renders outside the portal <Providers>
// tree, so i18next is not otherwise initialized (same as not-found.tsx).
import "@/i18n/config"

import { UserRound } from "lucide-react"
import Image from "next/image"
import { useTranslation } from "react-i18next"
import type { PublicProfile } from "@/client"
import { BadgeTile } from "@/components/badges/BadgeTile"
import { imageOptimization } from "@/lib/image-optimization"

interface PublicProfileViewProps {
  profile: PublicProfile
  tenantName: string
  tenantLogoUrl?: string | null
}

export function PublicProfileView({
  profile,
  tenantName,
  tenantLogoUrl,
}: PublicProfileViewProps) {
  const { t } = useTranslation()
  const name = profile.display_name ?? t("publicProfile.anonymous")

  return (
    <main className="flex min-h-screen justify-center bg-neutral-100 px-4 py-10">
      <div className="w-full max-w-2xl space-y-8">
        <div className="flex items-center justify-center gap-2 text-sm text-neutral-600">
          {tenantLogoUrl && (
            <span className="relative h-6 w-6">
              <Image
                src={tenantLogoUrl}
                alt=""
                fill
                sizes="24px"
                className="object-contain"
                {...imageOptimization(tenantLogoUrl)}
              />
            </span>
          )}
          {t("publicProfile.community", { tenant: tenantName })}
        </div>

        <section className="rounded-2xl bg-white p-8 shadow-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="relative h-24 w-24 overflow-hidden rounded-full bg-neutral-200">
              {profile.picture_url ? (
                <Image
                  src={profile.picture_url}
                  alt={name}
                  fill
                  sizes="96px"
                  className="object-cover"
                  {...imageOptimization(profile.picture_url)}
                />
              ) : (
                <UserRound className="absolute inset-0 m-auto h-12 w-12 text-neutral-400" />
              )}
            </div>
            <h1 className="text-2xl font-semibold text-neutral-900">{name}</h1>
            <p className="text-sm text-neutral-500">
              {t("publicProfile.badge_count", {
                count: profile.badges.length,
              })}
            </p>
          </div>

          {profile.badges.length > 0 ? (
            <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3">
              {profile.badges.map((badge) => (
                <BadgeTile
                  key={badge.name}
                  name={badge.name}
                  imageUrl={badge.image_url}
                  count={badge.count}
                  caption={badge.description}
                />
              ))}
            </div>
          ) : (
            <p className="mt-8 text-center text-sm text-neutral-500">
              {t("publicProfile.no_badges")}
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
