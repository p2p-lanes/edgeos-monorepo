import { describe, expect, it } from "vitest"
import { buildReadonlyConnectionString } from "./tenant-db-connection"

const credential = { db_username: "tenant@ro", db_password: "p:/?#" }

describe("tenant database connection string", () => {
  it("uses the advertised endpoint and verifies its TLS hostname when configured", () => {
    expect(
      buildReadonlyConnectionString(credential, {
        db_host: "db.edgeos.world",
        db_port: 5432,
        db_name: "edgeos",
        db_ssl_mode: "verify-full",
      }),
    ).toBe(
      "postgresql://tenant%40ro:p%3A%2F%3F%23@db.edgeos.world:5432/edgeos?sslmode=verify-full",
    )
  })

  it("keeps the previous URL for deployments without a public endpoint", () => {
    expect(
      buildReadonlyConnectionString(credential, {
        db_host: "private-db",
        db_port: 5544,
        db_name: "edgeos",
      }),
    ).toBe("postgresql://tenant%40ro:p%3A%2F%3F%23@private-db:5544/edgeos")
  })
})
