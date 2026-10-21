import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  AttendeeCategoriesService,
  FormFieldsService,
  SalesFlowsService,
} from "@/client"
import { DirectoryFieldsEditor } from "./DirectoryFieldsEditor"

vi.mock("@/client", () => ({
  AttendeeCategoriesService: { listAttendeeCategories: vi.fn() },
  FormFieldsService: { listFormFields: vi.fn() },
  SalesFlowsService: { listSalesFlows: vi.fn() },
}))

const fields = [
  {
    id: "first_name",
    label: "First name",
    source: "human" as const,
    key: "first_name",
    shareable: true,
  },
  {
    id: "last_name",
    label: "Last name",
    source: "human" as const,
    key: "last_name",
    shareable: true,
  },
  {
    id: "email",
    label: "Email",
    source: "human" as const,
    key: "email",
    shareable: true,
  },
  {
    id: "telegram",
    label: "Telegram username",
    source: "human" as const,
    key: "telegram",
    shareable: true,
  },
  {
    id: "role",
    label: "Role",
    source: "application" as const,
    key: "role",
    shareable: true,
  },
  {
    id: "organization",
    label: "Organization",
    source: "application" as const,
    key: "organization",
    shareable: true,
  },
]

function renderEditor(
  onChange = vi.fn(),
  configuredFields: typeof fields = fields,
) {
  vi.mocked(SalesFlowsService.listSalesFlows).mockResolvedValue({
    results: [{ id: "primary-flow", type: "application", is_default: true }],
  } as never)
  vi.mocked(FormFieldsService.listFormFields).mockResolvedValue({
    results: [
      {
        id: "role-field-id",
        name: "role",
        label: "Role",
        field_type: "text",
        protected: false,
      },
      {
        id: "company-field-id",
        name: "company_name",
        label: "Company name",
        field_type: "text",
        protected: false,
      },
    ],
  } as never)
  vi.mocked(AttendeeCategoriesService.listAttendeeCategories).mockResolvedValue(
    {
      results: [
        {
          id: "spouse-category",
          key: "spouse",
          directory_eligible: true,
          required_fields: [{ name: "email", label: "Email" }],
        },
        {
          id: "kid-category",
          key: "kid",
          directory_eligible: false,
          required_fields: [{ name: "age_group", label: "Age group" }],
        },
      ],
    } as never,
  )

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function ControlledEditor() {
    const [currentFields, setCurrentFields] = useState(configuredFields)
    return (
      <DirectoryFieldsEditor
        popupId="popup-1"
        fields={currentFields}
        onChange={(nextFields) => {
          onChange(nextFields)
          setCurrentFields(nextFields)
        }}
      />
    )
  }
  render(
    <QueryClientProvider client={queryClient}>
      <ControlledEditor />
    </QueryClientProvider>,
  )
  return onChange
}

describe("DirectoryFieldsEditor", () => {
  it("lists existing Human, application, and eligible attendee fields without exposing keys", async () => {
    renderEditor()

    expect(await screen.findByText("Company name")).toBeTruthy()
    expect(
      screen.getAllByRole("checkbox", { name: "Include Email" }),
    ).toHaveLength(1)
    expect(screen.queryByText("Age group")).toBeNull()
    expect(screen.queryByText("From")).toBeNull()
    expect(screen.queryByLabelText("Source key")).toBeNull()
    expect(screen.queryByLabelText("Field ID")).toBeNull()
  })

  it("adds selected fields and moves configured columns in order", async () => {
    const onChange = renderEditor()

    const companyField = await screen.findByRole("checkbox", {
      name: "Include Company name",
    })
    fireEvent.click(companyField)
    expect(onChange).toHaveBeenLastCalledWith([
      ...fields.filter((field) => field.id !== "organization"),
      {
        id: "application_company_field_id",
        label: "Company name",
        source: "application",
        key: "company_name",
        shareable: true,
      },
    ])

    fireEvent.click(
      screen.getByRole("button", { name: "Move Telegram username down" }),
    )
    const moved = onChange.mock.calls.at(-1)?.[0]
    expect(moved?.map((field) => field.id)).toEqual([
      "first_name",
      "last_name",
      "email",
      "role",
      "telegram",
      "application_company_field_id",
    ])
  })

  it("drops stale saved fields and offers current form fields instead", async () => {
    const onChange = vi.fn()
    renderEditor(onChange, [
      {
        id: "role",
        label: "Role",
        source: "application",
        key: "old_role_key",
        shareable: true,
      },
    ])

    const roleField = await screen.findByRole("checkbox", {
      name: "Include Role",
    })
    expect(roleField.getAttribute("aria-checked")).toBe("false")
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(fields.slice(0, 4)),
    )
    expect(screen.queryByText("Saved field not found")).toBeNull()
  })
})
