import { describe, expect, it } from "vitest"

import {
  buildEmailTemplateCreatePayload,
  buildEmailTemplatePreviewPayload,
  buildEmailTemplateSendTestPayload,
  requirePopupForTemplateScope,
} from "./email-template-scope"

describe("email-template-scope helpers", () => {
  it("omits popup context for tenant-scoped auth templates", () => {
    expect(
      buildEmailTemplateCreatePayload({
        scope: "tenant",
        popupId: "popup-1",
        templateType: "login_code_human",
        htmlContent: "<html></html>",
        subject: "Tenant subject",
        isActive: true,
      }),
    ).toEqual({
      template_type: "login_code_human",
      html_content: "<html></html>",
      subject: "Tenant subject",
      is_active: true,
    })

    expect(
      buildEmailTemplatePreviewPayload({
        scope: "tenant",
        popupId: "popup-1",
        templateType: "login_code_human",
        htmlContent: "<html></html>",
        subject: "Preview subject",
      }),
    ).toEqual({
      template_type: "login_code_human",
      html_content: "<html></html>",
      subject: "Preview subject",
    })

    expect(
      buildEmailTemplateSendTestPayload({
        scope: "tenant",
        popupId: "popup-1",
        templateType: "login_code_human",
        htmlContent: "<html></html>",
        subject: "Send subject",
        toEmail: "test@example.com",
      }),
    ).toEqual({
      template_type: "login_code_human",
      html_content: "<html></html>",
      subject: "Send subject",
      to_email: "test@example.com",
    })
  })

  it("requires popup context for popup-scoped communications", () => {
    expect(requirePopupForTemplateScope("popup")).toBe(true)
    expect(requirePopupForTemplateScope("tenant")).toBe(false)

    expect(
      buildEmailTemplateCreatePayload({
        scope: "popup",
        popupId: "popup-123",
        templateType: "application_received",
        htmlContent: "<html></html>",
        subject: "Popup subject",
        isActive: false,
      }),
    ).toEqual({
      popup_id: "popup-123",
      template_type: "application_received",
      html_content: "<html></html>",
      subject: "Popup subject",
      is_active: false,
    })
  })

  it("attaches sales_flow_id for a flow-scoped custom template (task 14.1)", () => {
    expect(
      buildEmailTemplateCreatePayload({
        scope: "popup",
        popupId: "popup-123",
        salesFlowId: "flow-456",
        templateType: "application_received",
        htmlContent: "<html></html>",
        subject: "Flow subject",
        isActive: true,
      }),
    ).toEqual({
      popup_id: "popup-123",
      sales_flow_id: "flow-456",
      template_type: "application_received",
      html_content: "<html></html>",
      subject: "Flow subject",
      is_active: true,
    })
  })

  it("omits sales_flow_id when not scoped to a flow", () => {
    const payload = buildEmailTemplateCreatePayload({
      scope: "popup",
      popupId: "popup-123",
      templateType: "application_received",
      htmlContent: "<html></html>",
      isActive: true,
    })
    expect(payload).not.toHaveProperty("sales_flow_id")
  })
})
