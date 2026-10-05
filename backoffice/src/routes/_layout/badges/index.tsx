import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Award, Palette, Plus, Repeat } from "lucide-react"
import { useState } from "react"

import { type BadgePublic, BadgesService } from "@/client"
import { BadgeArt } from "@/components/Badges/BadgeAwardsList"
import { BadgeStylesDialog } from "@/components/Badges/BadgeStylesDialog"
import { EmptyState } from "@/components/Common/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/badges/")({
  component: BadgesPage,
  head: () => ({
    meta: [{ title: "Badges - EdgeOS" }],
  }),
})

function BadgeCard({ badge }: { badge: BadgePublic }) {
  return (
    <Link to="/badges/$id" params={{ id: badge.id }} className="group">
      <Card className="h-full transition-colors group-hover:border-primary/40">
        <CardContent className="flex flex-col items-center gap-3 p-4 text-center">
          <BadgeArt url={badge.image_url} className="h-24 w-24" />
          <div className="space-y-1">
            <p className="font-medium leading-tight">{badge.name}</p>
            {badge.category && (
              <p className="text-xs text-muted-foreground">{badge.category}</p>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-1">
            <Badge variant="secondary">{badge.award_count} awarded</Badge>
            {badge.repeatable && (
              <Badge variant="outline" className="gap-1">
                <Repeat className="h-3 w-3" />
                Repeatable
              </Badge>
            )}
            {badge.archived_at && <Badge variant="outline">Archived</Badge>}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function BadgesGrid({
  search,
  includeArchived,
}: {
  search: string
  includeArchived: boolean
}) {
  const { isOperatorOrAbove } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ["badges", { search, includeArchived }],
    queryFn: () =>
      BadgesService.listBadges({
        search: search || undefined,
        includeArchived,
        limit: 200,
      }),
  })

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />

  if (data.results.length === 0) {
    return search ? (
      <p className="text-sm text-muted-foreground">No badges match.</p>
    ) : (
      <EmptyState
        icon={Award}
        title="No badges yet"
        description="Badges recognize what people do at your gatherings. Add a style, then create your first badge."
        action={
          isOperatorOrAbove ? (
            <Button asChild>
              <Link to="/badges/new">
                <Plus className="mr-2 h-4 w-4" />
                New badge
              </Link>
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {data.results.map((badge) => (
        <BadgeCard key={badge.id} badge={badge} />
      ))}
    </div>
  )
}

function BadgesPage() {
  const { isOperatorOrAbove } = useAuth()
  const { needsTenantSelection } = useWorkspace()
  const [stylesOpen, setStylesOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [includeArchived, setIncludeArchived] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Badges</h1>
          <p className="text-muted-foreground">
            Recognition people collect on their profile
          </p>
        </div>
        {isOperatorOrAbove && !needsTenantSelection && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStylesOpen(true)}>
              <Palette className="mr-2 h-4 w-4" />
              Styles
            </Button>
            <Button asChild>
              <Link to="/badges/new">
                <Plus className="mr-2 h-4 w-4" />
                New badge
              </Link>
            </Button>
          </div>
        )}
      </div>

      {needsTenantSelection ? (
        <p className="text-sm text-muted-foreground">
          Select an organization to manage its badges.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search badges..."
              className="max-w-xs"
            />
            <div className="flex items-center gap-2">
              <Switch
                id="include-archived"
                checked={includeArchived}
                onCheckedChange={setIncludeArchived}
              />
              <Label htmlFor="include-archived">Show archived</Label>
            </div>
          </div>
          <BadgesGrid search={search} includeArchived={includeArchived} />
        </>
      )}

      <BadgeStylesDialog open={stylesOpen} onOpenChange={setStylesOpen} />
    </div>
  )
}
