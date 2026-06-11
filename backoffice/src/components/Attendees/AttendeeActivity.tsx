import { useQuery } from "@tanstack/react-query"

import { AuditLogsService } from "@/client"
import { InlineSection } from "@/components/ui/inline-form"
import { Skeleton } from "@/components/ui/skeleton"
import { actorLabel, describeAuditAction } from "@/lib/auditMessage"

/**
 * History of audited admin actions for a single attendee (newest first).
 * Reads audit_logs filtered by entity_id so it shows ticket grants, swaps,
 * removals and any future attendee-scoped event.
 */
export function AttendeeActivity({ attendeeId }: { attendeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", { entityId: attendeeId }],
    queryFn: () =>
      AuditLogsService.listAuditLogs({ entityId: attendeeId, limit: 50 }),
  })

  const entries = data?.results ?? []

  return (
    <InlineSection title="Activity" className="px-6 py-4">
      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p>{describeAuditAction(entry)}</p>
              <p className="text-xs text-muted-foreground">
                {actorLabel(entry)} ·{" "}
                {new Date(entry.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </InlineSection>
  )
}
