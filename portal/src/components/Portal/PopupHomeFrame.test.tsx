import {
  buildPopupHomeDocument,
  hasCustomHome,
  interpolatePopupHome,
  PopupHomeFrame,
  unknownPopupHomeVariables,
} from "@edgeos/shared-form-ui/popup-home"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

const popup = {
  name: 'A & B "Gathering"',
  location: "Patagonia",
  start_date: "2027-03-10T00:00:00Z",
  end_date: "2027-04-10T00:00:00Z",
  image_url: "https://example.com/image.png",
}

function documentFor(html: string, details = popup) {
  return new DOMParser().parseFromString(
    buildPopupHomeDocument(html, details),
    "text/html",
  )
}

describe("custom home template", () => {
  it.each([
    {},
    { custom_home_html: "<h1>Saved, not enabled</h1>" },
    { custom_home_enabled: false, custom_home_html: "<h1>Disabled</h1>" },
    { custom_home_enabled: true },
    { custom_home_enabled: true, custom_home_html: " \n " },
  ])("keeps the existing home for %j", (settings) => {
    expect(hasCustomHome(settings)).toBe(false)
  })

  it("requires both an explicit switch and content", () => {
    expect(
      hasCustomHome({
        custom_home_enabled: true,
        custom_home_html: "<h1>Hello</h1>",
      }),
    ).toBe(true)
  })

  it("substitutes the allowlisted popup values and escapes text and attributes", () => {
    const doc = documentFor(
      '<h1 title="{{popup.name}}">{{ popup.name }}</h1><p>{{ popup.location }}</p><img src="{{ popup.image_url }}">',
    )
    expect(doc.querySelector("h1")?.textContent).toBe(popup.name)
    expect(doc.querySelector("h1")?.title).toBe(popup.name)
    expect(doc.querySelector("p")?.textContent).toBe("Patagonia")
    expect(doc.querySelector("img")?.src).toBe(popup.image_url)
  })

  it("formats dates in the requested language without timezone drift", () => {
    expect(interpolatePopupHome("{{ popup.start_date }}", popup, "en")).toBe(
      "March 10, 2027",
    )
    expect(interpolatePopupHome("{{ popup.end_date }}", popup, "es")).toBe(
      "10 de abril de 2027",
    )
    expect(
      interpolatePopupHome("{{ popup.start_date }}", popup, "not_a_locale"),
    ).toBe("March 10, 2027")
  })

  it("handles missing and invalid details without showing null or Invalid Date", () => {
    expect(
      interpolatePopupHome(
        "{{ popup.location }}{{ popup.start_date }}{{ popup.end_date }}{{ popup.image_url }}",
        {
          name: "Home",
          start_date: "invalid",
        },
      ),
    ).toBe("")
  })

  it("does not evaluate expressions or recursively expand values", () => {
    expect(
      interpolatePopupHome("{{ popup.name }} {{ user.email }}", {
        name: "{{ popup.location }}",
      }),
    ).toBe("{{ popup.location }} {{ user.email }}")
    expect(
      unknownPopupHomeVariables(
        "{{ popup.name }} {{ user.email }} {{ links.events }} {{user.email}}",
      ),
    ).toEqual(["{{ user.email }}", "{{ links.events }}", "{{user.email}}"])
  })
})

describe("isolated HTML document", () => {
  it("keeps full documents, inline CSS, and external stylesheets", () => {
    const doc = documentFor(
      '<!doctype html><html><head><style>h1 { color: red; }</style><link rel="stylesheet" href="https://example.com/style.css"></head><body class="home"><h1>Hello</h1></body></html>',
    )
    expect(doc.body.className).toBe("home")
    expect(doc.querySelector("h1")?.textContent).toBe("Hello")
    expect(doc.head.textContent).toContain("h1 { color: red; }")
    expect(doc.querySelector("link")?.getAttribute("rel")).toBe("stylesheet")
  })

  it("strips scripts, event handlers, embeds, forms, redirects, and base overrides", () => {
    const doc = documentFor(`<script>window.top.pwned = true</script>
      <meta http-equiv="refresh" content="0;url=https://example.com">
      <base href="https://example.com">
      <iframe srcdoc="<script>alert(1)</script>"></iframe>
      <object data="https://example.com"></object>
      <form action="https://example.com"><input name="password"><button>Send</button></form>
      <img src="x" onerror="alert(1)"><a href="javascript:alert(1)">Unsafe</a>
      <link rel="prefetch" href="https://example.com">`)
    expect(
      doc.querySelector(
        "script, base, iframe, object, form, input, button, [onerror], link",
      ),
    ).toBeNull()
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull()
    expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false)
    const csp = doc.head.firstElementChild
    expect(csp?.getAttribute("http-equiv")).toBe("Content-Security-Policy")
    expect(csp?.getAttribute("content")).toContain("script-src 'none'")
    expect(csp?.getAttribute("content")).toContain("form-action 'none'")
  })

  it("sanitizes after interpolation so popup values cannot inject markup or unsafe URLs", () => {
    const doc = documentFor(
      '<h1>{{ popup.name }}</h1><img src="{{ popup.image_url }}">',
      {
        ...popup,
        name: '<img src=x onerror="alert(1)">',
        image_url: "javascript:alert(1)",
      },
    )
    expect(doc.querySelector("h1")?.textContent).toBe(
      '<img src=x onerror="alert(1)">',
    )
    expect(doc.querySelector("h1 img")).toBeNull()
    expect(doc.querySelector("img")?.hasAttribute("src")).toBe(false)
  })

  it("supports ordinary top-level links and in-document anchors", () => {
    const doc = documentFor(
      '<a href="/portal/profile" ping="https://example.com">Profile</a><a href="#about">About</a>',
    )
    const [profile, about] = doc.querySelectorAll("a")
    expect(profile.target).toBe("_top")
    expect(profile.rel).toBe("noopener noreferrer")
    expect(profile.hasAttribute("ping")).toBe(false)
    expect(about.target).toBe("_self")
  })

  it("uses an opaque scriptless sandbox and disables navigation in previews", () => {
    const { rerender } = render(
      <PopupHomeFrame html="<h1>Hello</h1>" popup={popup} title="Home" />,
    )
    const frame = screen.getByTitle("Home")
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-top-navigation-by-user-activation",
    )
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer")
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Hello</h1>")
    rerender(
      <PopupHomeFrame
        html="<h1>New popup</h1>"
        popup={popup}
        title="Home"
        preview
      />,
    )
    expect(frame.getAttribute("sandbox")).toBe("")
    expect(frame.getAttribute("srcdoc")).toContain("<h1>New popup</h1>")
  })
})
