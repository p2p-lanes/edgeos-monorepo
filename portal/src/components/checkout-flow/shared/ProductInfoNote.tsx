"use client"

import { Info } from "lucide-react"
import type { KeyboardEvent, SyntheticEvent } from "react"
import { useTranslation } from "react-i18next"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface ProductInfoNoteProps {
  /** The admin-written note. Nothing renders when it is empty. */
  note?: string | null
  /** Product name, used for the trigger's accessible label. */
  productName: string
  className?: string
}

// Product rows and cards select the product or change its quantity on click.
// Opening the note must do neither, so every click the trigger or the
// popover sees stops here. React bubbles synthetic events through portals,
// so the popover content needs this as much as the trigger does.
// stopPropagation (never preventDefault) keeps Radix's own trigger handler
// running: it skips itself once the event is defaultPrevented. Pointerdown is
// left alone on purpose: no row acts on it, and Radix listens for it on the
// document to dismiss another note that is already open.
const stop = (event: SyntheticEvent) => event.stopPropagation()

const isActivationKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === " "

/**
 * An info icon next to a product name that reveals the product's info note,
 * e.g. "A passport will be requested for this product".
 *
 * A popover rather than a tooltip: hover never fires on touch, and a buyer
 * on a phone has to be able to read it too, so it opens on tap and closes
 * on a second tap or a tap outside.
 */
export function ProductInfoNote({
  note,
  productName,
  className,
}: ProductInfoNoteProps) {
  const { t } = useTranslation()
  const text = note?.trim()
  if (!text) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* biome-ignore lint/a11y/useSemanticElements: several product rows are themselves <button>s, and a <button> cannot nest inside one */}
        <span
          role="button"
          tabIndex={0}
          aria-label={t("checkout.product_info_note_label", {
            name: productName,
          })}
          onClick={stop}
          onKeyDown={(event) => {
            if (!isActivationKey(event)) return
            // Keep the key away from the row (and Space from scrolling),
            // then open the note the way a tap does.
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.click()
          }}
          className={cn(
            "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-w-[min(18rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed whitespace-pre-line"
        onClick={stop}
        onKeyDown={(event) => {
          if (isActivationKey(event)) event.stopPropagation()
        }}
      >
        {text}
      </PopoverContent>
    </Popover>
  )
}
