import { TableCell } from "@/components/ui/table"
import CellControl from "./CellControl"

const CommonCell = ({
  value,
  className,
}: {
  value: string
  className?: string
}) => {
  return (
    <TableCell className={className}>
      <CellControl className="text-foreground" value={value}>
        {value}
      </CellControl>
    </TableCell>
  )
}
export default CommonCell
