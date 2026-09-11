import { CUSTOM_HOME_HTML_MAX_LENGTH } from "@edgeos/shared-form-ui/popup-home"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POPUP_HOME_STARTER, PopupHomeEditor } from "./PopupHomeEditor"

const mocks = vi.hoisted(() => ({ editor: vi.fn(), theme: "light" }))
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: mocks.theme }),
}))
// Monaco needs a browser layout/worker environment. Test the controlled editor
// contract here; syntax colors and responsive layout are checked in-browser.
vi.mock("@monaco-editor/react", () => ({
  default: (props: {
    value: string
    onChange: (value: string) => void
    options: { ariaLabel: string; readOnly: boolean }
  }) => {
    mocks.editor(props)
    return (
      <textarea
        aria-label={props.options.ariaLabel}
        value={props.value}
        readOnly={props.options.readOnly}
        onChange={(event) => props.onChange(event.target.value)}
      />
    )
  },
}))

afterEach(cleanup)
beforeEach(() => {
  mocks.editor.mockClear()
  mocks.theme = "light"
})

function Editor({ readOnly = false, initialHtml = "" }) {
  const [html, setHtml] = useState(initialHtml)
  const [enabled, setEnabled] = useState(false)
  return (
    <PopupHomeEditor
      html={html}
      enabled={enabled}
      onHtmlChange={setHtml}
      onEnabledChange={setEnabled}
      popup={{ name: "Test gathering" }}
      locale="en"
      readOnly={readOnly}
    />
  )
}

