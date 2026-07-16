/** SimpleFi's checkout page localizes from a "locale" query param ("lang" is
 * an EdgeOS-internal entry param it ignores), so every portal redirect to a
 * checkout URL forwards the buyer's current language through it. */
export function withCheckoutLocale(
  checkoutUrl: string,
  locale: string,
): string {
  try {
    const url = new URL(checkoutUrl)
    url.searchParams.set("locale", locale)
    return url.toString()
  } catch {
    return checkoutUrl
  }
}
