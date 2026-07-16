"use client"

import { Placeholder } from "@tiptap/extensions"
import type { Editor } from "@tiptap/react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Bold, Italic, Link as LinkIcon, List, ListOrdered } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Markdown } from "tiptap-markdown"
import { cn } from "../../utils"
import { markdownContentClass } from "../MarkdownContent"

export interface MarkdownEditorProps {
  id?: string
  /** Markdown string. */
  value: string
  /** Called with the serialized Markdown on every change. */
  onChange: (markdown: string) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  error?: string
  className?: string
}

// `tiptap-markdown` augments editor.storage at runtime but ships no types for it.
function getMarkdown(editor: Editor): string {
  return (
    editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown()
}

const toolbarButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground " +
  "hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      // Keep the editor selection when clicking a toolbar button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(toolbarButtonClass, active && "bg-accent text-foreground")}
    >
      {children}
    </button>
  )
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  readOnly,
  error,
  className,
}: MarkdownEditorProps) {
  const editable = !disabled && !readOnly
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState("")
  const linkInputRef = useRef<HTMLInputElement>(null)

  // Focus the URL field when the link editor opens (avoids the autoFocus attr).
  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus()
  }, [linkOpen])

  const editor = useEditor({
    // Avoid SSR hydration mismatch in Next; harmless in Vite.
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        // Configure the bundled Link extension; don't follow links while editing.
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        },
      }),
      Markdown.configure({ html: false, linkify: true, breaks: true }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => {
      onChange(getMarkdown(editor))
    },
    editorProps: {
      attributes: {
        class: cn(
          markdownContentClass,
          "min-h-[72px] w-full px-3 py-2 outline-none",
          // Placeholder extension marks the empty node; render its text via ::before.
          "[&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:float-left",
          "[&_.is-editor-empty]:before:h-0 [&_.is-editor-empty]:before:text-muted-foreground",
          "[&_.is-editor-empty]:before:content-[attr(data-placeholder)]",
        ),
      },
    },
  })

  // Reflect external value changes (form reset, async load) into the editor
  // without clobbering the caret while the user is typing.
  useEffect(() => {
    if (!editor) return
    const current = getMarkdown(editor)
    if (value !== current) {
      editor.commands.setContent(value || "", { emitUpdate: false })
    }
  }, [editor, value])

  // Keep editability in sync with disabled/readOnly toggles.
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  const openLinkEditor = () => {
    if (!editor) return
    setLinkValue(editor.getAttributes("link").href ?? "")
    setLinkOpen(true)
  }

  const applyLink = () => {
    if (!editor) return
    const href = linkValue.trim()
    const chain = editor.chain().focus().extendMarkRange("link")
    if (href) {
      chain.setLink({ href }).run()
    } else {
      chain.unsetLink().run()
    }
    setLinkOpen(false)
    setLinkValue("")
  }

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-transparent shadow-sm",
        "focus-within:ring-1 focus-within:ring-ring",
        error && "border-red-500",
        !editable && "opacity-50",
        className,
      )}
    >
      {editable && (
        <div className="flex items-center gap-0.5 border-b border-input px-1.5 py-1">
          <ToolbarButton
            label="Bold"
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Bullet list"
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Numbered list"
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Link"
            active={editor?.isActive("link") || linkOpen}
            onClick={openLinkEditor}
          >
            <LinkIcon className="h-4 w-4" />
          </ToolbarButton>
        </div>
      )}

      {editable && linkOpen && (
        <div className="flex items-center gap-2 border-b border-input px-2 py-1.5">
          <input
            ref={linkInputRef}
            type="url"
            value={linkValue}
            placeholder="https://example.com"
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                applyLink()
              } else if (e.key === "Escape") {
                e.preventDefault()
                setLinkOpen(false)
              }
            }}
            className="flex-1 rounded border border-input bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={applyLink}
            className="rounded bg-primary px-2 py-1 text-sm text-primary-foreground"
          >
            Apply
          </button>
        </div>
      )}

      <EditorContent editor={editor} id={id} />
      {error && <p className="px-3 pb-2 text-sm text-red-500">{error}</p>}
    </div>
  )
}
