"use client"

import { jwtDecode } from "jwt-decode"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import type { PaymentProductRequest } from "@/client"
import { CouponsService, PaymentsService } from "@/client"
import {
  clearCartStorage,
  loadCheckoutCart,
  markPurchasePending,
  type PersistedCheckoutCart,
  saveCheckoutCart,
} from "@/hooks/useCartStorage"
import useGetPassesData from "@/hooks/useGetPassesData"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  CheckoutCartState,
  CheckoutCartSummary,
  CheckoutStep,
  SelectedHousingItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import { useApplication } from "./applicationProvider"
import { useCityProvider } from "./cityProvider"
import { useDiscount } from "./discountProvider"
import { usePassesProvider } from "./passesProvider"

interface CheckoutContextValue {
  currentStep: CheckoutStep
  availableSteps: CheckoutStep[]
  cart: CheckoutCartState
  summary: CheckoutCartSummary
  passProducts: ProductsPass[]
  housingProducts: ProductsPass[]
  merchProducts: ProductsPass[]
  patronProducts: ProductsPass[]
  attendees: AttendeePassState[]
  isLoading: boolean
  isSubmitting: boolean
  error: string | null
  goToStep: (step: CheckoutStep) => void
  goToNextStep: () => void
  goToPreviousStep: () => void
  togglePass: (attendeeId: string, productId: string) => void
  resetDayProduct: (attendeeId: string, productId: string) => void
  selectHousing: (productId: string, checkIn: string, checkOut: string) => void
  clearHousing: () => void
  updateMerchQuantity: (productId: string, quantity: number) => void
  setPatronAmount: (
    productId: string,
    amount: number,
    isCustom?: boolean,
  ) => void
  clearPatron: () => void
  applyPromoCode: (code: string) => Promise<boolean>
  clearPromoCode: () => void
  toggleInsurance: () => void
  clearCart: () => void
  canProceedToStep: (step: CheckoutStep) => boolean
  isStepComplete: (step: CheckoutStep) => boolean
  submitPayment: () => Promise<{ success: boolean; error?: string }>
  isEditing: boolean
  toggleEditing: (editing?: boolean) => void
  editCredit: number
  monthUpgradeCredit: number
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null)

interface CheckoutProviderProps {
  children: ReactNode
  initialStep?: CheckoutStep
}

