/**
 * What each readiness code means, in words.
 *
 * The API sends machine codes and the backoffice owns the wording, so this is
 * where the wording lives — once. Both the flow map and the editor read it,
 * because an operator who saw "The checkout has no steps" on one screen and a
 * different sentence for the same code on the other would reasonably wonder
 * whether they were two different problems.
 */

export const BLOCKER_TEXT: Record<string, string> = {
  no_steps: "The checkout has no steps, so buyers see an empty page",
  sells_nothing: "The steps offer no product that is on sale",
  no_form: "The application form has no questions",
}

export const WARNING_TEXT: Record<string, string> = {
  unlisted: "Not listed in the portal, reachable only by its link",
  accepts_everyone: "No approval rules, so every application is accepted",
}

/**
 * What being unlisted costs depends on the kind of door.
 *
 * For a way in that sells, the link IS the channel: a partner door is
 * deliberately unlisted and works perfectly. For an add-on it is not the same
 * sentence at all — add-ons are discovered on the passes page, and only
 * portal-listed ones reach it, so an unlisted add-on is missing from the one
 * place its buyers would ever look.
 */
export function warningText(code: string, flowType?: string): string {
  if (code === "unlisted" && flowType === "upsale") {
    return "Not on the passes page, so buyers never see it among their add-ons"
  }
  return WARNING_TEXT[code] ?? code
}
