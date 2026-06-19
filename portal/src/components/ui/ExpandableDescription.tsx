"use client"

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface ExpandableDescriptionProps {
  text: string
  clamp?: number
  className?: string
  buttonClassName?: string
  moreLabel?: string
  lessLabel?: string
  /** Classes applied to the text only while expanded. Use to bound the height
   *  (e.g. "max-h-56 overflow-y-auto") so a long description can't make a grid
   *  card tower over its neighbours. The toggle button stays outside this box. */
  expandedClassName?: string
}

const ExpandableDescription = ({
  text,
  clamp = 2,
  className,
  buttonClassName,
  moreLabel,
  lessLabel,
  expandedClassName,
}: ExpandableDescriptionProps) => {
  const { t } = useTranslation()
  const resolvedMoreLabel = moreLabel ?? t("common.see_more")
  const resolvedLessLabel = lessLabel ?? t("common.see_less")
  const paragraphRef = useRef<HTMLParagraphElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const measureOverflow = useCallback(
    (el: HTMLElement): boolean => {
      const style = window.getComputedStyle(el)
      const lineHeightPx = Number.parseFloat(style.lineHeight)
      if (Number.isFinite(lineHeightPx) && lineHeightPx > 0) {
        const lineCount = Math.round(el.scrollHeight / lineHeightPx)
        return lineCount > clamp
      }
      return el.scrollHeight > el.clientHeight + 1
    },
    [clamp],
  )

  // text is not referenced directly in the effect body but it changes the
  // rendered DOM height, so we need to re-measure when it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on text changes
  useLayoutEffect(() => {
    const el = paragraphRef.current
    if (!el) return
    if (isExpanded) {
      setIsOverflowing(true)
      return
    }
    setIsOverflowing(measureOverflow(el))
  }, [text, isExpanded, measureOverflow])

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return
    const el = paragraphRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const node = paragraphRef.current
      if (!node) return
      if (isExpanded) {
        setIsOverflowing(true)
        return
      }
      setIsOverflowing(measureOverflow(node))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [isExpanded, measureOverflow])

  const handleToggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    setIsExpanded((prev) => !prev)
  }

  const collapsedStyle = !isExpanded
    ? {
        display: "-webkit-box",
        WebkitLineClamp: clamp,
        WebkitBoxOrient: "vertical" as const,
        overflow: "hidden",
      }
    : undefined

  return (
    <div className="w-full">
      <p
        ref={paragraphRef}
        className={cn(className, isExpanded && expandedClassName)}
        style={collapsedStyle}
      >
        {text}
      </p>
      {isOverflowing && (
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            "mt-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline cursor-pointer",
            buttonClassName,
          )}
        >
          {isExpanded ? resolvedLessLabel : resolvedMoreLabel}
        </button>
      )}
    </div>
  )
}

export default ExpandableDescription
