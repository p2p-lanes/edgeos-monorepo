import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { RichTextConfig } from "../../types"
import { Checkbox } from "../Checkbox"
import { FormInputWrapper } from "../FormInputWrapper"

export interface RichTextFormProps {
  id: string
  /** Kept for SchemaField compatibility; never rendered — rich_text is a
   * content block and any heading should live in the markdown itself. */
  label?: string
  config?: RichTextConfig
  value?: boolean
  onChange?: (value: boolean) => void
  error?: string
  isRequired?: boolean
  disabled?: boolean
}

// Tailwind's typography plugin isn't installed in this repo, so style the
// rendered markdown with explicit child-selector utilities instead of `prose`.
// `leading-5` pins the line-height at 20px so the checkbox vertical-offset
// math below stays stable regardless of the parent's text styles.
const markdownClass =
  "text-sm leading-5 text-muted-foreground " +
  "[&_p]:my-0 [&_p+p]:mt-2 " +
  "[&>ul]:my-1 [&>ul]:list-disc [&>ul]:pl-5 " +
  "[&>ol]:my-1 [&>ol]:list-decimal [&>ol]:pl-5 " +
  "[&_strong]:font-semibold [&_em]:italic"

function Markdown({
  source,
  stopAnchorPropagation,
}: {
  source: string
  stopAnchorPropagation?: boolean
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a
            {...props}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
            // Prevent the surrounding <label> from toggling the checkbox when
            // the user actually intends to follow the link.
            onClick={
              stopAnchorPropagation ? (e) => e.stopPropagation() : undefined
            }
          >
            {children}
          </a>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  )
}

export function RichTextForm({
  id,
  config,
  value,
  onChange,
  error,
  isRequired,
  disabled,
}: RichTextFormProps) {
  const content = config?.content ?? ""
  const isCheckbox = config?.is_checkbox ?? false

  if (isCheckbox) {
    return (
      <FormInputWrapper>
        <div className="flex items-start my-2">
          {/* Centers the 16px checkbox with the first text line (20px line-box,
              ~14px cap height): 2px top offset puts the checkbox center at 10px,
              matching the visual center of the first line. */}
          <Checkbox
            id={id}
            checked={value ?? false}
            onCheckedChange={(checked: boolean) => onChange?.(checked)}
            disabled={disabled}
            required={isRequired}
            className="mt-0.5 shrink-0 mr-2"
          />
          {/* <label htmlFor> so clicking anywhere on the text toggles the
              checkbox. Anchor clicks call stopPropagation in <Markdown> so they
              still open the link. ml-2.5 (10px) over gap-x — gap-x has
              occasionally compressed inside narrow flex parents. */}
          <label
            htmlFor={id}
            className={`${markdownClass} ml-2.5 flex-1 min-w-0 ${
              disabled ? "cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <Markdown source={content} stopAnchorPropagation />
          </label>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
      </FormInputWrapper>
    )
  }

  return (
    <FormInputWrapper>
      <div className={markdownClass}>
        <Markdown source={content} />
      </div>
    </FormInputWrapper>
  )
}
