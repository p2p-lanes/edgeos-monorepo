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

  it("includes sales_flow_id when an explicit flow is targeted", () => {
    const result = splitForCreate({
      values: { first_name: "Pat", last_name: "Doe" },
      popupId: "popup-1",
      status: "draft",
      schema: emptySchema,
      salesFlowId: "flow-vip",
    })
    expect(result.sales_flow_id).toBe("flow-vip")
  })

  it("does not submit the retired application privacy field", () => {
    const result = splitForCreate({
      values: {
        first_name: "Pat",
        last_name: "Doe",
        info_not_shared: ["Email"],
      },
      popupId: "popup-1",
      status: "draft",
      schema: {
        ...emptySchema,
        base_fields: {
          info_not_shared: {
            type: "multiselect",
            label: "Info not shared",
            required: false,
            target: "application",
            options: ["Email"],
          },
        },
      },
    })

    expect(result).not.toHaveProperty("info_not_shared")
  })
})
