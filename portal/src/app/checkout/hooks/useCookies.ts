"use client"

import Cookies from "js-cookie"

const COOKIE_NAME = "user_form_data_checkout_edge"
const COOKIE_EXPIRY = 7 // days

const useCookies = () => {
  const getCookie = () => {
    return Cookies.get(COOKIE_NAME)
  }

  const setCookie = (value: string) => {
    Cookies.set(COOKIE_NAME, value, { expires: COOKIE_EXPIRY, sameSite: "Lax" })
  }
  return { getCookie, setCookie }
}
export default useCookies
