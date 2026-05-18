import { Ticket } from "lucide-react"

import type { ProductWithQuantity } from "@/client"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type Props = {
  products: ProductWithQuantity[] | null | undefined
}

function ProductLine({ product }: { product: ProductWithQuantity }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium leading-tight">
          {product.name}
        </span>
        {product.category && (
          <span className="text-xs text-muted-foreground">
            {product.category}
          </span>
        )}
      </div>
      {product.price && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {product.price}
        </span>
      )}
    </div>
  )
}

export function ProductsCell({ products }: Props) {
  if (!products || products.length === 0) {
    return null
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs font-medium hover:bg-muted"
        >
          <Ticket className="h-3.5 w-3.5" />
          {products.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="flex flex-col divide-y">
          {products.map((p, i) => (
            <ProductLine key={`${p.id}-${i}`} product={p} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
