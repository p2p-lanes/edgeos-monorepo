import type { PortalPerson } from "./peopleProjection"

export function orderPeopleForDisplay(people: PortalPerson[]) {
  return [...people].sort(
    (left, right) =>
      Number(right.relationship === "primary") -
      Number(left.relationship === "primary"),
  )
}

export function getPersonInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}
