import { Check } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { TemplateConfigProps } from "./types"

const ALIGNMENTS = [
  { value: "center", label: "Center" },
  { value: "left", label: "Left" },
] as const

const WIDTHS = [
  { value: "wide", label: "Wide", description: "max-w-3xl, marketing copy" },
  { value: "narrow", label: "Narrow", description: "max-w-md, captions" },
] as const

export function RichTextConfig({ config, onChange }: TemplateConfigProps) {
  const html = typeof config?.html === "string" ? config.html : ""
  const alignment = (config?.alignment as string) || "center"
  const width = (config?.max_width as string) || "wide"

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="rich-text-html" className="text-sm font-medium">
          HTML content
        </Label>
        <p className="text-xs text-muted-foreground">
          Paste HTML markup or markdown-style text. Script tags and inline
          event handlers are stripped on render — safe for marketing copy,
          banners, payment-method badges, and decorative blocks.
        </p>
        <Textarea
          id="rich-text-html"
          value={html}
          onChange={(e) => onChange({ ...config, html: e.target.value })}
          placeholder={'<h2>Marketing headline</h2>\n<p>Your copy here.</p>'}
          className="min-h-[180px] text-sm font-mono"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Alignment
          </Label>
          <div className="flex gap-2">
            {ALIGNMENTS.map((a) => {
              const isActive = alignment === a.value
              return (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => onChange({ ...config, alignment: a.value })}
                  className={cn(
                    "relative flex-1 rounded-md border-2 px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-accent/50",
                  )}
                >
                  {isActive && (
                    <Check className="absolute top-1 right-1 h-3 w-3" />
                  )}
                  {a.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Max width
          </Label>
          <div className="flex gap-2">
            {WIDTHS.map((w) => {
              const isActive = width === w.value
              return (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => onChange({ ...config, max_width: w.value })}
                  className={cn(
                    "relative flex-1 rounded-md border-2 px-3 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-accent/50",
                  )}
                >
                  {isActive && (
                    <Check className="absolute top-1 right-1 h-3 w-3" />
                  )}
                  <span className="font-medium">{w.label}</span>
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    {w.description}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
