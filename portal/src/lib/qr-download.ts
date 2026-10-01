/**
 * Save a rendered `react-qr-code` SVG as a PNG.
 *
 * The on-screen QR is an inline <svg>, which a right-click "save image as"
 * won't reliably produce a file from and which can't be pasted into a slide
 * or a printed sign. This rasterizes it instead, at a size that survives
 * being projected or printed rather than at the small size it renders at.
 *
 * Two details that decide whether the result actually scans:
 *  - a white quiet zone around the code. react-qr-code's viewBox is exactly
 *    the module grid, so a bare export butts the finder patterns against
 *    whatever it's pasted onto and readers give up.
 *  - an explicit width/height on the clone. Firefox refuses to rasterize an
 *    SVG that sizes itself only through a viewBox.
 */

/** Exported edge length of the code itself, before the quiet zone. */
const EXPORT_SIZE = 1024
/** Quiet zone as a fraction of the code's width (the spec asks for ~4 modules). */
const QUIET_ZONE_RATIO = 0.08

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Could not rasterize the QR code"))
    image.src = src
  })
}

/**
 * Downloads the SVG inside `container` as `filename`.
 *
 * Resolves once the download has been handed to the browser. Throws if the
 * container holds no SVG or the canvas is unavailable, so callers can toast.
 */
export async function downloadQrPng(
  container: HTMLElement | null,
  filename: string,
): Promise<void> {
  const svg = container?.querySelector("svg")
  if (!svg) throw new Error("No QR code to download")

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("width", String(EXPORT_SIZE))
  clone.setAttribute("height", String(EXPORT_SIZE))

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
    type: "image/svg+xml;charset=utf-8",
  })
  const objectUrl = URL.createObjectURL(blob)

  try {
    const image = await loadImage(objectUrl)
    const quietZone = Math.round(EXPORT_SIZE * QUIET_ZONE_RATIO)
    const canvas = document.createElement("canvas")
    canvas.width = EXPORT_SIZE + quietZone * 2
    canvas.height = canvas.width

    const context = canvas.getContext("2d")
    if (!context) throw new Error("Could not rasterize the QR code")
    // Opaque white: a transparent PNG dropped on a dark slide inverts the
    // code and stops scanning.
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, quietZone, quietZone, EXPORT_SIZE, EXPORT_SIZE)

    const link = document.createElement("a")
    link.href = canvas.toDataURL("image/png")
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
