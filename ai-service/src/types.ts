export type UserRole =
  | "superadmin"
  | "admin"
  | "operator"
  | "viewer"
  | "check_in_controller"

export type JsonObject = Record<string, unknown>
