import {
  CUSTOM_HOME_HTML_MAX_LENGTH,
  POPUP_HOME_VARIABLES,
  type PopupHomeDetails,
  PopupHomeFrame,
  unknownPopupHomeVariables,
} from "@edgeos/shared-form-ui/popup-home"
import CodeEditor from "@monaco-editor/react"
import { Code2, Maximize2, Monitor, Smartphone, X } from "lucide-react"
import { useDeferredValue, useState } from "react"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export const POPUP_HOME_STARTER = `<style>
  body { font-family: system-ui, sans-serif; background: #eef4f8; color: #17364a; }
  main { max-width: 960px; margin: auto; padding: clamp(32px, 8vw, 96px); }
  .eyebrow { text-transform: uppercase; letter-spacing: .16em; font-size: 12px; }
  h1 { font-size: clamp(40px, 8vw, 88px); line-height: 1; letter-spacing: -.05em; }
  .details { border-top: 2px solid #17364a; padding-top: 24px; line-height: 1.8; }
</style>
<main>
  <p class="eyebrow">A place to come together</p>
  <h1>Welcome to {{ popup.name }}</h1>
  <div class="details">
    <p>{{ popup.location }}</p>
    <p>{{ popup.start_date }} — {{ popup.end_date }}</p>
  </div>
</main>`

interface PopupHomeEditorProps {
  html: string
  enabled: boolean
  onHtmlChange: (html: string) => void
  onEnabledChange: (enabled: boolean) => void
  popup: PopupHomeDetails
  locale: string
  readOnly?: boolean
}

