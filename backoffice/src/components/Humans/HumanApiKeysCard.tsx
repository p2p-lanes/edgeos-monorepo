import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { type ApiKeyPublic, type HumanPublic, HumansService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { LoadingButton } from "@/components/ui/loading-button"
import { Separator } from "@/components/ui/separator"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

function keyStatus(key: ApiKeyPublic): "Active" | "Revoked" | "Expired" {
  if (key.revoked_at) return "Revoked"
  if (key.expires_at && new Date(key.expires_at) <= new Date()) return "Expired"
  return "Active"
}

/** Human ID + API key history + the kill switch that revokes every active key. */
export function HumanApiKeysCard({ human }: { human: HumanPublic }) {
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: apiKeys = [] } = useQuery<ApiKeyPublic[]>({
    queryKey: ["humans", human.id, "api-keys"],
    queryFn: () => HumansService.listHumanApiKeys({ humanId: human.id }),
    enabled: isAdmin,
  })

  const revokeMutation = useMutation({
    mutationFn: () => HumansService.revokeHumanApiKeys({ humanId: human.id }),
    onSuccess: () => {
      showSuccessToast("All API keys revoked successfully")
      queryClient.invalidateQueries({ queryKey: ["humans", human.id] })
      queryClient.invalidateQueries({
        queryKey: ["humans", human.id, "api-keys"],
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-muted-foreground">Human ID</p>
        <p className="font-mono text-xs text-muted-foreground break-all">
          {human.id}
        </p>
      </div>

      {isAdmin && (
        <>
          <Separator />
          <div>
            <p className="text-sm text-muted-foreground">API keys</p>
            <p className="font-medium">
              {apiKeys.length === 0
                ? "No keys issued"
                : `${apiKeys.length} key${apiKeys.length === 1 ? "" : "s"}`}
            </p>
          </div>

          {apiKeys.length > 0 && (
            <div className="space-y-2">
              {apiKeys.map((key) => {
                const status = keyStatus(key)
                return (
                  <div
                    key={key.id}
                    className="space-y-1 rounded-md border p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        {key.name}
                      </span>
                      <Badge
                        variant={
                          status === "Active"
                            ? "default"
                            : status === "Revoked"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {status}
                      </Badge>
                    </div>
                    <div className="font-mono text-muted-foreground">
                      {key.prefix}…
                    </div>
                    <div className="text-muted-foreground">
                      Created: {new Date(key.created_at).toLocaleString()}
                    </div>
                    {key.last_used_at && (
                      <div className="text-muted-foreground">
                        Last used: {new Date(key.last_used_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <Separator />
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">API key kill switch</p>
              <p className="text-sm text-muted-foreground">
                Revoke every active API key for this human immediately.
              </p>
            </div>
            <LoadingButton
              type="button"
              variant="destructive"
              loading={revokeMutation.isPending}
              onClick={() => {
                const confirmed = window.confirm(
                  "Revoke all API keys for this human? Anything using those tokens will stop working immediately.",
                )
                if (!confirmed) return
                revokeMutation.mutate()
              }}
            >
              Revoke all API keys
            </LoadingButton>
          </div>
        </>
      )}
    </div>
  )
}
