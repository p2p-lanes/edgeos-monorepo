import "server-only"
import type {
  ApplicationPublic,
  AttendeeWithOriginPublic,
  CheckoutRuntimeResponse,
  PaymentPublic,
  PopupPublic,
  ProductPublic,
} from "@/client"
import { visiblePortalPopups } from "@/hooks/portalPopupList"
import { queryKeys } from "../query-keys"
import { sessionIdentity } from "../session-contract"
import type { PortalServerContext } from "./bootstrap"

export function prefetchPortalShell(context: PortalServerContext) {
  if (!context.snapshot.session) return Promise.resolve()
  const client = context.queryClient
  return Promise.all([
    client.prefetchQuery({
      queryKey: queryKeys.popups.portal(),
      queryFn: async () =>
        visiblePortalPopups(
          await context.api<PopupPublic[]>("/api/v1/popups/portal/list"),
        ),
    }),
    client.prefetchQuery({
      queryKey: queryKeys.applications.mine(),
      queryFn: async () =>
        (
          await context.api<{ results: ApplicationPublic[] }>(
            "/api/v1/applications/my/applications",
          )
        ).results,
    }),
  ])
}

export async function prefetchShop(
  context: PortalServerContext,
  popupSlug: string,
  flowSlug: string,
  language: string | null,
) {
  if (!context.snapshot.session) return null
  const client = context.queryClient
  const runtime = await client.fetchQuery({
    queryKey: queryKeys.checkout.runtime(
      popupSlug,
      flowSlug,
      language,
      sessionIdentity(context.snapshot.session),
    ),
    queryFn: () =>
      context.api<CheckoutRuntimeResponse>(
        `/api/v1/checkout/${encodeURIComponent(popupSlug)}/${encodeURIComponent(flowSlug)}/runtime`,
        language,
      ),
  })
  if (runtime.flow_type !== "application") return runtime
  const popupId = runtime.popup.id
  const flowId = runtime.selected_flow.id
  const application = client
    .getQueryData<ApplicationPublic[]>(queryKeys.applications.mine())
    ?.find((item) => item.sales_flow_id === flowId)
  client.setQueryData(["ticketing-steps-portal", popupId, flowId], {
    results: runtime.ticketing_steps,
  })
  if (runtime.attendee_categories)
    client.setQueryData(
      queryKeys.attendeeCategories.byPopup(popupId),
      [...runtime.attendee_categories].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      ),
    )
  await Promise.all([
    ...(application?.group_id
      ? [
          client.prefetchQuery({
            queryKey: queryKeys.groups.mine(),
            queryFn: async () =>
              (
                await context.api<{ results: unknown[] }>(
                  "/api/v1/groups/my/groups",
                )
              ).results,
          }),
        ]
      : []),
    client.prefetchQuery({
      queryKey: queryKeys.humanPopupAccess.byPopup(popupId),
      queryFn: () => context.api(`/api/v1/portal/popup/${popupId}/access`),
    }),
    client.prefetchQuery({
      queryKey: queryKeys.participation.byPopup(popupId),
      queryFn: () =>
        context.api(`/api/v1/applications/my/participation/${popupId}`),
    }),
    client.prefetchQuery({
      queryKey: queryKeys.attendees.byHumanPopup(popupId),
      queryFn: async () =>
        (
          await context.api<{ results: AttendeeWithOriginPublic[] }>(
            `/api/v1/attendees/my/popup/${popupId}`,
          )
        ).results,
    }),
    client.prefetchQuery({
      queryKey: queryKeys.products.byPopup(popupId, flowId),
      queryFn: async () =>
        (
          await context.api<{ results: ProductPublic[] }>(
            `/api/v1/products/portal/products?popup_id=${popupId}&sales_flow_id=${flowId}`,
            language,
          )
        ).results.map((product) => ({
          ...product,
          price: Number(product.price),
          compare_price: product.compare_price
            ? Number(product.compare_price)
            : null,
          category: product.category ?? "other",
        })),
    }),
    client.prefetchQuery({
      queryKey: queryKeys.cart.byPopup(popupId, flowId),
      queryFn: async () =>
        (
          await context.api<{ items: unknown } | null>(
            `/api/v1/carts/my/${popupId}?sales_flow_id=${flowId}`,
          )
        )?.items ?? {
          lines: [],
          recipients: [],
          promo_code: null,
          insurance: false,
          current_step: null,
        },
    }),
    client.prefetchQuery({
      queryKey: queryKeys.purchases.byPopup(popupId),
      queryFn: () =>
        context.api<{ results: PaymentPublic[] }>(
          `/api/v1/payments/my/popup/${popupId}`,
        ),
    }),
  ])
  return runtime
}
