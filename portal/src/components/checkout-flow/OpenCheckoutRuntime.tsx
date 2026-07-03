"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  type CheckoutRuntimeProduct,
  type CheckoutRuntimeResponse,
  CouponsService,
  type ProductPublic,
} from "@/client"
import FaviconOverride from "@/components/checkout-flow/FaviconOverride"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher"
import { trackGAViewItem } from "@/lib/google-analytics"
import { trackMetaViewContent } from "@/lib/meta-pixel"
import { queryKeys } from "@/lib/query-keys"
import { ApplicationContext } from "@/providers/applicationProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { CityContext } from "@/providers/cityProvider"
import { DiscountContext } from "@/providers/discountProvider"
import { LanguageProvider } from "@/providers/languageProvider"
import PassesProvider from "@/providers/passesProvider"
import ThemeProvider from "@/providers/themeProvider"
import type { AttendeePassState } from "@/types/Attendee"
import { setActiveCurrency } from "@/types/checkout"
import type { DiscountProps } from "@/types/discounts"
import type {
  ApplicationFormSchema,
  FormFieldSchema,
} from "@/types/form-schema"
import type { ProductsPass } from "@/types/Products"

interface OpenCheckoutRuntimeProps {
  runtime: CheckoutRuntimeResponse
  popupSlug: string
  prefilledBuyer?: {
    email?: string
    firstName?: string
    lastName?: string
  }
}

function toProductsPass(product: CheckoutRuntimeProduct): ProductsPass {
  return {
    ...product,
    price: Number(product.price),
    compare_price: product.compare_price ? Number(product.compare_price) : null,
    category: product.category ?? "ticket",
    duration_type:
      (product.duration_type as ProductPublic["duration_type"]) ?? null,
  }
}

function buildVirtualBuyerAttendee(
  runtime: CheckoutRuntimeResponse,
): AttendeePassState {
  const tenantId = runtime.products[0]?.tenant_id ?? ""

  return {
    id: `open-buyer-${runtime.popup.id}`,
    tenant_id: tenantId,
    popup_id: runtime.popup.id,
    human_id: null,
    application_id: null,
    name: "",
    category: "main",
    email: null,
    gender: null,
    poap_url: null,
    created_at: null,
    updated_at: null,
    products: [],
  }
}

function buildInitialBuyerValues(
  _formSchema: ApplicationFormSchema,
  prefilledBuyer: OpenCheckoutRuntimeProps["prefilledBuyer"],
) {
  if (!prefilledBuyer) {
    return {}
  }

  const values: Record<string, unknown> = {}
  if (prefilledBuyer.email) values.email = prefilledBuyer.email
  if (prefilledBuyer.firstName) values.first_name = prefilledBuyer.firstName
  if (prefilledBuyer.lastName) values.last_name = prefilledBuyer.lastName
  return values
}

function buildOpenBuyerSchema(
  runtime: CheckoutRuntimeResponse,
  t: (key: string) => string,
): ApplicationFormSchema {
  const runtimeFormSchema = (
    runtime as CheckoutRuntimeResponse & {
      form_schema?: ApplicationFormSchema | null
    }
  ).form_schema

  const baseFields: Record<string, FormFieldSchema> = {
    ...(runtimeFormSchema?.base_fields ?? {}),
    email: {
      type: "email",
      label: t("form.email"),
      required: true,
      target: "human",
      position: 0,
    },
    first_name: {
      type: "text",
      label: t("form.first_name"),
      required: true,
      target: "human",
      position: 1,
    },
    last_name: {
      type: "text",
      label: t("form.last_name"),
      required: true,
      target: "human",
      position: 2,
    },
  }

  return {
    base_fields: baseFields,
    custom_fields: runtimeFormSchema?.custom_fields ?? {},
    sections: runtimeFormSchema?.sections ?? [],
  }
}

