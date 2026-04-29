import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ApplicationFormSchema } from "@/types/form-schema"
import UserInfoForm from "."

const mockUseApplicationData = vi.fn()
const mockUseEmailVerification = vi.fn()

vi.mock("react-i18next", async () => {
  const actual =
    await vi.importActual<typeof import("react-i18next")>("react-i18next")
  return {
    ...actual,
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  }
})

vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => true,
}))

vi.mock("../../hooks/useApplicationData", () => ({
  useApplicationData: (args: unknown) => mockUseApplicationData(args),
}))

vi.mock("../../hooks/useEmailVerification", () => ({
  useEmailVerification: (args: unknown) => mockUseEmailVerification(args),
}))

const schema: ApplicationFormSchema = {
  base_fields: {
    email: {
      type: "email",
      label: "Email",
      required: true,
      target: "human",
    },
    first_name: {
      type: "text",
      label: "First name",
      required: true,
      target: "human",
      section_id: "personal",
      position: 1,
    },
    telegram: {
      type: "text",
      label: "Telegram",
      required: true,
      target: "human",
      section_id: "personal",
      position: 3,
    },
  },
  custom_fields: {
    document_id: {
      type: "text",
      label: "Document",
      required: true,
      section_id: "personal",
      position: 2,
    },
    favorite_color: {
      type: "text",
      label: "Favorite color",
      required: true,
      section_id: "preferences",
      position: 1,
    },
  },
  sections: [
    {
      id: "personal",
      label: "Personal info",
      description: "About you",
      order: 1,
      kind: "standard",
    },
    {
      id: "preferences",
      label: "Preferences",
      description: "Your choices",
      order: 2,
      kind: "standard",
    },
  ],
}

describe("UserInfoForm application checkout", () => {
  beforeEach(() => {
    mockUseApplicationData.mockReturnValue({
      applicationData: {
        email: "human@example.com",
        email_verified: true,
        first_name: "Matias",
        telegram: "matias",
        custom_document_id: "12345678",
        custom_favorite_color: "",
      },
      isLoading: false,
      refreshApplicationData: vi.fn(),
    })
    mockUseEmailVerification.mockReturnValue({
      otpEnabled: true,
      showVerificationInput: false,
      verificationCode: "",
      setVerificationCode: vi.fn(),
      isSendingCode: false,
      isVerifyingCode: false,
      verificationError: null,
      countdown: 0,
      handleSendVerificationCode: vi.fn(),
      handleVerifyCode: vi.fn(),
      handleResendCode: vi.fn(),
      handleChangeEmail: vi.fn(),
    })
  })

  it("renders custom fields from the visible personal section only", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <UserInfoForm
        popupId="popup-1"
        popupName="Popup"
        otpEnabled={true}
        schema={schema}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    expect(screen.getByDisplayValue("human@example.com")).toHaveProperty(
      "disabled",
      true,
    )
    expect(screen.getByDisplayValue("Matias")).toBeTruthy()
    expect(screen.getByDisplayValue("12345678")).toBeTruthy()
    expect(screen.queryByLabelText(/Favorite color/)).toBeNull()
    expect(screen.queryByText("Personal info")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "common.continue" }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "human@example.com",
          first_name: "Matias",
          telegram: "matias",
          custom_document_id: "12345678",
        }),
      )
      expect(onSubmit).toHaveBeenCalledWith(
        expect.not.objectContaining({
          custom_favorite_color: expect.anything(),
        }),
      )
    })
  })

  it("does not render or require base fields omitted from the popup schema", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const schemaWithoutTelegram: ApplicationFormSchema = {
      ...schema,
      base_fields: {
        email: schema.base_fields.email,
        first_name: schema.base_fields.first_name,
      },
      custom_fields: {},
    }

    mockUseApplicationData.mockReturnValue({
      applicationData: {
        email: "human@example.com",
        email_verified: true,
        first_name: "Matias",
      },
      isLoading: false,
      refreshApplicationData: vi.fn(),
    })

    render(
      <UserInfoForm
        popupId="popup-1"
        popupName="Popup"
        otpEnabled={true}
        schema={schemaWithoutTelegram}
        onSubmit={onSubmit}
        isSubmitting={false}
      />,
    )

    expect(screen.queryByLabelText(/Telegram/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "common.continue" }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "human@example.com",
          first_name: "Matias",
        }),
      )
    })
  })
})
