import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useState } from "react"

import { BadgesService, type HumanPublic } from "@/client"
import { BadgeArt, BadgeAwardsList } from "@/components/Badges/BadgeAwardsList"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

function GiveBadgeDialog({
  human,
  heldIds,
  open,
  onOpenChange,
}: {
  human: HumanPublic
  /** Non-repeatable badges this person already holds. */
  heldIds: Set<string>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [badgeId, setBadgeId] = useState("")
  const [message, setMessage] = useState("")

  const { data: catalog } = useQuery({
    queryKey: ["badges", { limit: 200 }],
    queryFn: () => BadgesService.listBadges({ limit: 200 }),
    enabled: open,
  })
  const options = (catalog?.results ?? []).filter(
    (badge) => badge.repeatable || !heldIds.has(badge.id),
  )

  const give = useMutation({
    mutationFn: () =>
      BadgesService.awardBadge({
        badgeId,
        requestBody: {
          recipient_human_id: human.id,
          message: message.trim() || null,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Badge given")
      queryClient.invalidateQueries({ queryKey: ["badge-awards"] })
      queryClient.invalidateQueries({ queryKey: ["badges"] })
      setBadgeId("")
      setMessage("")
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Give a badge</DialogTitle>
          <DialogDescription>
            It shows up on their profile and their public link.
          </DialogDescription>
        </DialogHeader>
        {catalog && catalog.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There are no badges yet.{" "}
            <Link to="/badges/new" className="underline">
              Create one
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Badge</Label>
              <Select value={badgeId} onValueChange={setBadgeId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a badge" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((badge) => (
                    <SelectItem key={badge.id} value={badge.id}>
                      <span className="flex items-center gap-2">
                        <BadgeArt url={badge.image_url} className="h-5 w-5" />
                        {badge.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="badge-message">Message (optional)</Label>
              <Textarea
                id="badge-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Only they and admins can read it"
                rows={3}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            loading={give.isPending}
            disabled={!badgeId}
            onClick={() => give.mutate()}
          >
            Give badge
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The person's badges, with give/remove for operators. */
export function HumanBadgesCard({ human }: { human: HumanPublic }) {
  const { isOperatorOrAbove } = useAuth()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ["badge-awards", { humanId: human.id }],
    queryFn: () => BadgesService.listBadgeAwards({ humanId: human.id }),
  })
  const awards = data?.results ?? []
  const heldIds = new Set(
    awards.filter((a) => !a.badge.repeatable).map((a) => a.badge.id),
  )

  return (
    <div className="space-y-3">
      {awards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No badges yet.</p>
      ) : (
        <BadgeAwardsList awards={awards} show="badge" />
      )}
      {isOperatorOrAbove && (
        <>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Give badge
          </Button>
          <GiveBadgeDialog
            human={human}
            heldIds={heldIds}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      )}
    </div>
  )
}
