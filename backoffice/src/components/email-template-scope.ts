type TemplateScope = "tenant" | "popup"

type ScopedTemplatePayloadArgs = {
  scope: TemplateScope
  popupId?: string
  templateType: string
  htmlContent: string
  subject?: string
}

export function requirePopupForTemplateScope(scope: TemplateScope): boolean {
  return scope === "popup"
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

export function buildEmailTemplateCreatePayload(
  args: ScopedTemplatePayloadArgs & { isActive: boolean },
) {
  return maybeAttachPopupId(args.scope, args.popupId, {
    template_type: args.templateType,
    html_content: args.htmlContent,
    subject: args.subject,
    is_active: args.isActive,
  })
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
