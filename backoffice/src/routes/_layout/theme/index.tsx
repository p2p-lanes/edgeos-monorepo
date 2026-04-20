import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import { PopupsService } from "@/client"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { ThemeConfigForm } from "@/components/forms/ThemeConfigForm"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

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

function ThemePageContent({ popupId }: { popupId: string }) {
  const { data: popup, isLoading } = useQuery({
    queryKey: ["popups", popupId],
    queryFn: () => PopupsService.getPopup({ popupId }),
  })

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
          Colors, typography and radius for the {popup.name} portal and
          checkout flow.
        </p>
      </div>
      {/* Re-mount the form when the popup context changes so its internal
          useState snapshots take the new popup's theme_config. */}
      <ThemeConfigForm
        key={popup.id}
        popupId={popup.id}
        themeConfig={popup.theme_config as Record<string, unknown> | null}
        previewEvent={{
          name: popup.name,
          tagline: popup.tagline ?? null,
          location: popup.location ?? null,
          start_date: popup.start_date ?? null,
          end_date: popup.end_date ?? null,
          express_checkout_background: popup.express_checkout_background ?? null,
        }}
      />
    </div>
  )
}
