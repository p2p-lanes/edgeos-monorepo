import { Amarante, Oswald, Quicksand } from "next/font/google"

export const amaranteFont = Amarante({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-amanita-display",
  display: "swap",
})
export const oswaldFont = Oswald({
  subsets: ["latin"],
  variable: "--font-amanita-condensed",
  display: "swap",
})
export const quicksandFont = Quicksand({
  subsets: ["latin"],
  variable: "--font-amanita-sans",
  display: "swap",
})

/** Combined className to place on the `.checkout-amanita` wrapper so the three
 *  font CSS variables are in scope for the skin CSS. */
export const amanitaFontVars = `${amaranteFont.variable} ${oswaldFont.variable} ${quicksandFont.variable}`
