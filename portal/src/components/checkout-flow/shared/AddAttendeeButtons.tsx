"use client"

interface AddAttendeeButtonsProps {
  onAttendeeAdded?: (attendeeId: string) => void
  className?: string
}

// Companion add buttons are disabled pending category-driven dynamic flow.
export default function AddAttendeeButtons(
  _props: AddAttendeeButtonsProps,
): null {
  return null
}