describe("popup home editor", () => {
  it("starts optional and inserts an example without enabling the home", () => {
    render(<Editor />)
    expect(screen.getByRole("switch")).not.toBeChecked()
    expect(
      screen.getByRole("button", { name: "Fullscreen preview" }),
    ).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Add starter HTML" }))
    expect(screen.getByLabelText("Home page HTML")).toHaveValue(
      POPUP_HOME_STARTER,
    )
    expect(screen.getByRole("switch")).not.toBeChecked()
  })

  it("preserves the HTML when disabled and shows the default-home state", () => {
    render(<Editor initialHtml="<h1>Saved</h1>" />)
    const toggle = screen.getByRole("switch")
    fireEvent.click(toggle)
    expect(screen.getByText("Custom home on save")).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByLabelText("Home page HTML")).toHaveValue(
      "<h1>Saved</h1>",
    )
    expect(screen.getByText("Default home on save")).toBeInTheDocument()
  })

  it("uses the same sanitized, sandboxed renderer for mobile preview", () => {
    render(
      <Editor
        initialHtml={"<h1>{{ popup.name }}</h1><script>alert(1)</script>"}
      />,
    )
    // Preview is already visible alongside the editor, without changing tabs.
    expect(screen.getByLabelText("Home page HTML")).toBeInTheDocument()
    expect(screen.getByTitle("Custom home preview")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Mobile preview" }))
    expect(screen.getByLabelText("Home page HTML")).toBeInTheDocument()
    const frame = screen.getByTitle("Custom home preview")
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Test gathering</h1>")
    expect(frame.getAttribute("srcdoc")).not.toContain("<script>")
    expect(frame).toHaveAttribute("sandbox", "")
    expect(frame).toHaveClass("max-w-[375px]")
  })

  it("updates the live preview as HTML is edited without saving or enabling", async () => {
    render(<Editor initialHtml="<h1>Before</h1>" />)
    const code =
      "<style>h1 { color: red; }</style><h1>{{ popup.name }} updated</h1>"
    fireEvent.change(screen.getByLabelText("Home page HTML"), {
      target: { value: code },
    })
    await waitFor(() =>
      expect(
        screen.getByTitle("Custom home preview").getAttribute("srcdoc"),
      ).toContain("<h1>Test gathering updated</h1>"),
    )
    expect(
      screen.getByTitle("Custom home preview").getAttribute("srcdoc"),
    ).toContain("color: red")
    expect(screen.getByRole("switch")).not.toBeChecked()
    fireEvent.change(screen.getByLabelText("Home page HTML"), {
      target: { value: "" },
    })
    await waitFor(() =>
      expect(screen.queryByTitle("Custom home preview")).toBeNull(),
    )
    expect(
      screen.getByText("Your home page will appear here"),
    ).toBeInTheDocument()
  })

  it("opens the unsaved HTML at full window width without saving or changing the inline view", async () => {
    const submit = vi.fn((event) => event.preventDefault())
    render(
      <form onSubmit={submit}>
        <Editor initialHtml="<h1>Saved version</h1>" />
      </form>,
    )
    const draft = "<h1>Unsaved {{ popup.name }}</h1><script>alert(1)</script>"
    fireEvent.change(screen.getByLabelText("Home page HTML"), {
      target: { value: draft },
    })
    fireEvent.click(screen.getByRole("button", { name: "Mobile preview" }))
    const trigger = screen.getByRole("button", { name: "Fullscreen preview" })
    trigger.focus()
    fireEvent.click(trigger)

    expect(
      screen.getByRole("dialog", { name: "Fullscreen preview" }),
    ).toHaveClass("h-dvh", "w-screen", "max-w-none")
    const frame = screen.getByTitle("Fullscreen custom home preview")
    expect(frame.getAttribute("srcdoc")).toContain(
      "<h1>Unsaved Test gathering</h1>",
    )
    expect(frame.getAttribute("srcdoc")).not.toContain("<script>")
    expect(frame).toHaveAttribute("sandbox", "")
    expect(frame).not.toHaveClass("max-w-[375px]")

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.getByLabelText("Home page HTML")).toHaveValue(draft)
    expect(
      screen.getByRole("button", { name: "Mobile preview" }),
    ).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTitle("Custom home preview")).toHaveClass(
      "max-w-[375px]",
    )
    expect(screen.getByRole("switch")).not.toBeChecked()
    expect(submit).not.toHaveBeenCalled()
  })

  it("allows read-only fullscreen previews and closes with Escape", async () => {
    render(<Editor readOnly initialHtml="<h1>Read only</h1>" />)
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen preview" }))
    expect(
      screen.getByTitle("Fullscreen custom home preview"),
    ).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByLabelText("Home page HTML")).toHaveValue(
      "<h1>Read only</h1>",
    )
  })

  it("configures a themed HTML code editor with line numbers, folding and CSS formatting", () => {
    const { rerender } = render(<Editor />)
    expect(mocks.editor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        language: "html",
        theme: "light",
        options: expect.objectContaining({
          readOnly: false,
          lineNumbers: "on",
          folding: true,
          formatOnPaste: true,
          automaticLayout: true,
          wordWrap: "on",
        }),
      }),
    )
    mocks.theme = "dark"
    rerender(<Editor />)
    expect(mocks.editor).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "vs-dark" }),
    )
  })

  it("shows oversized source intact with a warning and pauses the preview", () => {
    const html = "x".repeat(CUSTOM_HOME_HTML_MAX_LENGTH + 1)
    render(<Editor initialHtml={html} />)
    expect(screen.getByLabelText("Home page HTML")).toHaveValue(html)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Shorten it before saving",
    )
    expect(screen.queryByTitle("Custom home preview")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Fullscreen preview" }),
    ).toBeDisabled()
    expect(
      screen.getByText("Reduce the HTML to resume the preview."),
    ).toBeInTheDocument()
  })

  it("warns about unsupported parameters", () => {
    render(<Editor initialHtml="{{ links.events }}" />)
    expect(screen.getByRole("status")).toHaveTextContent("Unknown placeholders")
  })

  it("does not allow a read-only user to change or seed content", () => {
    const onEnabledChange = vi.fn()
    render(
      <PopupHomeEditor
        html=""
        enabled={false}
        onHtmlChange={vi.fn()}
        onEnabledChange={onEnabledChange}
        popup={{ name: "Home" }}
        locale="en"
        readOnly
      />,
    )
    expect(screen.getByRole("switch")).toBeDisabled()
    expect(screen.getByLabelText("Home page HTML")).toHaveAttribute("readonly")
    expect(
      screen.queryByRole("button", { name: "Add starter HTML" }),
    ).toBeNull()
    fireEvent.click(screen.getByRole("switch"))
    expect(onEnabledChange).not.toHaveBeenCalled()
  })
})
