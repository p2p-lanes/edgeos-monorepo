import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type PopupAppPublic, ThirdPartySsoService } from "@/client"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/** Independent admin save, not part of the HTML editor or its draft/version. */
export function PopupThirdPartyApps({ popupId }: { popupId: string }) {
  const client = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryKey = ["popup-third-party-apps", popupId]
  const {
    data: apps,
    isPending,
    isError,
  } = useQuery({
    queryKey,
    queryFn: () => ThirdPartySsoService.listPopupApps({ popupId }),
  })
  const mutation = useMutation({
    mutationFn: ({
      app_id,
      enabled,
    }: Pick<PopupAppPublic, "app_id" | "enabled">) =>
      ThirdPartySsoService.setPopupApp({
        popupId,
        appId: app_id,
        requestBody: { enabled },
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey })
      showSuccessToast("App access updated")
    },
    onError: createErrorHandler(showErrorToast),
  })
  const copy = async (app: PopupAppPublic) => {
    const anchor = document.createElement("a")
    anchor.setAttribute("href", app.launch_path)
    anchor.textContent = `Open ${app.name}`
    try {
      await navigator.clipboard.writeText(anchor.outerHTML)
      showSuccessToast("HTML link copied")
    } catch {
      showErrorToast("Could not copy the link")
    }
  }
  return (
    <section
      className="rounded-lg border p-4 space-y-3"
      aria-label="Third-party app access"
    >
      <div>
        <h3 className="text-sm font-semibold">Third-party app access</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Enabling an app preauthorizes automatic access for anyone who can view
          this home. Tokens keep the app's tenant-wide permissions. Changes save
          immediately.
        </p>
      </div>
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading apps…</p>
      ) : isError ? (
        <p className="text-sm text-destructive">Could not load apps.</p>
      ) : apps?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Register an app in Third-party Apps first.
        </p>
      ) : (
        apps?.map((app) => (
          <div
            key={app.app_id}
            className="flex flex-wrap items-center gap-3 border-t pt-3"
          >
            <Switch
              aria-label={`Enable ${app.name}`}
              checked={app.enabled}
              disabled={
                (!app.sso_configured && !app.enabled) || mutation.isPending
              }
              onCheckedChange={(enabled) =>
                mutation.mutate({ app_id: app.app_id, enabled })
              }
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{app.name}</p>
              <p className="text-xs text-muted-foreground">
                {app.sso_configured
                  ? app.launch_path
                  : "Configure both SSO URLs in Third-party Apps first."}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!app.enabled || !app.sso_configured}
              onClick={() => copy(app)}
            >
              Copy HTML link
            </Button>
          </div>
        ))
      )}
    </section>
  )
}
