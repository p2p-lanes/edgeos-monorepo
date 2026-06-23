import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import { type HumanActivityItem, HumansService } from "@/client"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { describeHumanActivity } from "@/lib/humanActivityMessage"
import { HumanActivityDialog } from "./HumanActivityDialog"

/** Kinds performed by a backoffice user — these carry an actor to credit. */
const ACTOR_KINDS = new Set<HumanActivityItem["kind"]>([
  "note.added",
  "rating.changed",
  "comment.added",
])

/** Colour the timeline dot by event kind (rating dots match their flag). */
function dotClass(item: HumanActivityItem): string {
  if (item.kind === "rating.changed") {
    switch (item.rating) {
      case "red_flag":
        return "bg-red-500"
      case "orange_flag":
        return "bg-orange-500"
      case "green_flag":
        return "bg-green-500"
      case "star":
        return "bg-yellow-400"
      default:
        return "bg-muted-foreground"
    }
  }
  switch (item.kind) {
    case "payment.completed":
      return "bg-green-500"
    case "application.accepted":
      return "bg-blue-500"
    case "comment.added":
      return "bg-sky-500"
    default:
      return "bg-muted-foreground"
  }
}

/**
 * Full activity timeline for a single human (newest first): applications,
 * purchases, tickets and manual notes, aggregated on the backend. Admins can
 * add a manual past-dated note via the header button.
 */
export function HumanActivity({ humanId }: { humanId: string }) {
  const { isAdmin } = useAuth()
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["human-activity", humanId],
    queryFn: () => HumansService.getHumanActivity({ humanId, limit: 50 }),
  })

  const items = data?.results ?? []

  return (
    <div className="space-y-3 px-6 py-4">
      <div className="flex items-center justify-between">
        <h3 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Activity
        </h3>
        {isAdmin && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add activity
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="relative ml-2 border-l border-border">
          {items.map((item) => {
            const actor = item.actor_name || item.actor_email
            return (
              <li key={item.id} className="relative py-3 pl-6 text-sm">
                <span
                  className={`absolute -left-[5px] top-4 h-2.5 w-2.5 rounded-full border-2 border-background ${dotClass(item)}`}
                />
                <p>{describeHumanActivity(item)}</p>
                <p className="text-xs text-muted-foreground">
                  {ACTOR_KINDS.has(item.kind) && actor ? `${actor} · ` : ""}
                  {new Date(item.occurred_at).toLocaleString()}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {isAdmin && (
        <HumanActivityDialog
          humanId={humanId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </div>
  )
}
