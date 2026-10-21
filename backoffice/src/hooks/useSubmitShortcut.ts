import type { KeyboardEvent } from "react"

/** True on macOS / iOS, where the submit modifier is shown as ⌘. */
export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
  )
}

/**
 * Whether a keydown is the "submit" chord: Cmd+Enter or Ctrl+Enter. Either
 * modifier is accepted on every OS (the hint only names the native one).
 * Plain Enter is left alone so multi-line notes keep their newlines, and the
 * keystroke that confirms an IME composition never submits.
 */
export function isSubmitShortcut(
  e: Pick<
    KeyboardEvent<HTMLElement>,
    "key" | "metaKey" | "ctrlKey" | "nativeEvent"
  >,
): boolean {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return false
  return e.metaKey || e.ctrlKey
}

/**
 * Cmd/Ctrl+Enter submits a comment textarea. `canSubmit` should be false while
 * the body is empty or a submit is already pending, so the chord is swallowed
 * instead of sending twice. Returns the `onKeyDown` handler for the textarea
 * and a platform-specific label for the hint next to the submit button.
 */
export function useSubmitShortcut({
  onSubmit,
  canSubmit,
}: {
  onSubmit: () => void
  canSubmit: boolean
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSubmitShortcut(e)) return
    e.preventDefault()
    if (canSubmit) onSubmit()
  }

  return {
    onKeyDown,
    shortcutLabel: isMacPlatform() ? "⌘+Enter" : "Ctrl+Enter",
  }
}
