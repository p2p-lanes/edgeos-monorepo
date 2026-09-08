// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { handlePortalApi } from "./api-handler"
import { handleAuthPost, handleSessionGet } from "./auth-handlers"
import {
  ingressHeaders,
  isStaticHost,
  requireApplicationHost,
  trustedClientIp,
} from "./ingress"

beforeEach(() => {
  vi.stubEnv("AWS_EXECUTION_ENV", undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
it.each([
  "production",
  "development",
])("ignores caller forwarding in local %s runtime", (environment) => {
  vi.stubEnv("NODE_ENV", environment)
  expect(
    ingressHeaders(
      new Headers({
        "x-forwarded-for": "spoofed, 203.0.113.7",
        "x-real-ip": "1.2.3.4",
        "x-forwarded-host": "AWS_ECS_FARGATE",
        "aws-execution-env": "AWS_ECS_FARGATE",
        "x-aws-execution-env": "AWS_ECS_FARGATE",
      }),
    ),
  ).toEqual({})
})
it.each([
  "AWS_ECS_EC2",
  "AWS_Lambda_nodejs22.x",
  "unknown",
  "",
  "aws_ecs_fargate",
])("does not trust an unverified runtime: %s", (runtime) => {
  vi.stubEnv("AWS_EXECUTION_ENV", runtime)
  expect(
    ingressHeaders(new Headers({ "x-forwarded-for": "203.0.113.7" })),
  ).toEqual({})
})
it("uses the Fargate runtime default without an operator setting or client override", () => {
  vi.stubEnv("AWS_EXECUTION_ENV", "AWS_ECS_FARGATE")
  expect(
    ingressHeaders(
      new Headers({
        "x-forwarded-for": "forged, 203.0.113.7",
        "aws-execution-env": "AWS_ECS_EC2",
      }),
    ),
  ).toEqual({ "X-Forwarded-For": "203.0.113.7" })
  expect(ingressHeaders(new Headers({ "x-real-ip": "1.2.3.4" }))).toEqual({})
})
it.each([
  ["203.0.113.7", "203.0.113.7"],
  ["2001:db8::7", "2001:db8::7"],
  ["spoofed, 203.0.113.7", "203.0.113.7"],
  ["198.51.100.1, 2001:db8::7", "2001:db8::7"],
  ["203.0.113.7,", null],
  ["203.0.113.7, unknown", null],
  ["203.0.113.7, 1.2.3.4:1234", null],
  ["203.0.113.7, [2001:db8::7]:443", null],
  ["203.0.113.7, [2001:db8::7]", null],
  ["203.0.113.7, fe80::1%eth0", null],
  ["203.0.113.7, 01.02.03.04", null],
  ["", null],
])("trusts only the final bare IP: %s", (chain, expected) => {
  vi.stubEnv("AWS_EXECUTION_ENV", "AWS_ECS_FARGATE")
  expect(
    trustedClientIp(
      new Headers({ "x-forwarded-for": chain, "x-real-ip": "9.9.9.9" }),
    ),
  ).toBe(expected)
})
it("excludes exact CDN and origin hosts without blocking custom domains", () => {
  vi.stubEnv("ASSET_PREFIX", "https://cdn.example.com/assets")
  expect(isStaticHost("cdn.example.com")).toBe(true)
  expect(isStaticHost("static.edgeos.world")).toBe(true)
  expect(isStaticHost("static-origin.edgeos.world")).toBe(true)
  expect(isStaticHost("tickets.example.com")).toBe(false)
  expect(() => requireApplicationHost("static.edgeos.world")).toThrow(
    "static_host_only",
  )
})
it("forwards one verified hop through the actual Portal adapter", async () => {
  vi.stubEnv("AWS_EXECUTION_ENV", "AWS_ECS_FARGATE")
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        slug: "demo",
        landing_mode: "portal",
      }),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }))
  vi.stubGlobal("fetch", fetchMock)
  const response = await handlePortalApi(
    new Request("https://demo.example.com/api/v1/checkout/popup/flow/runtime", {
      headers: {
        host: "demo.example.com",
        "x-forwarded-for": "attacker, 203.0.113.7",
        "x-real-ip": "1.2.3.4",
      },
    }),
    ["checkout", "popup", "flow", "runtime"],
  )
  expect(response.status).toBe(200)
  expect(fetchMock.mock.calls[1][1].headers.get("x-forwarded-for")).toBe(
    "203.0.113.7",
  )
  expect(fetchMock.mock.calls[1][1].headers.has("x-real-ip")).toBe(false)
})
it.each([
  "static.edgeos.world",
  "static-origin.edgeos.world",
])("rejects auth/session/API on %s before upstream traffic", async (host) => {
  const fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  const headers = {
    host,
    origin: `https://${host}`,
    "content-type": "application/json",
  }
  for (const action of ["login", "verify", "migrate", "logout"] as const) {
    const response = await handleAuthPost(
      new Request(`https://${host}/api/auth/${action}`, {
        method: "POST",
        headers,
        body: "{}",
      }),
      action,
    )
    expect(response.status).toBe(404)
    expect(response.headers.get("set-cookie")).toBeNull()
  }
  expect(
    (
      await handleSessionGet(
        new Request(`https://${host}/api/auth/session`, { headers }),
      )
    ).status,
  ).toBe(404)
  expect(
    (
      await handlePortalApi(
        new Request(`https://${host}/api/v1/humans/me`, { headers }),
        ["humans", "me"],
      )
    ).status,
  ).toBe(404)
  expect(fetchMock).not.toHaveBeenCalled()
})
