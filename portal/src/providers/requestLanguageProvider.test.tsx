import { renderToString } from "react-dom/server"
import { expect, it } from "vitest"
import { queryKeys } from "@/lib/query-keys"
import {
  RequestLanguageProvider,
  useRequestLanguage,
} from "./requestLanguageProvider"

function RuntimeIdentity() {
  return (
    <output>
      {JSON.stringify(
        queryKeys.checkout.runtime(
          "gathering",
          "general",
          useRequestLanguage(),
          "tenant:human",
        ),
      )}
    </output>
  )
}

it("uses the server language rather than a null runtime identity during SSR", () => {
  const html = renderToString(
    <RequestLanguageProvider language="es">
      <RuntimeIdentity />
    </RequestLanguageProvider>,
  )
  expect(html).toContain("es")
  expect(html).toContain("tenant:human")
  expect(html).not.toContain("null")
})
