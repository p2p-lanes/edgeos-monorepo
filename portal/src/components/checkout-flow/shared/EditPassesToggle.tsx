"use client"

import { Pencil, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import { formatCurrency } from "@/types/checkout"

/**
 * In-flow entry point for editing already-purchased passes.
 *
 * This is checkout-level functionality, agnostic to how a given template
 * renders products. It lives above the product variant (see DynamicProductStep)
 * so it shows for every ticket template, not just one. Renders nothing until the
 * attendee owns at least one purchased pass.
 */
export default function EditPassesToggle() {
  const { t } = useTranslation()
  const { attendeePasses, isEditing, toggleEditing } = usePassesProvider()
  const { editCredit, editPassesEnabled } = useCheckout()

  const somePurchased = attendeePasses.some((a) =>
    a.products.some((p) => p.purchased),
  )

  // Hide the edit-passes affordance entirely when the popup has pass editing
  // disabled. Credit still applies to purchases (that behavior is decoupled);
  // this only gates the in-flow "give up a pass for credit" UI so it never
  // shows a control that does nothing.
  if (!editPassesEnabled || !somePurchased) return null

  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => toggleEditing()}
          aria-label={
            isEditing
              ? t("passes.cancel_pass_editing")
              : t("passes.edit_passes")
          }
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all shadow-sm active:scale-95",
            isEditing
              ? "bg-muted text-foreground hover:bg-muted/80"
              : "bg-card border border-border text-foreground hover:bg-muted",
          )}
        >
          {isEditing ? (
            <>
              <X className="w-4 h-4" />
              {t("passes.cancel_pass_editing")}
            </>
          ) : (
            <>
              <Pencil className="w-4 h-4" />
              {t("passes.edit_passes")}
            </>
          )}
        </button>
      </div>

      {isEditing && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-primary/30 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-primary">
                {t("checkout.edit_mode_title")}
              </p>
              <p className="text-sm text-primary">
                {t("checkout.edit_mode_description")}
              </p>
            </div>
            {editCredit > 0 && (
              <div className="bg-primary/20 px-3 py-1.5 rounded-lg">
                <p className="text-sm font-semibold text-primary">
                  {t("checkout.credit_label", {
                    amount: formatCurrency(editCredit),
                  })}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
