import { describe, expect, it } from "vitest"
import {
  clampAssistantPanelWidth,
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  storedAssistantPanelWidth,
} from "./panel-width"

describe("assistant panel width", () => {
  it("reserves usable application space after the sidebar", () => {
    expect(
      clampAssistantPanelWidth(680, {
        viewportWidth: 1400,
        applicationLeft: 250,
      }),
    ).toBe(590)
  })

  it("allows the configured maximum when enough space is available", () => {
    expect(
      clampAssistantPanelWidth(900, {
        viewportWidth: 1600,
        applicationLeft: 250,
      }),
    ).toBe(MAX_PANEL_WIDTH)
  })

  it("uses the default width when no preference has been stored", () => {
    expect(storedAssistantPanelWidth(null)).toBe(DEFAULT_PANEL_WIDTH)
    expect(storedAssistantPanelWidth("not-a-number")).toBe(DEFAULT_PANEL_WIDTH)
  })

  it("keeps the panel usable when the viewport cannot fit both minimums", () => {
    expect(
      clampAssistantPanelWidth(480, {
        viewportWidth: 1024,
        applicationLeft: 250,
      }),
    ).toBe(MIN_PANEL_WIDTH)
  })
})
