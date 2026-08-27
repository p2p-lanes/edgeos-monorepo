export type GenericToolPart = {
  type: string
  state?: string
  text?: string
  toolCallId?: string
  input?: unknown
  output?: unknown
  errorText?: string
  approval?: {
    id: string
    approved?: boolean
    isAutomatic?: boolean
    reason?: string
  }
}

export type ToolRendererProps = {
  part: GenericToolPart
  onApproval: (id: string, approved: boolean) => void
  onNavigate: () => void
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
