import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { downloadQrPng } from "./qr-download"

/**
 * jsdom has no canvas or SVG rasterizer, so the pieces this helper leans on
 * are stubbed and the assertions are about what it asks the browser to do:
 * the quiet zone, the opaque background, the filename, and cleaning up the
 * object URL. The pixels themselves are the browser's job.
 */

let context: {
  fillStyle: string
  fillRect: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
}
let canvas: HTMLCanvasElement
let clicked: HTMLAnchorElement[]

const createObjectURL = vi.fn(() => "blob:qr")
const revokeObjectURL = vi.fn()

function renderQrSvg(): HTMLElement {
  const container = document.createElement("div")
  container.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176" viewBox="0 0 29 29"><path d="M 0 0" /></svg>'
  return container
}

beforeEach(() => {
  clicked = []
  context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  }

  const realCreateElement = document.createElement.bind(document)
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const element = realCreateElement(tag)
    if (tag === "canvas") {
      canvas = element as HTMLCanvasElement
      canvas.getContext = vi.fn(
        () => context,
      ) as unknown as typeof canvas.getContext
      canvas.toDataURL = vi.fn(() => "data:image/png;base64,QQ==")
    }
    if (tag === "a") {
      const anchor = element as HTMLAnchorElement
      anchor.click = vi.fn(() => {
        clicked.push(anchor)
      })
    }
    return element
  })

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  })

  // The stub resolves the load on the next tick, the way a real decode would.
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

describe("downloadQrPng", () => {
  it("saves the code under the given filename", async () => {
    await downloadQrPng(renderQrSvg(), "event-check-in-abc.png")

    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe("event-check-in-abc.png")
    expect(clicked[0].href).toBe("data:image/png;base64,QQ==")
  })

  it("surrounds the code with a quiet zone so readers can find it", async () => {
    await downloadQrPng(renderQrSvg(), "qr.png")

    // drawImage(image, dx, dy, dWidth, dHeight): the code is inset by the
    // margin on every side, and the canvas is exactly that much larger.
    const [, offsetX, offsetY, codeWidth] = context.drawImage.mock.calls[0]
    expect(offsetX).toBeGreaterThan(0)
    expect(offsetX).toBe(offsetY)
    expect(canvas.width).toBe(canvas.height)
    expect(canvas.width).toBe(codeWidth + offsetX * 2)
  })

  it("paints an opaque white ground so a dark slide can't invert it", async () => {
    await downloadQrPng(renderQrSvg(), "qr.png")

    expect(context.fillStyle).toBe("#ffffff")
    expect(context.fillRect).toHaveBeenCalledWith(
      0,
      0,
      canvas.width,
      canvas.height,
    )
  })

  it("exports at print size, not at the size it renders on screen", async () => {
    await downloadQrPng(renderQrSvg(), "qr.png")

    const [, , , codeWidth, codeHeight] = context.drawImage.mock.calls[0]
    expect(codeWidth).toBeGreaterThanOrEqual(1024)
    expect(codeHeight).toBe(codeWidth)
  })

  it("releases the object URL once the file is handed over", async () => {
    await downloadQrPng(renderQrSvg(), "qr.png")

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:qr")
  })

  it("rejects when there is no QR to save", async () => {
    await expect(downloadQrPng(null, "qr.png")).rejects.toThrow()
    await expect(
      downloadQrPng(document.createElement("div"), "qr.png"),
    ).rejects.toThrow()
  })
})
