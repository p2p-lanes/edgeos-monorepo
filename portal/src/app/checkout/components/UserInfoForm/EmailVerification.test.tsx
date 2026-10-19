import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ApiError, AuthService, CancelablePromise } from "@/client"
import { useEmailVerification } from "../../hooks/useEmailVerification"
import EmailVerification from "./EmailVerification"
import "@/i18n/config"

vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}))
vi.mock("@/lib/api-client", () => ({ configureApiClient: vi.fn() }))
vi.mock("@/hooks/useIsAuthenticated", () => ({ dispatchAuthChange: vi.fn() }))

function VerificationForm() {
  const verification = useEmailVerification({
    email: "guest@example.com",
    onVerificationSuccess: () => {},
  })
  return (
    <>
      <button
        type="button"
        onClick={() => verification.handleSendVerificationCode()}
      >
        Send initial code
      </button>
      <EmailVerification
        {...verification}
        email="guest@example.com"
        handleEmailChange={() => {}}
        handleSendCode={verification.handleSendVerificationCode}
        isDisabled={verification.isSendingCode || verification.isVerifyingCode}
      />
    </>
  )
}

describe("checkout verification recovery", () => {
  beforeEach(() => {
    vi.spyOn(AuthService, "humanLogin").mockResolvedValue({
      message: "sent",
      email: "guest@example.com",
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([
    [400, "Code has expired"],
    [401, "No authentication code pending or code has expired"],
    [429, "Maximum verification attempts exceeded"],
  ])("requests a replacement after %s %s, then verifies the new code", async (status, detail) => {
    const authenticate = vi
      .spyOn(AuthService, "humanAuthenticate")
      .mockRejectedValueOnce(
        new ApiError(
          { method: "POST", url: "/auth/human/authenticate" },
          {
            url: "",
            ok: false,
            status: Number(status),
            statusText: "Error",
            body: { detail },
          },
          String(detail),
        ),
      )
      .mockResolvedValue({ access_token: "test-token" })
    render(<VerificationForm />)
    fireEvent.click(screen.getByRole("button", { name: "Send initial code" }))
    await screen.findByLabelText("Digit 1 of verification code")
    fireEvent.paste(screen.getByLabelText("Digit 1 of verification code"), {
      clipboardData: { getData: () => "123456" },
    })
    await screen.findByRole("alert")

    const requestNew = screen.getByRole("button", {
      name: "Request new code",
    }) as HTMLButtonElement
    expect(requestNew.disabled).toBe(false)
    expect(
      (
        screen.getByLabelText(
          "Digit 1 of verification code",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true)

    let finishResend!: (value: { message: string; email: string }) => void
    vi.mocked(AuthService.humanLogin).mockImplementationOnce(
      () =>
        new CancelablePromise((resolve) => {
          finishResend = resolve
        }),
    )
    fireEvent.click(requestNew)
    expect(requestNew.disabled).toBe(true)
    fireEvent.click(requestNew)
    expect(AuthService.humanLogin).toHaveBeenCalledTimes(2)
    await act(async () => {
      finishResend({ message: "sent", email: "guest@example.com" })
    })

    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("status").textContent).toBe(
      "A new code has been sent. Previous codes no longer work. Please use the code from the latest email.",
    )
    const input = screen.getByLabelText(
      "Digit 1 of verification code",
    ) as HTMLInputElement
    expect(input.value).toBe("")
    expect(input.disabled).toBe(false)
    expect(
      screen.queryByRole("button", { name: "Request new code" }),
    ).toBeNull()

    fireEvent.paste(input, { clipboardData: { getData: () => "654321" } })
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Digit 1 of verification code"),
      ).toBeNull(),
    )
    localStorage.clear()
  })
})