export function OpenCheckoutRuntime({
  runtime,
  popupSlug,
  prefilledBuyer,
}: OpenCheckoutRuntimeProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const cartCid = searchParams.get("cid")
  const cartSig = searchParams.get("sig")
  const [discountApplied, setDiscountApplied] = useState<DiscountProps>({
    discount_value: 0,
    discount_type: "percentage",
    discount_code: null,
    city_id: runtime.popup.id,
  })

  const popup = runtime.popup

  // Seed the attendee-categories cache from the public runtime so the shared
  // checkout components read it from cache instead of calling the human-gated
  // /portal/popups/{id}/attendee-categories endpoint, which 401s for anonymous
  // buyers. Runs once, synchronously, before children mount, so the query
  // resolves from fresh cache with no network request.
  const queryClient = useQueryClient()
  const categoriesSeededRef = useRef(false)
  if (!categoriesSeededRef.current) {
    queryClient.setQueryData(
      queryKeys.attendeeCategories.byPopup(popup.id),
      runtime.attendee_categories ?? [],
    )
    categoriesSeededRef.current = true
  }

  const trackedViewContentRef = useRef<string | null>(null)
  const products = useMemo(
    () => runtime.products.map(toProductsPass),
    [runtime.products],
  )
  const attendees = useMemo(
    () => [buildVirtualBuyerAttendee(runtime)],
    [runtime],
  )
  const buyerFormSchema = useMemo(
    () => buildOpenBuyerSchema(runtime, t),
    [runtime, t],
  )

  setActiveCurrency(popup.currency ?? "USD")

  useEffect(() => {
    if (trackedViewContentRef.current === popup.id) return

    trackMetaViewContent({ popup, products: runtime.products })
    trackGAViewItem({ popup, products: runtime.products })
    trackedViewContentRef.current = popup.id
  }, [popup, runtime.products])

  return (
    <CityContext.Provider
      value={{
        getCity: () => popup,
        getPopups: () => [popup],
        setCityPreselected: () => {},
        popupsLoaded: true,
      }}
    >
      <ThemeProvider>
        <LanguageProvider>
          <ApplicationContext.Provider
            value={{
              applications: null,
              participation: null,
              getRelevantApplication: () => null,
              getAttendees: () => [],
              updateApplication: () => {},
            }}
          >
            <DiscountContext.Provider
              value={{
                discountApplied,
                setDiscount: (discount) => setDiscountApplied(discount),
                resetDiscount: () =>
                  setDiscountApplied({
                    discount_value: 0,
                    discount_type: "percentage",
                    discount_code: null,
                    city_id: popup.id,
                  }),
              }}
            >
              <PassesProvider
                attendees={attendees}
                restoreFromCart={false}
                productsOverride={products}
                purchasesOverride={[]}
              >
                <CheckoutProvider
                  initialStep="passes"
                  productsOverride={products}
                  configuredStepsOverride={runtime.ticketing_steps}
                  accountCreditOverride={0}
                  buyerFormSchema={buyerFormSchema}
                  initialBuyerValues={
                    buyerFormSchema
                      ? buildInitialBuyerValues(buyerFormSchema, prefilledBuyer)
                      : {}
                  }
                  cartPersistenceEnabled={false}
                  cartUiEnabled={true}
                  openCartPopupSlug={popupSlug}
                  openCartCid={cartCid}
                  openCartSig={cartSig}
                  validatePromoCodeOverride={async (code) => {
                    const result = await CouponsService.validateCouponPublic({
                      requestBody: {
                        popup_slug: popupSlug,
                        code,
                      },
                    })
                    return Number(result.discount_value)
                  }}
                  submitMode="open-ticketing"
                  submitPopupSlug={popupSlug}
                >
                  <FaviconOverride
                    url={
                      (popup as { favicon_url?: string | null }).favicon_url ??
                      null
                    }
                  />
                  <ScrollyCheckoutFlow
                    navExtraContent={<LanguageSwitcher compact />}
                    brandLogoUrl={
                      (popup as { icon_url?: string | null }).icon_url ?? null
                    }
                    brandLabel={popup.name}
                  />
                </CheckoutProvider>
              </PassesProvider>
            </DiscountContext.Provider>
          </ApplicationContext.Provider>
        </LanguageProvider>
      </ThemeProvider>
    </CityContext.Provider>
  )
}
