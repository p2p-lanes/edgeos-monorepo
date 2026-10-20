import { TableHead, TableHeader, TableRow } from "@/components/ui/table"

const Header = ({
  fields,
  showBadges = false,
}: {
  fields: Array<{ id: string; label: string }>
  showBadges?: boolean
}) => {
  return (
    <TableHeader>
      <TableRow className="border-b border-border bg-card">
        <TableHead className="text-md font-semibold text-foreground whitespace-nowrap min-w-[200px]">
          Attendee
        </TableHead>
        {fields.map((field) => (
          <TableHead
            key={field.id}
            className="text-md font-semibold text-foreground whitespace-nowrap min-w-[150px]"
          >
            {field.label}
          </TableHead>
        ))}
        {showBadges && (
          <TableHead className="sticky right-0 bg-card text-md font-semibold text-foreground whitespace-nowrap">
            <span className="sr-only">Badges</span>
          </TableHead>
        )}
      </TableRow>
    </TableHeader>
  )
}
export default Header
