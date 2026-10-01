import { ApiError } from "@/client"

/**
 * Pull the server's error code out of a failed request.
 *
 * The check-in and attendance endpoints answer with `{code, message}`; the
 * guards they share with the rest of the portal (ended popup, private event)
 * still answer with a plain string, so both shapes are handled.
 */
export function readApiError(error: unknown): {
  code: string | null
  message: string | null
} {
  if (!(error instanceof ApiError) || !error.body) {
    return { code: null, message: null }
  }
  const detail = (error.body as { detail?: unknown }).detail
  if (typeof detail === "string") return { code: null, message: detail }
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const shaped = detail as { code?: unknown; message?: unknown }
    return {
      code: typeof shaped.code === "string" ? shaped.code : null,
      message: typeof shaped.message === "string" ? shaped.message : null,
    }
  }
  return { code: null, message: null }
}
