import { describe, expect, it } from "vitest"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { splitForCreate } from "./form-data-splitter"

const emptySchema: ApplicationFormSchema = {
  base_fields: {},
  custom_fields: {},
  sections: [],
}

describe("splitForCreate", () => {
  it("omits sales_flow_id when not provided (default-flow resolution unchanged)", () => {
    const result = splitForCreate({
      values: { first_name: "Pat", last_name: "Doe" },
      popupId: "popup-1",
      status: "draft",
      schema: emptySchema,
    })
    expect(result.sales_flow_id).toBeUndefined()
  })

  it("includes sales_flow_id when an explicit flow is targeted (sdd/sales-flows FlowPicker, task 9.4)", () => {
    const result = splitForCreate({
      values: { first_name: "Pat", last_name: "Doe" },
      popupId: "popup-1",
      status: "draft",
      schema: emptySchema,
      salesFlowId: "flow-vip",
    })
    expect(result.sales_flow_id).toBe("flow-vip")
  })
})
