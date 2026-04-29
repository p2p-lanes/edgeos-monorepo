import { jwtDecode } from "jwt-decode"

export type StoredTokenType = "human" | "human_checkout"

export interface StoredTokenInfo {
  token: string
  type: StoredTokenType | null
  popupId: string | null
}

interface DecodedClaims {
  token_type?: unknown
  popup_id?: unknown
}

const TOKEN_STORAGE_KEY = "token"

function readToken(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(TOKEN_STORAGE_KEY)
}

function decodeStoredTokenType(value: unknown): StoredTokenType | null {
  return value === "human" || value === "human_checkout" ? value : null
}

export function getStoredTokenInfo(): StoredTokenInfo | null {
  const token = readToken()
  if (!token) return null

  try {
    const claims = jwtDecode<DecodedClaims>(token)
    const type = decodeStoredTokenType(claims.token_type)
    const popupId =
      typeof claims.popup_id === "string" ? claims.popup_id : null
    return { token, type, popupId }
  } catch {
    return { token, type: null, popupId: null }
  }
}

export function clearStoredToken(): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  window.dispatchEvent(new Event("auth-change"))
}

export function isCheckoutOnlyToken(info: StoredTokenInfo | null): boolean {
  return info?.type === "human_checkout"
}
