import { Check, Crown, Info, Plus } from "lucide-react"
import type React from "react"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ProductsPass } from "@/types/Products"

// HOC para manejar la l├│gica de presentaci├│n
const withSpecialProductPresentation = (
  WrappedComponent: React.ComponentType<any>,
) => {
  return function WithSpecialProductPresentation(props: SpecialProps) {
    const { selected, disabled, purchased } = props.product

    const getStatusIcon = () => {
      if (disabled || purchased || props.disabled) {
        return null
      }
      if (selected) {
        return <Check className="w-4 h-4" color="#005F3A" />
      }
      return <Plus className="w-4 h-4" />
    }

    return <WrappedComponent {...props} getStatusIcon={getStatusIcon} />
  }
}

interface ProductTitleProps {
  product: ProductsPass
  selected: boolean
  disabled: boolean
}

const ProductTitle = ({ product, selected, disabled }: ProductTitleProps) => (
  <span
    className={cn(
      "font-semibold flex items-center gap-2",
      selected && "text-[#005F3A]",
      disabled && "text-neutral-300",
    )}
  >
    <Crown
      className={cn("w-5 h-5 text-orange-500", disabled && "text-neutral-300")}
    />
    {product.name}
    {!disabled && !product.description && (
      <TooltipPatreon purchased={product.purchased} />
    )}
  </span>
)

interface ProductPriceProps {
  product: ProductsPass
  selected: boolean
  disabled: boolean
}

const ProductPrice = ({ product, selected, disabled }: ProductPriceProps) => (
  <span
    className={cn(
      "font-medium",
      selected && "text-[#005F3A]",
      disabled && "text-neutral-300",
    )}
  >
    ${product.price.toLocaleString()}
  </span>
)

const TooltipPatreon = ({ purchased }: { purchased?: boolean }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div className="cursor-pointer">
        <Info
          className={cn(
            "w-4 h-4 text-neutral-400",
            purchased && "text-primary-foreground",
          )}
        />
      </div>
    </TooltipTrigger>
    <TooltipContent className="bg-card text-foreground max-w-[420px] border border-border">
      A patron pass supports the community and gives you access to the full
      event.
    </TooltipContent>
  </Tooltip>
)

// Interfaces
interface SpecialProps {
  product: ProductsPass
  onClick?: () => void
  disabled?: boolean
}

type VariantStyles = "selected" | "purchased" | "edit" | "disabled" | "default"

const variants: Record<VariantStyles, string> = {
  selected:
    "bg-gradient-to-r from-[#FF7B7B]/30 to-[#E040FB]/30 border-neutral-300",
  purchased:
    "bg-slate-800 text-primary-foreground border-neutral-700 cursor-not-allowed",
  edit: "bg-slate-800/30 border-dashed border-slate-200 text-neutral-700",
  disabled: "bg-neutral-0 text-neutral-300 cursor-not-allowed ",
  default:
    "bg-checkout-card-bg border-neutral-300 text-checkout-title hover:bg-gradient-to-r hover:from-[#FF7B7B]/10 hover:to-[#E040FB]/10",
}

// Componente base
function SpecialBase({
  product,
  onClick,
  getStatusIcon,
  disabled,
}: SpecialProps & {
  getStatusIcon: () => React.ReactElement | null
  disabled: boolean
}) {
  const { selected, disabled: productDisabled, purchased } = product

  const isDisabled = disabled || productDisabled
  const hasOnClick = !isDisabled && onClick && !purchased
  const hasDescription = !!product.description && !purchased
  return (
    <button
      type="button"
      data-category="patreon"
      onClick={hasOnClick ? onClick : undefined}
      data-selected={selected}
      data-price={product.price}
      className={cn(
        "w-full py-1 px-4 border border-neutral-200 rounded-md",
        hasDescription
          ? "flex flex-col gap-1"
          : "flex items-center justify-between gap-2",
        variants[
          purchased
            ? "purchased"
            : isDisabled || !onClick
              ? "disabled"
              : selected
                ? "selected"
                : "default"
        ],
      )}
    >
      <div className="flex items-center justify-between gap-2 w-full">
        <div className="flex items-center gap-2 py-2">
          {getStatusIcon()}
          <ProductTitle
            product={product}
            disabled={isDisabled || !onClick}
            selected={selected ?? false}
          />
        </div>

        <div className="flex items-center gap-4">
          {product.purchased ? (
            <span className="text-sm font-medium text-[white]">Purchased</span>
          ) : (
            <ProductPrice
              product={product}
              selected={selected ?? false}
              disabled={isDisabled || !onClick}
            />
          )}
        </div>
      </div>

      {hasDescription && product.description && (
        <div className="w-full pb-2">
          <ExpandableDescription
            text={product.description}
            clamp={2}
            className={cn(
              "text-xs text-left text-neutral-600",
              (isDisabled || !onClick) && "text-neutral-300",
            )}
          />
        </div>
      )}
    </button>
  )
}

// Exportar el componente envuelto con el HOC
export default withSpecialProductPresentation(SpecialBase)
