import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export interface SidebarLink {
  id: string
  label: string
  url: string
}

export interface SidebarSection {
  id: string
  kind: "commerce" | "checkouts" | "community" | "external"
  title?: string
  links?: SidebarLink[]
}

export interface PopupSidebarConfig {
  [key: string]: unknown
  sections: SidebarSection[]
}

const DEFAULT_SECTIONS: SidebarSection[] = [
  { id: "commerce", kind: "commerce" },
  { id: "checkouts", kind: "checkouts" },
  { id: "community", kind: "community" },
]

const SECTION_LABELS: Record<SidebarSection["kind"], string> = {
  commerce: "General",
  checkouts: "Commerce (checkout options)",
  community: "Community",
  external: "External links",
}

export function PopupSidebarEditor({
  value,
  onChange,
  disabled,
}: {
  value: PopupSidebarConfig | null
  onChange: (value: PopupSidebarConfig | null) => void
  disabled: boolean
}) {
  const [linkDrafts, setLinkDrafts] = useState<Record<string, SidebarLink>>({})
  const sections = value?.sections ?? DEFAULT_SECTIONS

  const updateSections = (next: SidebarSection[]) =>
    onChange({ sections: next })

  const moveSection = (index: number, offset: number) => {
    const next = [...sections]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    updateSections(next)
  }

  const updateExternalSection = (
    index: number,
    update: Partial<SidebarSection>,
  ) => {
    updateSections(
      sections.map((section, current) =>
        current === index ? { ...section, ...update } : section,
      ),
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Reorder the existing sidebar sections and add external links in their
        own sections. Existing options stay grouped as they are today.
      </p>
      <ol className="space-y-3">
        {sections.map((section, index) => (
          <li key={section.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              {section.kind === "external" ? (
                <Input
                  aria-label="Section title"
                  placeholder="Section title"
                  value={section.title ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    updateExternalSection(index, { title: event.target.value })
                  }
                />
              ) : (
                <span className="flex-1 text-sm font-medium">
                  {SECTION_LABELS[section.kind]}
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Move ${SECTION_LABELS[section.kind]} up`}
                disabled={disabled || index === 0}
                onClick={() => moveSection(index, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Move ${SECTION_LABELS[section.kind]} down`}
                disabled={disabled || index === sections.length - 1}
                onClick={() => moveSection(index, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              {section.kind === "external" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Delete external link section"
                  disabled={disabled}
                  onClick={() =>
                    updateSections(
                      sections.filter((_, current) => current !== index),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {section.kind === "external" && (
              <div className="space-y-2">
                {(section.links ?? []).map((link) => (
                  <div key={link.id} className="flex flex-wrap gap-2">
                    <Input
                      aria-label="Link name"
                      placeholder="Link name"
                      value={link.label}
                      disabled={disabled}
                      onChange={(event) =>
                        updateExternalSection(index, {
                          links: (section.links ?? []).map((item) =>
                            item.id === link.id
                              ? { ...item, label: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                    <Input
                      aria-label="Link URL"
                      placeholder="URL"
                      value={link.url}
                      disabled={disabled}
                      onChange={(event) =>
                        updateExternalSection(index, {
                          links: (section.links ?? []).map((item) =>
                            item.id === link.id
                              ? { ...item, url: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Delete external link"
                      disabled={disabled}
                      onClick={() =>
                        updateExternalSection(index, {
                          links: (section.links ?? []).filter(
                            (item) => item.id !== link.id,
                          ),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="Link name"
                    aria-label="New link name"
                    value={linkDrafts[section.id]?.label ?? ""}
                    disabled={disabled}
                    onChange={(event) =>
                      setLinkDrafts((drafts) => ({
                        ...drafts,
                        [section.id]: {
                          id: drafts[section.id]?.id ?? crypto.randomUUID(),
                          label: event.target.value,
                          url: drafts[section.id]?.url ?? "",
                        },
                      }))
                    }
                  />
                  <Input
                    placeholder="URL"
                    aria-label="New link URL"
                    value={linkDrafts[section.id]?.url ?? ""}
                    disabled={disabled}
                    onChange={(event) =>
                      setLinkDrafts((drafts) => ({
                        ...drafts,
                        [section.id]: {
                          id: drafts[section.id]?.id ?? crypto.randomUUID(),
                          label: drafts[section.id]?.label ?? "",
                          url: event.target.value,
                        },
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      disabled ||
                      !linkDrafts[section.id]?.label ||
                      !linkDrafts[section.id]?.url
                    }
                    onClick={() => {
                      const link = linkDrafts[section.id]
                      if (!link) return
                      updateExternalSection(index, {
                        links: [...(section.links ?? []), link],
                      })
                      setLinkDrafts((drafts) => ({
                        ...drafts,
                        [section.id]: {
                          id: crypto.randomUUID(),
                          label: "",
                          url: "",
                        },
                      }))
                    }}
                  >
                    Add link
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            updateSections([
              ...sections,
              {
                id: crypto.randomUUID(),
                kind: "external",
                title: "External links",
                links: [],
              },
            ])
          }
        >
          <Plus className="mr-2 h-4 w-4" /> Add external link section
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            Use default navigation
          </Button>
        )}
      </div>
    </div>
  )
}
