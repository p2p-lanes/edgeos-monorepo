/**
 * Mailpit helpers: poll the in-memory SMTP catcher to pull auth codes sent
 * during dev login flows, so E2E can complete the same email-code login a
 * real user goes through.
 *
 * Mailpit exposes an HTTP API on :8025 — see https://mailpit.axllent.org/docs/api-v1/
 */
import { MAILPIT_URL } from "./env"

type MailpitMessage = {
  ID: string
  To: Array<{ Address: string; Name: string }>
  Subject: string
  Snippet: string
  Created: string
}

type MailpitMessageList = {
  messages: MailpitMessage[]
  total: number
}

type MailpitMessageDetail = {
  ID: string
  Text: string
  HTML: string
  Subject: string
}

async function mailpitGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${MAILPIT_URL}${path}`)
  if (!resp.ok) {
    throw new Error(`Mailpit ${path} → ${resp.status} ${resp.statusText}`)
  }
  return resp.json() as Promise<T>
}

/** Clear every message in the Mailpit inbox. */
export async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" })
}

/**
 * Poll Mailpit until a message addressed to ``to`` lands, then return the
 * first 6-digit code found in the body. Throws after ~15s.
 *
 * Matches the backend's ``generate_auth_code`` convention (6 digits).
 */
export async function waitForLoginCode(
  to: string,
  { timeoutMs = 15_000, pollMs = 500 } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const list = await mailpitGet<MailpitMessageList>(
      `/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=5`,
    )
    if (list.messages.length > 0) {
      // Sort desc — Mailpit returns newest first, but be defensive.
      const newest = list.messages.sort((a, b) =>
        b.Created.localeCompare(a.Created),
      )[0]
      const detail = await mailpitGet<MailpitMessageDetail>(
        `/api/v1/message/${newest.ID}`,
      )
      const body = detail.Text || detail.HTML
      const match = body.match(/\b(\d{6})\b/)
      if (match) return match[1]
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`No login code for ${to} in Mailpit within ${timeoutMs}ms`)
}
