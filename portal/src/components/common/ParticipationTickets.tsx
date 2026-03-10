import { TicketPatron, TicketWeek } from "@/components/Icons/Tickets"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toDateRange } from "@/helpers/dates"
import type { ProductsPass } from "@/types/Products"

interface ParticipationProduct {
  category?: string | null
  duration_type?: string | null
  start_date?: string | null
  end_date?: string | null
}

const ParticipationTickets = ({
  participation,
  passes,
}: {
  participation: ParticipationProduct[] | string
  className?: string
  passes: ProductsPass[]
}) => {
  if (typeof participation === "string") return

  const isPatreon = participation.some(
    (product) => product.category === "patreon",
  )
  const hasMonthPass = participation.some(
    (product) => product.duration_type === "month",
  )
  const products = passes.filter(
    (product) =>
      product.duration_type === "week" && product.attendee_category === "main",
  )

  const weeks: (ProductsPass | null)[] = [null, null, null, null]

  const toDay = (date: string) => {
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) return ""
    return parsed.toISOString().slice(0, 10)
  }

  products.forEach((product, index) => {
    if (
      hasMonthPass ||
      participation.find(
        (p) =>
          toDay(p.start_date ?? "") === toDay(product.start_date ?? "") &&
          toDay(p.end_date ?? "") === toDay(product.end_date ?? ""),
      )
    ) {
      weeks[index] = { ...product, purchased: true }
      return
    }
    weeks[index] = product
  })

  return (
    <div className="flex gap-2">
      {weeks.map((week, index) => (
        <Ticket key={week?.id ?? index} week={week} isPatreon={isPatreon} />
      ))}
    </div>
  )
}

const Ticket = ({
  week,
  isPatreon,
}: {
  week: ProductsPass | null
  isPatreon: boolean
}) => {
  const label =
    week?.start_date && week?.end_date
      ? toDateRange(week?.start_date, week?.end_date)
      : "No date"

  return (
    <Tooltip>
      <TooltipTrigger>
        {isPatreon && !!week?.purchased ? (
          <TicketPatron />
        ) : (
          <TicketWeek week={!!week?.purchased} />
        )}
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export default ParticipationTickets
