"use client"

import { ChevronDown, HelpCircle } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { VariantProps } from "../registries/variantRegistry"

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface FaqItem {
  id: string
  question: string
  answer: string
}

function parseFaqs(templateConfig: VariantProps["templateConfig"]): FaqItem[] {
  const raw = templateConfig?.items
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw as FaqItem[]
}

function SectionTitle({ title }: { title?: string }) {
  if (!title) return null
  return (
    <h3 className="text-xl font-semibold text-foreground text-center">{title}</h3>
  )
}

// ---------------------------------------------------------------------------
// Accordion variant
// ---------------------------------------------------------------------------

function AccordionFaqs({
  items,
  title,
  onSkip,
}: {
  items: FaqItem[]
  title?: string
  onSkip?: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <SectionTitle title={title} />
      <div className="space-y-2">
        {items.map((item) => {
          const isOpen = openId === item.id
          return (
            <Collapsible
              key={item.id}
              open={isOpen}
              onOpenChange={(open) => setOpenId(open ? item.id : null)}
            >
              <div
                className={cn(
                  "rounded-xl border border-border bg-card overflow-hidden transition-shadow",
                  isOpen && "shadow-sm",
                )}
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted transition-colors"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {item.question || "Untitled question"}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200",
                        isOpen && "rotate-180",
                      )}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground whitespace-pre-line">
                    {item.answer}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// List variant
// ---------------------------------------------------------------------------

function ListFaqs({
  items,
  title,
  onSkip,
}: {
  items: FaqItem[]
  title?: string
  onSkip?: () => void
}) {
  return (
    <div className="space-y-4">
      <SectionTitle title={title} />
      <div className="space-y-5">
        {items.map((item) => (
          <div key={item.id} className="space-y-1">
            <h4 className="text-sm font-semibold text-foreground">
              {item.question || "Untitled question"}
            </h4>
            <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
              {item.answer}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Two-column variant
// ---------------------------------------------------------------------------

function TwoColumnFaqs({
  items,
  title,
  onSkip,
}: {
  items: FaqItem[]
  title?: string
  onSkip?: () => void
}) {
  return (
    <div className="space-y-4">
      <SectionTitle title={title} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-border bg-card p-4 space-y-1.5"
          >
            <h4 className="text-sm font-semibold text-foreground">
              {item.question || "Untitled question"}
            </h4>
            <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
              {item.answer}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cards variant
// ---------------------------------------------------------------------------

function CardsFaqs({
  items,
  title,
  onSkip,
}: {
  items: FaqItem[]
  title?: string
  onSkip?: () => void
}) {
  return (
    <div className="space-y-4">
      <SectionTitle title={title} />
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
          >
            <div className="shrink-0 w-9 h-9 rounded-full bg-muted flex items-center justify-center">
              <HelpCircle className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-1">
              <h4 className="text-sm font-semibold text-foreground">
                {item.question || "Untitled question"}
              </h4>
              <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                {item.answer}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const VARIANT_MAP: Record<string, typeof AccordionFaqs> = {
  accordion: AccordionFaqs,
  list: ListFaqs,
  "two-column": TwoColumnFaqs,
  cards: CardsFaqs,
}

export default function VariantFaqs({ onSkip, templateConfig }: VariantProps) {
  const items = parseFaqs(templateConfig)
  const title = (templateConfig?.title as string) || undefined
  const variant = (templateConfig?.variant as string) || "accordion"

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <HelpCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-6">No frequently asked questions yet.</p>
        <Button variant="outline" onClick={onSkip}>
          Continue
        </Button>
      </div>
    )
  }

  const Layout = VARIANT_MAP[variant] ?? AccordionFaqs

  return <Layout items={items} title={title} onSkip={onSkip} />
}
