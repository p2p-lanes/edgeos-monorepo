import { TableHead, TableHeader, TableRow } from "@/components/ui/table"

const Header = () => {
  return (
    <TableHeader>
      <TableRow className="border-b border-border bg-card">
        <TableHead className="text-md font-semibold text-foreground whitespace-nowrap min-w-[200px]">
          Attendee
        </TableHead>
        <TableHead className="text-md font-semibold text-foreground whitespace-nowrap min-w-[200px]">
          Email
        </TableHead>
        <TableHead className="text-md font-semibold text-foreground whitespace-nowrap min-w-[150px]">
          Telegram Username
        </TableHead>
        <TableHead className="text-md font-semibold text-foreground whitespace-nowrap min-w-[150px]">
          Role
        </TableHead>
        <TableHead className="text-md font-semibold text-foreground whitespace-nowrap min-w-[200px]">
          Organization
        </TableHead>
      </TableRow>
    </TableHeader>
  )
}
export default Header
