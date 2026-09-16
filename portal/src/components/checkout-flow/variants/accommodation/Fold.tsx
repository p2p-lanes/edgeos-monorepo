"use client"

/**
 * A block that folds open and folds shut.
 *
 * The accommodation step swaps between two things that occupy the same
 * place: the board of rooms, and the one room that was chosen off it. Cross
 * -fading them is not enough, because they are wildly different heights and
 * the page underneath would jump the moment the swap lands. So the outgoing
 * block collapses its own height to nothing first, and the incoming one
 * unfolds into the space that leaves. The eye reads it as the list folding
 * up around the chosen room rather than as one screen being replaced by
 * another.
 *
 * `height: auto` cannot be animated by the browser, so framer-motion
 * measures it, which means the content must be clipped while it moves. It
 * is unclipped again the moment it settles: rings, shadows and focus
 * outlines live outside the content box and would be shaved off otherwise.
 */

import { motion, useReducedMotion } from "framer-motion"
import { type ReactNode, useState } from "react"

/** Slow out, no overshoot: a fold is a fold, it does not bounce. */
const EASE = [0.22, 1, 0.36, 1] as const

export function Fold({
  children,
  className,
  onSettled,
}: {
  children: ReactNode
  className?: string
  /** Fired when the block has finished unfolding and is at its full size. */
  onSettled?: () => void
}) {
  const reduced = useReducedMotion()
  const [settled, setSettled] = useState(false)
  const duration = reduced ? 0 : 0.32

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        height: { duration, ease: EASE },
        // Fade out faster than it collapses and in slower than it unfolds,
        // so what is leaving is gone before the space is, and what arrives
        // has room before it is legible.
        opacity: { duration: duration * 0.6, ease: "easeOut" },
      }}
      onAnimationStart={() => setSettled(false)}
      onAnimationComplete={() => {
        setSettled(true)
        onSettled?.()
      }}
      style={{ overflow: settled ? "visible" : "hidden" }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
