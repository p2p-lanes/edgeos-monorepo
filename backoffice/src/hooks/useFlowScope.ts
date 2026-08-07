import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { type SalesFlowPublic, SalesFlowsService } from "@/client"

const STORAGE_KEY = "edgeos.flow-scope"

/**
 * Which sales flow a flow-scoped page is showing.
 *
 * The answer lives in the URL, so a link to "the form of Volunteers" means
 * the same thing to everyone who opens it. Memory only fills the gap: it
 * decides where you land when a URL says nothing, so moving between
 * sections does not ask the same question again.
 *
 * Stored per gathering. Two gatherings have different flows, and carrying
 * one's choice into the other would resolve to a flow that is not there.
 */
function readRemembered(popupId: string): string | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    return (JSON.parse(raw) as Record<string, string>)[popupId]
  } catch {
    return undefined
  }
}

/**
 * Persist the choice without navigating. For pages whose flow switch does
 * more than change the URL — clearing a selection that belonged to the
 * previous flow, for instance.
 */
export function rememberFlow(popupId: string, flowId: string): void {
  if (typeof window === "undefined") return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    map[popupId] = flowId
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // A browser that refuses storage costs the operator a re-pick, not the page.
  }
}

interface UseFlowScopeResult {
  flows: SalesFlowPublic[]
  /** The flow on screen. Undefined only while the list is still loading. */
  activeFlow: SalesFlowPublic | undefined
  activeFlowId: string | undefined
  isLoading: boolean
  /** Call when the operator picks a different flow. Persists the choice. */
  selectFlow: (flowId: string) => void
}

/**
 * @param popupId  The selected gathering.
 * @param urlFlowId  The `flow` search param of the current route.
 * @param onFlowResolved  Called when the page should adopt a flow the URL did
 *   not name — the route owns navigation, so it writes the param itself.
 */
export function useFlowScope(
  popupId: string | undefined,
  urlFlowId: string | undefined,
  onFlowResolved?: (flowId: string) => void,
): UseFlowScopeResult {
  const { data, isLoading } = useQuery({
    queryKey: ["sales-flows", { popupId }],
    queryFn: () =>
      SalesFlowsService.listSalesFlows({ popupId: popupId!, limit: 100 }),
    enabled: !!popupId,
  })

  const flows = data?.results ?? []
  // A URL naming a flow of another gathering must not win. Falling through
  // to the remembered or default flow keeps the page showing something real.
  const fromUrl = flows.find((f) => f.id === urlFlowId)
  const remembered = popupId
    ? flows.find((f) => f.id === readRemembered(popupId))
    : undefined
  const fallback = flows.find((f) => f.is_default) ?? flows[0]
  const activeFlow = fromUrl ?? remembered ?? fallback

  useEffect(() => {
    if (!activeFlow || activeFlow.id === urlFlowId) return
    onFlowResolved?.(activeFlow.id)
  }, [activeFlow, urlFlowId, onFlowResolved])

  const selectFlow = (flowId: string) => {
    if (popupId) rememberFlow(popupId, flowId)
    onFlowResolved?.(flowId)
  }

  return {
    flows,
    activeFlow,
    activeFlowId: activeFlow?.id,
    isLoading,
    selectFlow,
  }
}
