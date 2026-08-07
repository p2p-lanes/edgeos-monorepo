import type { TemplateScope } from "@/client"

type ScopedTemplatePayloadArgs = {
  scope: TemplateScope
  popupId?: string
  templateType: string
  htmlContent: string
  subject?: string
}

/**
 * Both gathering-owned and flow-owned templates hang off a popup; only a
 * tenant-owned one does not. Mirrors `_scope_needs_popup` on the API.
 */
export function requirePopupForTemplateScope(scope: TemplateScope): boolean {
  return scope === "popup" || scope === "flow"
}

function maybeAttachPopupId<T extends Record<string, unknown>>(
  scope: TemplateScope,
  popupId: string | undefined,
  payload: T,
): T & { popup_id?: string } {
  if (!requirePopupForTemplateScope(scope)) {
    return payload
  }

  return {
    ...payload,
    popup_id: popupId,
  }
}

/**
 * sdd/sales-flows task 14.1: attaches sales_flow_id to a create payload
 * when the editor is scoped to one flow's own template tier (slice 10).
 * Only create needs this — update/delete target an existing row by id,
 * and preview/send-test render the given HTML directly without resolving
 * a DB tier, so neither takes a sales_flow_id.
 */
function maybeAttachSalesFlowId<T extends Record<string, unknown>>(
  salesFlowId: string | undefined,
  payload: T,
): T & { sales_flow_id?: string } {
  if (!salesFlowId) return payload
  return { ...payload, sales_flow_id: salesFlowId }
}

export function buildEmailTemplateCreatePayload(
  args: ScopedTemplatePayloadArgs & { isActive: boolean; salesFlowId?: string },
) {
  return maybeAttachSalesFlowId(
    args.salesFlowId,
    maybeAttachPopupId(args.scope, args.popupId, {
      template_type: args.templateType,
      html_content: args.htmlContent,
      subject: args.subject,
      is_active: args.isActive,
    }),
  )
}

export function buildEmailTemplatePreviewPayload(
  args: ScopedTemplatePayloadArgs,
) {
  return maybeAttachPopupId(args.scope, args.popupId, {
    template_type: args.templateType,
    html_content: args.htmlContent,
    subject: args.subject,
  })
}

export function buildEmailTemplateSendTestPayload(
  args: ScopedTemplatePayloadArgs & { toEmail: string },
) {
  return maybeAttachPopupId(args.scope, args.popupId, {
    template_type: args.templateType,
    html_content: args.htmlContent,
    subject: args.subject,
    to_email: args.toEmail,
  })
}
