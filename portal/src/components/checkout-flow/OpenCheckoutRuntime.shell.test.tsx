import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { PopupPublic } from "@/client"
import { resolveCheckoutShell } from "@/lib/checkout-shell"

// The runtime renders StepperCheckoutFlow iff resolveCheckoutShell(popup) === "stepper".
// This test locks that contract at the decision boundary (the render wiring is
// exercised by the app; the branch logic is what can regress).
function ShellSwitch({ popup }: { popup: PopupPublic }) {
  return resolveCheckoutShell(popup) === "stepper" ? (
    <div>stepper-flow</div>
  ) : (
    <div>scrolly-flow</div>
  )
}

describe("OpenCheckoutRuntime shell selection", () => {
  it("selects stepper when theme_config.checkout_shell is stepper", () => {
    render(
      <ShellSwitch
        popup={
          {
            theme_config: { checkout_shell: "stepper" },
          } as unknown as PopupPublic
        }
      />,
    )
    expect(screen.getByText("stepper-flow")).toBeTruthy()
  })

  it("selects scrolly by default", () => {
    render(
      <ShellSwitch popup={{ theme_config: {} } as unknown as PopupPublic} />,
    )
    expect(screen.getByText("scrolly-flow")).toBeTruthy()
  })
})
