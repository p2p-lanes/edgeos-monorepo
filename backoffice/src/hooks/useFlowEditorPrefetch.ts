import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo, useRef } from "react"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { prefetchFlowEditor } from "@/lib/flowEditorPrefetch"
import type { FlowEditorScope } from "@/lib/salesFlowQueries"
import useAuth from "./useAuth"

export function useFlowEditorPrefetch() {
  const { selectedPopupId, effectiveTenantId, isContextReady } = useWorkspace()
  const { user, isOperatorOrAbove } = useAuth()
  const queryClient = useQueryClient()
  const currentScope = useRef<FlowEditorScope | undefined>(undefined)
  const token = localStorage.getItem("access_token")
  const ambientTenant = localStorage.getItem("workspace_tenant_id")
  const ambientPopup = localStorage.getItem("workspace_popup_id")
  const scope = useMemo(() => {
    if (
      !isContextReady ||
      !selectedPopupId ||
      !effectiveTenantId ||
      !user?.id ||
      !isOperatorOrAbove ||
      !token
    )
      return undefined
    const captured: FlowEditorScope = {
      tenantId: effectiveTenantId,
      popupId: selectedPopupId,
      isCurrent: () =>
        currentScope.current === captured &&
        localStorage.getItem("access_token") === token &&
        localStorage.getItem("workspace_tenant_id") === ambientTenant &&
        localStorage.getItem("workspace_popup_id") === ambientPopup,
    }
    return captured
  }, [
    selectedPopupId,
    effectiveTenantId,
    isContextReady,
    user?.id,
    isOperatorOrAbove,
    token,
    ambientTenant,
    ambientPopup,
  ])
  currentScope.current = scope
  const prefetch = useCallback(
    (destination: string, flowId?: string, popupId?: string) => {
      void prefetchFlowEditor(queryClient, scope, destination, flowId, popupId)
    },
    [queryClient, scope],
  )
  return { scope, prefetch }
}
