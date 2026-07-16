import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { cn } from "../utils"

// Tailwind's typography plugin isn't installed in this repo, so style the
// rendered markdown with explicit child-selector utilities instead of `prose`.
// Descendant selectors (`[&_ul]`) cover nested lists produced by the editor.
export const markdownContentClass =
  "text-sm leading-5 " +
  "[&_p]:my-0 [&_p+p]:mt-2 " +
  "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:my-0.5 " +
  "[&_strong]:font-semibold [&_em]:italic " +
  "[&_a]:text-primary [&_a]:underline"

/**
 * Bare markdown renderer (no wrapper element). Links always open in a new tab.
 * `stopAnchorPropagation` keeps anchor clicks from bubbling into a surrounding
 * interactive element (e.g. a <label> that would otherwise toggle a checkbox).
 * `breaks` turns single newlines into <br> so legacy plain-text content (which
 * relied on `whitespace-pre-wrap`) keeps its line breaks when rendered.
 */
export function MarkdownRenderer({
  source,
  stopAnchorPropagation,
  breaks,
}: {
  source: string
  stopAnchorPropagation?: boolean
  breaks?: boolean
}) {
  return (
    <ReactMarkdown
      remarkPlugins={breaks ? [remarkGfm, remarkBreaks] : [remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a
            {...props}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
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

export interface MarkdownContentProps {
  source: string
  /** Extra classes merged onto the styled wrapper (e.g. text colour). */
  className?: string
  stopAnchorPropagation?: boolean
}

/**
 * Styled markdown block — renders a Markdown string with the shared markdown
 * styling. Used to display event descriptions (and any other markdown content)
 * consistently across apps.
 */
export function MarkdownContent({
  source,
  className,
  stopAnchorPropagation,
}: MarkdownContentProps) {
  return (
    <div className={cn(markdownContentClass, className)}>
      <MarkdownRenderer
        source={source}
        stopAnchorPropagation={stopAnchorPropagation}
        breaks
      />
    </div>
  )
}
