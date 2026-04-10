"use client"

import {
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { cn } from "@/lib/utils"

interface ExpandableDescriptionProps {
  text: string
  clamp?: number
  className?: string
  buttonClassName?: string
  moreLabel?: string
  lessLabel?: string
}

const ExpandableDescription = ({
  text,
  clamp = 2,
  className,
  buttonClassName,
  moreLabel = "Ver más",
  lessLabel = "Ver menos",
}: ExpandableDescriptionProps) => {
  const paragraphRef = useRef<HTMLParagraphElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  // text/clamp are not referenced directly in the effect body but they change
  // the rendered DOM height, so we need to re-measure when they change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on text/clamp changes
  useLayoutEffect(() => {
    const el = paragraphRef.current
    if (!el) return
    // When expanded the clamp is removed and scrollHeight === clientHeight,
    // so keep the button visible by short-circuiting the measurement.
    if (isExpanded) {
      setIsOverflowing(true)
      return
    }
    setIsOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [text, clamp, isExpanded])

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
      setIsOverflowing(node.scrollHeight > node.clientHeight + 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [isExpanded])

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
      <p ref={paragraphRef} className={cn(className)} style={collapsedStyle}>
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
          {isExpanded ? lessLabel : moreLabel}
        </button>
      )}
    </div>
  )
}

export default ExpandableDescription
