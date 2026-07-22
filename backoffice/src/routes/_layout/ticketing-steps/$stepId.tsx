import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_layout/ticketing-steps/$stepId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/ticketing-steps",
      search: { step: params.stepId },
    })
  },
})
