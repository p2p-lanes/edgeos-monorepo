"use client"

import { useMutation } from "@tanstack/react-query"
import { CouponsService } from "@/client"

export function usePublicCoupon() {
  return useMutation({
    mutationFn: ({ popupSlug, code }: { popupSlug: string; code: string }) =>
      CouponsService.validateCouponPublic({
        requestBody: {
          popup_slug: popupSlug,
          code,
        },
      }),
  })
}
