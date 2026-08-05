import { ExternalLink } from "lucide-react"

import type { SalesFlowPublic, SalesFlowType } from "@/client"
import { CopyLinkButton } from "@/components/Common/CopyLinkButton"
import { Button } from "@/components/ui/button"
import { getPopupCheckoutUrl, getPopupPortalUrl } from "@/lib/portal-urls"

type FlowUrlInfo = Pick<SalesFlowPublic, "slug"> & { type?: SalesFlowType }

/**
 * The portal URL where a flow is actually reachable (sales-flows D6 URL
 * scheme). Application flows never get a dedicated URL - buyers land on the
 * event's application entry point and pick a flow there when more than one
 * is listed.
 */
export function getSalesFlowUrl(
  portalBaseUrl: string,
  popupSlug: string,
  flow: FlowUrlInfo,
): string {
  if (flow.type === "application") {
    return `${getPopupPortalUrl(portalBaseUrl, popupSlug)}/application`
  }
  return `${getPopupCheckoutUrl(portalBaseUrl, popupSlug)}/${flow.slug}`
}

interface SalesFlowUrlCardProps {
  portalBaseUrl: string | null
  popupSlug: string | undefined
  flow: FlowUrlInfo
}

export function SalesFlowUrlCard({
  portalBaseUrl,
  popupSlug,
  flow,
}: SalesFlowUrlCardProps) {
  const url =
    portalBaseUrl && popupSlug
      ? getSalesFlowUrl(portalBaseUrl, popupSlug, flow)
      : null
  const isApplication = flow.type === "application"

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {isApplication ? "Application entry URL" : "Flow URL"}
          </p>
          <p className="truncate text-sm" title={url ?? undefined}>
            {url ?? "Set a portal domain for this organization to get a link"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CopyLinkButton url={url} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open link"
            disabled={!url}
            asChild={!!url}
          >
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      {isApplication && (
        <p className="mt-2 text-xs text-muted-foreground">
          Applicants pick this flow from the portal's flow picker when more than
          one application flow is listed for this event.
        </p>
      )}
    </div>
  )
}
