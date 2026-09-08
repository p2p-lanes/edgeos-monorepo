// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { expect, it } from "vitest"
import { allowedPortalPath } from "./api-policy"

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.name === "client" ||
      entry.name === "server" ||
      entry.name.includes(".test.")
    )
      return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(file)
      : /\.tsx?$/.test(file)
        ? [file]
        : []
  })
}

it("covers actual Portal SDK consumers without exposing auth issuance", () => {
  const root = path.resolve(import.meta.dirname, "../..")
  const sdk = readFileSync(path.join(root, "client/sdk.gen.ts"), "utf8")
  const methods = new Map<string, { method: string; url: string }>()
  for (const block of sdk.split("export class ").slice(1)) {
    const service = block.match(/^(\w+)/)![1]
    for (const match of block.matchAll(
      /public static (\w+)\([\s\S]*?method: ['"](\w+)['"],\s*url: ['"]([^'"]+)['"]/g,
    )) {
      methods.set(`${service}.${match[1]}`, { method: match[2], url: match[3] })
    }
  }
  const missing = new Set<string>()
  for (const file of sourceFiles(root)) {
    const content = readFileSync(file, "utf8")
    for (const match of content.matchAll(/(\w+Service)\.(\w+)\s*\(/g)) {
      const name = `${match[1].replace(/^Generated/, "")}.${match[2]}`
      const endpoint = methods.get(name)
      if (!endpoint || name.startsWith("AuthService.")) continue
      const segments = endpoint.url
        .replace("/api/v1/", "")
        .split("/")
        .map((segment) => (segment.startsWith("{") ? "fake-id" : segment))
      if (!allowedPortalPath(endpoint.method, segments))
        missing.add(`${name}: ${endpoint.method} ${endpoint.url}`)
    }
  }
  expect([...missing]).toEqual([])
  expect(allowedPortalPath("POST", ["auth", "human", "authenticate"])).toBe(
    false,
  )
})
