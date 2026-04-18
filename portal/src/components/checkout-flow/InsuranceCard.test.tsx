/**
 * Tests for InsuranceCard props customization (A.8).
 *
 * Verifies that:
 * - Custom props (title, subtitle, toggleLabel, benefits) are rendered when passed
 * - Default values from INSURANCE_BENEFITS constant are used when props are omitted
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import InsuranceCard from "./InsuranceCard"

// framer-motion requires mocking in tests (no browser animation context)
// Strip framer-motion-specific props to silence React DOM warnings in tests
const MOTION_PROPS = new Set([
  "animate",
  "initial",
  "exit",
  "transition",
  "whileHover",
  "whileTap",
  "layout",
  "variants",
  "custom",
])

function stripMotionProps<T extends Record<string, unknown>>(props: T) {
  return Object.fromEntries(
    Object.entries(props).filter(([k]) => !MOTION_PROPS.has(k)),
  )
}

vi.mock("framer-motion", () => ({
  motion: {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    div: ({ children, className, ...rest }: any) => (
      <div className={className} {...stripMotionProps(rest)}>
        {children}
      </div>
    ),
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    span: ({ children, className, ...rest }: any) => (
      <span className={className} {...stripMotionProps(rest)}>
        {children}
      </span>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

const defaultProps = {
  insurance: false,
  price: 1000,
  onToggle: vi.fn(),
}

describe("InsuranceCard", () => {
  describe("default values", () => {
    it("renders default title 'Insurance' when title prop is omitted", () => {
      render(<InsuranceCard {...defaultProps} />)
      const heading = screen.queryByRole("heading", { name: "Insurance" })
      expect(heading).not.toBeNull()
    })

    it("renders default subtitle when subtitle prop is omitted", () => {
      render(<InsuranceCard {...defaultProps} />)
      const subtitle = screen.queryByText(/Change of plans coverage/)
      expect(subtitle).not.toBeNull()
    })

    it("renders toggle with default aria-label when toggleLabel is omitted", () => {
      render(<InsuranceCard {...defaultProps} />)
      const toggle = screen.queryByRole("switch", { name: "Toggle insurance" })
      expect(toggle).not.toBeNull()
    })

    it("renders default INSURANCE_BENEFITS when benefits prop is omitted", () => {
      render(<InsuranceCard {...defaultProps} />)
      expect(
        screen.queryByText("Full refund up to 14 days before the event"),
      ).not.toBeNull()
      expect(
        screen.queryByText("50% refund up to 7 days before"),
      ).not.toBeNull()
      expect(
        screen.queryByText("Free date change at no extra cost"),
      ).not.toBeNull()
    })
  })

  describe("custom props", () => {
    it("renders custom title when title prop is provided", () => {
      render(<InsuranceCard {...defaultProps} title="Reembolso Total" />)
      expect(
        screen.queryByRole("heading", { name: "Reembolso Total" }),
      ).not.toBeNull()
      expect(screen.queryByRole("heading", { name: "Insurance" })).toBeNull()
    })

    it("renders custom subtitle when subtitle prop is provided", () => {
      render(
        <InsuranceCard {...defaultProps} subtitle="Cobertura personalizada" />,
      )
      expect(screen.queryByText(/Cobertura personalizada/)).not.toBeNull()
      expect(screen.queryByText(/Change of plans coverage/)).toBeNull()
    })

    it("renders custom toggleLabel as aria-label when toggleLabel prop is provided", () => {
      render(<InsuranceCard {...defaultProps} toggleLabel="Agregar seguro" />)
      expect(
        screen.queryByRole("switch", { name: "Agregar seguro" }),
      ).not.toBeNull()
      expect(
        screen.queryByRole("switch", { name: "Toggle insurance" }),
      ).toBeNull()
    })

    it("renders custom benefits when benefits prop is provided", () => {
      const customBenefits = ["Benefit A", "Benefit B"]
      render(<InsuranceCard {...defaultProps} benefits={customBenefits} />)
      expect(screen.queryByText("Benefit A")).not.toBeNull()
      expect(screen.queryByText("Benefit B")).not.toBeNull()
      // Default benefits should not appear
      expect(
        screen.queryByText("Full refund up to 14 days before the event"),
      ).toBeNull()
    })

    it("renders all custom props together", () => {
      render(
        <InsuranceCard
          {...defaultProps}
          title="Custom Title"
          subtitle="Custom Subtitle"
          toggleLabel="Custom Toggle"
          benefits={["Benefit X"]}
        />,
      )
      expect(
        screen.queryByRole("heading", { name: "Custom Title" }),
      ).not.toBeNull()
      expect(screen.queryByText(/Custom Subtitle/)).not.toBeNull()
      expect(
        screen.queryByRole("switch", { name: "Custom Toggle" }),
      ).not.toBeNull()
      expect(screen.queryByText("Benefit X")).not.toBeNull()
    })
  })
})