export function CheckoutProvider({
  children,
  initialStep = "passes",
}: CheckoutProviderProps) {
  const { attendeePasses, toggleProduct, isEditing, toggleEditing } =
    usePassesProvider()
  const { discountApplied, setDiscount } = useDiscount()
  const { getRelevantApplication } = useApplication()
  const { getCity } = useCityProvider()
  const { products } = useGetPassesData()
  const application = getRelevantApplication()
  const city = getCity()
  const cityId = city?.id

  const citizenId = useMemo(() => {
    try {
      const token =
        typeof window !== "undefined"
          ? window.localStorage.getItem("token")
          : null
      if (!token) return null
      const decoded = jwtDecode<{ citizen_id?: string }>(token)
      return decoded.citizen_id ?? null
    } catch {
      return null
    }
  }, [])

  const hasRestoredCheckoutRef = useRef(false)

  // Step management
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(initialStep)

  // Cart state for non-pass items
  const [housing, setHousing] = useState<SelectedHousingItem | null>(null)
  const [merch, setMerch] = useState<SelectedMerchItem[]>([])
  const [patron, setPatron] = useState<SelectedPatronItem | null>(null)
  const [promoCode, setPromoCode] = useState("")
  const [promoCodeValid, setPromoCodeValid] = useState(false)
  const [promoCodeDiscount, setPromoCodeDiscount] = useState(0)
  const [insurance, setInsurance] = useState(false)

  // Restore checkout cart from localStorage
  useEffect(() => {
    if (hasRestoredCheckoutRef.current || !cityId || !citizenId) return

    hasRestoredCheckoutRef.current = true

    if (initialStep === "success") {
      clearCartStorage(citizenId, cityId)
      return
    }

    const savedCart = loadCheckoutCart(citizenId, cityId)
    if (!savedCart) return

    // Restore housing
    if (savedCart.housing) {
      const product = products.find(
        (p) => p.id === savedCart.housing?.productId,
      )
      if (product) {
        const start = new Date(savedCart.housing.checkIn)
        const end = new Date(savedCart.housing.checkOut)
        const nights = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
        )
        setHousing({
          productId: product.id,
          product,
          checkIn: savedCart.housing.checkIn,
          checkOut: savedCart.housing.checkOut,
          nights,
          pricePerNight: product.price,
          totalPrice: product.price * nights,
        })
      }
    }

    // Restore merch
    if (savedCart.merch?.length) {
      const restoredMerch = savedCart.merch.reduce<SelectedMerchItem[]>(
        (acc, saved) => {
          const product = products.find((p) => p.id === saved.productId)
          if (!product || saved.quantity <= 0) return acc
          acc.push({
            productId: product.id,
            product,
            quantity: saved.quantity,
            unitPrice: product.price,
            totalPrice: product.price * saved.quantity,
          })
          return acc
        },
        [],
      )
      if (restoredMerch.length > 0) setMerch(restoredMerch)
    }
  }, [cityId, citizenId, products, initialStep])

  // Loading states
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset isSubmitting when page is restored from bfcache
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setIsSubmitting(false)
      }
    }

    window.addEventListener("pageshow", handlePageShow)
    return () => window.removeEventListener("pageshow", handlePageShow)
  }, [])

  // Filter products by category
  const passProducts = useMemo(
    () => products.filter((p) => p.category === "ticket" && p.is_active),
    [products],
  )

  const housingProducts = useMemo(
    () => products.filter((p) => p.category === "housing" && p.is_active),
    [products],
  )

  const merchProducts = useMemo(
    () => products.filter((p) => p.category === "merch" && p.is_active),
    [products],
  )

  const patronProducts = useMemo(
    () => products.filter((p) => p.category === "patreon" && p.is_active),
    [products],
  )

  // Calculate available steps dynamically
  const availableSteps = useMemo<CheckoutStep[]>(() => {
    const steps: CheckoutStep[] = ["passes"]

    if (patronProducts.length > 0) steps.push("patron")
    if (housingProducts.length > 0) steps.push("housing")
    if (merchProducts.length > 0) steps.push("merch")

    steps.push("confirm")

    return steps
  }, [patronProducts.length, housingProducts.length, merchProducts.length])

  // Build selected passes from attendeePasses
  const selectedPasses = useMemo<SelectedPassItem[]>(() => {
    const passes: SelectedPassItem[] = []

    for (const attendee of attendeePasses) {
      for (const product of attendee.products) {
        if (product.selected && !(isEditing && product.purchased)) {
          const isDayPass = product.duration_type === "day"
          const quantity = isDayPass
            ? (product.quantity ?? 1) - (product.original_quantity ?? 0)
            : 1

          if (quantity > 0) {
            passes.push({
              productId: product.id,
              product,
              attendeeId: attendee.id,
              attendee,
              quantity,
              price: product.price * quantity,
              originalPrice: product.original_price
                ? product.original_price * quantity
                : undefined,
            })
          }
        }
      }
    }

    return passes
  }, [attendeePasses, isEditing])

  // Compute edit credit from attendeePasses
  const editCredit = useMemo(() => {
    if (!isEditing) return 0
    return attendeePasses.reduce((total, attendee) => {
      return (
        total +
        attendee.products
          .filter((p) => p.edit && p.purchased)
          .reduce((sum, p) => sum + p.price * (p.quantity ?? 1), 0)
      )
    }, 0)
  }, [attendeePasses, isEditing])

  // Month upgrade credit
  const monthUpgradeCredit = useMemo(() => {
    if (isEditing) return 0

    const hasPatreonSelected = attendeePasses.some((a) =>
      a.products.some((p) => p.category === "patreon" && p.selected),
    )
    if (hasPatreonSelected) return 0

    return attendeePasses.reduce((total, attendee) => {
      const hasMonthSelected = attendee.products.some(
        (p) => p.duration_type === "month" && p.selected && !p.purchased,
      )
      if (!hasMonthSelected) return total

      const hasPurchasedWeekOrDay = attendee.products.some(
        (p) =>
          (p.duration_type === "week" || p.duration_type === "day") &&
          p.purchased,
      )
      if (!hasPurchasedWeekOrDay) return total

      const purchasedCredit = attendee.products
        .filter((p) => p.category !== "patreon" && p.purchased)
        .reduce((sum, p) => sum + p.price * (p.quantity ?? 1), 0)

      return total + purchasedCredit
    }, 0)
  }, [attendeePasses, isEditing])

  // Calculate insurance amount
  const calculateInsuranceAmount = useCallback(
    (
      passes: SelectedPassItem[],
      housingItem: SelectedHousingItem | null,
      merchItems: SelectedMerchItem[],
    ): number => {
      // Insurance percentage defaults to 5% if not specified on product
      const DEFAULT_INSURANCE_PCT = 5
      let total = 0

      for (const pass of passes) {
        const pct =
          (pass.product as ProductsPass & { insurance_percentage?: number })
            .insurance_percentage ?? DEFAULT_INSURANCE_PCT
        const basePrice = pass.originalPrice ?? pass.price
        total += (basePrice * pct) / 100
      }

      if (housingItem) {
        const pct =
          (
            housingItem.product as ProductsPass & {
              insurance_percentage?: number
            }
          ).insurance_percentage ?? DEFAULT_INSURANCE_PCT
        total += (housingItem.totalPrice * pct) / 100
      }

      for (const item of merchItems) {
        const pct =
          (item.product as ProductsPass & { insurance_percentage?: number })
            .insurance_percentage ?? DEFAULT_INSURANCE_PCT
        total += (item.totalPrice * pct) / 100
      }

      return total
    },
    [],
  )

  const insurancePotentialAmount = useMemo(
    () => calculateInsuranceAmount(selectedPasses, housing, merch),
    [selectedPasses, housing, merch, calculateInsuranceAmount],
  )

  const insuranceAmount = useMemo(() => {
    if (!insurance) return 0
    return insurancePotentialAmount
  }, [insurance, insurancePotentialAmount])

  // Build cart state
  const cart = useMemo<CheckoutCartState>(
    () => ({
      passes: selectedPasses,
      housing,
      merch,
      patron,
      promoCode,
      promoCodeValid,
      promoCodeDiscount,
      insurance,
      insurancePrice: insuranceAmount,
      insurancePotentialPrice: insurancePotentialAmount,
    }),
    [
      selectedPasses,
      housing,
      merch,
      patron,
      promoCode,
      promoCodeValid,
      promoCodeDiscount,
      insurance,
      insuranceAmount,
      insurancePotentialAmount,
    ],
  )

  // Persist checkout cart to localStorage
  useEffect(() => {
    if (!cityId || !citizenId || !hasRestoredCheckoutRef.current) return
    const persistedCart: PersistedCheckoutCart = {
      housing: housing
        ? {
            productId: housing.productId,
            checkIn: housing.checkIn,
            checkOut: housing.checkOut,
          }
        : null,
      merch: merch.map((m) => ({
        productId: m.productId,
        quantity: m.quantity,
      })),
      patron: null,
    }
    saveCheckoutCart(citizenId, cityId, persistedCart)
  }, [housing, merch, cityId, citizenId])

  // Calculate summary
  const summary = useMemo<CheckoutCartSummary>(() => {
    const passesSubtotal = selectedPasses.reduce((sum, p) => sum + p.price, 0)
    const passesOriginalSubtotal = selectedPasses.reduce(
      (sum, p) => sum + (p.originalPrice ?? p.price),
      0,
    )
    const housingSubtotal = housing?.totalPrice ?? 0
    const merchSubtotal = merch.reduce((sum, m) => sum + m.totalPrice, 0)
    const patronSubtotal = patron?.amount ?? 0
    const insuranceSubtotal = insuranceAmount

    const subtotal =
      passesSubtotal +
      housingSubtotal +
      merchSubtotal +
      patronSubtotal +
      insuranceSubtotal
    const originalSubtotal =
      passesOriginalSubtotal +
      housingSubtotal +
      merchSubtotal +
      patronSubtotal +
      insuranceSubtotal
    const discount = originalSubtotal - subtotal
    const accountCredit = 0 // ApplicationPublic does not have credit field yet
    const credit = isEditing
      ? editCredit + accountCredit
      : accountCredit + monthUpgradeCredit
    const grandTotal = Math.max(0, subtotal - credit)

    const itemCount =
      selectedPasses.length +
      (housing ? 1 : 0) +
      merch.length +
      (patron ? 1 : 0)

    return {
      passesSubtotal,
      housingSubtotal,
      merchSubtotal,
      patronSubtotal,
      insuranceSubtotal,
      subtotal: originalSubtotal,
      discount,
      credit,
      grandTotal,
      itemCount,
    }
  }, [
    selectedPasses,
    housing,
    merch,
    patron,
    insuranceAmount,
    isEditing,
    editCredit,
    monthUpgradeCredit,
  ])

  // Navigation
  const goToStep = useCallback((step: CheckoutStep) => {
    setCurrentStep(step)
    setError(null)
  }, [])

  const goToNextStep = useCallback(() => {
    const currentIndex = availableSteps.indexOf(currentStep)
    if (currentIndex < availableSteps.length - 1) {
      setCurrentStep(availableSteps[currentIndex + 1])
      setError(null)
    }
  }, [currentStep, availableSteps])

  const goToPreviousStep = useCallback(() => {
    const currentIndex = availableSteps.indexOf(currentStep)
    if (currentIndex > 0) {
      setCurrentStep(availableSteps[currentIndex - 1])
      setError(null)
    }
  }, [currentStep, availableSteps])

  // Pass actions (delegate to passesProvider)
  const togglePass = useCallback(
    (attendeeId: string, productId: string) => {
      const attendee = attendeePasses.find((a) => a.id === attendeeId)
      const product = attendee?.products.find((p) => p.id === productId)
      if (product) {
        toggleProduct(attendeeId, product)
      }
    },
    [attendeePasses, toggleProduct],
  )

  const resetDayProduct = useCallback(
    (attendeeId: string, productId: string) => {
      const attendee = attendeePasses.find((a) => a.id === attendeeId)
      const product = attendee?.products.find((p) => p.id === productId)
      if (product) {
        const resetProduct = {
          ...product,
          quantity: product.original_quantity ?? 0,
        }
        toggleProduct(attendeeId, resetProduct)
      }
    },
    [attendeePasses, toggleProduct],
  )

  // Housing actions
  const selectHousing = useCallback(
    (productId: string, checkIn: string, checkOut: string) => {
      const product = housingProducts.find((p) => p.id === productId)
      if (!product) return

      const start = new Date(checkIn)
      const end = new Date(checkOut)
      const nights = Math.max(
        1,
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
      )

      setHousing({
        productId,
        product,
        checkIn,
        checkOut,
        nights,
        pricePerNight: product.price,
        totalPrice: product.price * nights,
      })
    },
    [housingProducts],
  )

  const clearHousing = useCallback(() => {
    setHousing(null)
  }, [])

  // Merch actions
  const updateMerchQuantity = useCallback(
    (productId: string, quantity: number) => {
      const product = merchProducts.find((p) => p.id === productId)
      if (!product) return

      if (quantity <= 0) {
        setMerch((prev) => prev.filter((m) => m.productId !== productId))
      } else {
        setMerch((prev) => {
          const existing = prev.find((m) => m.productId === productId)
          if (existing) {
            return prev.map((m) =>
              m.productId === productId
                ? { ...m, quantity, totalPrice: product.price * quantity }
                : m,
            )
          }
          return [
            ...prev,
            {
              productId,
              product,
              quantity,
              unitPrice: product.price,
              totalPrice: product.price * quantity,
            },
          ]
        })
      }
    },
    [merchProducts],
  )

  // Patron actions
  const setPatronAmount = useCallback(
    (productId: string, amount: number, isCustom = false) => {
      const product = patronProducts.find((p) => p.id === productId)
      if (!product) return

      setPatron({
        productId,
        product,
        amount,
        isCustomAmount: isCustom,
      })
    },
    [patronProducts],
  )

  const clearPatron = useCallback(() => {
    setPatron(null)
  }, [])

  // Promo code validation
  const applyPromoCode = useCallback(
    async (code: string): Promise<boolean> => {
      if (!city?.id) return false

      setIsLoading(true)
      setError(null)

      try {
        const result = await CouponsService.validateCoupon({
          requestBody: {
            popup_id: city.id,
            code: code.toUpperCase(),
          },
        })

        const discountValue = result.discount_value ?? 0

        if (discountValue >= discountApplied.discount_value) {
          setPromoCode(code.toUpperCase())
          setPromoCodeValid(true)
          setPromoCodeDiscount(discountValue)

          setDiscount({
            discount_value: discountValue,
            discount_type: "percentage",
            discount_code: code.toUpperCase(),
            city_id: city.id,
          })

          return true
        }
        setError("You already have a higher discount than this coupon")
        return false
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to validate promo code"
        setError(message)
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [city?.id, discountApplied.discount_value, setDiscount],
  )

  const clearPromoCode = useCallback(() => {
    setPromoCode("")
    setPromoCodeValid(false)
    setPromoCodeDiscount(0)
  }, [])

  // Insurance
  const toggleInsurance = useCallback(() => {
    setInsurance((prev) => !prev)
  }, [])

  // Cart management
  const clearCart = useCallback(() => {
    setHousing(null)
    setMerch([])
    setPatron(null)
    setPromoCode("")
    setPromoCodeValid(false)
    setPromoCodeDiscount(0)
    setInsurance(false)
    if (cityId && citizenId) {
      clearCartStorage(citizenId, cityId)
    }
  }, [cityId, citizenId])

  // Validation helpers
  const canProceedToStepFn = useCallback(
    (step: CheckoutStep): boolean => {
      const targetIndex = availableSteps.indexOf(step)

      if (isEditing) {
        return selectedPasses.length > 0
      }

      if (targetIndex > 0 && selectedPasses.length === 0) {
        return false
      }

      return true
    },
    [selectedPasses.length, availableSteps, isEditing],
  )

  const isStepCompleteFn = useCallback(
    (step: CheckoutStep): boolean => {
      switch (step) {
        case "passes":
          return selectedPasses.length > 0
        case "housing":
        case "merch":
        case "patron":
          return true
        case "confirm":
          return false
        default:
          return false
      }
    },
    [selectedPasses.length],
  )

  // Submit payment
  const submitPayment = useCallback(async (): Promise<{
    success: boolean
    error?: string
  }> => {
    if (!application?.id) {
      return { success: false, error: "Application not available" }
    }

    if (selectedPasses.length === 0) {
      return {
        success: false,
        error: isEditing
          ? "Please select a new pass"
          : "Please select at least one pass",
      }
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const productsToSend: PaymentProductRequest[] = []

      const monthSelectedWithWeekOrDay = attendeePasses.some(
        (a) =>
          a.products.some(
            (p) => p.duration_type === "month" && p.selected && !p.purchased,
          ) &&
          (a.products.some((p) => p.duration_type === "week" && p.purchased) ||
            a.products.some((p) => p.duration_type === "day" && p.purchased)),
      )
      const hasPatreonSelected = attendeePasses.some((a) =>
        a.products.some((p) => p.category === "patreon" && p.selected),
      )
      const isMonthUpgrade = monthSelectedWithWeekOrDay && !hasPatreonSelected

      if (isEditing) {
        for (const attendee of attendeePasses) {
          for (const product of attendee.products) {
            // Kept: purchased and NOT given up for credit
            if (product.purchased && !product.edit) {
              productsToSend.push({
                product_id: product.id,
                attendee_id: attendee.id,
                quantity: product.quantity ?? 1,
              })
            }
            // New: selected and not previously purchased
            if (product.selected && !product.purchased) {
              productsToSend.push({
                product_id: product.id,
                attendee_id: attendee.id,
                quantity:
                  product.duration_type === "day"
                    ? (product.quantity ?? 1) - (product.original_quantity ?? 0)
                    : (product.quantity ?? 1),
              })
            }
          }
        }
      } else {
        const hasAccountCredit = false // ApplicationPublic doesn't have credit yet

        if (hasAccountCredit || isMonthUpgrade) {
          for (const attendee of attendeePasses) {
            const hasMonth = attendee.products.some(
              (p) => p.duration_type === "month" && (p.purchased || p.selected),
            )

            for (const product of attendee.products) {
              if (!product.purchased) continue
              if (
                hasMonth &&
                (product.duration_type === "week" ||
                  product.duration_type === "day")
              )
                continue
              if (patron && product.category === "patreon") continue

              productsToSend.push({
                product_id: product.id,
                attendee_id: attendee.id,
                quantity: product.quantity ?? 1,
              })
            }
          }
        }

        // Add selected passes
        for (const pass of selectedPasses) {
          productsToSend.push({
            product_id: pass.productId,
            attendee_id: pass.attendeeId,
            quantity: pass.quantity,
          })
        }

        // Add merch
        for (const item of merch) {
          const firstAttendeeId = selectedPasses[0]?.attendeeId ?? ""
          productsToSend.push({
            product_id: item.productId,
            attendee_id: firstAttendeeId,
            quantity: item.quantity,
          })
        }

        // Add housing
        if (housing) {
          const firstAttendeeId = selectedPasses[0]?.attendeeId ?? ""
          productsToSend.push({
            product_id: housing.productId,
            attendee_id: firstAttendeeId,
            quantity: housing.nights,
          })
        }

        // Add patron
        if (patron) {
          const firstAttendeeId = selectedPasses[0]?.attendeeId ?? ""
          productsToSend.push({
            product_id: patron.productId,
            attendee_id: firstAttendeeId,
            quantity: 1,
          })
        }
      }

      const result = await PaymentsService.createMyPayment({
        requestBody: {
          application_id: application.id,
          products: productsToSend,
          coupon_code: promoCodeValid ? promoCode : undefined,
          edit_passes: isEditing || isMonthUpgrade ? true : undefined,
        },
      })

      // Handle PaymentPreview (has checkout_url) or PaymentPublic
      const data = result as {
        status?: string
        checkout_url?: string | null
      }

      if (data.status === "pending" && data.checkout_url) {
        markPurchasePending()
        const currentUrl = new URL(window.location.href)
        currentUrl.searchParams.set("checkout", "success")
        const redirectUrl = currentUrl.toString()
        window.location.href = `${data.checkout_url}?redirect_url=${encodeURIComponent(redirectUrl)}`
        return { success: true }
      }

      if (data.status === "approved") {
        toast.success(
          isEditing
            ? "Your passes have been updated successfully!"
            : "Payment completed successfully!",
        )
        if (isEditing) {
          toggleEditing(false)
        }
        clearCart()
        setCurrentStep("success")
        setIsSubmitting(false)
        return { success: true }
      }

      setIsSubmitting(false)
      return { success: true }
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to create payment"
      setError(errorMsg)
      toast.error(errorMsg)
      setIsSubmitting(false)
      return { success: false, error: errorMsg }
    }
  }, [
    application?.id,
    selectedPasses,
    merch,
    housing,
    patron,
    promoCodeValid,
    promoCode,
    clearCart,
    isEditing,
    attendeePasses,
    toggleEditing,
  ])

  const value: CheckoutContextValue = {
    currentStep,
    availableSteps,
    cart,
    summary,
    passProducts,
    housingProducts,
    merchProducts,
    patronProducts,
    attendees: attendeePasses,
    isLoading,
    isSubmitting,
    error,
    goToStep,
    goToNextStep,
    goToPreviousStep,
    togglePass,
    resetDayProduct,
    selectHousing,
    clearHousing,
    updateMerchQuantity,
    setPatronAmount,
    clearPatron,
    applyPromoCode,
    clearPromoCode,
    toggleInsurance,
    clearCart,
    canProceedToStep: canProceedToStepFn,
    isStepComplete: isStepCompleteFn,
    submitPayment,
    isEditing,
    toggleEditing,
    editCredit,
    monthUpgradeCredit,
  }

  return (
    <CheckoutContext.Provider value={value}>
      {children}
    </CheckoutContext.Provider>
  )
}

export function useCheckout(): CheckoutContextValue {
  const context = useContext(CheckoutContext)
  if (!context) {
    throw new Error("useCheckout must be used within a CheckoutProvider")
  }
  return context
}
