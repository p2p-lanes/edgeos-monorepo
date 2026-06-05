"use client"

import { useTranslation } from "react-i18next"

type Visibility = "public" | "private" | "unlisted"

const HINT_KEY: Record<Visibility, string> = {
  public: "events.form.visibility_hint_public",
  private: "events.form.visibility_hint_private",
  unlisted: "events.form.visibility_hint_unlisted",
}

/**
 * A small reminder shown under the create/save button that spells out what the
 * chosen visibility means for who can see the event. Mirrors the visibility
 * options in VisibilityField.
 */
export function VisibilityHint({ value }: { value: Visibility }) {
  const { t } = useTranslation()
  return (
    <p className="mt-2 text-right text-xs text-muted-foreground">
      {t(HINT_KEY[value])}
    </p>
  )
}
