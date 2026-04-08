export const HUMAN_APPLICATION_FILTER = {
  ALL: "all",
  INCOMPLETE: "incomplete",
} as const

export type HumansApplicationFilter =
  (typeof HUMAN_APPLICATION_FILTER)[keyof typeof HUMAN_APPLICATION_FILTER]

export function getHumansNavigationTarget() {
  return {
    to: "/humans" as const,
    search: {
      applicationFilter: HUMAN_APPLICATION_FILTER.ALL,
    },
  }
}
