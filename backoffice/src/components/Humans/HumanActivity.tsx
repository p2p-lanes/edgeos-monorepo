import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import { HumansService } from "@/client"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { describeHumanActivity } from "@/lib/humanActivityMessage"
import { HumanActivityDialog } from "./HumanActivityDialog"

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
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="py-3 text-sm">
              <p>{describeHumanActivity(item)}</p>
              <p className="text-xs text-muted-foreground">
                {item.kind === "note.added" && item.actor_name
                  ? `${item.actor_name} · `
                  : ""}
                {new Date(item.occurred_at).toLocaleString()}
              </p>
            </li>
          ))}
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
