import { act, renderHook, waitFor } from "@testing-library/react"
import { ApiError, AuthService, CancelablePromise, type Token } from "@/client"
import { useEmailVerification } from "./useEmailVerification"
import "@/i18n/config"

vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}))
vi.mock("@/lib/api-client", () => ({ configureApiClient: vi.fn() }))
vi.mock("@/hooks/useIsAuthenticated", () => ({ dispatchAuthChange: vi.fn() }))

describe("checkout email verification", () => {
  beforeEach(() => {
    vi.spyOn(AuthService, "humanLogin").mockResolvedValue({
      message: "sent",
      email: "guest@example.com",
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it.each([
    401, 404, 429, 500,
  ])("keeps a %s failure visible without retrying on render", async (status) => {
    const error = new ApiError(
      { method: "POST", url: "/auth/human/authenticate" },
      { url: "", ok: false, status, statusText: "Error", body: {} },
      "Invalid code",
    )
    const authenticate = vi
      .spyOn(AuthService, "humanAuthenticate")
      .mockRejectedValueOnce(error)
      // Bound the old retry loop so a regression fails without flooding requests.
      .mockImplementation(() => new CancelablePromise(() => {}))
    const { result, rerender } = renderHook(() =>
      useEmailVerification({
        email: "guest@example.com",
        onVerificationSuccess: () => {},
      }),
    )

    await act(async () => {
      await result.current.handleSendVerificationCode()
    })
    act(() => result.current.setVerificationCode("123456"))

    await waitFor(() => {
      expect(result.current.verificationError).toBeTruthy()
      expect(result.current.isVerifyingCode).toBe(false)
    })
    rerender()
    expect(authenticate).toHaveBeenCalledTimes(1)
  })

  it("allows correcting the code, re-entering it, and resending after failures", async () => {
    const authenticate = vi
      .spyOn(AuthService, "humanAuthenticate")
      .mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() =>
      useEmailVerification({
        email: "guest@example.com",
        onVerificationSuccess: () => {},
      }),
    )
    await act(async () => {
      await result.current.handleSendVerificationCode()
    })

    act(() => result.current.setVerificationCode("123456"))
    await waitFor(() => expect(result.current.verificationError).toBeTruthy())
    act(() => result.current.setVerificationCode("654321"))
    await waitFor(() => {
      expect(authenticate).toHaveBeenCalledTimes(2)
      expect(result.current.isVerifyingCode).toBe(false)
    })
    act(() => result.current.setVerificationCode("65432"))
    act(() => result.current.setVerificationCode("654321"))
    await waitFor(() => {
      expect(authenticate).toHaveBeenCalledTimes(3)
      expect(result.current.isVerifyingCode).toBe(false)
    })

    await act(async () => {
      await result.current.handleResendCode()
    })
    act(() => result.current.setVerificationCode("654321"))
    await waitFor(() => {
      expect(authenticate).toHaveBeenCalledTimes(4)
      expect(result.current.isVerifyingCode).toBe(false)
    })
  })

  it("deduplicates simultaneous submissions and completes successful sign-in", async () => {
    let resolveAuthentication!: (value: Token) => void
    const authenticate = vi
      .spyOn(AuthService, "humanAuthenticate")
      .mockImplementation(
        () =>
          new CancelablePromise((resolve) => {
            resolveAuthentication = resolve
          }),
      )
    const onSuccess = vi.fn()
    const { result } = renderHook(() =>
      useEmailVerification({
        email: "guest@example.com",
        onVerificationSuccess: onSuccess,
      }),
    )
    await act(async () => {
      await result.current.handleSendVerificationCode()
    })
    act(() => result.current.setVerificationCode("123456"))
    await act(async () => {
      await result.current.handleVerifyCode()
    })
    expect(authenticate).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAuthentication({ access_token: "test-token" })
    })
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith("test-token")
    expect(localStorage.getItem("token")).toBe("test-token")
    expect(result.current.showVerificationInput).toBe(false)
    expect(result.current.isVerifyingCode).toBe(false)
  })

  it.each([
    [
      401,
      "Invalid code",
      "Incorrect code. Please check the latest email and try again.",
      false,
    ],
    [
      400,
      "Code has expired",
      "This code has expired. Please request a new code.",
      true,
    ],
    [
      401,
      "No authentication code pending or code has expired",
      "This code has expired. Please request a new code.",
      true,
    ],
    [
      404,
      "No pending registration found",
      "There is no active code. Please request a new code.",
      true,
    ],
    [
      400,
      "No authentication code pending",
      "There is no active code. Please request a new code.",
      true,
    ],
    [
      429,
      "Maximum authentication attempts exceeded",
      "Too many attempts. Please request a new code to continue.",
      true,
    ],
    [
      500,
      "Internal error",
      "We couldn’t verify your code right now. Please try again shortly.",
      false,
    ],
  ] as const)("explains a %s %s failure and requires a new code when necessary", async (status, detail, message, requiresNewCode) => {
    const authenticate = vi
      .spyOn(AuthService, "humanAuthenticate")
      .mockRejectedValue(
        new ApiError(
          { method: "POST", url: "/auth/human/authenticate" },
          { url: "", ok: false, status, statusText: "Error", body: { detail } },
          detail,
        ),
      )
    const { result } = renderHook(() =>
      useEmailVerification({
        email: "guest@example.com",
        onVerificationSuccess: () => {},
      }),
    )
    await act(async () => {
      await result.current.handleSendVerificationCode()
    })
    act(() => result.current.setVerificationCode("123456"))
    await waitFor(() => expect(result.current.verificationError).toBe(message))
    expect(result.current.requiresNewCode).toBe(requiresNewCode)
    expect(authenticate).toHaveBeenCalledTimes(1)

    if (requiresNewCode) {
      act(() => result.current.setVerificationCode("654321"))
      await act(async () => {
        await result.current.handleVerifyCode()
      })
      expect(authenticate).toHaveBeenCalledTimes(1)
    }
  })

  it("explains network errors without automatically retrying", async () => {
    const authenticate = vi
      .spyOn(AuthService, "humanAuthenticate")
      .mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() =>
      useEmailVerification({
        email: "guest@example.com",
        onVerificationSuccess: () => {},
      }),
    )
    await act(async () => {
      await result.current.handleSendVerificationCode()
    })
    act(() => result.current.setVerificationCode("123456"))
    await waitFor(() =>
      expect(result.current.verificationError).toBe(
        "We couldn’t verify your code. Check your connection and try again.",
      ),
    )
    expect(authenticate).toHaveBeenCalledTimes(1)
    expect(result.current.requiresNewCode).toBe(false)
  })
})
