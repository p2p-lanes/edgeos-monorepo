"use client"

import { useState } from "react"
import {
  type CheckoutRuntimeProduct,
  type CheckoutRuntimeResponse,
  CouponsService,
  type ProductPublic,
} from "@/client"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { ApplicationContext } from "@/providers/applicationProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { CityContext } from "@/providers/cityProvider"
import { DiscountContext } from "@/providers/discountProvider"
import PassesProvider from "@/providers/passesProvider"
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
    attendee_category:
      (product.attendee_category as ProductPublic["attendee_category"]) ?? null,
    duration_type:
      (product.duration_type as ProductPublic["duration_type"]) ?? null,
    start_date:
      typeof product.start_date === "string" ? product.start_date : null,
    end_date: typeof product.end_date === "string" ? product.end_date : null,
    tier_group: product.tier_group ?? null,
    phase: product.phase ?? null,
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
    check_in_code: "",
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
      label: "Email",
      required: true,
      target: "human",
      position: 0,
    },
    first_name: {
      type: "text",
      label: "First name",
      required: true,
      target: "human",
      position: 1,
    },
    last_name: {
      type: "text",
      label: "Last name",
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
  const [discountApplied, setDiscountApplied] = useState<DiscountProps>({
    discount_value: 0,
    discount_type: "percentage",
    discount_code: null,
    city_id: runtime.popup.id,
  })

  const popup = runtime.popup
  const products = runtime.products.map(toProductsPass)
  const attendees = [buildVirtualBuyerAttendee(runtime)]
  const buyerFormSchema = buildOpenBuyerSchema(runtime)

  setActiveCurrency(popup.currency ?? "USD")

  return (
    <CityContext.Provider
      value={{
        getCity: () => popup,
        getPopups: () => [popup],
        setCityPreselected: () => {},
        popupsLoaded: true,
      }}
    >
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
              cartUiEnabled={false}
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
              <ScrollyCheckoutFlow />
            </CheckoutProvider>
          </PassesProvider>
        </DiscountContext.Provider>
      </ApplicationContext.Provider>
    </CityContext.Provider>
  )
}
