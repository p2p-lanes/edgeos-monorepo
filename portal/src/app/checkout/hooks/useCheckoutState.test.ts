import { ApiError, type ApplicationPublic } from "@/client"
import type { ApplicationFormSchema } from "@/types/form-schema"
import {
  buildCheckoutApplicationMutationPayload,
  readCheckoutSubmitError,
} from "./useCheckoutState"

const schema: ApplicationFormSchema = {
  base_fields: {
    first_name: {
      type: "text",
      label: "First name",
      required: true,
      target: "human",
    },
    scholarship_request: {
      type: "boolean",
      label: "Scholarship",
      required: false,
      target: "application",
    },
  },
  custom_fields: {
    favorite_color: {
      type: "text",
      label: "Favorite color",
      required: false,
    },
  },
  sections: [],
}

function makeApiError(status: number, body: unknown): ApiError {
  return new ApiError(
    { method: "POST", url: "/api/v1/applications/my" },
    { url: "/api/v1/applications/my", ok: false, status, statusText: "", body },
    "request failed",
  )
}

describe("readCheckoutSubmitError", () => {
  it("surfaces field errors from a validation 400 instead of swallowing them", () => {
    // Regression: this shape used to be dropped, so a missing custom field
    // was reported to the applicant as "you already have an application".
    expect(
      readCheckoutSubmitError(
        makeApiError(400, {
          detail: {
            message: "Invalid custom fields",
            errors: ["Required field 'T-Shirt Size' is missing"],
          },
        }),
      ),
    ).toEqual({
      isDuplicate: false,
      detailText:
        "Invalid custom fields: Required field 'T-Shirt Size' is missing",
    })
  })

  it("flags a genuine duplicate from the detail string", () => {
    expect(
      readCheckoutSubmitError(
        makeApiError(400, { detail: "You already have an application" }),
      ),
    ).toEqual({
      isDuplicate: true,
      detailText: "You already have an application",
    })
  })

  it("flags any 409 as a duplicate", () => {
    expect(readCheckoutSubmitError(makeApiError(409, {})).isDuplicate).toBe(
      true,
    )
  })

  it("reports nothing usable for a non-API error", () => {
    expect(readCheckoutSubmitError(new Error("boom"))).toEqual({
      isDuplicate: false,
      detailText: null,
    })
  })
})

describe("buildCheckoutApplicationMutationPayload", () => {
  it("builds create payloads from checkout-visible base and custom fields", () => {
    expect(
      buildCheckoutApplicationMutationPayload({
        popupId: "popup-1",
        schema,
        values: {
          first_name: "Matias",
          scholarship_request: true,
          custom_favorite_color: "Blue",
          gender_specify: "ignored",
        },
        existingApplication: null,
      }),
    ).toEqual({
      kind: "create",
      payload: {
        popup_id: "popup-1",
        first_name: "Matias",
        last_name: "",
        custom_fields: {
          favorite_color: "Blue",
        },
        status: "in review",
      },
    })
  })

  it("builds update payloads from checkout-visible base and custom fields", () => {
    const existingApplication = {
      id: "app-1",
      popup_id: "popup-1",
    } as ApplicationPublic

    expect(
      buildCheckoutApplicationMutationPayload({
        popupId: "popup-1",
        schema,
        values: {
          first_name: "Matias",
          scholarship_request: false,
          custom_favorite_color: "Green",
        },
        existingApplication,
      }),
    ).toEqual({
      kind: "update",
      payload: {
        first_name: "Matias",
        custom_fields: {
          favorite_color: "Green",
        },
        status: "in review",
      },
    })
  })
})
