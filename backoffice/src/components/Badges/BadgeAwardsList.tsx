import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Award, Undo2 } from "lucide-react"

import { type BadgeAwardPublic, BadgesService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { LoadingButton } from "@/components/ui/loading-button"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export function BadgeArt({
  url,
  className = "h-10 w-10",
}: {
  url?: string | null
  className?: string
}) {
  return url ? (
    <img src={url} alt="" className={`${className} shrink-0 object-contain`} />
  ) : (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-muted`}
    >
      <Award className="h-1/2 w-1/2 text-muted-foreground" />
    </div>
  )
}

function recipientName(award: BadgeAwardPublic): string {
  const { first_name, last_name, email } = award.recipient
  return [first_name, last_name].filter(Boolean).join(" ") || email
}

function RevokeButton({ award }: { award: BadgeAwardPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const revoke = useMutation({
    mutationFn: (reason: string | null) =>
      BadgesService.revokeBadgeAward({
        awardId: award.id,
        requestBody: { reason },
      }),
    onSuccess: () => {
      showSuccessToast("Badge removed")
      queryClient.invalidateQueries({ queryKey: ["badge-awards"] })
      queryClient.invalidateQueries({ queryKey: ["badges"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <LoadingButton
      size="sm"
      variant="ghost"
      loading={revoke.isPending}
      onClick={() => {
        const reason = window.prompt(
          `Remove "${award.badge.name}" from ${recipientName(award)}? Optionally say why.`,
          "",
        )
        if (reason === null) return
        revoke.mutate(reason.trim() || null)
      }}
    >
      <Undo2 className="h-4 w-4" />
      Remove
    </LoadingButton>
  )
}

/**
 * Awards of one badge (``show="recipient"``) or of one person
 * (``show="badge"``), newest first, with a remove action for operators.
 */
export function BadgeAwardsList({
  awards,
  show,
}: {
  awards: BadgeAwardPublic[]
  show: "recipient" | "badge"
}) {
  const { isOperatorOrAbove } = useAuth()

  return (
    <ul className="divide-y">
      {awards.map((award) => (
        <li key={award.id} className="flex items-start gap-3 py-3">
          <BadgeArt url={award.badge.image_url} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              {show === "badge" ? (
                <Link
                  to="/badges/$id"
                  params={{ id: award.badge.id }}
                  className="font-medium hover:underline"
                >
                  {award.badge.name}
                </Link>
              ) : (
                <Link
                  to="/humans/$id"
                  params={{ id: award.recipient.id }}
                  className="font-medium hover:underline"
                >
                  {recipientName(award)}
                </Link>
              )}
              {award.revoked_at && <Badge variant="secondary">Removed</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {new Date(award.awarded_at).toLocaleDateString()}
              {award.issuer_name ? ` · by ${award.issuer_name}` : ""}
            </p>
            {award.message && (
              <p className="text-sm text-muted-foreground">"{award.message}"</p>
            )}
            {award.revoked_at && award.revoke_reason && (
              <p className="text-xs text-muted-foreground">
                Removed: {award.revoke_reason}
              </p>
            )}
          </div>
          {isOperatorOrAbove && !award.revoked_at && (
            <RevokeButton award={award} />
          )}
        </li>
      ))}
    </ul>
  )
}