export function PopupHomeEditor({
  html,
  enabled,
  onHtmlChange,
  onEnabledChange,
  popup,
  locale,
  readOnly = false,
}: PopupHomeEditorProps) {
  const { resolvedTheme } = useTheme()
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">(
    "desktop",
  )
  const tooLong = html.length > CUSTOM_HOME_HTML_MAX_LENGTH
  // Keep typing responsive and never parse an oversized paste in the preview.
  // Preserve the source so the author can fix it without losing their work.
  const previewHtml = useDeferredValue(tooLong ? "" : html)
  const unknownVariables = unknownPopupHomeVariables(previewHtml)

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-start justify-between gap-6">
        <div className="max-w-2xl space-y-2">
          <Label htmlFor="custom-home-enabled" className="text-base">
            Use custom home page
          </Label>
          <p className="text-sm text-muted-foreground">
            Optional. Keep the current portal home unless you enable this and
            save HTML. Turning it off keeps your HTML for later.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Badge variant="outline" className="hidden sm:inline-flex">
            {enabled && html.trim()
              ? "Custom home on save"
              : "Default home on save"}
          </Badge>
          <Switch
            id="custom-home-enabled"
            checked={enabled}
            onCheckedChange={onEnabledChange}
            disabled={readOnly}
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Replaces the home content and application/status cards, not the sidebar
        or other screens. HTML and CSS only; JavaScript, forms, and embedded
        pages are blocked.
      </p>

      <div className="grid min-w-0 grid-cols-1 overflow-hidden rounded-lg border lg:grid-cols-2">
        <section
          aria-labelledby="home-html-heading"
          className="min-w-0 border-b lg:border-r lg:border-b-0"
        >
          <div className="flex h-12 items-center justify-between gap-3 border-b bg-muted/30 px-4">
            <h3
              id="home-html-heading"
              className="flex items-center gap-2 font-mono text-sm"
            >
              <Code2
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              home.html
            </h3>
            {!html.trim() && !readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onHtmlChange(POPUP_HOME_STARTER)}
              >
                Add starter HTML
              </Button>
            )}
            {readOnly && <Badge variant="outline">Read only</Badge>}
          </div>
          <div className="h-[420px] lg:h-[min(65vh,720px)] lg:min-h-[420px]">
            <CodeEditor
              height="100%"
              language="html"
              value={html}
              onChange={(value) => {
                if (!readOnly) onHtmlChange(value ?? "")
              }}
              theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
              loading={
                <p className="text-sm text-muted-foreground">
                  Loading code editor…
                </p>
              }
              options={{
                ariaLabel: "Home page HTML",
                readOnly,
                domReadOnly: readOnly,
                minimap: { enabled: false },
                lineNumbers: "on",
                fontFamily: "'Geist Mono Variable', ui-monospace, monospace",
                fontSize: 13,
                lineHeight: 22,
                tabSize: 2,
                insertSpaces: true,
                detectIndentation: false,
                wordWrap: "on",
                folding: true,
                bracketPairColorization: { enabled: true },
                formatOnPaste: true,
                formatOnType: true,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 16, bottom: 16 },
              }}
            />
          </div>
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>HTML + CSS · Format: Shift + Alt + F</span>
            <span
              className={`tabular-nums ${tooLong ? "text-destructive" : ""}`}
            >
              {html.length.toLocaleString()} /{" "}
              {CUSTOM_HOME_HTML_MAX_LENGTH.toLocaleString()}
            </span>
          </div>
        </section>

        <section aria-labelledby="home-preview-heading" className="min-w-0">
          <div className="flex h-12 items-center justify-between gap-3 border-b bg-muted/30 px-4">
            <h3
              id="home-preview-heading"
              className="flex items-center gap-2 text-sm font-medium"
            >
              <span
                className="size-1.5 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              Live preview
            </h3>
            <fieldset
              className="flex items-center gap-1"
              aria-label="Preview controls"
            >
              {(
                [
                  ["desktop", "Desktop preview", Monitor],
                  ["mobile", "Mobile preview", Smartphone],
                ] as const
              ).map(([value, label, Icon]) => (
                <Button
                  key={value}
                  type="button"
                  size="icon"
                  className="size-8"
                  variant={previewWidth === value ? "secondary" : "ghost"}
                  aria-label={label}
                  title={label}
                  aria-pressed={previewWidth === value}
                  onClick={() => setPreviewWidth(value)}
                >
                  <Icon className="size-4" />
                </Button>
              ))}
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    className="size-8"
                    variant="ghost"
                    aria-label="Fullscreen preview"
                    title="Fullscreen preview"
                    disabled={tooLong || !previewHtml.trim()}
                  >
                    <Maximize2 className="size-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent
                  showCloseButton={false}
                  className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
                >
                  <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
                    <DialogHeader className="min-w-0 text-left">
                      <DialogTitle className="truncate text-sm font-medium">
                        Fullscreen preview
                      </DialogTitle>
                      <DialogDescription className="sr-only">
                        Preview of your current unsaved HTML at full window
                        width. Links are disabled. Close to return to the
                        editor.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogClose asChild>
                      <Button type="button" variant="ghost" size="sm">
                        <X className="size-4" />
                        Close preview
                      </Button>
                    </DialogClose>
                  </div>
                  <PopupHomeFrame
                    html={tooLong ? "" : previewHtml}
                    popup={popup}
                    locale={locale}
                    preview
                    title="Fullscreen custom home preview"
                    className="block min-h-0 w-full flex-1 border-0 bg-white"
                  />
                </DialogContent>
              </Dialog>
            </fieldset>
          </div>
          <div className="h-[420px] bg-muted/40 lg:h-[min(65vh,720px)] lg:min-h-[420px]">
            {tooLong ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                Reduce the HTML to resume the preview.
              </div>
            ) : previewHtml.trim() ? (
              <PopupHomeFrame
                html={previewHtml}
                popup={popup}
                locale={locale}
                preview
                title="Custom home preview"
                className={`mx-auto block h-full w-full border-0 bg-white ${previewWidth === "mobile" ? "max-w-[375px]" : ""}`}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <p className="text-sm font-medium">
                  Your home page will appear here
                </p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Start typing HTML or add the starter template. Until you
                  enable and save it, visitors keep the current portal home.
                </p>
              </div>
            )}
          </div>
          <p className="flex min-h-11 items-center border-t px-4 py-2 text-xs text-muted-foreground">
            Updates as you type. Links are disabled. Save Changes applies your
            settings.
          </p>
        </section>
      </div>

      {tooLong && (
        <p role="alert" className="text-sm text-destructive">
          HTML exceeds the {CUSTOM_HOME_HTML_MAX_LENGTH.toLocaleString()}
          -character limit. Shorten it before saving. Your code has not been
          truncated.
        </p>
      )}
      {enabled && !html.trim() && (
        <p className="text-sm text-muted-foreground">
          Add HTML to use a custom home. Until then, the current home stays in
          place.
        </p>
      )}
      {unknownVariables.length > 0 && (
        <output className="block text-sm text-amber-700 dark:text-amber-400">
          Unknown placeholders will appear as written:{" "}
          {unknownVariables.join(", ")}
        </output>
      )}

      <details className="rounded-lg border px-4">
        <summary className="cursor-pointer py-3 text-sm font-medium">
          Popup placeholders
        </summary>
        <p className="pb-3 text-xs text-muted-foreground">
          Use in text or HTML attributes. Missing values become empty text.
          Dates follow the portal language. Preview uses the current form
          details.
        </p>
        <dl className="grid gap-x-8 pb-3 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(POPUP_HOME_VARIABLES).map(([key, description]) => (
            <div key={key} className="space-y-1 border-t py-2.5 text-xs">
              <dt className="select-all font-mono">{`{{ popup.${key} }}`}</dt>
              <dd className="text-muted-foreground">{description}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  )
}
