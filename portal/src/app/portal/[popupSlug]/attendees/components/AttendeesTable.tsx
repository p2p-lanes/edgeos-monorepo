import { Award } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SendBadgeDialog } from "@/components/badges/SendBadgeDialog"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import useGetProfile from "@/hooks/useGetProfile"
import useIssuableBadges from "@/hooks/useIssuableBadges"
import { useCityProvider } from "@/providers/cityProvider"
import type { AttendeeDirectory } from "@/types/Attendee"
import GiveableBadgesBanner from "./GiveableBadgesBanner"
import PaginationControls from "./Pagination"
import AttendeeCell from "./Table/Cells/AttendeeCell"
import CommonCell from "./Table/Cells/CommonCell"
import Header from "./Table/Header"
import "./Table/Cells/styles.css"

type AttendeesTableProps = {
  attendees: AttendeeDirectory[]
  loading: boolean
  totalAttendees: number
  currentPage: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

const AttendeesTable = ({
  attendees,
  loading,
  totalAttendees,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: AttendeesTableProps) => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const popupId = getCity()?.id
  const { issuable } = useIssuableBadges(popupId)
  const canGive = issuable.length > 0
  const { profile } = useGetProfile()
  // You can't give yourself a badge; the server refuses it anyway.
  const isMe = (attendee: AttendeeDirectory) =>
    !!profile?.email &&
    attendee.email?.toLowerCase() === profile.email.toLowerCase()
  const [recipient, setRecipient] = useState<AttendeeDirectory | null>(null)

  if (attendees.length === 0 && !loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <p className="text-center text-muted-foreground">
          {t("attendees.no_attendees")}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-full mt-4">
      <GiveableBadgesBanner issuable={issuable} />
      <Table>
        <Header showBadges={canGive} />
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={canGive ? 6 : 5} className="h-[530px]">
                <div className="flex justify-center items-center h-full">
                  <div className="w-6 h-6 border-2 border-gray-400 border-t-primary rounded-full animate-spin" />
                </div>
              </TableCell>
            </TableRow>
          ) : (
            attendees.map((attendee, index) => (
              <TableRow
                key={index}
                className="group border-b border-border hover:bg-muted bg-card sticky z-10 left-0"
              >
                <AttendeeCell attendee={attendee} />
                <CommonCell value={attendee.email ?? ""} />
                <CommonCell value={attendee.telegram ?? ""} />
                <CommonCell
                  value={
                    attendee.role && attendee.role?.length > 60
                      ? `${attendee.role.slice(0, 60)}...`
                      : (attendee.role ?? "")
                  }
                />
                <CommonCell
                  value={
                    attendee.organization && attendee.organization?.length > 80
                      ? `${attendee.organization.slice(0, 80)}...`
                      : (attendee.organization ?? "")
                  }
                />
                {canGive && (
                  // Pinned to the right edge so it stays reachable while the
                  // other columns scroll sideways.
                  <TableCell className="sticky right-0 whitespace-nowrap bg-card text-right group-hover:bg-muted">
                    {!isMe(attendee) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRecipient(attendee)}
                      >
                        <Award className="mr-1 h-4 w-4" />
                        {t("attendees.badges.give")}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {recipient && popupId && (
        <SendBadgeDialog
          open={!!recipient}
          onOpenChange={(open) => !open && setRecipient(null)}
          popupId={popupId}
          attendeeId={recipient.id}
          recipientName={
            [recipient.first_name, recipient.last_name]
              .filter(Boolean)
              .join(" ") || t("attendees.badges.this_person")
          }
          issuable={issuable}
        />
      )}

      <PaginationControls
        currentPage={currentPage}
        totalItems={totalAttendees}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  )
}

export default AttendeesTable
