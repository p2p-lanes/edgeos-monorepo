import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Palette } from "lucide-react"
import { useState } from "react"

import { PopupsService, SalesFlowsService } from "@/client"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { ThemeConfigForm } from "@/components/forms/ThemeConfigForm"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { salesFlowsQueryKey } from "@/lib/salesFlowQueries"

export const Route = createFileRoute("/_layout/theme/")({
  component: ThemePage,
  head: () => ({
    meta: [{ title: "Theme - EdgeOS" }],
  }),
})

function ThemePage() {
  const { isAdmin } = useAuth()
  const { isContextReady, selectedPopupId } = useWorkspace()

  if (!isContextReady) {
    return (
      <div className="flex flex-col gap-6">
        <WorkspaceAlert resource="theme" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="text-2xl font-bold tracking-tight">Theme</h1>
        <p className="text-muted-foreground">
          You need admin permissions to edit the theme.
        </p>
      </div>
    )
  }

  return <ThemePageContent popupId={selectedPopupId!} />
}

const GATHERING = "__gathering__"

function ThemePageContent({ popupId }: { popupId: string }) {
  // What is being restyled. A flow chooses how its checkout looks; the
  // gathering's own theme still dresses its portal pages, where no flow is
  // in scope. Two surfaces, two owners — so both stay editable here and
  // neither falls back to the other.
  const [scope, setScope] = useState<string>(GATHERING)

  const { data: popup, isLoading } = useQuery({
    queryKey: ["popups", popupId],
    queryFn: () => PopupsService.getPopup({ popupId }),
  })

  const { data: flowsData } = useQuery({
    queryKey: salesFlowsQueryKey(popupId),
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId, limit: 100 }),
  })
  const flows = flowsData?.results ?? []
  const activeFlow = flows.find((f) => f.id === scope)

  if (isLoading || !popup) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Theme</h1>
        <p className="text-muted-foreground">
          {activeFlow
            ? `Colors, typography and radius for the ${activeFlow.name} checkout.`
            : `Colors, typography and radius for the ${popup.name} portal pages.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <Palette className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger
            className="h-8 w-64 bg-background"
            aria-label="Theme scope"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GATHERING}>Gathering portal pages</SelectItem>
            {flows.map((flow) => (
              <SelectItem key={flow.id} value={flow.id}>
                {flow.name} checkout
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          Each flow's checkout has its own look. Changing one never changes
          another.
        </p>
      </div>
      {/* Re-mount the form when the popup context changes so its internal
          useState snapshots take the new popup's theme_config. */}
      <ThemeConfigForm
        key={activeFlow?.id ?? popup.id}
        popupId={popup.id}
        salesFlowId={activeFlow?.id}
        themeConfig={
          (activeFlow?.theme_config ?? popup.theme_config) as Record<
            string,
            unknown
          > | null
        }
        previewEvent={{
          name: popup.name,
          tagline: popup.tagline ?? null,
          location: popup.location ?? null,
          start_date: popup.start_date ?? null,
          end_date: popup.end_date ?? null,
          express_checkout_background:
            popup.express_checkout_background ?? null,
        }}
      />
    </div>
  )
}
