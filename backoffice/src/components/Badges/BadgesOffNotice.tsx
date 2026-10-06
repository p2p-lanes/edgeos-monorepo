import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Award } from "lucide-react"

import { PopupsService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

/**
 * Says so when the gathering being worked on has badges turned off, and
 * links to the switch. The catalog is per organization and can be set up
 * meanwhile; the gathering just won't use any of it until it's on.
 */
export function BadgesOffNotice({ className }: { className?: string }) {
  const { selectedPopupId } = useWorkspace()
  const { isAdmin } = useAuth()
  const { data: popup } = useQuery({
    queryKey: ["popups", selectedPopupId],
    queryFn: () => PopupsService.getPopup({ popupId: selectedPopupId ?? "" }),
    enabled: !!selectedPopupId,
  })

  if (!popup || popup.badges_enabled) return null

  return (
    <Alert className={cn("border-amber-500/50", className)}>
      <Award className="h-4 w-4" />
      <AlertTitle>Badges are off for {popup.name}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Turn them on in the gathering's Features so attendees can give badges,
          its check-ins count toward rules, and its portal shows badges and the
          public profile link. You can keep setting badges up here meanwhile.
        </p>
        {isAdmin && (
          <Button asChild size="sm" variant="outline">
            <Link
              to="/popups/$id/edit"
              params={{ id: popup.id }}
              search={{ tab: "features" }}
            >
              Turn on badges
            </Link>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
