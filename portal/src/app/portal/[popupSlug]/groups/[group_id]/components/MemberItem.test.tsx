import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { GroupMemberPublic } from "@/client"
import en from "@/i18n/locales/en.json"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const [namespace, name] = key.split(".")
      const template =
        (en as unknown as Record<string, Record<string, string>>)[namespace]?.[
          name
        ] ?? key
      return template.replace(
        /\{\{(\w+)\}\}/g,
        (_, variable: string) => options?.[variable] ?? "",
      )
    },
  }),
}))

vi.mock("./AddMemberModal", () => ({ default: () => null }))
vi.mock("./ConfirmDeleteModal", () => ({ default: () => null }))

import MemberItem from "./MemberItem"

afterEach(cleanup)

const baseMember: GroupMemberPublic = {
  id: "member-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
}

const expand = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Toggle details for Ada Lovelace" }),
  )

describe("MemberItem", () => {
  it("shows the full name collapsed and the email once expanded", () => {
    render(<MemberItem member={baseMember} />)

    expect(screen.getByText("Ada Lovelace")).toBeTruthy()
    expect(screen.queryByText("ada@example.com")).toBeNull()

    expand()

    expect(screen.getByText("Email")).toBeTruthy()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
  })

  it("hides optional details that are empty or blank", () => {
    render(
      <MemberItem
        member={{
          ...baseMember,
          gender: "",
          telegram: "   ",
          organization: null,
          role: undefined,
        }}
      />,
    )

    expand()

    expect(screen.getByText("ada@example.com")).toBeTruthy()
    expect(screen.queryByText("Gender")).toBeNull()
    expect(screen.queryByText("Telegram")).toBeNull()
    expect(screen.queryByText("Organization")).toBeNull()
    expect(screen.queryByText("Role")).toBeNull()
  })

  it("shows optional details that have a value", () => {
    render(
      <MemberItem
        member={{
          ...baseMember,
          gender: "Female",
          telegram: "@ada",
          organization: "Analytical Engines",
          role: "Mathematician",
        }}
      />,
    )

    expand()

    expect(screen.getByText("Gender")).toBeTruthy()
    expect(screen.getByText("Female")).toBeTruthy()
    expect(screen.getByText("Telegram")).toBeTruthy()
    expect(screen.getByText("@ada")).toBeTruthy()
    expect(screen.getByText("Organization")).toBeTruthy()
    expect(screen.getByText("Analytical Engines")).toBeTruthy()
    expect(screen.getByText("Role")).toBeTruthy()
    expect(screen.getByText("Mathematician")).toBeTruthy()
  })

  it("marks group leaders with a Leader badge", () => {
    const { rerender } = render(
      <MemberItem member={{ ...baseMember, is_leader: true }} />,
    )
    expect(screen.getByText("Leader")).toBeTruthy()

    rerender(<MemberItem member={{ ...baseMember, is_leader: false }} />)
    expect(screen.queryByText("Leader")).toBeNull()
  })

  it("keeps the Pass holder badge for members with products", () => {
    const { rerender } = render(
      <MemberItem member={{ ...baseMember, products: [{ id: "p-1" }] }} />,
    )
    expect(screen.getByText("Pass holder")).toBeTruthy()

    rerender(<MemberItem member={{ ...baseMember, products: [] }} />)
    expect(screen.queryByText("Pass holder")).toBeNull()
  })

  it("only offers edit and remove to a viewer who can manage members", () => {
    const { rerender } = render(<MemberItem member={baseMember} />)
    expand()
    expect(screen.queryByRole("button", { name: "Edit member" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Remove member" })).toBeNull()

    rerender(<MemberItem member={baseMember} canManageMembers />)
    expect(screen.getByRole("button", { name: "Edit member" })).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "Remove member",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })

  it("disables removing a member who already holds a pass", () => {
    render(
      <MemberItem
        member={{ ...baseMember, products: [{ id: "p-1" }] }}
        canManageMembers
      />,
    )
    expand()

    expect(
      (
        screen.getByRole("button", {
          name: "Remove member",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})
