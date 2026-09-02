import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight, Users } from "lucide-react"
import { useState } from "react"

import { ApplicationsService } from "@/client"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"

const PAGE_SIZE = 10

interface SourceApplicationsSectionProps {
  popupId: string
  source: "invite" | "referral"
  sourceId: string
}

export function SourceApplicationsSection({
  popupId,
  source,
  sourceId,
}: SourceApplicationsSectionProps) {
  const [page, setPage] = useState(0)
  const filters = JSON.stringify({
    match: "all",
    conditions: [{ field: `${source}_id`, op: "eq", value: sourceId }],
  })
  const { data, isLoading, isError } = useQuery({
    queryKey: ["applications", "source", source, sourceId, page],
    queryFn: () =>
      ApplicationsService.listApplications({
        popupId,
        filters,
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
  })

  const applications = data?.results ?? []
  const total = data?.paging.total ?? 0

  return (
    <section
      className="mx-auto max-w-2xl space-y-3"
      aria-labelledby="source-applications-heading"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2
            id="source-applications-heading"
            className="flex items-center gap-2 text-sm font-medium"
          >
            <Users className="size-4 text-muted-foreground" />
            Applications
          </h2>
          <p className="text-xs text-muted-foreground">
            People who applied using this {source}
          </p>
        </div>
        {!isLoading && !isError && (
          <span className="font-mono text-xs text-muted-foreground">
            {total}
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-md border">
        {isLoading && (
          <p className="p-4 text-sm text-muted-foreground">
            Loading applications...
          </p>
        )}
        {isError && (
          <p className="p-4 text-sm text-destructive">
            Unable to load applications.
          </p>
        )}
        {!isLoading && !isError && applications.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            No applications used this {source}.
          </p>
        )}
        {applications.map((application) => {
          const human = application.human
          const name = [human?.first_name, human?.last_name]
            .filter(Boolean)
            .join(" ")
          return (
            <Link
              key={application.id}
              to="/applications/$id"
              params={{ id: application.id }}
              className="group flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/40"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {name || human?.email || application.id}
                </p>
                {human?.email && human.email !== name && (
                  <p className="truncate text-xs text-muted-foreground">
                    {human.email}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={application.status} />
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          )
        })}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  )
}
