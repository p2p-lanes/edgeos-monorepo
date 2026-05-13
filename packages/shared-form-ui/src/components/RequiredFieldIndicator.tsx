export function RequiredFieldIndicator() {
  // Inherits the label's text colour so the asterisk reads as part of
  // the label rather than an out-of-band warning. The actual error
  // state (missing/invalid field after submit) is communicated by the
  // separate error message rendered below the field, which keeps its
  // destructive colour.
  return <span className="text-current ml-1">*</span>
}
