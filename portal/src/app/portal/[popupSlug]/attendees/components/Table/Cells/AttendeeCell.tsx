import { TableCell } from "@/components/ui/table"
import type { AttendeeDirectory } from "@/types/Attendee"
import CellControl from "./CellControl"

const AttendeeCell = ({
  attendee,
  className,
}: {
  attendee: AttendeeDirectory
  className?: string
}) => {
  return (
    <TableCell className={`whitespace-nowrap min-w-[200px] ${className ?? ""}`}>
      <div className="flex items-center gap-1">
        <CellControl
          className="font-medium text-foreground"
          value={attendee.first_name ?? ""}
        >
          {attendee.first_name}
        </CellControl>
        <CellControl
          className="font-medium text-foreground"
          value={attendee.last_name ?? ""}
        >
          {attendee.last_name}
        </CellControl>
      </div>
    </TableCell>
  )
}
export default AttendeeCell
