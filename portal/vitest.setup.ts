import { vi } from "vitest"

// Provide a test-time fallback for the API URL env var.
// proxy.ts throws at module init if this is missing.
if (!process.env.NEXT_PUBLIC_API_URL) {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test"
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    value: vi.fn(),
    writable: true,
  })

  // jsdom implements `window.scrollTo` as a no-op stub but leaves
  // `Element.prototype.scrollTo` undefined entirely, so any component that
  // scrolls a container (the checkout stepper scrolls its nav to keep the
  // active pill in view) throws on render rather than in an assertion.
  Object.defineProperty(Element.prototype, "scrollTo", {
    value: vi.fn(),
    writable: true,
  })

  Object.defineProperty(window, "matchMedia", {
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
    writable: true,
  })
}

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "ResizeObserver", {
    value: ResizeObserverMock,
    writable: true,
  })
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: ResizeObserverMock,
  writable: true,
})
