"use client"

import DOMPurify from "dompurify"
import { useEffect, useState } from "react"

export const CUSTOM_HOME_HTML_MAX_LENGTH = 200_000

export const POPUP_HOME_VARIABLES = {
  name: "Gathering name",
  location: "Location",
  start_date: "Start date (localized)",
  end_date: "End date (localized)",
  image_url: "Gathering image URL",
} as const

export interface PopupHomeDetails {
  name: string
  location?: string | null
  start_date?: string | null
  end_date?: string | null
  image_url?: string | null
}

export function hasCustomHome(popup: {
  custom_home_enabled?: boolean
  custom_home_html?: string | null
}): boolean {
  return popup.custom_home_enabled === true && !!popup.custom_home_html?.trim()
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }
  return value.replace(/[&<>"']/g, (character) => entities[character])
}

function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  // Popup dates are calendar dates stored at UTC midnight. Do not shift a
  // gathering's start day when a viewer lives west of UTC.
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(date)
  }
}

export function interpolatePopupHome(
  html: string,
  popup: PopupHomeDetails,
  locale = "en",
): string {
  const values: Record<keyof typeof POPUP_HOME_VARIABLES, string> = {
    name: popup.name,
    location: popup.location ?? "",
    start_date: formatDate(popup.start_date, locale),
    end_date: formatDate(popup.end_date, locale),
    image_url: popup.image_url ?? "",
  }
  // One pass over an allowlist, not a template engine. Values cannot introduce
  // more expressions, and unknown expressions remain literal text.
  return html.replace(
    /{{\s*popup\.(name|location|start_date|end_date|image_url)\s*}}/g,
    (_, key: keyof typeof values) => escapeHtml(values[key]),
  )
}

export function unknownPopupHomeVariables(html: string): string[] {
  return [...new Set(html.match(/{{[^{}]*}}/g) ?? [])].filter(
    (token) =>
      !/^{{\s*popup\.(name|location|start_date|end_date|image_url)\s*}}$/.test(
        token,
      ),
  )
}

const HOME_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline' https: http:",
  "img-src https: http: data:",
  "font-src https: http: data:",
  "media-src https: http:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ")

/** Browser-only. Shared by preview and portal so neither renders raw admin HTML. */
export function buildPopupHomeDocument(
  html: string,
  popup: PopupHomeDetails,
  locale = "en",
): string {
  const clean = DOMPurify.sanitize(interpolatePopupHome(html, popup, locale), {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style", "link"],
    ADD_ATTR: ["target"],
    FORBID_TAGS: [
      "script",
      "meta",
      "base",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "textarea",
      "select",
    ],
    FORBID_ATTR: ["srcdoc", "autofocus", "contenteditable"],
  })
  const doc = new DOMParser().parseFromString(clean, "text/html")
  // Only stylesheets may load through link tags (no prefetch/preload side effects).
  for (const link of doc.querySelectorAll("link")) {
    if (link.getAttribute("rel")?.toLowerCase() !== "stylesheet") link.remove()
  }
  for (const anchor of doc.querySelectorAll("a")) {
    anchor.removeAttribute("ping")
    anchor.setAttribute("rel", "noopener noreferrer")
    anchor.setAttribute(
      "target",
      anchor.getAttribute("href")?.startsWith("#") ? "_self" : "_top",
    )
  }
  // Our policy must precede all user content, including stylesheets. A custom
  // meta refresh/base cannot redirect the iframe or weaken this policy.
  const csp = doc.createElement("meta")
  csp.httpEquiv = "Content-Security-Policy"
  csp.content = HOME_CSP
  const viewport = doc.createElement("meta")
  viewport.name = "viewport"
  viewport.content = "width=device-width, initial-scale=1"
  const defaults = doc.createElement("style")
  defaults.textContent =
    "html{color-scheme:light}body{margin:0}img{max-width:100%;height:auto}"
  doc.head.prepend(csp, viewport, defaults)
  doc.documentElement.lang = locale
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
}

export function PopupHomeFrame({
  html,
  popup,
  locale = "en",
  title,
  className,
  preview = false,
}: {
  html: string
  popup: PopupHomeDetails
  locale?: string
  title: string
  className?: string
  preview?: boolean
}) {
  const { name, location, start_date, end_date, image_url } = popup
  const [document, setDocument] = useState<string>()
  useEffect(() => {
    setDocument(
      buildPopupHomeDocument(
        html,
        { name, location, start_date, end_date, image_url },
        locale,
      ),
    )
  }, [html, name, location, start_date, end_date, image_url, locale])

  return (
    <iframe
      title={title}
      className={className}
      srcDoc={document}
      // No scripts, same-origin access, forms, popups, or automatic top navigation.
      // Ordinary links can leave the frame only after a user gesture in the portal.
      sandbox={preview ? "" : "allow-top-navigation-by-user-activation"}
      referrerPolicy="no-referrer"
      aria-busy={!document}
    />
  )
}
