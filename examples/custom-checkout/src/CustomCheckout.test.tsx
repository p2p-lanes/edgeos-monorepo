// Smoke test for the reference checkout: drives the whole flow (select →
// preview → buyer → pay → checkout url) against a fake transport. Doubles as
// proof that the example — and thus the SDK's public surface — actually works
// end to end from a consumer's point of view.

import {
  CheckoutProvider,
  type CheckoutRuntimeResponse,
  type Transport,
} from "@edgeos/checkout-react"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CustomCheckout } from "./CustomCheckout"

function runtime(): CheckoutRuntimeResponse {
  return {
    popup: { id: "pop1", slug: "my-event", name: "My Event", currency: "USD" },
    products: [
      {
        tenant_id: "t",
        popup_id: "pop1",
        id: "p1",
        name: "General Admission",
        slug: "ga",
        price: "100",
        category: "ticket",
        currency: "USD",
        is_active: true,
      },
    ],
    buyer_form: [],
    ticketing_steps: [
      { id: "s1", tenant_id: "t", popup_id: "pop1", step_type: "tickets", title: "Tickets" },
      { id: "s2", tenant_id: "t", popup_id: "pop1", step_type: "buyer", title: "Buyer" },
      { id: "s3", tenant_id: "t", popup_id: "pop1", step_type: "confirm", title: "Confirm" },
    ],
    form_schema: {
      base_fields: {
        email: { type: "text", label: "Email", required: true },
        first_name: { type: "text", label: "First name", required: true },
        last_name: { type: "text", label: "Last name", required: true },
      },
      custom_fields: {},
    },
  }
}

/** Fake transport standing in for the EdgeOS API. */
function fakeTransport(): Transport {
  return {
    request: (async (_method: string, path: string, body?: unknown) => {
      if (path.endsWith("/preview")) {
        const qty =
          (body as { products: { quantity: number }[] }).products[0]
            ?.quantity ?? 0
        const total = (100 * qty).toFixed(2)
        return {
          lines: [],
          discountable_amount: total,
          non_discountable_amount: "0",
          discount_amount: "0",
          post_discount_amount: total,
          insurance_amount: "0",
          contribution_amount: "0",
          total,
          currency: "USD",
        }
      }
      if (path.endsWith("/purchase")) {
        return {
          payment_id: "pay-1",
          status: "pending",
          checkout_url: "https://simplefi.test/checkout/ref",
          redirect_url: null,
          amount: "200.00",
          currency: "USD",
        }
      }
      if (path.endsWith("/cart")) {
        return { id: "cart-1", popup_id: "pop1", email: "", items: {}, restore_token: "t" }
      }
      return {}
    }) as Transport["request"],
  }
}

function renderExample(onCheckoutUrl: (u: string) => void) {
  return render(
    <CheckoutProvider
      slug="my-event"
      baseUrl="https://api/api/v1"
      transport={fakeTransport()}
      initialRuntime={runtime()}
    >
      <CustomCheckout onCheckoutUrl={onCheckoutUrl} />
    </CheckoutProvider>,
  )
}

describe("CustomCheckout (reference example)", () => {
  it("runs the full select → preview → buyer → pay flow", async () => {
    const onCheckoutUrl = vi.fn()
    renderExample(onCheckoutUrl)

    // Product renders from the runtime.
    await screen.findByText(/General Admission/)

    // Add 2 tickets → the server-authoritative total appears.
    fireEvent.click(screen.getByLabelText("increase General Admission"))
    fireEvent.click(screen.getByLabelText("increase General Admission"))
    await waitFor(() =>
      expect(screen.getByTestId("total").textContent).toBe("200.00"),
    )

    // Continue to the buyer step.
    fireEvent.click(screen.getByText("Continue"))
    await screen.findByText("Your information")

    // Fill buyer info.
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "buyer@acme.example" },
    })
    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Ada" },
    })
    fireEvent.change(screen.getByLabelText("Last name"), {
      target: { value: "Lovelace" },
    })

    // Pay → the SDK returns a checkout URL, which the example hands to the redirect.
    await act(async () => {
      fireEvent.click(screen.getByText("Pay"))
    })
    await waitFor(() =>
      expect(onCheckoutUrl).toHaveBeenCalledWith(
        "https://simplefi.test/checkout/ref",
      ),
    )
  })
})
