/** Thrown by the default transport on any non-2xx response. */
export class CheckoutApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, detail: unknown) {
    super(`Checkout API error ${status}`)
    this.name = "CheckoutApiError"
    this.status = status
    this.detail = detail
  }
}
