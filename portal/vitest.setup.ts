import { vi } from "vitest"

// Provide a test-time fallback for the API URL env var.
// proxy.ts throws at module init if this is missing.
if (!process.env.NEXT_PUBLIC_API_URL) {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test"
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

if (typeof window !== "undefined") {
  const localStorage = createMemoryStorage()

  Object.defineProperty(globalThis, "localStorage", {
    value: localStorage,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, "localStorage", {
    value: localStorage,
    configurable: true,
  })

  Object.defineProperty(window, "scrollTo", {
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
