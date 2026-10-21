import { afterEach, describe, expect, it, vi } from "vitest"

import { isMacPlatform, isSubmitShortcut } from "./useSubmitShortcut"

function keydown(
  overrides: Partial<{
    key: string
    metaKey: boolean
    ctrlKey: boolean
    isComposing: boolean
  }> = {},
) {
  const { isComposing = false, ...rest } = overrides
  return {
    key: "Enter",
    metaKey: false,
    ctrlKey: false,
    ...rest,
    nativeEvent: { isComposing } as KeyboardEvent,
  }
}

describe("isSubmitShortcut", () => {
  it("matches Ctrl+Enter and Cmd+Enter", () => {
    expect(isSubmitShortcut(keydown({ ctrlKey: true }))).toBe(true)
    expect(isSubmitShortcut(keydown({ metaKey: true }))).toBe(true)
  })

  it("ignores plain Enter so it stays a newline", () => {
    expect(isSubmitShortcut(keydown())).toBe(false)
  })

  it("ignores other keys with the modifier", () => {
    expect(isSubmitShortcut(keydown({ key: "a", ctrlKey: true }))).toBe(false)
  })

  it("ignores the chord while an IME composition is active", () => {
    expect(
      isSubmitShortcut(keydown({ ctrlKey: true, isComposing: true })),
    ).toBe(false)
  })
})

describe("isMacPlatform", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("detects macOS from the user agent", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    })
    expect(isMacPlatform()).toBe(true)
  })

  it("is false elsewhere", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    })
    expect(isMacPlatform()).toBe(false)
  })
})
